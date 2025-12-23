import events from 'events';
import {JWProxy, PROTOCOLS} from '@appium/base-driver';
import cp from 'child_process';
import {system, fs, logger, util} from '@appium/support';
import {retryInterval, asyncmap} from 'asyncbox';
import {SubProcess, exec, type ExecError} from 'teen_process';
import B from 'bluebird';
import {
  getChromeVersion,
  getChromedriverDir,
  CHROMEDRIVER_CHROME_MAPPING,
  getChromedriverBinaryPath,
  generateLogPrefix,
} from './utils';
import * as semver from 'semver';
import _ from 'lodash';
import path from 'path';
import {compareVersions} from 'compare-versions';
import {ChromedriverStorageClient} from './storage-client/storage-client';
import {toW3cCapNames, getCapValue, toW3cCapName} from './protocol-helpers';
import type {ADB} from 'appium-adb';
import type {ProxyOptions, HTTPMethod, HTTPBody} from '@appium/types';
import type {Request, Response} from 'express';
import type {ChromedriverOpts, ChromedriverVersionMapping} from './types';

const NEW_CD_VERSION_FORMAT_MAJOR_VERSION = 73;
const DEFAULT_HOST = '127.0.0.1';
const MIN_CD_VERSION_WITH_W3C_SUPPORT = 75;
const DEFAULT_PORT = 9515;
const CHROME_BUNDLE_ID = 'com.android.chrome';
const WEBVIEW_SHELL_BUNDLE_ID = 'org.chromium.webview_shell';
const WEBVIEW_BUNDLE_IDS = ['com.google.android.webview', 'com.android.webview'] as const;
const VERSION_PATTERN = /([\d.]+)/;

const CD_VERSION_TIMEOUT = 5000;

interface ChromedriverInfo {
  executable: string;
  version: string;
  minChromeVersion: string | null;
}

interface NewSessionResponse {
  capabilities?: Record<string, any>;
  [key: string]: any;
}

type SessionCapabilities = Record<string, any>;

export class Chromedriver extends events.EventEmitter {
  static readonly EVENT_ERROR = 'chromedriver_error';
  static readonly EVENT_CHANGED = 'stateChanged';
  static readonly STATE_STOPPED = 'stopped';
  static readonly STATE_STARTING = 'starting';
  static readonly STATE_ONLINE = 'online';
  static readonly STATE_STOPPING = 'stopping';
  static readonly STATE_RESTARTING = 'restarting';

  private readonly _log: any;
  private readonly proxyHost: string;
  private readonly proxyPort: number;
  private readonly adb?: ADB;
  private readonly cmdArgs?: string[];
  private proc: SubProcess | null;
  private readonly useSystemExecutable: boolean;
  private chromedriver?: string;
  private readonly executableDir: string;
  private readonly mappingPath?: string;
  private bundleId?: string;
  private executableVerified: boolean;
  state: string;
  private readonly _execFunc: typeof exec;
  jwproxy: JWProxy;
  private readonly isCustomExecutableDir: boolean;
  private readonly verbose?: boolean;
  private readonly logPath?: string;
  private readonly disableBuildCheck: boolean;
  private readonly storageClient: ChromedriverStorageClient | null;
  private readonly details?: ChromedriverOpts['details'];
  private capabilities: SessionCapabilities;
  private _desiredProtocol: keyof typeof PROTOCOLS | null;
  private _driverVersion: string | null;
  private _onlineStatus: Record<string, any> | null;

  constructor(args: ChromedriverOpts = {}) {
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
      reqBasePath,
    } = args;
    this._log = logger.getLogger(generateLogPrefix(this));

    this.proxyHost = host;
    this.proxyPort = parseInt(String(port), 10);
    this.adb = adb;
    this.cmdArgs = cmdArgs;
    this.proc = null;
    this.useSystemExecutable = useSystemExecutable;
    this.chromedriver = executable;
    this.mappingPath = mappingPath;
    this.bundleId = bundleId;
    this.executableVerified = false;
    this.state = Chromedriver.STATE_STOPPED;

    // to mock in unit test
    this._execFunc = exec;

    const proxyOpts: ProxyOptions = {
      server: this.proxyHost,
      port: this.proxyPort,
      log: this._log,
    };
    if (reqBasePath) {
      proxyOpts.reqBasePath = reqBasePath;
    }
    this.jwproxy = new JWProxy(proxyOpts);
    if (executableDir) {
      // Expects the user set the executable directory explicitly
      this.executableDir = executableDir;
      this.isCustomExecutableDir = true;
    } else {
      this.executableDir = getChromedriverDir();
      this.isCustomExecutableDir = false;
    }

    this.verbose = verbose;
    this.logPath = logPath;
    this.disableBuildCheck = !!disableBuildCheck;
    this.storageClient = isAutodownloadEnabled
      ? new ChromedriverStorageClient({chromedriverDir: this.executableDir})
      : null;
    this.details = details;
    this.capabilities = {};
    this._desiredProtocol = null;

    // Store the running driver version
    this._driverVersion = null;
    this._onlineStatus = null;
  }

  /**
   * Gets the logger instance for this Chromedriver instance.
   * @returns The logger instance.
   */
  get log() {
    return this._log;
  }

  /**
   * Gets the version of the currently running Chromedriver.
   * @returns The driver version string, or null if not yet determined.
   */
  get driverVersion(): string | null {
    return this._driverVersion;
  }

  /**
   * Starts a new Chromedriver session with the given capabilities.
   * @param caps - The session capabilities to use.
   * @param emitStartingState - Whether to emit the starting state event (default: true).
   * @returns A promise that resolves to the session capabilities returned by Chromedriver.
   * @throws {Error} If Chromedriver fails to start or crashes during startup.
   */
  async start(caps: SessionCapabilities, emitStartingState = true): Promise<SessionCapabilities> {
    this.capabilities = _.cloneDeep(caps);

    // set the logging preferences to ALL the console logs
    this.capabilities.loggingPrefs = _.cloneDeep(getCapValue(caps, 'loggingPrefs', {}));
    if (_.isEmpty(this.capabilities.loggingPrefs.browser)) {
      this.capabilities.loggingPrefs.browser = 'ALL';
    }

    if (emitStartingState) {
      this.changeState(Chromedriver.STATE_STARTING);
    }

    const args = this.buildChromedriverArgs();
    // what are the process stdout/stderr conditions wherein we know that
    // the process has started to our satisfaction?
    const startDetector = (stdout: string) => stdout.startsWith('Starting ');

    let processIsAlive = false;
    let webviewVersion: string | undefined;
    try {
      const chromedriverPath = await this.initChromedriverPath();
      await this.killAll();

      // set up our subprocess object
      this.proc = new SubProcess(chromedriverPath, args);
      processIsAlive = true;

      // handle log output
      for (const streamName of ['stderr', 'stdout'] as const) {
        this.proc.on(`line-${streamName}`, (line: string) => {
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

          if (this.verbose) {
            // give the output if it is requested
            this.log.debug(`[${streamName.toUpperCase()}] ${line}`);
          }
        });
      }

      // handle out-of-bound exit by simply emitting a stopped state
      this.proc.once('exit', (code: number | null, signal: string | null) => {
        this._driverVersion = null;
        this._desiredProtocol = null;
        this._onlineStatus = null;
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
      this.log.info(`Spawning Chromedriver with: ${this.chromedriver} ${args.join(' ')}`);
      // start subproc and wait for startDetector
      await this.proc.start(startDetector);
      await this.waitForOnline();
      this.syncProtocol();
      return await this.startSession();
    } catch (e) {
      const err = e as Error;
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

  /**
   * Gets the current session ID if the driver is online.
   * @returns The session ID string, or null if the driver is not online.
   */
  sessionId(): string | null {
    return this.state === Chromedriver.STATE_ONLINE ? this.jwproxy.sessionId : null;
  }

  /**
   * Restarts the Chromedriver session.
   * The session will be stopped and then started again with the same capabilities.
   * @returns A promise that resolves to the session capabilities returned by Chromedriver.
   * @throws {Error} If the driver is not online or if restart fails.
   */
  async restart(): Promise<SessionCapabilities> {
    this.log.info('Restarting chromedriver');
    if (this.state !== Chromedriver.STATE_ONLINE) {
      throw new Error("Can't restart when we're not online");
    }
    this.changeState(Chromedriver.STATE_RESTARTING);
    await this.stop(false);
    return await this.start(this.capabilities, false);
  }

  /**
   * Stops the Chromedriver session and terminates the process.
   * @param emitStates - Whether to emit state change events during shutdown (default: true).
   * @returns A promise that resolves when the session has been stopped.
   */
  async stop(emitStates = true): Promise<void> {
    if (emitStates) {
      this.changeState(Chromedriver.STATE_STOPPING);
    }
    const runSafeStep = async (f: () => Promise<any> | any): Promise<void> => {
      try {
        return await f();
      } catch (e) {
        const err = e as Error;
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
   * Sends a command to the Chromedriver server.
   * @param url - The endpoint URL (e.g., '/url', '/session').
   * @param method - The HTTP method to use ('POST', 'GET', or 'DELETE').
   * @param body - Optional request body for POST requests.
   * @returns A promise that resolves to the response from Chromedriver.
   */
  async sendCommand(url: string, method: HTTPMethod, body: HTTPBody = null): Promise<HTTPBody> {
    return await this.jwproxy.command(url, method, body);
  }

  /**
   * Proxies an HTTP request/response to the Chromedriver server.
   * @param req - The incoming HTTP request object.
   * @param res - The outgoing HTTP response object.
   * @returns A promise that resolves when the proxying is complete.
   */
  async proxyReq(req: Request, res: Response): Promise<void> {
    await this.jwproxy.proxyReqRes(req, res);
  }

  /**
   * Checks if Chromedriver is currently able to automate webviews.
   * Sometimes Chromedriver stops automating webviews; this method runs a simple
   * command to determine the current state.
   * @returns A promise that resolves to true if webviews are working, false otherwise.
   */
  async hasWorkingWebview(): Promise<boolean> {
    try {
      await this.jwproxy.command('/url', 'GET');
      return true;
    } catch {
      return false;
    }
  }

  // Private methods at the tail of the class

  private buildChromedriverArgs(): string[] {
    const args = [`--port=${this.proxyPort}`];
    if (this.adb?.adbPort) {
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
    return args;
  }

  private async getDriversMapping(): Promise<ChromedriverVersionMapping> {
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

  private async getChromedrivers(mapping: ChromedriverVersionMapping): Promise<ChromedriverInfo[]> {
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

          // if this has timed out, it has actually started Chromedriver,
          // in which case there will also be the version string in the output
          stdout = err.stdout;
        }

        const match = /ChromeDriver\s+\(?v?([\d.]+)\)?/i.exec(stdout); // https://regex101.com/r/zpj5wA/1
        if (!match) {
          return logError({message: 'Cannot parse the version string', stdout, stderr});
        }
        let version = match[1];
        let minChromeVersion = mapping[version] || null;
        const coercedVersion = semver.coerce(version);
        if (coercedVersion) {
          // before 2019-03-06 versions were of the form major.minor
          if (coercedVersion.major < NEW_CD_VERSION_FORMAT_MAJOR_VERSION) {
            version = `${coercedVersion.major}.${coercedVersion.minor}`;
            minChromeVersion = mapping[version] || null;
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

  private async getChromeVersion(): Promise<semver.SemVer | null> {
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

    let chromeVersion: string | undefined;

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

  private async updateDriversMapping(newMapping: ChromedriverVersionMapping): Promise<void> {
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

  private async getCompatibleChromedriver(): Promise<string> {
    if (!this.adb && !this.isCustomExecutableDir) {
      return await getChromedriverBinaryPath();
    }

    const mapping = await this.getDriversMapping();
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
      await this.updateDriversMapping(mapping);
      return true;
    };

    while (true) {
      const cds = await this.getChromedrivers(mapping);

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
            const err = e as Error;
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
        `If a specific version is required, specify it with the 'chromedriverExecutable'` +
          ` capability.`,
      );
      return binPath;
    }
  }

  private async initChromedriverPath(): Promise<string> {
    if (this.executableVerified && this.chromedriver) {
      return this.chromedriver;
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
          `${chromedriver}, but it doesn't exist!`,
      );
    }
    this.executableVerified = true;
    this.log.info(`Set chromedriver binary as: ${chromedriver}`);
    return chromedriver;
  }

  private syncProtocol(): keyof typeof PROTOCOLS {
    if (this.driverVersion) {
      const coercedVersion = semver.coerce(this.driverVersion);
      if (!coercedVersion || coercedVersion.major < MIN_CD_VERSION_WITH_W3C_SUPPORT) {
        this.log.info(
          `The ChromeDriver v. ${this.driverVersion} does not fully support ${PROTOCOLS.W3C} protocol. ` +
            `Defaulting to ${PROTOCOLS.MJSONWP}`,
        );
        this._desiredProtocol = PROTOCOLS.MJSONWP;
        return this._desiredProtocol;
      }
    }

    const isOperaDriver = _.includes(this._onlineStatus?.message, 'OperaDriver');
    const chromeOptions = getCapValue(this.capabilities, 'chromeOptions');
    if (_.isPlainObject(chromeOptions) && chromeOptions.w3c === false) {
      this.log.info(
        `The ChromeDriver v. ${this.driverVersion} supports ${PROTOCOLS.W3C} protocol, ` +
          `but ${PROTOCOLS.MJSONWP} one has been explicitly requested`,
      );
      this._desiredProtocol = PROTOCOLS.MJSONWP;
      return this._desiredProtocol;
    } else if (isOperaDriver) {
      // OperaDriver needs the W3C protocol to be requested explicitly,
      // otherwise it defaults to JWP
      if (_.isPlainObject(chromeOptions)) {
        chromeOptions.w3c = true;
      } else {
        this.capabilities[toW3cCapName('chromeOptions')] = {w3c: true};
      }
    }

    this._desiredProtocol = PROTOCOLS.W3C;
    return this._desiredProtocol;
  }

  private async waitForOnline(): Promise<void> {
    // we need to make sure that CD hasn't crashed
    let chromedriverStopped = false;
    await retryInterval(20, 200, async () => {
      if (this.state === Chromedriver.STATE_STOPPED) {
        // we are either stopped or stopping, so something went wrong
        chromedriverStopped = true;
        return;
      }
      const status: any = await this.getStatus();
      if (!_.isPlainObject(status) || !status.ready) {
        throw new Error(`The response to the /status API is not valid: ${JSON.stringify(status)}`);
      }
      this._onlineStatus = status;
      const versionMatch = VERSION_PATTERN.exec(status.build?.version ?? '');
      if (versionMatch) {
        this._driverVersion = versionMatch[1];
        this.log.info(`Chromedriver version: ${this._driverVersion}`);
      } else {
        this.log.info('Chromedriver version cannot be determined from the /status API response');
      }
    });
    if (chromedriverStopped) {
      throw new Error('ChromeDriver crashed during startup.');
    }
  }

  private async getStatus(): Promise<any> {
    return await this.jwproxy.command('/status', 'GET');
  }

  private async startSession(): Promise<SessionCapabilities> {
    const sessionCaps =
      this._desiredProtocol === PROTOCOLS.W3C
        ? {capabilities: {alwaysMatch: toW3cCapNames(this.capabilities)}}
        : {desiredCapabilities: this.capabilities};
    this.log.info(
      `Starting ${this._desiredProtocol} Chromedriver session with capabilities: ` +
        JSON.stringify(sessionCaps, null, 2),
    );
    const response = (await this.jwproxy.command('/session', 'POST', sessionCaps)) as NewSessionResponse;
    this.log.prefix = generateLogPrefix(this, this.jwproxy.sessionId);
    this.changeState(Chromedriver.STATE_ONLINE);
    return _.has(response, 'capabilities') && response.capabilities ? response.capabilities : (response as SessionCapabilities);
  }

  private changeState(state: string): void {
    this.state = state;
    this.log.debug(`Changed state to '${state}'`);
    this.emit(Chromedriver.EVENT_CHANGED, {state});
  }

  private async killAll(): Promise<void> {
    const cmd = system.isWindows()
      ? `wmic process where "commandline like '%chromedriver.exe%--port=${this.proxyPort}%'" delete`
      : `pkill -15 -f "${this.chromedriver}.*--port=${this.proxyPort}"`;
    this.log.debug(`Killing any old chromedrivers, running: ${cmd}`);
    try {
      await B.promisify(cp.exec)(cmd);
      this.log.debug('Successfully cleaned up old chromedrivers');
    } catch {
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
        for (const conn of await this.adb.getForwardList()) {
          // chromedriver will ask ADB to forward a port like "deviceId tcp:port localabstract:webview_devtools_remote_port"
          if (!(conn.includes('webview_devtools') && (!udid || conn.includes(udid)))) {
            continue;
          }

          const params = conn.split(/\s+/);
          if (params.length > 1) {
            await this.adb.removePortForward(params[1].replace(/[\D]*/, ''));
          }
        }
      } catch (e) {
        const err = e as Error;
        this.log.warn(`Unable to clean forwarded ports. Error: '${err.message}'. Continuing.`);
      }
    }
  }
}
