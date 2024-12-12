import events from 'events';
import {JWProxy, PROTOCOLS} from '@appium/base-driver';
import cp from 'child_process';
import {system, fs, logger, util} from '@appium/support';
import {retryInterval, asyncmap} from 'asyncbox';
import {SubProcess, exec} from 'teen_process';
import B from 'bluebird';
import {
  getChromeVersion,
  getChromedriverDir,
  CHROMEDRIVER_CHROME_MAPPING,
  getChromedriverBinaryPath,
  generateLogPrefix,
} from './utils';
import semver from 'semver';
import _ from 'lodash';
import path from 'path';
import {compareVersions} from 'compare-versions';
import ChromedriverStorageClient from './storage-client/storage-client';
import {toW3cCapNames, getCapValue} from './protocol-helpers';

const NEW_CD_VERSION_FORMAT_MAJOR_VERSION = 73;
const DEFAULT_HOST = '127.0.0.1';
const MIN_CD_VERSION_WITH_W3C_SUPPORT = 75;
const DEFAULT_PORT = 9515;
const CHROME_BUNDLE_ID = 'com.android.chrome';
const WEBVIEW_SHELL_BUNDLE_ID = 'org.chromium.webview_shell';
const WEBVIEW_BUNDLE_IDS = ['com.google.android.webview', 'com.android.webview'];
const VERSION_PATTERN = /([\d.]+)/;
const WEBDRIVER_VERSION_PATTERN = /Starting (ChromeDriver|Microsoft Edge WebDriver) ([.\d]+)/;

const CD_VERSION_TIMEOUT = 5000;

export class Chromedriver extends events.EventEmitter {
  /**
   *
   * @param {import('./types').ChromedriverOpts} args
   */
  constructor(args = {}) {
    super();

    const {
      host = DEFAULT_HOST,
      port = DEFAULT_PORT,
      useSystemExecutable = false,
      executable,
      executableDir,
      bundleId,
      mappingPath,
      cmdArgs,
      adb,
      verbose,
      logPath,
      disableBuildCheck,
      details,
      isAutodownloadEnabled = false,
    } = args;
    this._log = logger.getLogger(generateLogPrefix(this));

    this.proxyHost = host;
    this.proxyPort = port;
    this.adb = adb;
    this.cmdArgs = cmdArgs;
    this.proc = null;
    this.useSystemExecutable = useSystemExecutable;
    this.chromedriver = executable;
    this.executableDir = executableDir;
    this.mappingPath = mappingPath;
    this.bundleId = bundleId;
    this.executableVerified = false;
    this.state = Chromedriver.STATE_STOPPED;
    this.jwproxy = new JWProxy({
      server: this.proxyHost,
      port: this.proxyPort,
      log: this._log,
    });

    if (this.executableDir) {
      // Expects the user set the executable directory explicitly
      this.isCustomExecutableDir = true;
    } else {
      this.isCustomExecutableDir = false;
      this.executableDir = getChromedriverDir();
    }

    this.verbose = verbose;
    this.logPath = logPath;
    this.disableBuildCheck = !!disableBuildCheck;
    this.storageClient = isAutodownloadEnabled
      ? new ChromedriverStorageClient({chromedriverDir: this.executableDir})
      : null;
    this.details = details;
    /** @type {any} */
    this.capabilities = {};
    /** @type {keyof PROTOCOLS} */
    this.desiredProtocol = PROTOCOLS.MJSONWP;

    // Store the running driver version
    this.driverVersion = /** @type {string|null} */ null;
  }

  get log() {
    return this._log;
  }

  async getDriversMapping() {
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
          const err = /** @type {Error} */ (e);
          this.log.warn(`Error parsing mapping from '${this.mappingPath}': ${err.message}`);
          this.log.info('Defaulting to the static Chromedriver->Chrome mapping');
        }
      }
    } else {
      this.log.debug('Using the static Chromedriver->Chrome mapping');
    }

    // make sure that the values for minimum chrome version are semver compliant
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
   * @param {ChromedriverVersionMapping} mapping
   */
  async getChromedrivers(mapping) {
    // go through the versions available
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
      await asyncmap(executables, async (executable) => {
        /**
         * @param {{message: string, stdout?: string, stderr?: string}} opts
         */
        const logError = ({message, stdout, stderr}) => {
          let errMsg =
            `Cannot retrieve version number from '${path.basename(
              executable,
            )}' Chromedriver binary. ` +
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

        let stdout;
        let stderr;
        try {
          ({stdout, stderr} = await exec(executable, ['--version'], {
            timeout: CD_VERSION_TIMEOUT,
          }));
        } catch (e) {
          const err = /** @type {import('teen_process').ExecError} */ (e);
          if (
            !(err.message || '').includes('timed out') &&
            !(err.stdout || '').includes('Starting ChromeDriver')
          ) {
            return logError(err);
          }

          // if this has timed out, it has actually started Chromedriver,
          // in which case there will also be the version string in the output
          stdout = err.stdout;
        }

        const match = /ChromeDriver\s+\(?v?([\d.]+)\)?/i.exec(stdout); // https://regex101.com/r/zpj5wA/1
        if (!match) {
          return logError({message: 'Cannot parse the version string', stdout, stderr});
        }
        let version = match[1];
        let minChromeVersion = mapping[version];
        const coercedVersion = semver.coerce(version);
        if (coercedVersion) {
          // before 2019-03-06 versions were of the form major.minor
          if (coercedVersion.major < NEW_CD_VERSION_FORMAT_MAJOR_VERSION) {
            version = /** @type {keyof typeof mapping} */ (
              `${coercedVersion.major}.${coercedVersion.minor}`
            );
            minChromeVersion = mapping[version];
          }
          if (!minChromeVersion && coercedVersion.major >= NEW_CD_VERSION_FORMAT_MAJOR_VERSION) {
            // Assume the major Chrome version is the same as the corresponding driver major version
            minChromeVersion = `${coercedVersion.major}`;
          }
        }
        return {
          executable,
          version,
          minChromeVersion,
        };
      })
    )
      .filter((cd) => !!cd)
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

  async getChromeVersion() {
    // Try to retrieve the version from `details` property if it is set
    // The `info` item must contain the output of /json/version CDP command
    // where `Browser` field looks like `Chrome/72.0.3601.0``
    if (this.details?.info) {
      this.log.debug(`Browser version in the supplied details: ${this.details?.info?.Browser}`);
    }
    const versionMatch = VERSION_PATTERN.exec(this.details?.info?.Browser ?? '');
    if (versionMatch) {
      const coercedVersion = semver.coerce(versionMatch[1]);
      if (coercedVersion) {
        return coercedVersion;
      }
    }

    let chromeVersion;

    // in case of WebView Browser Tester, simply try to find the underlying webview
    if (this.bundleId === WEBVIEW_SHELL_BUNDLE_ID) {
      if (this.adb) {
        for (const bundleId of WEBVIEW_BUNDLE_IDS) {
          chromeVersion = await getChromeVersion(this.adb, bundleId);
          if (chromeVersion) {
            this.bundleId = bundleId;
            return semver.coerce(chromeVersion);
          }
        }
      }
      return null;
    }

    // on Android 7-9 webviews are backed by the main Chrome, not the system webview
    if (this.adb) {
      const apiLevel = await this.adb.getApiLevel();
      if (
        apiLevel >= 24 &&
        apiLevel <= 28 &&
        [WEBVIEW_SHELL_BUNDLE_ID, ...WEBVIEW_BUNDLE_IDS].includes(this.bundleId ?? '')
      ) {
        this.bundleId = CHROME_BUNDLE_ID;
      }
    }

    // try out webviews when no bundle id is sent in
    if (!this.bundleId) {
      // default to the generic Chrome bundle
      this.bundleId = CHROME_BUNDLE_ID;

      // we have a webview of some sort, so try to find the bundle version
      for (const bundleId of WEBVIEW_BUNDLE_IDS) {
        if (this.adb) {
          chromeVersion = await getChromeVersion(this.adb, bundleId);
          if (chromeVersion) {
            this.bundleId = bundleId;
            break;
          }
        }
      }
    }

    // if we do not have a chrome version, it must not be a webview
    if (!chromeVersion && this.adb) {
      chromeVersion = await getChromeVersion(this.adb, this.bundleId);
    }

    // make sure it is semver, so later checks won't fail
    return chromeVersion ? semver.coerce(chromeVersion) : null;
  }

  /**
   *
   * @param {ChromedriverVersionMapping} newMapping
   * @returns {Promise<void>}
   */
  async updateDriversMapping(newMapping) {
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
        const err = /** @type {Error} */ (e);
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
   * When executableDir is given explicitly for non-adb environment,
   * this method will respect the executableDir rather than the system installed binary.
   * @returns {Promise<string>}
   */
  async getCompatibleChromedriver() {
    if (!this.adb && !this.isCustomExecutableDir) {
      return await getChromedriverBinaryPath();
    }

    const mapping = await this.getDriversMapping();
    if (!_.isEmpty(mapping)) {
      this.log.debug(`The most recent known Chrome version: ${_.values(mapping)[0]}`);
    }

    let didStorageSync = false;
    /**
     *
     * @param {import('semver').SemVer} chromeVersion
     */
    const syncChromedrivers = async (chromeVersion) => {
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
      }, /** @type {ChromedriverVersionMapping} */ ({}));
      Object.assign(mapping, synchronizedDriversMapping);
      await this.updateDriversMapping(mapping);
      return true;
    };

    do {
      const cds = await this.getChromedrivers(mapping);

      /** @type {ChromedriverVersionMapping} */
      const missingVersions = {};
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
            `which ${
              _.size(missingVersions) === 1 ? 'is' : 'are'
            } missing in the list of known versions: ` +
            JSON.stringify(missingVersions),
        );
        await this.updateDriversMapping(Object.assign(mapping, missingVersions));
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
        this.log.warn(
          `If this is wrong, set 'chromedriverDisableBuildCheck' capability to 'false'`,
        );
        return executable;
      }

      const chromeVersion = await this.getChromeVersion();
      if (!chromeVersion) {
        // unable to get the chrome version
        if (_.isEmpty(cds)) {
          throw this.log.errorWithException(
            `There must be at least one Chromedriver executable available for use if ` +
              `the current Chrome version cannot be determined`,
          );
        }
        const {version, executable} = cds[0];
        this.log.warn(
          `Unable to discover Chrome version. Using Chromedriver ${version} at '${executable}'`,
        );
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
              continue;
            }
          } catch (e) {
            const err = /** @type {Error} */ (e);
            this.log.warn(
              `Cannot synchronize local chromedrivers with the remote storage: ${err.message}`,
            );
            this.log.debug(err.stack);
          }
        }
        const autodownloadSuggestion =
          'You could also try to enable automated chromedrivers download as ' +
          'a possible workaround.';
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
        'If a specific version is required, specify it with the `chromedriverExecutable`' +
          'desired capability.',
      );
      return binPath;
      // eslint-disable-next-line no-constant-condition
    } while (true);
  }

  async initChromedriverPath() {
    if (this.executableVerified && this.chromedriver) {
      return /** @type {string} */ (this.chromedriver);
    }

    let chromedriver = this.chromedriver;
    // the executable might be set (if passed in)
    // or we might want to use the basic one installed with this driver
    // or we want to figure out the best one
    if (!chromedriver) {
      chromedriver = this.chromedriver = this.useSystemExecutable
        ? await getChromedriverBinaryPath()
        : await this.getCompatibleChromedriver();
    }

    if (!(await fs.exists(chromedriver))) {
      throw new Error(
        `Trying to use a chromedriver binary at the path ` +
          `${this.chromedriver}, but it doesn't exist!`,
      );
    }
    this.executableVerified = true;
    this.log.info(`Set chromedriver binary as: ${this.chromedriver}`);
    return /** @type {string} */ (this.chromedriver);
  }

  /**
   * Sync the WebDriver protocol if current on going protocol is W3C or MJSONWP.
   * Does nothing if this.driverVersion is null.
   *
   * @returns {typeof PROTOCOLS[keyof typeof PROTOCOLS]}
   */
  syncProtocol() {
    if (!this.driverVersion) {
      // Keep the default protocol if the driverVersion was unsure.
      return this.desiredProtocol;
    }

    this.desiredProtocol = PROTOCOLS.MJSONWP;
    const coercedVersion = semver.coerce(this.driverVersion);
    if (!coercedVersion || coercedVersion.major < MIN_CD_VERSION_WITH_W3C_SUPPORT) {
      this.log.info(
        `The ChromeDriver v. ${this.driverVersion} does not fully support ${PROTOCOLS.W3C} protocol. ` +
          `Defaulting to ${PROTOCOLS.MJSONWP}`,
      );
      return this.desiredProtocol;
    }
    // Check only chromeOptions for now.
    const chromeOptions = getCapValue(this.capabilities, 'chromeOptions', {});
    if (chromeOptions.w3c === false) {
      this.log.info(
        `The ChromeDriver v. ${this.driverVersion} supports ${PROTOCOLS.W3C} protocol, ` +
          `but ${PROTOCOLS.MJSONWP} one has been explicitly requested`,
      );
      return this.desiredProtocol;
    }

    this.desiredProtocol = PROTOCOLS.W3C;
    this.log.info(`Set ChromeDriver communication protocol to ${PROTOCOLS.W3C}`);
    return this.desiredProtocol;
  }

  /**
   * Sync the protocol by reading the given output
   *
   * @param {string} line The output of ChromeDriver process
   * @returns {typeof PROTOCOLS[keyof typeof PROTOCOLS] | null}
   */
  detectWebDriverProtocol(line) {
    if (this.driverVersion) {
      return this.syncProtocol();
    }

    // also print chromedriver version to logs
    // will output something like
    //  Starting ChromeDriver 2.33.506106 (8a06c39c4582fbfbab6966dbb1c38a9173bfb1a2) on port 9515
    // Or MSEdge:
    //  Starting Microsoft Edge WebDriver 111.0.1661.41 (57be51b50d1be232a9e8186a10017d9e06b1fd16) on port 9515
    const match = WEBDRIVER_VERSION_PATTERN.exec(line);
    if (match && match.length === 3) {
      this.log.debug(`${match[1]} version: '${match[2]}'`);
      this.driverVersion = match[2];
      try {
        return this.syncProtocol();
      } catch (e) {
        this.driverVersion = null;
        this.log.error(`Stopping the chromedriver process. Cannot determinate the protocol: ${e}`);
        this.stop();
      }
      // Does not print else condition log since the log could be
      // very noisy when this.verbose option is true.
    }
    return null;
  }

  /**
   *
   * @param {object} caps
   * @param {boolean} emitStartingState
   */
  async start(caps, emitStartingState = true) {
    this.capabilities = _.cloneDeep(caps);

    // set the logging preferences to ALL the console logs
    this.capabilities.loggingPrefs = _.cloneDeep(getCapValue(caps, 'loggingPrefs', {}));
    if (_.isEmpty(this.capabilities.loggingPrefs.browser)) {
      this.capabilities.loggingPrefs.browser = 'ALL';
    }

    if (emitStartingState) {
      this.changeState(Chromedriver.STATE_STARTING);
    }

    const args = [`--port=${this.proxyPort}`];
    if (this.adb && this.adb.adbPort) {
      args.push(`--adb-port=${this.adb.adbPort}`);
    }
    if (_.isArray(this.cmdArgs)) {
      args.push(...this.cmdArgs);
    }
    if (this.logPath) {
      args.push(`--log-path=${this.logPath}`);
    }
    if (this.disableBuildCheck) {
      args.push('--disable-build-check');
    }
    args.push('--verbose');
    // what are the process stdout/stderr conditions wherein we know that
    // the process has started to our satisfaction?
    const startDetector = /** @param {string} stdout */ (stdout) => stdout.startsWith('Starting ');

    let processIsAlive = false;
    /** @type {string|undefined} */
    let webviewVersion;
    let didDetectProtocol = false;
    try {
      const chromedriverPath = await this.initChromedriverPath();
      await this.killAll();

      // set up our subprocess object
      this.proc = new SubProcess(chromedriverPath, args);
      processIsAlive = true;

      // handle log output
      for (const streamName of ['stderr', 'stdout']) {
        this.proc.on(`line-${streamName}`, (line) => {
          // if the cd output is not printed, find the chrome version and print
          // will get a response like
          //   DevTools response: {
          //      "Android-Package": "io.appium.sampleapp",
          //      "Browser": "Chrome/55.0.2883.91",
          //      "Protocol-Version": "1.2",
          //      "User-Agent": "...",
          //      "WebKit-Version": "537.36"
          //   }
          if (!webviewVersion) {
            const match = /"Browser": "([^"]+)"/.exec(line);
            if (match) {
              webviewVersion = match[1];
              this.log.debug(`Webview version: '${webviewVersion}'`);
            }
          }

          if (!didDetectProtocol) {
            const proto = this.detectWebDriverProtocol(line);
            if (proto === PROTOCOLS.W3C) {
              // given caps might not be properly prefixed
              // so we try to fix them in order to properly init
              // the new W3C session
              this.capabilities = toW3cCapNames(this.capabilities);
            }
            didDetectProtocol = true;
          }

          if (this.verbose) {
            // give the output if it is requested
            this.log.debug(`[${streamName.toUpperCase()}] ${line}`);
          }
        });
      }

      // handle out-of-bound exit by simply emitting a stopped state
      this.proc.once('exit', (code, signal) => {
        this.driverVersion = null;
        processIsAlive = false;
        if (
          this.state !== Chromedriver.STATE_STOPPED &&
          this.state !== Chromedriver.STATE_STOPPING &&
          this.state !== Chromedriver.STATE_RESTARTING
        ) {
          const msg = `Chromedriver exited unexpectedly with code ${code}, signal ${signal}`;
          this.log.error(msg);
          this.changeState(Chromedriver.STATE_STOPPED);
        }
        this.proc?.removeAllListeners();
        this.proc = null;
      });
      this.log.info(`Spawning chromedriver with: ${this.chromedriver} ${args.join(' ')}`);
      // start subproc and wait for startDetector
      await this.proc.start(startDetector);
      await this.waitForOnline();
      return await this.startSession();
    } catch (e) {
      const err = /** @type {Error} */ (e);
      this.log.debug(err);
      this.emit(Chromedriver.EVENT_ERROR, err);
      // just because we had an error doesn't mean the chromedriver process
      // finished; we should clean up if necessary
      if (processIsAlive) {
        await this.proc?.stop();
      }
      this.proc?.removeAllListeners();
      this.proc = null;

      let message = '';
      // often the user's Chrome version is not supported by the version of Chromedriver
      if (err.message.includes('Chrome version must be')) {
        message +=
          'Unable to automate Chrome version because it is not supported by this version of Chromedriver.\n';
        if (webviewVersion) {
          message += `Chrome version on the device: ${webviewVersion}\n`;
        }
        const versionsSupportedByDriver =
          /Chrome version must be (.+)/.exec(err.message)?.[1] || '';
        if (versionsSupportedByDriver) {
          message += `Chromedriver supports Chrome version(s): ${versionsSupportedByDriver}\n`;
        }
        message += 'Check the driver tutorial for troubleshooting.\n';
      }

      message += err.message;
      throw this.log.errorWithException(message);
    }
  }

  sessionId() {
    return this.state === Chromedriver.STATE_ONLINE ? this.jwproxy.sessionId : null;
  }

  async restart() {
    this.log.info('Restarting chromedriver');
    if (this.state !== Chromedriver.STATE_ONLINE) {
      throw new Error("Can't restart when we're not online");
    }
    this.changeState(Chromedriver.STATE_RESTARTING);
    await this.stop(false);
    await this.start(this.capabilities, false);
  }

  async waitForOnline() {
    // we need to make sure that CD hasn't crashed
    let chromedriverStopped = false;
    await retryInterval(20, 200, async () => {
      if (this.state === Chromedriver.STATE_STOPPED) {
        // we are either stopped or stopping, so something went wrong
        chromedriverStopped = true;
        return;
      }
      await this.getStatus();
    });
    if (chromedriverStopped) {
      throw new Error('ChromeDriver crashed during startup.');
    }
  }

  async getStatus() {
    return await this.jwproxy.command('/status', 'GET');
  }

  async startSession() {
    const sessionCaps =
      this.desiredProtocol === PROTOCOLS.W3C
        ? {capabilities: {alwaysMatch: this.capabilities}}
        : {desiredCapabilities: this.capabilities};
    this.log.info(
      `Starting ${this.desiredProtocol} Chromedriver session with capabilities: ` +
        JSON.stringify(sessionCaps, null, 2),
    );
    const {capabilities} = /** @type {NewSessionResponse} */ (
      await this.jwproxy.command('/session', 'POST', sessionCaps)
    );
    this.log.prefix = generateLogPrefix(this, this.jwproxy.sessionId);
    this.changeState(Chromedriver.STATE_ONLINE);
    return capabilities;
  }

  async stop(emitStates = true) {
    if (emitStates) {
      this.changeState(Chromedriver.STATE_STOPPING);
    }
    /**
     *
     * @param {() => Promise<any>|any} f
     */
    const runSafeStep = async (f) => {
      try {
        return await f();
      } catch (e) {
        const err = /** @type {Error} */ (e);
        this.log.warn(err.message);
        this.log.debug(err.stack);
      }
    };
    await runSafeStep(() => this.jwproxy.command('', 'DELETE'));
    await runSafeStep(() => {
      this.proc?.stop('SIGTERM', 20000);
      this.proc?.removeAllListeners();
      this.proc = null;
    });
    this.log.prefix = generateLogPrefix(this);
    if (emitStates) {
      this.changeState(Chromedriver.STATE_STOPPED);
    }
  }

  /**
   *
   * @param {string} state
   */
  changeState(state) {
    this.state = state;
    this.log.debug(`Changed state to '${state}'`);
    this.emit(Chromedriver.EVENT_CHANGED, {state});
  }

  /**
   *
   * @param {string} url
   * @param {'POST'|'GET'|'DELETE'} method
   * @param {any} body
   * @returns
   */
  async sendCommand(url, method, body) {
    return await this.jwproxy.command(url, method, body);
  }

  /**
   *
   * @param {any} req
   * @param {any} res
   * @privateRemarks req / res probably from Express
   */
  async proxyReq(req, res) {
    return await this.jwproxy.proxyReqRes(req, res);
  }

  async killAll() {
    let cmd = system.isWindows()
      ? `wmic process where "commandline like '%chromedriver.exe%--port=${this.proxyPort}%'" delete`
      : `pkill -15 -f "${this.chromedriver}.*--port=${this.proxyPort}"`;
    this.log.debug(`Killing any old chromedrivers, running: ${cmd}`);
    try {
      await B.promisify(cp.exec)(cmd);
      this.log.debug('Successfully cleaned up old chromedrivers');
    } catch (err) {
      this.log.warn('No old chromedrivers seem to exist');
    }

    if (this.adb) {
      const udidIndex = this.adb.executable.defaultArgs.findIndex((item) => item === '-s');
      const udid = udidIndex > -1 ? this.adb.executable.defaultArgs[udidIndex + 1] : null;

      if (udid) {
        this.log.debug(`Cleaning this device's adb forwarded port socket connections: ${udid}`);
      } else {
        this.log.debug(`Cleaning any old adb forwarded port socket connections`);
      }

      try {
        for (let conn of await this.adb.getForwardList()) {
          // chromedriver will ask ADB to forward a port like "deviceId tcp:port localabstract:webview_devtools_remote_port"
          if (!(conn.includes('webview_devtools') && (!udid || conn.includes(udid)))) {
            continue;
          }

          let params = conn.split(/\s+/);
          if (params.length > 1) {
            await this.adb.removePortForward(params[1].replace(/[\D]*/, ''));
          }
        }
      } catch (e) {
        const err = /** @type {Error} */ (e);
        this.log.warn(`Unable to clean forwarded ports. Error: '${err.message}'. Continuing.`);
      }
    }
  }

  async hasWorkingWebview() {
    // sometimes chromedriver stops automating webviews. this method runs a
    // simple command to determine our state, and responds accordingly
    try {
      await this.jwproxy.command('/url', 'GET');
      return true;
    } catch (e) {
      return false;
    }
  }
}

Chromedriver.EVENT_ERROR = 'chromedriver_error';
Chromedriver.EVENT_CHANGED = 'stateChanged';
Chromedriver.STATE_STOPPED = 'stopped';
Chromedriver.STATE_STARTING = 'starting';
Chromedriver.STATE_ONLINE = 'online';
Chromedriver.STATE_STOPPING = 'stopping';
Chromedriver.STATE_RESTARTING = 'restarting';

/**
 * @typedef {import('./types').ChromedriverVersionMapping} ChromedriverVersionMapping
 */

/**
 * @typedef {{capabilities: Record<string, any>}} NewSessionResponse
 */
