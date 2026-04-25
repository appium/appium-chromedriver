import {fs, util} from '@appium/support';
import {asyncmap} from 'asyncbox';
import {compareVersions} from 'compare-versions';
import {type ExecError} from 'teen_process';
import _ from 'lodash';
import path from 'node:path';
import * as semver from 'semver';
import {CHROMEDRIVER_CHROME_MAPPING, getChromedriverBinaryPath} from '../utils';
import type {ChromedriverVersionMapping} from '../types';
import type {ChromedriverCommandContext} from './types';

const NEW_CD_VERSION_FORMAT_MAJOR_VERSION = 73;
const CD_VERSION_TIMEOUT = 5000;
const GET_COMPATIBLE_CHROMEDRIVER_MAX_ITERATIONS = 10;

export interface ChromedriverInfo {
  executable: string;
  version: string;
  minChromeVersion: string | null;
}

type ChromedriverSelectionSelf = ChromedriverCommandContext & {
  getDriversMapping: () => Promise<ChromedriverVersionMapping>;
  getChromedrivers: (mapping: ChromedriverVersionMapping) => Promise<ChromedriverInfo[]>;
  updateDriversMapping: (mapping: ChromedriverVersionMapping) => Promise<void>;
  getChromeVersion: () => Promise<semver.SemVer | null>;
  getCompatibleChromedriver: () => Promise<string>;
};

/**
 * Loads and normalizes Chromedriver-to-Chrome version mapping.
 */
export async function getDriversMapping(
  this: ChromedriverCommandContext,
): Promise<ChromedriverVersionMapping> {
  let mapping = _.cloneDeep(CHROMEDRIVER_CHROME_MAPPING);
  if (this.mappingPath) {
    this.log.debug(`Attempting to use Chromedriver->Chrome mapping from '${this.mappingPath}'`);
    if (!(await fs.exists(this.mappingPath))) {
      this.log.warn(`No file found at '${this.mappingPath}'`);
      this.log.info('Defaulting to the static Chromedriver->Chrome mapping');
    } else {
      try {
        mapping = JSON.parse(await fs.readFile(this.mappingPath, 'utf8'));
      } catch (e) {
        const err = e as Error;
        this.log.warn(`Error parsing mapping from '${this.mappingPath}': ${err.message}`);
        this.log.info('Defaulting to the static Chromedriver->Chrome mapping');
      }
    }
  } else {
    this.log.debug('Using the static Chromedriver->Chrome mapping');
  }

  for (const [cdVersion, chromeVersion] of _.toPairs(mapping)) {
    const coercedVersion = semver.coerce(chromeVersion);
    if (coercedVersion) {
      mapping[cdVersion] = coercedVersion.version;
    } else {
      this.log.info(`'${chromeVersion}' is not a valid version number. Skipping it`);
    }
  }
  return mapping;
}

/**
 * Discovers available Chromedriver binaries and parses their versions.
 */
export async function getChromedrivers(
  this: ChromedriverCommandContext,
  mapping: ChromedriverVersionMapping,
): Promise<ChromedriverInfo[]> {
  // enumerate available executables in configured chromedriver directory
  const executables = await fs.glob('*', {
    cwd: this.executableDir,
    nodir: true,
    absolute: true,
  });
  this.log.debug(
    `Found ${util.pluralize('executable', executables.length, true)} ` +
      `in '${this.executableDir}'`,
  );
  const cds = (
    await asyncmap(executables, async (executable: string) => {
      const logError = ({
        message,
        stdout,
        stderr,
      }: {
        message: string;
        stdout?: string;
        stderr?: string;
      }): null => {
        let errMsg =
          `Cannot retrieve version number from '${path.basename(executable)}' Chromedriver binary. ` +
          `Make sure it returns a valid version string in response to '--version' command line argument. ${message}`;
        if (stdout) {
          errMsg += `\nStdout: ${stdout}`;
        }
        if (stderr) {
          errMsg += `\nStderr: ${stderr}`;
        }
        this.log.warn(errMsg);
        return null;
      };

      let stdout: string;
      let stderr: string | undefined;
      try {
        ({stdout, stderr} = await this._execFunc(executable, ['--version'], {
          timeout: CD_VERSION_TIMEOUT,
        }));
      } catch (e) {
        const err = e as ExecError;
        if (
          !(err.message || '').includes('timed out') &&
          !(err.stdout || '').includes('Starting ChromeDriver')
        ) {
          return logError(err);
        }
        // timeouts may still contain the version banner in stdout
        stdout = err.stdout;
      }

      const match = /ChromeDriver\s+\(?v?([\d.]+)\)?/i.exec(stdout);
      if (!match) {
        return logError({message: 'Cannot parse the version string', stdout, stderr});
      }
      let version = match[1];
      let minChromeVersion = mapping[version] || null;
      const coercedVersion = semver.coerce(version);
      if (coercedVersion) {
        if (coercedVersion.major < NEW_CD_VERSION_FORMAT_MAJOR_VERSION) {
          version = `${coercedVersion.major}.${coercedVersion.minor}`;
          minChromeVersion = mapping[version] || null;
        }
        if (!minChromeVersion && coercedVersion.major >= NEW_CD_VERSION_FORMAT_MAJOR_VERSION) {
          minChromeVersion = `${coercedVersion.major}`;
        }
      }
      return {executable, version, minChromeVersion};
    })
  )
    .filter((cd): cd is ChromedriverInfo => !!cd)
    .sort((a, b) => compareVersions(b.version, a.version));
  if (_.isEmpty(cds)) {
    this.log.info(`No Chromedrivers were found in '${this.executableDir}'`);
    return cds;
  }
  this.log.debug(`The following Chromedriver executables were found:`);
  for (const cd of cds) {
    this.log.debug(
      `    '${cd.executable}' (version '${cd.version}', minimum Chrome version '${
        cd.minChromeVersion ? cd.minChromeVersion : 'Unknown'
      }')`,
    );
  }
  return cds;
}

/**
 * Persists updated version mapping to disk or falls back to in-memory update.
 */
export async function updateDriversMapping(
  this: ChromedriverCommandContext,
  newMapping: ChromedriverVersionMapping,
): Promise<void> {
  let shouldUpdateStaticMapping = true;
  if (!this.mappingPath) {
    this.log.warn('No mapping path provided');
    return;
  }
  if (await fs.exists(this.mappingPath)) {
    try {
      await fs.writeFile(this.mappingPath, JSON.stringify(newMapping, null, 2), 'utf8');
      shouldUpdateStaticMapping = false;
    } catch (e) {
      const err = e as Error;
      this.log.warn(
        `Cannot store the updated chromedrivers mapping into '${this.mappingPath}'. ` +
          `This may reduce the performance of further executions. Original error: ${err.message}`,
      );
    }
  }
  if (shouldUpdateStaticMapping) {
    Object.assign(CHROMEDRIVER_CHROME_MAPPING, newMapping);
  }
}

/**
 * Selects the most suitable Chromedriver binary for current environment.
 */
export async function getCompatibleChromedriver(this: ChromedriverCommandContext): Promise<string> {
  if (usesDesktopChromedriverDefault(this)) {
    return await getChromedriverBinaryPath();
  }

  const ctx = this as ChromedriverSelectionSelf;
  const mapping = await ctx.getDriversMapping();
  if (!_.isEmpty(mapping)) {
    ctx.log.debug(`The most recent known Chrome version: ${_.values(mapping)[0]}`);
  }

  const syncState = {didStorageSync: false};

  for (let iteration = 0; iteration < GET_COMPATIBLE_CHROMEDRIVER_MAX_ITERATIONS; iteration++) {
    const cds = await ctx.getChromedrivers(mapping);
    await mergeDiscoveredMappingGaps(ctx, cds, mapping);

    if (ctx.disableBuildCheck) {
      return pickChromedriverWithBuildCheckDisabled(ctx, cds);
    }

    const chromeVersion = await ctx.getChromeVersion();
    if (!chromeVersion) {
      return pickChromedriverWhenChromeUnknown(ctx, cds);
    }
    ctx.log.debug(`Found Chrome bundle '${ctx.bundleId}' version '${chromeVersion}'`);

    const matchingDrivers = filterChromedriversMatchingChrome(cds, chromeVersion);
    if (_.isEmpty(matchingDrivers)) {
      if (ctx.storageClient && !syncState.didStorageSync) {
        try {
          if (await attemptChromedriverStorageSync(ctx, mapping, chromeVersion, syncState)) {
            continue;
          }
        } catch (e) {
          const err = e as Error;
          ctx.log.warn(
            `Cannot synchronize local chromedrivers with the remote storage: ${err.message}`,
          );
          if (err.stack) {
            ctx.log.debug(err.stack);
          }
        }
      }
      throw makeNoMatchingChromedriverError(ctx, chromeVersion);
    }

    return logChosenMatchingChromedriver(ctx, matchingDrivers, chromeVersion);
  }

  throw new Error(
    `Exceeded ${GET_COMPATIBLE_CHROMEDRIVER_MAX_ITERATIONS} iterations while selecting a ` +
      `compatible Chromedriver.`,
  );
}

/**
 * Resolves and verifies the effective Chromedriver executable path.
 */
export async function initChromedriverPath(this: ChromedriverCommandContext): Promise<string> {
  if (this.executableVerified && this.chromedriver) {
    return this.chromedriver;
  }
  let chromedriver = this.chromedriver;
  if (!chromedriver) {
    chromedriver = this.chromedriver = this.useSystemExecutable
      ? await getChromedriverBinaryPath()
      : await (this as ChromedriverSelectionSelf).getCompatibleChromedriver();
  }
  if (!chromedriver) {
    throw new Error('Cannot determine a valid Chromedriver executable path');
  }
  if (!(await fs.exists(chromedriver))) {
    throw new Error(
      `Trying to use a chromedriver binary at the path ${chromedriver}, but it doesn't exist!`,
    );
  }
  this.executableVerified = true;
  this.log.info(`Set chromedriver binary as: ${chromedriver}`);
  return chromedriver;
}

function usesDesktopChromedriverDefault(ctx: ChromedriverCommandContext): boolean {
  return !ctx.adb && !ctx.isCustomExecutableDir;
}

async function mergeDiscoveredMappingGaps(
  ctx: ChromedriverSelectionSelf,
  cds: ChromedriverInfo[],
  mapping: ChromedriverVersionMapping,
): Promise<void> {
  const missingVersions: ChromedriverVersionMapping = {};
  for (const {version, minChromeVersion} of cds) {
    if (!minChromeVersion || mapping[version]) {
      continue;
    }
    const coercedVer = semver.coerce(version);
    if (!coercedVer || coercedVer.major < NEW_CD_VERSION_FORMAT_MAJOR_VERSION) {
      continue;
    }
    missingVersions[version] = minChromeVersion;
  }
  if (_.isEmpty(missingVersions)) {
    return;
  }
  ctx.log.info(
    `Found ${util.pluralize('Chromedriver', _.size(missingVersions), true)}, ` +
      `which ${_.size(missingVersions) === 1 ? 'is' : 'are'} missing in the list of known versions: ` +
      JSON.stringify(missingVersions),
  );
  await ctx.updateDriversMapping(Object.assign(mapping, missingVersions));
}

function pickChromedriverWithBuildCheckDisabled(
  ctx: ChromedriverSelectionSelf,
  cds: ChromedriverInfo[],
): string {
  if (_.isEmpty(cds)) {
    throw ctx.log.errorWithException(
      `There must be at least one Chromedriver executable available for use if ` +
        `'chromedriverDisableBuildCheck' capability is set to 'true'`,
    );
  }
  const {version, executable} = cds[0];
  ctx.log.warn(
    `Chrome build check disabled. Using most recent Chromedriver version (${version}, at '${executable}')`,
  );
  ctx.log.warn(`If this is wrong, set 'chromedriverDisableBuildCheck' capability to 'false'`);
  return executable;
}

function pickChromedriverWhenChromeUnknown(
  ctx: ChromedriverSelectionSelf,
  cds: ChromedriverInfo[],
): string {
  if (_.isEmpty(cds)) {
    throw ctx.log.errorWithException(
      `There must be at least one Chromedriver executable available for use if ` +
        `the current Chrome version cannot be determined`,
    );
  }
  const {version, executable} = cds[0];
  ctx.log.warn(
    `Unable to discover Chrome version. Using Chromedriver ${version} at '${executable}'`,
  );
  return executable;
}

function filterChromedriversMatchingChrome(
  cds: ChromedriverInfo[],
  chromeVersion: semver.SemVer,
): ChromedriverInfo[] {
  return cds.filter(({minChromeVersion}) => {
    const minChromeVersionS = minChromeVersion && semver.coerce(minChromeVersion);
    if (!minChromeVersionS) {
      return false;
    }
    return chromeVersion.major > NEW_CD_VERSION_FORMAT_MAJOR_VERSION
      ? minChromeVersionS.major === chromeVersion.major
      : semver.gte(chromeVersion, minChromeVersionS);
  });
}

/**
 * Syncs drivers from remote storage into `mapping` and persists when possible.
 * Sets `syncState.didStorageSync` before any early return so a second sync is not attempted.
 */
async function attemptChromedriverStorageSync(
  ctx: ChromedriverSelectionSelf,
  mapping: ChromedriverVersionMapping,
  chromeVersion: semver.SemVer,
  syncState: {didStorageSync: boolean},
): Promise<boolean> {
  syncState.didStorageSync = true;
  if (!ctx.storageClient) {
    return false;
  }
  const retrievedMapping = await ctx.storageClient.retrieveMapping();
  ctx.log.debug(
    'Got chromedrivers mapping from the storage: ' +
      _.truncate(JSON.stringify(retrievedMapping, null, 2), {length: 500}),
  );
  const driverKeys = await ctx.storageClient.syncDrivers({
    minBrowserVersion: chromeVersion.major,
  });
  if (_.isEmpty(driverKeys)) {
    return false;
  }
  const synchronizedDriversMapping = driverKeys.reduce((acc, x) => {
    const {version, minBrowserVersion} = retrievedMapping[x];
    acc[version] = minBrowserVersion;
    return acc;
  }, {} as ChromedriverVersionMapping);
  Object.assign(mapping, synchronizedDriversMapping);
  await ctx.updateDriversMapping(mapping);
  return true;
}

function makeNoMatchingChromedriverError(
  ctx: ChromedriverSelectionSelf,
  chromeVersion: semver.SemVer,
): Error {
  const autodownloadSuggestion =
    'You could also try to enable automated chromedrivers download as a possible workaround.';
  return new Error(
    `No Chromedriver found that can automate Chrome '${chromeVersion}'.` +
      (ctx.storageClient ? '' : ` ${autodownloadSuggestion}`),
  );
}

function logChosenMatchingChromedriver(
  ctx: ChromedriverSelectionSelf,
  matchingDrivers: ChromedriverInfo[],
  chromeVersion: semver.SemVer,
): string {
  const binPath = matchingDrivers[0].executable;
  ctx.log.debug(
    `Found ${util.pluralize('executable', matchingDrivers.length, true)} ` +
      `capable of automating Chrome '${chromeVersion}'.\nChoosing the most recent, '${binPath}'.`,
  );
  ctx.log.debug(
    `If a specific version is required, specify it with the 'chromedriverExecutable' capability.`,
  );
  return binPath;
}
