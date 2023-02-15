import { default as chromedriver } from './lib/chromedriver';
import ChromedriverStorageClient from './lib/storage-client';

export { ChromedriverStorageClient };
export default chromedriver;

/**
 * @typedef {import('./lib/types').ChromedriverOpts} ChromedriverOpts
 * @typedef {import('./lib/types').ChromedriverDetails} ChromedriverDetails
 * @typedef {import('./lib/types').ChromedriverVersionMapping} ChromedriverVersionMapping
 * @typedef {import('./lib/types').ChromedriverStorageClientOpts} ChromedriverStorageClientOpts
 * @typedef {import('./lib/types').SyncOptions} SyncOptions
 * @typedef {import('./lib/types').OSInfo} OSInfo
 */
