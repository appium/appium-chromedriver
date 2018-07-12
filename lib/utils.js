import { system } from 'appium-support';
import path from 'path';


const CD_BASE_DIR = path.resolve(__dirname, '..', '..', 'chromedriver');

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

export { getChromeVersion, getChromedriverDir, getChromedriverBinaryPath,
         getCurPlatform, CD_BASE_DIR };
