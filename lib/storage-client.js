import { getChromedriverDir } from './utils';
import _ from 'lodash';
import requestPromise from 'request-promise';
import request from 'request';
import xpath from 'xpath';
import { DOMParser } from 'xmldom';
import B from 'bluebird';
import path from 'path';
import { system, fs, logger, tempDir, zip, util } from 'appium-support';


const STORAGE_URL = 'https://chromedriver.storage.googleapis.com';
const TIMEOUT_MS = 15000;
const MAX_PARALLEL_DOWNLOADS = 5;

const log = logger.getLogger('ChromedriverStorageClient');

async function walkDir (dir) {
  const result = [];
  for (const name of await fs.readdir(dir)) {
    const currentPath = path.join(dir, name);
    result.push(currentPath);
    if ((await fs.stat(currentPath)).isDirectory()) {
      result.push(...(await walkDir(currentPath)));
    }
  }
  return result;
}

async function getOsInfo () {
  let name = 'linux';
  if (system.isWindows()) {
    name = 'win';
  } else if (system.isMac()) {
    name = 'mac';
  }
  return {
    name,
    arch: await system.arch(),
  };
}

async function isCrcOk (src, checksum) {
  const md5 = await fs.hash(src, 'md5');
  return _.toLower(md5) === _.toLower(checksum);
}

function findChildNode (parent, childName = null, text = null) {
  if (!childName && !text) {
    return null;
  }
  if (!parent.hasChildNodes()) {
    return null;
  }

  for (let childNodeIdx = 0; childNodeIdx < parent.childNodes.length; childNodeIdx++) {
    const childNode = parent.childNodes[childNodeIdx];
    if (childName && !text && childName === childNode.localName) {
      return childNode;
    }
    if (text) {
      const childText = extractNodeText(childNode);
      if (!childText) {
        continue;
      }
      if (childName && childName === childNode.localName && text === childText) {
        return childNode;
      }
      if (!childName && text === childText) {
        return childNode;
      }
    }
  }
  return null;
}

function extractNodeText (node) {
  return (!node || !node.firstChild || !util.hasValue(node.firstChild.nodeValue))
    ? null
    : node.firstChild.nodeValue;
}


class ChromedriverStorageClient {
  constructor (args = {}) {
    const {
      chromedriverDir = getChromedriverDir(),
      timeout = TIMEOUT_MS,
    } = args;
    this.chromedriverDir = chromedriverDir;
    this.timeout = timeout;
    this.mapping = {};
  }

  parseNotes (content) {
    const result = {};
    const versionMatch = /^\s*[-]+ChromeDriver[\D]+([\d.]+)/im.exec(content);
    if (versionMatch) {
      result.version = versionMatch[1];
    }
    const minBrowserVersionMatch = /^\s*Supports Chrome[\D]+(\d+)/im.exec(content);
    if (minBrowserVersionMatch) {
      result.minBrowserVersion = minBrowserVersionMatch[1];
    }
    return result;
  }

  async retrieveAdditionalDriverInfo (driverKey, notesUrl, infoDict) {
    const response = await requestPromise({
      url: notesUrl,
      method: 'GET',
      headers: {
        'user-agent': 'appium',
        accept: '*/*',
      },
      resolveWithFullResponse: true,
      timeout: this.timeout,
    });
    const { minBrowserVersion } = this.parseNotes(response.body);
    if (!minBrowserVersion) {
      log.debug(`The driver '${driverKey}' does not contain valid notes. Skipping it`);
      return;
    }
    infoDict.minBrowserVersion = minBrowserVersion;
  }

  async parseStorageXml (doc, shouldParseNotes = true) {
    const driverNodes = xpath.select(`//*[local-name(.)='Contents']`, doc);
    log.debug(`Parsed ${driverNodes.length} entries from storage XML`);
    if (_.isEmpty(driverNodes)) {
      return;
    }

    const fibers = [];
    for (const driverNode of driverNodes) {
      const key = extractNodeText(findChildNode(driverNode, 'Key'));
      if (!_.includes(key, '/chromedriver_')) {
        continue;
      }

      log.debug(`Processing chromedriver entry '${key}'`);
      const etag = extractNodeText(findChildNode(driverNode, 'ETag'));
      if (!etag) {
        log.debug(`The entry '${key}' does not contain the checksum. Skipping it`);
        continue;
      }

      const cdInfo = {
        url: `${STORAGE_URL}/${key}`,
        etag: _.trim(etag, '"'),
        version: _.first(key.split('/')),
      };
      this.mapping[key] = cdInfo;
      log.debug(`Added a new entry to the storage mapping: ${JSON.stringify(cdInfo)}`);

      const notesPath = `${cdInfo.version}/notes.txt`;
      const isNotesPresent = !!driverNodes
        .reduce((acc, node) => acc || findChildNode(node, 'Key', notesPath), false);
      if (!isNotesPresent) {
        cdInfo.minBrowserVersion = null;
        if (shouldParseNotes) {
          log.info(`The entry '${key}' does not contain any notes. Skipping it`);
        }
        continue;
      } else if (!shouldParseNotes) {
        continue;
      }

      fibers.push(this.retrieveAdditionalDriverInfo(key, `${STORAGE_URL}/${notesPath}`, cdInfo));
      if (fibers.length % MAX_PARALLEL_DOWNLOADS === 0) {
        await B.all(fibers);
      }
    }
    await B.all(fibers);
    log.info(`The total count of entries in the mapping: ${_.size(this.mapping)}`);
  }

  async retrieveMapping (shouldParseNotes = true) {
    const response = await requestPromise({
      url: STORAGE_URL,
      method: 'GET',
      headers: {
        'user-agent': 'appium',
        accept: 'application/xml, */*',
      },
      resolveWithFullResponse: true,
      timeout: this.timeout,
    });
    const doc = new DOMParser().parseFromString(response.body);
    await this.parseStorageXml(doc, shouldParseNotes);
    return _.cloneDeep(this.mapping);
  }

  async unzipDriver (src, dst) {
    const tmpRoot = await tempDir.openDir();
    try {
      await zip.extractAllTo(src, tmpRoot);
      const allExtractedItems = await walkDir(tmpRoot);
      const chromedriverPath = allExtractedItems
        .find((p) => path.parse(p).name === 'chromedriver');
      if (!chromedriverPath) {
        throw new Error('The archive was unzipped properly, but we could not find any chromedriver executable');
      }
      log.debug(`Moving the extracted '${path.basename(chromedriverPath)}' to '${dst}'`);
      await fs.mv(chromedriverPath, dst, {
        mkdirp: true
      });
    } finally {
      await fs.rimraf(tmpRoot);
    }
  }

  selectMatchingDrivers (osInfo, opts = {}) {
    const {
      minBrowserVersion,
      versions = [],
    } = opts;
    let driversToSync = _.keys(this.mapping);

    if (!_.isEmpty(versions)) {
      // Handle only selected versions if requested
      log.debug(`Selecting chromedrivers whose versions match to ${versions}`);
      driversToSync = driversToSync
        .filter((x) => versions.includes(`${this.mapping[x].version}`));
      log.debug(`Got ${driversToSync.length} item${driversToSync.length === 1 ? '' : 's'}`);
    }

    if (minBrowserVersion) {
      // Only select drivers, where the given browser version is set as the minimal one
      log.debug(`Selecting chromedrivers whose minimum supported browser version matches to ${minBrowserVersion}`);
      driversToSync = driversToSync.reduce(
        (acc, x) => this.mapping[x].minBrowserVersion === `${minBrowserVersion}` ? [...acc, x] : acc, []);
      log.debug(`Got ${driversToSync.length} item${driversToSync.length === 1 ? '' : 's'}`);
    }

    // Filter out driver for unsupported system architectures
    let {name, arch} = osInfo;
    if (arch === '64' && !driversToSync.some((x) => x.includes(`_${name}64`))) {
      // Fall back to x86 build if x64 one is not available for the given OS
      arch = '32';
    }
    log.debug(`Selecting chromedrivers whose platform matches to ${name}${arch}`);
    driversToSync = driversToSync.filter((x) => x.includes(`_${name}${arch}`));
    log.debug(`Got ${driversToSync.length} item${driversToSync.length === 1 ? '' : 's'}`);

    return driversToSync;
  }

  async retrieveDriver (index, driverKey, archivesRoot, isStrict = false) {
    const { url, etag, version } = this.mapping[driverKey];
    const archivePath = path.resolve(archivesRoot, `${index}.zip`);
    log.debug(`Retrieving '${url}' to '${archivePath}'`);
    try {
      await new B((resolve, reject) => {
        request(url)
          .on('error', reject)
          .on('response', (res) => {
            // handle responses that fail, like 404s
            if (res.statusCode >= 400) {
              return reject(`Error downloading chromedriver at ${url}: ${res.statusCode}`);
            }
          })
          .pipe(fs.createWriteStream(archivePath))
          .on('close', resolve);
      });
    } catch (e) {
      const msg = `Cannot download chromedriver archive. Original error: ${e.message}`;
      if (isStrict) {
        throw new Error(msg);
      }
      log.error(msg);
      return false;
    }
    if (!await isCrcOk(archivePath, etag)) {
      const msg = `The checksum for the downloaded chromedriver '${driverKey}' did not match`;
      if (isStrict) {
        throw new Error(msg);
      }
      log.error(msg);
      return false;
    }
    const fileName = `${path.parse(url).name}_v${version}` +
      (system.isWindows() ? '.exe' : '');
    const targetPath = path.resolve(this.chromedriverDir, fileName);
    try {
      await this.unzipDriver(archivePath, targetPath);
    } catch (e) {
      if (isStrict) {
        throw e;
      }
      log.error(e.message);
      return false;
    }
    return true;
  }

  async syncDrivers (opts = {}) {
    if (_.isEmpty(this.mapping)) {
      await this.retrieveMapping(!!opts.minBrowserVersion);
    }
    if (_.isEmpty(this.mapping)) {
      throw new Error('Cannot retrieve chromedrivers mapping from Google storage');
    }

    const driversToSync = this.selectMatchingDrivers(await getOsInfo(), opts);
    if (_.isEmpty(driversToSync)) {
      log.debug(`There are no drivers to sync. Exiting`);
      return;
    }
    log.debug(`Got ${driversToSync.length} driver(s) to sync: ${driversToSync}`);

    let synchronizedDriversCount = 0;
    const fibers = [];
    const archivesRoot = await tempDir.openDir();
    try {
      for (const [idx, driverKey] of driversToSync.entries()) {
        fibers.push((async () => {
          if (await this.retrieveDriver(idx, driverKey, archivesRoot, !_.isEmpty(opts))) {
            synchronizedDriversCount++;
          }
        })());

        if (fibers.length % MAX_PARALLEL_DOWNLOADS === 0) {
          await B.all(fibers);
        }
      }
      await B.all(fibers);
    } finally {
      await fs.rimraf(archivesRoot);
    }
    if (synchronizedDriversCount) {
      log.info(`Successfully synchronized ${synchronizedDriversCount} chromedriver${synchronizedDriversCount === 1 ? '' : 's'}`);
    } else {
      log.info(`No chromedrivers were synchronized`);
    }
  }
}

export default ChromedriverStorageClient;