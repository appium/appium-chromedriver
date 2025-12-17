import {fs, mkdirp} from '@appium/support';
import {ChromedriverStorageClient} from '../../lib/storage-client/storage-client';
import {CD_VER, getOsInfo, getChromedriverDir} from '../../lib/utils';

const LATEST_VERSION = 'LATEST';

/**
 * Prepares the chromedriver directory for the given platform
 *
 * @param platformName - The name of the platform (e.g., 'mac', 'win', 'linux')
 * @returns Promise that resolves to the chromedriver directory path
 */
async function prepareChromedriverDir(platformName: string): Promise<string> {
  const chromedriverDir = getChromedriverDir(platformName);
  if (!(await fs.exists(chromedriverDir))) {
    await mkdirp(chromedriverDir);
  }
  return chromedriverDir;
}

/**
 * Installs the chromedriver binary for the current platform
 *
 * @returns Promise that resolves when installation is complete
 */
export async function install(): Promise<void> {
  const osInfo = await getOsInfo();
  const client = new ChromedriverStorageClient({
    chromedriverDir: await prepareChromedriverDir(osInfo.name),
  });
  const chromeDriverVersion: string =
    CD_VER === LATEST_VERSION ? await client.getLatestKnownGoodVersion() : CD_VER;
  await client.syncDrivers({
    osInfo,
    versions: [chromeDriverVersion],
  });
}

