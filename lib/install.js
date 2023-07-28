import { fs, mkdirp } from '@appium/support';
import ChromedriverStorageClient from './storage-client/storage-client';
import {parseLatestKnownGoodVersionsJson} from './storage-client/chromelabs';
import {
  CD_VER, retrieveData, getOsInfo, getChromedriverDir,
} from './utils';
import { USER_AGENT, STORAGE_REQ_TIMEOUT_MS, CHROMELABS_URL } from './constants';

const LATEST_VERSION = 'LATEST';

/**
 *
 * @param {string} ver
 */
async function formatCdVersion (ver) {
  if (ver !== LATEST_VERSION) {
    return ver;
  }

  const jsonStr = await retrieveData(
    `${CHROMELABS_URL}/chrome-for-testing/last-known-good-versions-with-downloads.json`, {
      'user-agent': USER_AGENT,
      accept: `application/json, */*`,
    }, {timeout: STORAGE_REQ_TIMEOUT_MS}
  );
  return parseLatestKnownGoodVersionsJson(jsonStr);
}

/**
 *
 * @param {string} platformName
 */
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
