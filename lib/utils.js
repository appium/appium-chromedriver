import _ from 'lodash';
import {system, fs, node} from '@appium/support';
import {BaseDriver} from '@appium/base-driver';
import path from 'path';
import {compareVersions} from 'compare-versions';
import axios from 'axios';
import os from 'os';
import {OS, CPU} from './constants';

const CD_EXECUTABLE_PREFIX = 'chromedriver';
const MODULE_NAME = 'appium-chromedriver';

/**
 * Calculates the path to the current module's root folder
 *
 * @returns {string} The full path to module root
 * @throws {Error} If the current module root folder cannot be determined
 */
const getModuleRoot = _.memoize(function getModuleRoot() {
  const root = node.getModuleRootSync(MODULE_NAME, __filename);
  if (!root) {
    throw new Error(`Cannot find the root folder of the ${MODULE_NAME} Node.js module`);
  }
  return root;
});

// Chromedriver version: minimum Chrome version
const CHROMEDRIVER_CHROME_MAPPING = require(path.join(getModuleRoot(), 'config', 'mapping.json'));
const CD_BASE_DIR = path.join(getModuleRoot(), 'chromedriver');

/**
 *
 * @param {import('./types').ChromedriverVersionMapping} mapping
 * @returns {string}
 */
function getMostRecentChromedriver(mapping = CHROMEDRIVER_CHROME_MAPPING) {
  if (_.isEmpty(mapping)) {
    throw new Error('Unable to get most recent Chromedriver version from empty mapping');
  }
  return /** @type {string} */ (_.last(_.keys(mapping).sort(compareVersions)));
}

const CD_VER =
  process.env.npm_config_chromedriver_version ||
  process.env.CHROMEDRIVER_VERSION ||
  getMostRecentChromedriver();

/**
 *
 * @param {import('appium-adb').ADB} adb
 * @param {string} bundleId
 * @returns
 */
async function getChromeVersion(adb, bundleId) {
  const {versionName} = await adb.getPackageInfo(bundleId);
  return versionName;
}

function getChromedriverDir(osName = getOsName()) {
  return path.resolve(CD_BASE_DIR, osName);
}

/**
 *
 * @param {string} osName
 * @returns {Promise<string>}
 */
async function getChromedriverBinaryPath(osName = getOsName()) {
  const rootDir = getChromedriverDir(osName);
  const pathSuffix = osName === OS.WINDOWS ? '.exe' : '';
  const paths = await fs.glob(`${CD_EXECUTABLE_PREFIX}*${pathSuffix}`, {
    cwd: rootDir,
    absolute: true,
    nocase: true,
    nodir: true,
  });
  return _.isEmpty(paths)
    ? path.resolve(rootDir, `${CD_EXECUTABLE_PREFIX}${pathSuffix}`)
    : /** @type {string} */ (_.first(paths));
}

/**
 *
 * @param {string} url
 * @param {import('axios').AxiosRequestConfig['headers']} headers
 * @param {Pick<import('axios').AxiosRequestConfig, 'timeout'|'responseType'>} opts
 * @returns
 */
async function retrieveData(url, headers, opts = {}) {
  const {timeout = 5000, responseType = 'text'} = opts;
  return (
    await axios({
      url,
      headers,
      timeout,
      responseType,
    })
  ).data;
}

/**
 * @returns {keyof OS}
 */
const getOsName = _.memoize(function getOsName() {
  if (system.isWindows()) {
    return OS.WINDOWS;
  }
  if (system.isMac()) {
    return OS.MAC;
  }
  return OS.LINUX;
});

const getCpuType = _.memoize(
  /**
   * @returns {string}
   */
  function getCpuType() {
    return _.includes(_.toLower(os.cpus()[0].model), 'apple') ? CPU.ARM : CPU.INTEL;
  }
);

const getOsInfo = _.memoize(
  /**
   * @returns {Promise<import('./types').OSInfo>}
   */
  async function getOsInfo() {
    return {
      name: getOsName(),
      arch: String(await system.arch()),
      cpu: getCpuType(),
    };
  }
);

// @ts-expect-error
// error TS2345: Argument of type '{}' is not assignable to parameter of type 'DriverOpts<Readonly<Record<string, Constraint>>>'
// Type '{}' is missing the following properties from type 'ServerArgs': address, allowCors, allowInsecure, basePath, and 26 more.
const getBaseDriverInstance = _.memoize(() => new BaseDriver({}, false));

/**
 * Generates log prefix string
 *
 * @param {any} obj log owner instance
 * @param {string?} sessionId Optional session identifier
 * @returns {string}
 */
function generateLogPrefix(obj, sessionId = null) {
  return getBaseDriverInstance().helpers.generateDriverLogPrefix(
    obj,
    sessionId ? sessionId : undefined
  );
}

/**
 * Converts the given object to an integer number if possible
 *
 * @param {any} value to be converted
 * @returns {number | null}
 */
function convertToInt(value) {
  switch (typeof value) {
    case 'number':
      return Number.isNaN(value) ? null : value;
    case 'string': {
      const parsedAsInt = parseInt(value, 10);
      return Number.isNaN(parsedAsInt) ? null : parsedAsInt;
    }
    default:
      return null;
  }
}

export {
  getChromeVersion,
  getChromedriverDir,
  getChromedriverBinaryPath,
  getOsName,
  CD_BASE_DIR,
  CD_VER,
  CHROMEDRIVER_CHROME_MAPPING,
  getMostRecentChromedriver,
  retrieveData,
  getOsInfo,
  getCpuType,
  OS,
  generateLogPrefix,
  convertToInt,
};
