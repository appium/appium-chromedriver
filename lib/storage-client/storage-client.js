import {
  getChromedriverDir,
  retrieveData,
  getOsInfo,
  convertToInt,
  getCpuType,
} from '../utils';
import _ from 'lodash';
import B from 'bluebird';
import path from 'path';
import {system, fs, logger, tempDir, zip, util, net} from '@appium/support';
import {
  STORAGE_REQ_TIMEOUT_MS,
  GOOGLEAPIS_CDN,
  USER_AGENT,
  CHROMELABS_URL,
  ARCH,
  OS,
  CPU,
} from '../constants';
import {parseGoogleapiStorageXml} from './googleapis';
import {parseKnownGoodVersionsWithDownloadsJson} from './chromelabs';
import {compareVersions} from 'compare-versions';
import semver from 'semver';

const MAX_PARALLEL_DOWNLOADS = 5;

const log = logger.getLogger('ChromedriverStorageClient');

/**
 *
 * @param {string} src
 * @param {string} checksum
 * @returns {Promise<boolean>}
 */
async function isCrcOk(src, checksum) {
  const md5 = await fs.hash(src, 'md5');
  return _.toLower(md5) === _.toLower(checksum);
}

export class ChromedriverStorageClient {
  /**
   *
   * @param {import('../types').ChromedriverStorageClientOpts} args
   */
  constructor(args = {}) {
    const {chromedriverDir = getChromedriverDir(), timeout = STORAGE_REQ_TIMEOUT_MS} = args;
    this.chromedriverDir = chromedriverDir;
    this.timeout = timeout;
    /** @type {ChromedriverDetailsMapping} */
    this.mapping = {};
  }

  /**
   * Retrieves chromedriver mapping from the storage
   *
   * @param {boolean} shouldParseNotes [true] - if set to `true`
   * then additional chromedrivers info is going to be retrieved and
   * parsed from release notes
   * @returns {Promise<ChromedriverDetailsMapping>}
   */
  async retrieveMapping(shouldParseNotes = true) {
    const [xmlStr, jsonStr] = await B.all([
      [GOOGLEAPIS_CDN, 'application/xml'],
      [`${CHROMELABS_URL}/chrome-for-testing/known-good-versions-with-downloads.json`, 'application/json'],
    ]
    .map(([url, contentType]) => url
      ? retrieveData(url, {
          'user-agent': USER_AGENT,
          accept: `${contentType}, */*`,
        }, {timeout: this.timeout})
      : B.resolve()
    ));
    this.mapping = xmlStr ? await parseGoogleapiStorageXml(xmlStr, shouldParseNotes) : {};
    Object.assign(this.mapping, parseKnownGoodVersionsWithDownloadsJson(jsonStr));
    return this.mapping;
  }

  /**
   * Extracts downloaded chromedriver archive
   * into the given destination
   *
   * @param {string} src - The source archive path
   * @param {string} dst - The destination chromedriver path
   */
  async unzipDriver(src, dst) {
    const tmpRoot = await tempDir.openDir();
    try {
      await zip.extractAllTo(src, tmpRoot);
      const chromedriverPath = await fs.walkDir(
        tmpRoot,
        true,
        (itemPath, isDirectory) =>
          !isDirectory && _.toLower(path.parse(itemPath).name) === 'chromedriver'
      );
      if (!chromedriverPath) {
        throw new Error(
          'The archive was unzipped properly, but we could not find any chromedriver executable'
        );
      }
      log.debug(`Moving the extracted '${path.basename(chromedriverPath)}' to '${dst}'`);
      await fs.mv(chromedriverPath, dst, {
        mkdirp: true,
      });
    } finally {
      await fs.rimraf(tmpRoot);
    }
  }

  /**
   * Filters `this.mapping` to only select matching
   * chromedriver entries by operating system information
   * and/or additional synchronization options (if provided)
   *
   * @param {OSInfo} osInfo
   * @param {SyncOptions} opts
   * @returns {Array<String>} The list of filtered chromedriver
   * entry names (version/archive name)
   */
  selectMatchingDrivers(osInfo, opts = {}) {
    const {minBrowserVersion, versions = []} = opts;
    let driversToSync = _.keys(this.mapping);

    if (!_.isEmpty(versions)) {
      // Handle only selected versions if requested
      log.debug(`Selecting chromedrivers whose versions match to ${versions}`);
      driversToSync = driversToSync.filter((cdName) =>
        versions.includes(`${this.mapping[cdName].version}`)
      );

      log.debug(`Got ${util.pluralize('item', driversToSync.length, true)}`);
      if (_.isEmpty(driversToSync)) {
        return [];
      }
    }

    const minBrowserVersionInt = convertToInt(minBrowserVersion);
    if (minBrowserVersionInt !== null) {
      // Only select drivers that support the current browser whose major version number equals to `minBrowserVersion`
      log.debug(
        `Selecting chromedrivers whose minimum supported browser version matches to ${minBrowserVersionInt}`
      );
      let closestMatchedVersionNumber = 0;
      // Select the newest available and compatible chromedriver
      for (const cdName of driversToSync) {
        const currentMinBrowserVersion = parseInt(
          String(this.mapping[cdName].minBrowserVersion),
          10
        );
        if (
          !Number.isNaN(currentMinBrowserVersion) &&
          currentMinBrowserVersion <= minBrowserVersionInt &&
          closestMatchedVersionNumber < currentMinBrowserVersion
        ) {
          closestMatchedVersionNumber = currentMinBrowserVersion;
        }
      }
      driversToSync = driversToSync.filter(
        (cdName) =>
          `${this.mapping[cdName].minBrowserVersion}` ===
          `${closestMatchedVersionNumber > 0 ? closestMatchedVersionNumber : minBrowserVersionInt}`
      );

      log.debug(`Got ${util.pluralize('item', driversToSync.length, true)}`);
      if (_.isEmpty(driversToSync)) {
        return [];
      }
      log.debug(
        `Will select candidate ${util.pluralize('driver', driversToSync.length)} ` +
          `versioned as '${_.uniq(driversToSync.map((cdName) => this.mapping[cdName].version))}'`
      );
    }

    if (!_.isEmpty(osInfo)) {
      // Filter out drivers for unsupported system architectures
      const {name, arch, cpu = getCpuType()} = osInfo;
      log.debug(`Selecting chromedrivers whose platform matches to ${name}:${cpu}${arch}`);
      let result = driversToSync.filter((cdName) => this.doesMatchForOsInfo(cdName, osInfo));
      if (_.isEmpty(result) && arch === ARCH.X64 && cpu === CPU.INTEL) {
        // Fallback to X86 if X64 architecture is not available for this driver
        result = driversToSync.filter((cdName) => this.doesMatchForOsInfo(cdName, {
          name, arch: ARCH.X86, cpu
        }));
      }
      if (_.isEmpty(result) && name === OS.MAC && cpu === CPU.ARM) {
        // Fallback to Intel/Rosetta if ARM architecture is not available for this driver
        result = driversToSync.filter((cdName) => this.doesMatchForOsInfo(cdName, {
          name, arch, cpu: CPU.INTEL
        }));
      }
      driversToSync = result;
      log.debug(`Got ${util.pluralize('item', driversToSync.length, true)}`);
    }

    if (!_.isEmpty(driversToSync)) {
      log.debug('Excluding older patches if present');
      /** @type {{[key: string]: string[]}} */
      const patchesMap = {};
      // Older chromedrivers must not be excluded as they follow a different
      // versioning pattern
      const versionWithPatchPattern = /\d+\.\d+\.\d+\.\d+/;
      const selectedVersions = new Set();
      for (const cdName of driversToSync) {
        const cdVersion = this.mapping[cdName].version;
        if (!versionWithPatchPattern.test(cdVersion)) {
          selectedVersions.add(cdVersion);
          continue;
        }
        const verObj = semver.parse(cdVersion, {loose: true});
        if (!verObj) {
          continue;
        }
        if (!_.isArray(patchesMap[verObj.major])) {
          patchesMap[verObj.major] = [];
        }
        patchesMap[verObj.major].push(cdVersion);
      }
      for (const majorVersion of _.keys(patchesMap)) {
        if (patchesMap[majorVersion].length <= 1) {
          continue;
        }
        patchesMap[majorVersion].sort(
          (/** @type {string} */ a, /** @type {string}} */ b) => compareVersions(b, a)
        );
      }
      if (!_.isEmpty(patchesMap)) {
        log.debug('Versions mapping: ' + JSON.stringify(patchesMap, null, 2));
        for (const sortedVersions of _.values(patchesMap)) {
          selectedVersions.add(sortedVersions[0]);
        }
        driversToSync = driversToSync.filter(
          (cdName) => selectedVersions.has(this.mapping[cdName].version)
        );
      }
    }

    return driversToSync;
  }

  /**
   * Checks whether the given chromedriver matches the operating system to run on
   *
   * @param {string} cdName
   * @param {OSInfo} osInfo
   * @returns {boolean}
   */
  doesMatchForOsInfo(cdName, {name, arch, cpu}) {
    const cdInfo = this.mapping[cdName];
    if (!cdInfo) {
      return false;
    }

    if (cdInfo.os.name !== name || cdInfo.os.arch !== arch) {
      return false;
    }
    if (cpu && cdInfo.os.cpu && this.mapping[cdName].os.cpu !== cpu) {
      return false;
    }

    return true;
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
   * @returns {Promise<boolean>} if `true` then the chromedriver is successfully
   * downloaded and extracted.
   */
  async retrieveDriver(index, driverKey, archivesRoot, isStrict = false) {
    const {url, etag, version} = this.mapping[driverKey];
    const archivePath = path.resolve(archivesRoot, `${index}.zip`);
    log.debug(`Retrieving '${url}' to '${archivePath}'`);
    try {
      await net.downloadFile(url, archivePath, {
        isMetered: false,
        timeout: STORAGE_REQ_TIMEOUT_MS,
      });
    } catch (e) {
      const err = /** @type {Error} */ (e);
      const msg = `Cannot download chromedriver archive. Original error: ${err.message}`;
      if (isStrict) {
        throw new Error(msg);
      }
      log.error(msg);
      return false;
    }
    if (etag && !(await isCrcOk(archivePath, etag))) {
      const msg = `The checksum for the downloaded chromedriver '${driverKey}' did not match`;
      if (isStrict) {
        throw new Error(msg);
      }
      log.error(msg);
      return false;
    }
    const fileName = `${path.parse(url).name}_v${version}` + (system.isWindows() ? '.exe' : '');
    const targetPath = path.resolve(this.chromedriverDir, fileName);
    try {
      await this.unzipDriver(archivePath, targetPath);
      await fs.chmod(targetPath, 0o755);
      log.debug(`Permissions of the file '${targetPath}' have been changed to 755`);
    } catch (e) {
      const err = /** @type {Error} */ (e);
      if (isStrict) {
        throw err;
      }
      log.error(err.message);
      return false;
    }
    return true;
  }

  /**
   * Retrieves chromedrivers from the remote storage
   * to the local file system
   *
   * @param {SyncOptions} opts
   * @throws {Error} if there was a problem while retrieving
   * the drivers
   * @returns {Promise<string[]>} The list of successfully synchronized driver keys
   */
  async syncDrivers(opts = {}) {
    if (_.isEmpty(this.mapping)) {
      await this.retrieveMapping(!!opts.minBrowserVersion);
    }
    if (_.isEmpty(this.mapping)) {
      throw new Error('Cannot retrieve chromedrivers mapping from Google storage');
    }

    const driversToSync = this.selectMatchingDrivers(opts.osInfo ?? (await getOsInfo()), opts);
    if (_.isEmpty(driversToSync)) {
      log.debug(`There are no drivers to sync. Exiting`);
      return [];
    }
    log.debug(
      `Got ${util.pluralize('driver', driversToSync.length, true)} to sync: ` +
        JSON.stringify(driversToSync, null, 2)
    );

    /**
     * @type {string[]}
     */
    const synchronizedDrivers = [];
    const promises = [];
    const chunk = [];
    const archivesRoot = await tempDir.openDir();
    try {
      for (const [idx, driverKey] of driversToSync.entries()) {
        const promise = B.resolve(
          (async () => {
            if (await this.retrieveDriver(idx, driverKey, archivesRoot, !_.isEmpty(opts))) {
              synchronizedDrivers.push(driverKey);
            }
          })()
        );
        promises.push(promise);
        chunk.push(promise);
        if (chunk.length >= MAX_PARALLEL_DOWNLOADS) {
          await B.any(chunk);
        }
        _.remove(chunk, (p) => p.isFulfilled());
      }
      await B.all(promises);
    } finally {
      await fs.rimraf(archivesRoot);
    }
    if (!_.isEmpty(synchronizedDrivers)) {
      log.info(
        `Successfully synchronized ` +
        `${util.pluralize('chromedriver', synchronizedDrivers.length, true)}`
      );
    } else {
      log.info(`No chromedrivers were synchronized`);
    }
    return synchronizedDrivers;
  }
}

export default ChromedriverStorageClient;

/**
 * @typedef {import('../types').SyncOptions} SyncOptions
 * @typedef {import('../types').OSInfo} OSInfo
 * @typedef {import('../types').ChromedriverDetails} ChromedriverDetails
 * @typedef {import('../types').ChromedriverDetailsMapping} ChromedriverDetailsMapping
 */
