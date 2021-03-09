import { fs, mkdirp } from 'appium-support';
import ChromedriverStorageClient from './storage-client';
import {
  CD_CDN, CD_VER, retrieveData, getOsInfo, getChromedriverDir,
} from './utils';


const DOWNLOAD_TIMEOUT_MS = 15 * 1000;
const LATEST_VERSION = 'LATEST';

async function formatCdVersion (ver) {
  return ver === LATEST_VERSION
    ? (await retrieveData(`${CD_CDN}/LATEST_RELEASE`, {
      'user-agent': 'appium',
      accept: '*/*',
    }, { timeout: DOWNLOAD_TIMEOUT_MS })).trim()
    : ver;
}

async function prepareChromedriverDir (platformName) {
  const chromedriverDir = getChromedriverDir(platformName);
  if (!await fs.exists(chromedriverDir)) {
    await mkdirp(chromedriverDir);
  }
  return chromedriverDir;
}

async function install () {
  const osInfo = await getOsInfo();
  const client = new ChromedriverStorageClient({
    chromedriverDir: await prepareChromedriverDir(osInfo.name),
  });
  await client.syncDrivers({
    osInfo,
    versions: [await formatCdVersion(CD_VER)],
  });
}

async function doInstall () {
  await install();
}

export { install, doInstall };
