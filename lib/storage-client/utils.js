export const STORAGE_REQ_TIMEOUT_MS = 15000;
export const GOOGLEAPIS_CDN =
  process.env.npm_config_chromedriver_cdnurl ||
  process.env.CHROMEDRIVER_CDNURL ||
  'https://chromedriver.storage.googleapis.com';

/**
 * Verifies if the given chromedriver name matches to the given OS and arch
 *
 * @param {string} cdName
 * @param {string} osName
 * @param {string} arch
 * @returns {boolean}
 */
export function doesCdNameMatchOsNameAndArchitecture(cdName, osName, arch) {
  return new RegExp(`([\\b_])${osName}${arch}\\b`).test(cdName);
}
