import _ from 'lodash';
import path from 'path';
import {logger} from '@appium/support';
import semver from 'semver';
import {ARCH, CPU} from '../constants';

const log = logger.getLogger('ChromedriverChromelabsStorageClient');

/**
 * Parses The output of the corresponding JSON API
 * that retrieves Chromedriver versions. See
 * https://github.com/GoogleChromeLabs/chrome-for-testing#json-api-endpoints
 * for more details.
 *
 * @param {string} jsonStr
 * @returns {ChromedriverDetailsMapping}
 */
export function parseKnownGoodVersionsWithDownloadsJson(jsonStr) {
  let json;
  try {
    json = JSON.parse(jsonStr);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Storage JSON cannot be parsed. Original error: ${err.message}`);
  }
  /**
   * Example output:
   * {
   * "timestamp":"2023-07-28T13:09:17.042Z",
   * "versions":[
   *    {
   *       "version":"113.0.5672.0",
   *       "revision":"1121455",
   *       "downloads":{
   *          "chromedriver":[
   *             {
   *                "platform":"linux64",
   *                "url":"https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/113.0.5672.0/linux64/chrome-linux64.zip"
   *             },
   *             {
   *                "platform":"mac-arm64",
   *                "url":"https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/113.0.5672.0/mac-arm64/chrome-mac-arm64.zip"
   *             },
   *             {
   *                "platform":"mac-x64",
   *                "url":"https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/113.0.5672.0/mac-x64/chrome-mac-x64.zip"
   *             },
   *             {
   *                "platform":"win32",
   *                "url":"https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/113.0.5672.0/win32/chrome-win32.zip"
   *             },
   *             {
   *                "platform":"win64",
   *                "url":"https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/113.0.5672.0/win64/chrome-win64.zip"
   *             }
   *          ]
   *       }
   *    },
   *    {
   *       "version":"113.0.5672.35",
   *       ...
   */
  /** @type {ChromedriverDetailsMapping} */
  const mapping = {};
  if (!_.isArray(json?.versions)) {
    log.debug(jsonStr);
    throw new Error('The format of the storage JSON is not supported');
  }
  for (const {version, downloads} of json.versions) {
    if (!_.isArray(downloads?.chromedriver)) {
      continue;
    }
    const versionObj = semver.parse(version, {loose: true});
    if (!versionObj) {
      continue;
    }
    for (const downloadEntry of downloads.chromedriver) {
      if (!downloadEntry?.url || !downloadEntry?.platform) {
        continue;
      }
      const osNameMatch = /^[a-z]+/i.exec(downloadEntry.platform);
      if (!osNameMatch) {
        log.debug(`The entry '${downloadEntry.url}' does not contain valid platform name. Skipping it`);
        continue;
      }
      const key = `${path.basename(path.dirname(path.dirname(downloadEntry.url)))}/` +
        `${path.basename(downloadEntry.url)}`;
      mapping[key] = {
        url: downloadEntry.url,
        etag: null,
        version,
        minBrowserVersion: `${versionObj.major}`,
        os: {
          name: osNameMatch[0],
          arch: downloadEntry.platform.includes(ARCH.X64) ? ARCH.X64 : ARCH.X86,
          cpu: downloadEntry.platform.includes(CPU.ARM) ? CPU.ARM : CPU.INTEL,
        }
      };
    }
  }
  log.info(`The total count of entries in the mapping: ${_.size(mapping)}`);
  return mapping;
}

/**
 * Parses The output of the corresponding JSON API
 * that retrieves the most recent stable Chromedriver version. See
 * https://github.com/GoogleChromeLabs/chrome-for-testing#json-api-endpoints
 * for more details.
 *
 * @param {string} jsonStr
 * @returns {string} The most recent available chromedriver version
 */
export function parseLatestKnownGoodVersionsJson(jsonStr) {
  let json;
  try {
    json = JSON.parse(jsonStr);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    throw new Error(`Storage JSON cannot be parsed. Original error: ${err.message}`);
  }
  /**
   * Example output:
   * "timestamp":"2023-07-28T13:09:17.036Z",
   * "channels":{
   *    "Stable":{
   *       "channel":"Stable",
   *       "version":"115.0.5790.102",
   *       "revision":"1148114"
   * ...
   */
  if (!json?.channels?.Stable?.version) {
    log.debug(jsonStr);
    throw new Error('The format of the storage JSON is not supported');
  }
  return json.channels.Stable.version;
}

/**
 * @typedef {import('../types').ChromedriverDetailsMapping} ChromedriverDetailsMapping
 */
