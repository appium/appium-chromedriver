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

export interface ChromedriverInfo {
  executable: string;
  version: string;
  minChromeVersion: string | null;
}

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
    `Found ${util.pluralize('executable', executables.length, true)} ` + `in '${this.executableDir}'`,
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
  const self = this as ChromedriverCommandContext & {
    getDriversMapping: () => Promise<ChromedriverVersionMapping>;
    getChromedrivers: (mapping: ChromedriverVersionMapping) => Promise<ChromedriverInfo[]>;
    updateDriversMapping: (mapping: ChromedriverVersionMapping) => Promise<void>;
    getChromeVersion: () => Promise<semver.SemVer | null>;
  };
  if (!this.adb && !this.isCustomExecutableDir) {
    // desktop default path shortcut when no device-specific matching is needed
    return await getChromedriverBinaryPath();
  }

  const mapping = await self.getDriversMapping();
  if (!_.isEmpty(mapping)) {
    this.log.debug(`The most recent known Chrome version: ${_.values(mapping)[0]}`);
  }

  let didStorageSync = false;
  const syncChromedrivers = async (chromeVersion: semver.SemVer): Promise<boolean> => {
    didStorageSync = true;
    if (!this.storageClient) {
      return false;
    }
    const retrievedMapping = await this.storageClient.retrieveMapping();
    this.log.debug(
      'Got chromedrivers mapping from the storage: ' +
        _.truncate(JSON.stringify(retrievedMapping, null, 2), {length: 500}),
    );
    const driverKeys = await this.storageClient.syncDrivers({
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
    await self.updateDriversMapping(mapping);
    return true;
  };

  while (true) {
    // retry loop may run twice if first pass triggers auto-download sync
    const cds = await self.getChromedrivers(mapping);
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
    if (!_.isEmpty(missingVersions)) {
      this.log.info(
        `Found ${util.pluralize('Chromedriver', _.size(missingVersions), true)}, ` +
          `which ${_.size(missingVersions) === 1 ? 'is' : 'are'} missing in the list of known versions: ` +
          JSON.stringify(missingVersions),
      );
      await self.updateDriversMapping(Object.assign(mapping, missingVersions));
    }

    if (this.disableBuildCheck) {
      if (_.isEmpty(cds)) {
        throw this.log.errorWithException(
          `There must be at least one Chromedriver executable available for use if ` +
            `'chromedriverDisableBuildCheck' capability is set to 'true'`,
        );
      }
      const {version, executable} = cds[0];
      this.log.warn(
        `Chrome build check disabled. Using most recent Chromedriver version (${version}, at '${executable}')`,
      );
      this.log.warn(`If this is wrong, set 'chromedriverDisableBuildCheck' capability to 'false'`);
      return executable;
    }

    const chromeVersion = await self.getChromeVersion();
    if (!chromeVersion) {
      if (_.isEmpty(cds)) {
        throw this.log.errorWithException(
          `There must be at least one Chromedriver executable available for use if ` +
            `the current Chrome version cannot be determined`,
        );
      }
      const {version, executable} = cds[0];
      this.log.warn(`Unable to discover Chrome version. Using Chromedriver ${version} at '${executable}'`);
      return executable;
    }
    this.log.debug(`Found Chrome bundle '${this.bundleId}' version '${chromeVersion}'`);

    const matchingDrivers = cds.filter(({minChromeVersion}) => {
      const minChromeVersionS = minChromeVersion && semver.coerce(minChromeVersion);
      if (!minChromeVersionS) {
        return false;
      }
      return chromeVersion.major > NEW_CD_VERSION_FORMAT_MAJOR_VERSION
        ? minChromeVersionS.major === chromeVersion.major
        : semver.gte(chromeVersion, minChromeVersionS);
    });
    if (_.isEmpty(matchingDrivers)) {
      if (this.storageClient && !didStorageSync) {
        try {
          if (await syncChromedrivers(chromeVersion)) {
            // mapping changed after sync; recompute with refreshed local binaries
            continue;
          }
        } catch (e) {
          const err = e as Error;
          this.log.warn(`Cannot synchronize local chromedrivers with the remote storage: ${err.message}`);
          this.log.debug(err.stack ?? '');
        }
      }
      const autodownloadSuggestion =
        'You could also try to enable automated chromedrivers download as a possible workaround.';
      throw new Error(
        `No Chromedriver found that can automate Chrome '${chromeVersion}'.` +
          (this.storageClient ? '' : ` ${autodownloadSuggestion}`),
      );
    }

    const binPath = matchingDrivers[0].executable;
    this.log.debug(
      `Found ${util.pluralize('executable', matchingDrivers.length, true)} ` +
        `capable of automating Chrome '${chromeVersion}'.\nChoosing the most recent, '${binPath}'.`,
    );
    this.log.debug(
      `If a specific version is required, specify it with the 'chromedriverExecutable' capability.`,
    );
    return binPath;
  }
}

/**
 * Resolves and verifies the effective Chromedriver executable path.
 */
export async function initChromedriverPath(this: ChromedriverCommandContext): Promise<string> {
  const self = this as ChromedriverCommandContext & {
    getCompatibleChromedriver: () => Promise<string>;
  };
  if (this.executableVerified && this.chromedriver) {
    return this.chromedriver;
  }
  let chromedriver = this.chromedriver;
  if (!chromedriver) {
    chromedriver = this.chromedriver = this.useSystemExecutable
      ? await getChromedriverBinaryPath()
      : await self.getCompatibleChromedriver();
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
