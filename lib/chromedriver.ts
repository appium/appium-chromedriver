import events from 'node:events';
import {JWProxy, PROTOCOLS} from '@appium/base-driver';
import {logger} from '@appium/support';
import {SubProcess, exec} from 'teen_process';
import {getChromedriverDir, generateLogPrefix} from './utils';
import _ from 'lodash';
import {ChromedriverStorageClient} from './storage-client/storage-client';
import {CHROMEDRIVER_EVENTS, CHROMEDRIVER_STATES} from './constants';
import {getCapValue} from './protocol-helpers';
import {
  getDriversMapping,
  getChromedrivers,
  updateDriversMapping,
  getCompatibleChromedriver,
  initChromedriverPath,
} from './commands/binary';
import {getChromeVersionForAutodetection} from './commands/version';
import {buildChromedriverArgs, waitForOnline, getStatus, killAll} from './commands/process';
import {syncProtocol, startSession} from './commands/session';
import type {ADB} from 'appium-adb';
import type {ProxyOptions, HTTPMethod, HTTPBody} from '@appium/types';
import type {Request, Response} from 'express';
import type {ChromedriverOpts} from './types';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9515;
type SessionCapabilities = Record<string, any>;

export class Chromedriver extends events.EventEmitter {
  static readonly EVENT_ERROR = CHROMEDRIVER_EVENTS.ERROR;
  static readonly EVENT_CHANGED = CHROMEDRIVER_EVENTS.CHANGED;
  static readonly STATE_STOPPED = CHROMEDRIVER_STATES.STOPPED;
  static readonly STATE_STARTING = CHROMEDRIVER_STATES.STARTING;
  static readonly STATE_ONLINE = CHROMEDRIVER_STATES.ONLINE;
  static readonly STATE_STOPPING = CHROMEDRIVER_STATES.STOPPING;
  static readonly STATE_RESTARTING = CHROMEDRIVER_STATES.RESTARTING;

  private readonly _log: any;
  private readonly proxyHost: string;
  readonly proxyPort: number;
  readonly adb?: ADB;
  readonly cmdArgs?: string[];
  proc: SubProcess | null;
  readonly useSystemExecutable: boolean;
  chromedriver?: string;
  readonly executableDir: string;
  readonly mappingPath?: string;
  bundleId?: string;
  executableVerified: boolean;
  state: string;
  _execFunc: typeof exec;
  jwproxy: JWProxy;
  readonly isCustomExecutableDir: boolean;
  readonly verbose?: boolean;
  readonly logPath?: string;
  readonly disableBuildCheck: boolean;
  readonly storageClient: ChromedriverStorageClient | null;
  readonly details?: ChromedriverOpts['details'];
  capabilities: SessionCapabilities;
  _desiredProtocol: keyof typeof PROTOCOLS | null;
  _driverVersion: string | null;
  _onlineStatus: Record<string, any> | null;

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
    this._execFunc = exec;

    const proxyOpts: ProxyOptions = {server: this.proxyHost, port: this.proxyPort, log: this._log};
    if (reqBasePath) {
      proxyOpts.reqBasePath = reqBasePath;
    }
    this.jwproxy = new JWProxy(proxyOpts);
    if (executableDir) {
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
    this._driverVersion = null;
    this._onlineStatus = null;
  }

  get log() {
    return this._log;
  }

  get driverVersion(): string | null {
    return this._driverVersion;
  }

  async start(caps: SessionCapabilities, emitStartingState = true): Promise<SessionCapabilities> {
    this.capabilities = _.cloneDeep(caps);
    // set the logging preferences to ALL browser console logs by default
    this.capabilities.loggingPrefs = _.cloneDeep(getCapValue(caps, 'loggingPrefs', {}));
    if (_.isEmpty(this.capabilities.loggingPrefs.browser)) {
      this.capabilities.loggingPrefs.browser = 'ALL';
    }
    if (emitStartingState) {
      this.changeState(Chromedriver.STATE_STARTING);
    }

    const args = this.buildChromedriverArgs();
    // consider chromedriver ready once startup banner appears
    const startDetector = (stdout: string) => stdout.startsWith('Starting ');
    let processIsAlive = false;
    let webviewVersion: string | undefined;
    try {
      const chromedriverPath = await this.initChromedriverPath();
      // remove stale chromedriver/adb-forward leftovers before launching
      await this.killAll();
      this.proc = new SubProcess(chromedriverPath, args);
      processIsAlive = true;

      for (const streamName of ['stderr', 'stdout'] as const) {
        this.proc.on(`line-${streamName}`, (line: string) => {
          // if chromedriver does not print explicit Chrome version support,
          // infer webview version from DevTools banner for better errors
          if (!webviewVersion) {
            const match = /"Browser": "([^"]+)"/.exec(line);
            if (match) {
              webviewVersion = match[1];
              this.log.debug(`Webview version: '${webviewVersion}'`);
            }
          }
          if (this.verbose) {
            this.log.debug(`[${streamName.toUpperCase()}] ${line}`);
          }
        });
      }

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
          this.log.error(`Chromedriver exited unexpectedly with code ${code}, signal ${signal}`);
          this.changeState(Chromedriver.STATE_STOPPED);
        }
        this.proc?.removeAllListeners();
        this.proc = null;
      });

      this.log.info(`Spawning Chromedriver with: ${this.chromedriver} ${args.join(' ')}`);
      await this.proc.start(startDetector);
      // wait until /status says ready, then negotiate protocol and start session
      await this.waitForOnline();
      this.syncProtocol();
      return await this.startSession();
    } catch (e) {
      const err = e as Error;
      this.log.debug(err);
      this.emit(Chromedriver.EVENT_ERROR, err);
      // an error does not always mean subprocess has already exited
      if (processIsAlive) {
        await this.proc?.stop();
      }
      this.proc?.removeAllListeners();
      this.proc = null;

      let message = '';
      // enrich the common version-mismatch error with actionable context
      if (err.message.includes('Chrome version must be')) {
        message +=
          'Unable to automate Chrome version because it is not supported by this version of Chromedriver.\n';
        if (webviewVersion) {
          message += `Chrome version on the device: ${webviewVersion}\n`;
        }
        const versionsSupportedByDriver = /Chrome version must be (.+)/.exec(err.message)?.[1] || '';
        if (versionsSupportedByDriver) {
          message += `Chromedriver supports Chrome version(s): ${versionsSupportedByDriver}\n`;
        }
        message += 'Check the driver tutorial for troubleshooting.\n';
      }
      message += err.message;
      throw this.log.errorWithException(message);
    }
  }

  sessionId(): string | null {
    return this.state === Chromedriver.STATE_ONLINE ? this.jwproxy.sessionId : null;
  }

  async restart(): Promise<SessionCapabilities> {
    this.log.info('Restarting chromedriver');
    if (this.state !== Chromedriver.STATE_ONLINE) {
      throw new Error("Can't restart when we're not online");
    }
    this.changeState(Chromedriver.STATE_RESTARTING);
    await this.stop(false);
    return await this.start(this.capabilities, false);
  }

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

  async sendCommand(url: string, method: HTTPMethod, body: HTTPBody = null): Promise<HTTPBody> {
    return await this.jwproxy.command(url, method, body);
  }

  async proxyReq(req: Request, res: Response): Promise<void> {
    await this.jwproxy.proxyReqRes(req, res);
  }

  async hasWorkingWebview(): Promise<boolean> {
    try {
      await this.jwproxy.command('/url', 'GET');
      return true;
    } catch {
      return false;
    }
  }

  private buildChromedriverArgs = buildChromedriverArgs;
  private getDriversMapping = getDriversMapping;
  private getChromedrivers = getChromedrivers;
  private updateDriversMapping = updateDriversMapping;
  private getCompatibleChromedriver = getCompatibleChromedriver;
  private initChromedriverPath = initChromedriverPath;
  private getChromeVersion = getChromeVersionForAutodetection;
  private syncProtocol = syncProtocol;
  private waitForOnline = waitForOnline;
  private getStatus = getStatus;
  private killAll = killAll;
  private startSession = startSession as () => Promise<SessionCapabilities>;

  private changeState(state: string): void {
    this.state = state;
    this.log.debug(`Changed state to '${state}'`);
    this.emit(Chromedriver.EVENT_CHANGED, {state});
  }
}
