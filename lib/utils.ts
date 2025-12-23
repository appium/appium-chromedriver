import _ from 'lodash';
import {system, fs, node} from '@appium/support';
import {BaseDriver} from '@appium/base-driver';
import path from 'path';
import {compareVersions} from 'compare-versions';
import axios from 'axios';
import os from 'os';
import {OS, CPU} from './constants';
import type {ADB} from 'appium-adb';
import type {ChromedriverVersionMapping, OSInfo} from './types';

const CD_EXECUTABLE_PREFIX = 'chromedriver';
const MODULE_NAME = 'appium-chromedriver';

/**
 * Calculates the path to the current module's root folder
 * @returns The full path to module root
 * @throws {Error} If the current module root folder cannot be determined
 */
const getModuleRoot = _.memoize(function getModuleRoot(): string {
  const root = node.getModuleRootSync(MODULE_NAME, __filename);
  if (!root) {
    throw new Error(`Cannot find the root folder of the ${MODULE_NAME} Node.js module`);
  }
  return root;
});

// Chromedriver version: minimum Chrome version
export const CHROMEDRIVER_CHROME_MAPPING: ChromedriverVersionMapping = require(path.join(
  getModuleRoot(),
  'config',
  'mapping.json'
));
export const CD_BASE_DIR = path.join(getModuleRoot(), 'chromedriver');

/**
 * Gets the most recent Chromedriver version from the mapping.
 * @param mapping - The Chromedriver version mapping (defaults to the static mapping).
 * @returns The most recent version string.
 * @throws {Error} If the mapping is empty.
 */
export function getMostRecentChromedriver(mapping: ChromedriverVersionMapping = CHROMEDRIVER_CHROME_MAPPING): string {
  if (_.isEmpty(mapping)) {
    throw new Error('Unable to get most recent Chromedriver version from empty mapping');
  }
  return _.last(_.keys(mapping).sort(compareVersions)) as string;
}

export const CD_VER: string =
  process.env.npm_config_chromedriver_version ||
  process.env.CHROMEDRIVER_VERSION ||
  getMostRecentChromedriver();

/**
 * Gets the Chrome version for a given bundle ID using ADB.
 * @param adb - The ADB instance to use.
 * @param bundleId - The bundle ID of the Chrome/WebView app.
 * @returns The version name string, or undefined if not found.
 */
export async function getChromeVersion(adb: ADB, bundleId: string): Promise<string | undefined> {
  const {versionName} = await adb.getPackageInfo(bundleId);
  return versionName;
}

/**
 * Gets the directory path for Chromedriver executables for a given OS.
 * @param osName - The OS name (defaults to the current OS).
 * @returns The full path to the Chromedriver directory.
 */
export function getChromedriverDir(osName: string = getOsName()): string {
  return path.resolve(CD_BASE_DIR, osName);
}

/**
 * Gets the path to the Chromedriver binary for a given OS.
 * @param osName - The OS name (defaults to the current OS).
 * @returns The full path to the Chromedriver binary.
 */
export async function getChromedriverBinaryPath(osName: string = getOsName()): Promise<string> {
  const rootDir = getChromedriverDir(osName);
  const pathSuffix = osName === OS.WINDOWS ? '.exe' : '';
  const paths = await fs.glob(`${CD_EXECUTABLE_PREFIX}*${pathSuffix}`, {
    cwd: rootDir,
    absolute: true,
    nocase: true,
    nodir: true,
  });
  return _.isEmpty(paths)
    ? path.resolve(rootDir, `${CD_EXECUTABLE_PREFIX}${pathSuffix}`)
    : (_.first(paths) as string);
}

/**
 * Retrieves data from a URL using axios.
 * @param url - The URL to fetch from.
 * @param headers - Optional HTTP headers.
 * @param opts - Optional configuration (timeout, responseType).
 * @returns The response data.
 */
export async function retrieveData(
  url: string,
  headers?: import('axios').AxiosRequestConfig['headers'],
  opts: Pick<import('axios').AxiosRequestConfig, 'timeout' | 'responseType'> = {}
): Promise<any> {
  const {timeout = 5000, responseType = 'text'} = opts;
  return (
    await axios({
      url,
      headers,
      timeout,
      responseType,
    })
  ).data;
}

/**
 * Gets the OS name for the current system.
 * @returns The OS name ('win', 'mac', or 'linux').
 */
export const getOsName = _.memoize(function getOsName(): typeof OS[keyof typeof OS] {
  if (system.isWindows()) {
    return OS.WINDOWS;
  }
  if (system.isMac()) {
    return OS.MAC;
  }
  return OS.LINUX;
});

/**
 * Gets the CPU type for the current system.
 * @returns The CPU type ('intel' or 'arm').
 */
export const getCpuType = _.memoize(function getCpuType(): typeof CPU[keyof typeof CPU] {
  return _.includes(_.toLower(os.cpus()[0].model), 'apple') ? CPU.ARM : CPU.INTEL;
});

/**
 * Gets OS information including name, architecture, and CPU type.
 * @returns A promise that resolves to OS information.
 */
export const getOsInfo = _.memoize(async function getOsInfo(): Promise<OSInfo> {
  return {
    name: getOsName(),
    arch: String(await system.arch()),
    cpu: getCpuType(),
  };
});

// @ts-expect-error to avoid error
// TS2345: Argument of type '{}' is not assignable to parameter of type 'DriverOpts<Readonly<Record<string, Constraint>>>'
// Type '{}' is missing the following properties from type 'ServerArgs': address, allowCors, allowInsecure, basePath, and 26 more.
const getBaseDriverInstance = _.memoize(() => new BaseDriver({}, false));

/**
 * Generates log prefix string.
 * @param obj - Log owner instance.
 * @param sessionId - Optional session identifier.
 * @returns The generated log prefix string.
 */
export function generateLogPrefix(obj: any, sessionId: string | null = null): string {
  return getBaseDriverInstance().helpers.generateDriverLogPrefix(
    obj,
    sessionId ? sessionId : undefined
  );
}

/**
 * Converts the given object to an integer number if possible.
 * @param value - The value to be converted.
 * @returns The integer value or null if conversion is not possible.
 */
export function convertToInt(value: any): number | null {
  switch (typeof value) {
    case 'number':
      return Number.isNaN(value) ? null : value;
    case 'string': {
      const parsedAsInt = parseInt(value, 10);
      return Number.isNaN(parsedAsInt) ? null : parsedAsInt;
    }
    default:
      return null;
  }
}

