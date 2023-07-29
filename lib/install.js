import _ from 'lodash';
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
 * @returns {Promise<string>}
 */
async function formatCdVersion (ver) {
  if (_.toUpper(ver) !== LATEST_VERSION) {
    return ver;
  }

  let jsonStr;
  const url = `${CHROMELABS_URL}/chrome-for-testing/last-known-good-versions.json`;
  try {
    jsonStr = await retrieveData(
      url, {
        'user-agent': USER_AGENT,
        accept: `application/json, */*`,
      }, {timeout: STORAGE_REQ_TIMEOUT_MS}
    );
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Cannot fetch the latest Chromedriver version. ` +
      `Make sure you can access ${url} from your machine or provide a mirror by setting ` +
      `a custom value to CHROMELABS_URL enironment variable. Original error: ${err.message}`);
  }
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
