import type ADB from 'appium-adb';

export interface ChromedriverOpts {
  host?: string;
  port?: string;
  useSystemExecutable?: boolean;
  executable?: string;
  executableDir?: string;
  bundleId?: string;
  mappingPath?: string;
  cmdArgs?: string[];
  adb?: ADB;
  verbose?: boolean;
  logPath?: string;
  disableBuildCheck?: boolean;
  /**
   * Output of the `/json/version` CDP command
   */
  details?: {info?: {Browser: string}};
  isAutodownloadEnabled?: boolean;
}

export type ChromedriverVersionMapping = Record<string, string | null>;

export interface SyncOptions {
  /**
   * The list of chromedriver versions to sync. If empty (the default value)
   * then all available chromedrivers are going to be downloaded and extracted
   */
  versions?: string[];
  /**
   * The minumum supported Chrome version that downloaded chromedrivers should
   * support. Can match multiple drivers.
   */
  minBrowserVersion?: string | number;
  /**
   * System information used to filter out the list of the retrieved drivers. If
   * not provided then the script will try to retrieve it.
   */
  osInfo?: OSInfo;
}

/**
 * Information about the current operating system
 */
export interface OSInfo {
  /**
   * The architecture of the host OS.
   * Can be either `32`, `64``
   */
  arch: string;
  /**
   *
   * The name of the host OS.
   * Can be either `mac`, `win` or `linux`
   */
  name: string;
  /**
   * The cpu type of the host OS.
   * Can be either `intel`, `arm`. `intel` is assumed by default
   */
  cpu?: string;
}

/**
 * Info about a Chromedriver version
 */
export interface ChromedriverDetails {
  /**
   * Full url to corresponding driver in the remote storage
   */
  url: string;
  /**
   * CRC of driver archive
   */
  etag: string | null;
  /**
   * Chromedriver version
   */
  version: string;
  minBrowserVersion: string | null;
  os: OSInfo;
}

/**
 * The keys are unique driver identifiers (version/archive name). The corresponding values have {@linkcode ChromedriverDetails} containing chromedriver details
 */
export type ChromedriverDetailsMapping = Record<string, ChromedriverDetails>;

export interface ChromedriverStorageClientOpts {
  chromedriverDir?: string;
  timeout?: number;
}

export interface AdditionalDriverDetails {
  /**
   * Chromedriver version or `null` if it cannot be found
   */
  version?: string | null;
  /**
   * The minimum browser version supported by chromedriver or `null` if it cannot be found
   */
  minBrowserVersion?: string | null;
}
