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

  /**
   * @typedef {Object} AdditionalDriverDetails
   * @property {?string} version - Chromedriver version
   * or `null` if it cannot be found
   * @property {?string} minBrowserVersion - The minimum browser version
   * supported by chromedriver or `null` if it cannot be found
   */

  /**
   * Gets additional chromedriver details from chromedriver
   * release notes
   *
   * @param {string} content - Release notes of the corresponding chromedriver
   * @returns {AdditionalDriverDetails}
   */
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

  /**
   * Downloads chromedriver release notes and puts them
   * into the dictionary argument
   *
   * @param {string} driverKey - Driver version plus archive name
   * @param {string} notesUrl - The URL of chromedriver notes
   * @param {Object} infoDict - The dictionary containing driver info.
   * The method call mutates by merging `AdditionalDriverDetails`
   * @throws {Error} if the release notes cannot be downloaded
   */
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
      log.debug(`The driver '${driverKey}' does not contain valid release notes at ${notesUrl}. ` +
        `Skipping it`);
      return;
    }
    infoDict.minBrowserVersion = minBrowserVersion;
  }

  /**
   * Parses chromedriver storage XML and stores
   * the parsed results into `this.mapping`
   *
   * @param {DOMDocument} doc - The DOM representation
   * of the chromedriver storage XML
   * @param {boolean} shouldParseNotes [true] - If set to `true`
   * then additional drivers information is going to be parsed
   * and assigned to `this.mapping`
   */
  async parseStorageXml (doc, shouldParseNotes = true) {
    const driverNodes = xpath.select(`//*[local-name(.)='Contents']`, doc);
    log.debug(`Parsed ${driverNodes.length} entries from storage XML`);
    if (_.isEmpty(driverNodes)) {
      return;
    }

    const promises = [];
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

      promises.push(this.retrieveAdditionalDriverInfo(key, `${STORAGE_URL}/${notesPath}`, cdInfo));
      if (promises.length % MAX_PARALLEL_DOWNLOADS === 0) {
        await B.all(promises);
      }
    }
    await B.all(promises);
    log.info(`The total count of entries in the mapping: ${_.size(this.mapping)}`);
  }

  /**
   * @typedef {Object} DriverDetails
   * @property {string} url - The full url to the corresponding driver in
   * the remote storage
   * @property {string} etag - The CRC of the driver archive
   * @property {string} version - Chromedriver version
   */

  /**
   * @typedef {Object} ChromedriversMapping
   * @property {DriverDetails} - The keys are unique driver identifiers
   * (version/archive name). The corresponding values have `DriverDetails`
   * containing chromedriver details
   */

  /**
   * Retrieves chromedriver mapping from the storage
   *
   * @param {boolean} shouldParseNotes [true] - if set to `true`
   * then additional chromedrivers info is going to be retrieved and
   * parsed from release notes
   * @returns {ChromedriversMapping}
   */
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

  /**
   * Extracts downloaded chromedriver archive
   * into the given destination
   *
   * @param {string} src - The source archive path
   * @param {string} dst - The destination chromedriver path
   */
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

  /**
   * @typedef {Object} OSInfo
   * @property {string} name - The name of the host OS
   * Can be either `mac`, `windows` or `linux`
   * @property {string} arch - The architecture of the host OD.
   * Can be either `32` or `64`
   */

  /**
   * Filters `this.mapping` to only select matching
   * chromedriver entries by operating system information
   * and/or additional synchronization options (if provided)
   *
   * @param {OSInfo} osInfo
   * @param {?SyncOptions} opts
   * @returns {Array<String>} The list of filtered chromedriver
   * entry names (version/archive name)
   */
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

  /**
   * Retrieves the given chromedriver from the storage
   * and unpacks it into `this.chromedriverDir` folder
   *
   * @param {number} index - The unique driver index
   * @param {string} driverKey - The driver key in `this.mapping`
   * @param {string} archivesRoot - The temporary folder path to extract
   * downloaded archives to
   * @param {boolean} isStrict [true] - Whether to throw an error (`true`)
   * or return a boolean result if the driver retrieval process fails
   * @throws {Error} if there was a failure while retrieving the driver
   * and `isStrict` is set to `true`
   * @returns {boolean} if `true` then the chromedriver is successfully
   * downloaded and extracted
   */
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

  /**
   * @typedef {Object} SyncOptions
   * @property {Array<String>} versions - The list of chromedriver
   * versions to sync. If empty (the default value) then all available
   * chromedrivers are going to be downloaded and extracted
   * @property {string|number} minBrowserVersion - The minumum supported
   * Chrome version that downloaded chromedrivers should support. Can match
   * multiple drivers.
   */

  /**
   * Retrieves chromedrivers from the remote storage
   * to the local file system
   *
   * @param {?SyncOptions} opts
   * @throws {Error} if there was a problem while retrieving
   * the drivers
   * @returns {Array<String} The list of successfully synchronized driver keys
   */
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
      return [];
    }
    log.debug(`Got ${driversToSync.length} driver(s) to sync: ${driversToSync}`);

    const synchronizedDrivers = [];
    const promises = [];
    const archivesRoot = await tempDir.openDir();
    try {
      for (const [idx, driverKey] of driversToSync.entries()) {
        promises.push((async () => {
          if (await this.retrieveDriver(idx, driverKey, archivesRoot, !_.isEmpty(opts))) {
            synchronizedDrivers.push(driverKey);
          }
        })());

        if (promises.length % MAX_PARALLEL_DOWNLOADS === 0) {
          await B.all(promises);
        }
      }
      await B.all(promises);
    } finally {
      await fs.rimraf(archivesRoot);
    }
    if (!_.isEmpty(synchronizedDrivers)) {
      log.info(`Successfully synchronized ${synchronizedDrivers.length} ` +
        `chromedriver${synchronizedDrivers.length === 1 ? '' : 's'}`);
    } else {
      log.info(`No chromedrivers were synchronized`);
    }
    return synchronizedDrivers;
  }
}

export default ChromedriverStorageClient;