import _ from 'lodash';
import { system } from 'appium-support';
import path from 'path';
import semver from 'semver';
import compareVersions from 'compare-versions';
import axios from 'axios';


const rootDir = path.basename(__dirname) === 'lib'
  ? path.resolve(__dirname, process.env.NO_PRECOMPILE ? '..' : '../..')
  : __dirname;
// Chromedriver version: minimum Chrome version
const CHROMEDRIVER_CHROME_MAPPING = require(path.resolve(rootDir, 'config', 'mapping.json'));

const CD_VER = process.env.npm_config_chromedriver_version
  || process.env.CHROMEDRIVER_VERSION
  || getMostRecentChromedriver();
const CD_BASE_DIR = path.resolve(__dirname, '..', '..', 'chromedriver');
const CD_CDN = process.env.npm_config_chromedriver_cdnurl
  || process.env.CHROMEDRIVER_CDNURL
  || 'https://chromedriver.storage.googleapis.com';

const MAC_32_ONLY = '2.23.0';
const LINUX_32_ONLY = '2.34.0';


function getMostRecentChromedriver (mapping = CHROMEDRIVER_CHROME_MAPPING) {
  if (_.isEmpty(mapping)) {
    throw new Error('Unable to get most recent Chromedriver version from empty mapping');
  }
  return _.last(_.keys(mapping).sort(compareVersions));
}

async function getChromeVersion (adb, bundleId) {
  const {versionName} = await adb.getPackageInfo(bundleId);
  return versionName;
}

function getChromedriverDir (platform = getCurPlatform()) {
  return path.resolve(CD_BASE_DIR, platform);
}

async function getChromedriverBinaryPath (platform = getCurPlatform(), arch = null) {
  const baseDir = getChromedriverDir(platform);
  let ext = '';
  if (platform === 'win') {
    ext = '.exe';
  } else if (platform === 'linux') {
    ext = `_${arch || await system.arch()}`;
  }

  return path.resolve(baseDir, `chromedriver${ext}`);
}

function getCurPlatform () {
  return system.isWindows() ? 'win' : (system.isMac() ? 'mac' : 'linux');
}

function getPlatforms () {
  let plats = [
    ['win', '32'],
    ['linux', '64'],
  ];
  const cdVer = semver.coerce(CD_VER);
  // before 2.23 Mac version was 32 bit. After it is 64.
  plats.push(semver.lt(cdVer, MAC_32_ONLY) ? ['mac', '32'] : ['mac', '64']);
  // 2.34 and above linux is only supporting 64 bit
  if (semver.lt(cdVer, LINUX_32_ONLY)) {
    plats.push(['linux', '32']);
  }
  return plats;
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


export {
  getChromeVersion, getChromedriverDir, getChromedriverBinaryPath,
  getCurPlatform, getPlatforms, CD_BASE_DIR, MAC_32_ONLY, LINUX_32_ONLY,
  CD_CDN, CD_VER, CHROMEDRIVER_CHROME_MAPPING, getMostRecentChromedriver,
  retrieveData,
};
