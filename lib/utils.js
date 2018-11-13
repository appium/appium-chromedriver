import { system } from 'appium-support';
import path from 'path';
import { CD_VER } from './chromedriver';
import semver from 'semver';


const CD_BASE_DIR = path.resolve(__dirname, '..', '..', 'chromedriver');

const MAC_32_ONLY = semver('2.23.0');
const LINUX_32_ONLY = semver('2.34.0');

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

export {
  getChromeVersion, getChromedriverDir, getChromedriverBinaryPath,
  getCurPlatform, getPlatforms, CD_BASE_DIR, MAC_32_ONLY, LINUX_32_ONLY,
};
