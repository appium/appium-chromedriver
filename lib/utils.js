import _ from 'lodash';
import { system, fs, node } from '@appium/support';
import { BaseDriver } from '@appium/base-driver';
import path from 'path';
import { compareVersions } from 'compare-versions';
import axios from 'axios';
import { exec } from 'teen_process';

const CD_CDN = process.env.npm_config_chromedriver_cdnurl
  || process.env.CHROMEDRIVER_CDNURL
  || 'https://chromedriver.storage.googleapis.com';
const OS = {
  linux: 'linux',
  windows: 'win',
  mac: 'mac'
};
const X64 = '64';
const X86 = '32';
const M1_ARCH_SUFFIX = '_m1';
const CD_EXECUTABLE_PREFIX = 'chromedriver';
const MODULE_NAME = 'appium-chromedriver';

/**
 * Calculates the path to the current module's root folder
 *
 * @returns {string} The full path to module root
 * @throws {Error} If the current module root folder cannot be determined
 */
const getModuleRoot = _.memoize(function getModuleRoot () {
  const root = node.getModuleRootSync(MODULE_NAME, __filename);
  if (!root) {
    throw new Error(`Cannot find the root folder of the ${MODULE_NAME} Node.js module`);
  }
  return root;
});

// Chromedriver version: minimum Chrome version
const CHROMEDRIVER_CHROME_MAPPING = require(path.join(getModuleRoot(), 'config', 'mapping.json'));
const CD_BASE_DIR = path.join(getModuleRoot(), 'chromedriver');

function getMostRecentChromedriver (mapping = CHROMEDRIVER_CHROME_MAPPING) {
  if (_.isEmpty(mapping)) {
    throw new Error('Unable to get most recent Chromedriver version from empty mapping');
  }
  return _.last(_.keys(mapping).sort(compareVersions));
}

const CD_VER = process.env.npm_config_chromedriver_version
  || process.env.CHROMEDRIVER_VERSION
  || getMostRecentChromedriver();

async function getChromeVersion (adb, bundleId) {
  const {versionName} = await adb.getPackageInfo(bundleId);
  return versionName;
}

function getChromedriverDir (osName = getOsName()) {
  return path.resolve(CD_BASE_DIR, osName);
}

async function getChromedriverBinaryPath (osName = getOsName()) {
  const rootDir = getChromedriverDir(osName);
  const pathSuffix = osName === OS.windows ? '.exe' : '';
  const paths = await fs.glob(`${CD_EXECUTABLE_PREFIX}*${pathSuffix}`, {
    cwd: rootDir,
    absolute: true,
    nocase: true,
    nodir: true,
    strict: false,
  });
  return _.isEmpty(paths)
    ? path.resolve(rootDir, `${CD_EXECUTABLE_PREFIX}${pathSuffix}`)
    : _.first(paths);
}

async function retrieveData (url, headers, opts = {}) {
  const {
    timeout = 5000,
    responseType = 'text',
  } = opts;
  return (await axios({
    url,
    headers,
    timeout,
    responseType,
  })).data;
}

const getOsName = _.memoize(function getOsName () {
  if (system.isWindows()) {
    return OS.windows;
  }
  if (system.isMac()) {
    return OS.mac;
  }
  return OS.linux;
});

const getOsInfo = _.memoize(async function getOsInfo () {
  return {
    name: getOsName(),
    arch: await system.arch(),
    hardwareName: system.isWindows() ? null : _.trim(await exec('uname', ['-m'])),
  };
});

const getBaseDriverInstance = _.memoize(() => new BaseDriver({}, false));

/**
 * Generates log prefix string
 *
 * @param {object} obj log owner instance
 * @param {string?} sessionId Optional session identifier
 * @returns {string}
 */
function generateLogPrefix (obj, sessionId = null) {
  return getBaseDriverInstance().helpers.generateDriverLogPrefix(obj, sessionId);
}


export {
  getChromeVersion, getChromedriverDir, getChromedriverBinaryPath, getOsName,
  CD_BASE_DIR, CD_CDN, CD_VER, CHROMEDRIVER_CHROME_MAPPING, getMostRecentChromedriver,
  retrieveData, getOsInfo, OS, X64, X86, M1_ARCH_SUFFIX, generateLogPrefix,
};
