import _ from 'lodash';
import { fs, mkdirp } from '@appium/support';
import ChromedriverStorageClient from '../../lib/storage-client/storage-client';
import {
  CD_VER, getOsInfo, getChromedriverDir,
} from '../../lib/utils';


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

export async function install () {
  const osInfo = await getOsInfo();
  const client = new ChromedriverStorageClient({
    chromedriverDir: await prepareChromedriverDir(osInfo.name),
  });
  const chromeDriverVersion = CD_VER === 'LATEST'
    ? CD_VER
    : await client.getLatestKnownGoodVersion();
  await client.syncDrivers({
    osInfo,
    versions: [chromeDriverVersion],
  });
}
