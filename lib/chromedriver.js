// transpile:main

import events from 'events';
import { JWProxy, PROTOCOLS } from 'appium-base-driver';
import cp from 'child_process';
import { system, fs, logger, util } from 'appium-support';
import { retryInterval, asyncmap } from 'asyncbox';
import { SubProcess, exec } from 'teen_process';
import B from 'bluebird';
import {
  getChromeVersion, getChromedriverDir, CHROMEDRIVER_CHROME_MAPPING,
  getChromedriverBinaryPath, CD_CDN,
} from './utils';
import semver from 'semver';
import _ from 'lodash';
import path from 'path';
import compareVersions from 'compare-versions';
import ChromedriverStorageClient from './storage-client';
import { toW3cCapNames, getCapValue } from './protocol-helpers';


const log = logger.getLogger('Chromedriver');

const NEW_CD_VERSION_FORMAT_MAJOR_VERSION = 73;
const DEFAULT_HOST = '127.0.0.1';
const MIN_CD_VERSION_WITH_W3C_SUPPORT = 75;
const DEFAULT_PORT = 9515;
const CHROME_BUNDLE_ID = 'com.android.chrome';
const WEBVIEW_SHELL_BUNDLE_ID = 'org.chromium.webview_shell';
const WEBVIEW_BUNDLE_IDS = [
  'com.google.android.webview',
  'com.android.webview',
];
const CHROMEDRIVER_TUTORIAL = 'https://github.com/appium/appium/blob/master/docs/en/writing-running-appium/web/chromedriver.md';
const VERSION_PATTERN = /([\d.]+)/;

const CD_VERSION_TIMEOUT = 5000;

class Chromedriver extends events.EventEmitter {
  constructor (args = {}) {
    super();

    const {
      host = DEFAULT_HOST,
      port = DEFAULT_PORT,
      useSystemExecutable = false,
      executable,
      executableDir = getChromedriverDir(),
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
    this.jwproxy = new JWProxy({server: this.proxyHost, port: this.proxyPort});
    this.verbose = verbose;
    this.logPath = logPath;
    this.disableBuildCheck = !!disableBuildCheck;
    this.storageClient = isAutodownloadEnabled
      ? new ChromedriverStorageClient({ chromedriverDir: this.executableDir })
      : null;
    this.details = details;
    this.capabilities = {};
    this.desiredProtocol = PROTOCOLS.MJSONWP;
  }

  async getDriversMapping () {
    let mapping = _.cloneDeep(CHROMEDRIVER_CHROME_MAPPING);
    if (this.mappingPath) {
      log.debug(`Attempting to use Chromedriver->Chrome mapping from '${this.mappingPath}'`);
      if (!await fs.exists(this.mappingPath)) {
        log.warn(`No file found at '${this.mappingPath}'`);
        log.info('Defaulting to the static Chromedriver->Chrome mapping');
      } else {
        try {
          mapping = JSON.parse(await fs.readFile(this.mappingPath, 'utf8'));
        } catch (err) {
          log.warn(`Error parsing mapping from '${this.mappingPath}': ${err.message}`);
          log.info('Defaulting to the static Chromedriver->Chrome mapping');
        }
      }
    } else {
      log.debug('Using the static Chromedriver->Chrome mapping');
    }

    // make sure that the values for minimum chrome version are semver compliant
    for (const [cdVersion, chromeVersion] of _.toPairs(mapping)) {
      const coercedVersion = semver.coerce(chromeVersion);
      if (coercedVersion) {
        mapping[cdVersion] = coercedVersion.version;
      } else {
        log.info(`'${chromeVersion}' is not a valid version number. Skipping it`);
      }
    }
    return mapping;
  }

  async getChromedrivers (mapping) {
    // go through the versions available
    const executables = await fs.glob(`${this.executableDir}/*`);
    log.debug(`Found ${util.pluralize('executable', executables.length, true)} ` +
      `in '${this.executableDir}'`);
    const cds = (await asyncmap(executables, async function mapChromedriver (executable) {
      const logError = ({message, stdout = null, stderr = null}) => {
        let errMsg = `Cannot retrieve version number from '${path.basename(executable)}' Chromedriver binary. ` +
          `Make sure it returns a valid version string in response to '--version' command line argument. ${message}`;
        if (stdout) {
          errMsg += `\nStdout: ${stdout}`;
        }
        if (stderr) {
          errMsg += `\nStderr: ${stderr}`;
        }
        log.warn(errMsg);
        return null;
      };

      let stdout;
      let stderr;
      try {
        ({stdout, stderr} = await exec(executable, ['--version'], {
          timeout: CD_VERSION_TIMEOUT,
        }));
      } catch (err) {
        if (!(err.message || '').includes('timed out') && !(err.stdout || '').includes('Starting ChromeDriver')) {
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
          version = `${coercedVersion.major}.${coercedVersion.minor}`;
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
    }))
      .filter((cd) => !!cd)
      .sort((a, b) => compareVersions(b.version, a.version));
    if (_.isEmpty(cds)) {
      log.info(`No Chromedrivers were found in '${this.executableDir}'`);
      return cds;
    }
    log.debug(`The following Chromedriver executables were found:`);
    for (const cd of cds) {
      log.debug(`    '${cd.executable}' (version '${cd.version}', minimum Chrome version '${cd.minChromeVersion ? cd.minChromeVersion : 'Unknown'}')`);
    }
    return cds;
  }

  async getChromeVersion () {
    // Try to retrieve the version from `details` property if it is set
    // The `info` item must contain the output of /json/version CDP command
    // where `Browser` field looks like `Chrome/72.0.3601.0``
    if (this.details?.info) {
      log.debug(`Browser version in the supplied details: ${this.details?.info?.Browser}`);
    }
    const versionMatch = VERSION_PATTERN.exec(this.details?.info?.Browser);
    if (versionMatch) {
      const coercedVersion = semver.coerce(versionMatch[1]);
      if (coercedVersion) {
        return coercedVersion;
      }
    }

    let chromeVersion;

    // in case of WebView Browser Tester, simply try to find the underlying webview
    if (this.bundleId === WEBVIEW_SHELL_BUNDLE_ID) {
      for (const bundleId of WEBVIEW_BUNDLE_IDS) {
        chromeVersion = await getChromeVersion(this.adb, bundleId);
        if (chromeVersion) {
          this.bundleId = bundleId;
          return semver.coerce(chromeVersion);
        }
      }
      return null;
    }

    // on Android 7-9 webviews are backed by the main Chrome, not the system webview
    if (this.adb) {
      const apiLevel = await this.adb.getApiLevel();
      if (apiLevel >= 24 && apiLevel <= 28 &&
          [WEBVIEW_SHELL_BUNDLE_ID, ...WEBVIEW_BUNDLE_IDS].includes(this.bundleId)) {
        this.bundleId = CHROME_BUNDLE_ID;
      }
    }

    // try out webviews when no bundle id is sent in
    if (!this.bundleId) {
      // default to the generic Chrome bundle
      this.bundleId = CHROME_BUNDLE_ID;

      // we have a webview of some sort, so try to find the bundle version
      for (const bundleId of WEBVIEW_BUNDLE_IDS) {
        chromeVersion = await getChromeVersion(this.adb, bundleId);
        if (chromeVersion) {
          this.bundleId = bundleId;
          break;
        }
      }
    }

    // if we do not have a chrome version, it must not be a webview
    if (!chromeVersion) {
      chromeVersion = await getChromeVersion(this.adb, this.bundleId);
    }

    // make sure it is semver, so later checks won't fail
    return chromeVersion ? semver.coerce(chromeVersion) : null;
  }

  async updateDriversMapping (newMapping) {
    let shouldUpdateStaticMapping = true;
    if (await fs.exists(this.mappingPath)) {
      try {
        await fs.writeFile(this.mappingPath, JSON.stringify(newMapping, null, 2), 'utf8');
        shouldUpdateStaticMapping = false;
      } catch (e) {
        log.warn(`Cannot store the updated chromedrivers mapping into '${this.mappingPath}'. ` +
          `This may reduce the performance of further executions. Original error: ${e.message}`);
      }
    }
    if (shouldUpdateStaticMapping) {
      Object.assign(CHROMEDRIVER_CHROME_MAPPING, newMapping);
    }
  }

  async getCompatibleChromedriver () {
    if (!this.adb) {
      return await getChromedriverBinaryPath();
    }

    const mapping = await this.getDriversMapping();
    if (!_.isEmpty(mapping)) {
      log.debug(`The most recent known Chrome version: ${_.values(mapping)[0]}`);
    }

    let didStorageSync = false;
    const syncChromedrivers = async (chromeVersion) => {
      didStorageSync = true;
      const retrievedMapping = await this.storageClient.retrieveMapping();
      log.debug('Got chromedrivers mapping from the storage: ' +
        JSON.stringify(retrievedMapping, null, 2));
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
      }, {});
      Object.assign(mapping, synchronizedDriversMapping);
      await this.updateDriversMapping(mapping);
      return true;
    };

    do {
      const cds = await this.getChromedrivers(mapping);

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
        log.info(`Found ${util.pluralize('Chromedriver', _.size(missingVersions), true)}, ` +
          `which ${_.size(missingVersions) === 1 ? 'is' : 'are'} missing in the list of known versions: ` +
          JSON.stringify(missingVersions));
        await this.updateDriversMapping(Object.assign(mapping, missingVersions));
      }

      if (this.disableBuildCheck) {
        if (_.isEmpty(cds)) {
          log.errorAndThrow(`There must be at least one Chromedriver executable available for use if ` +
            `'chromedriverDisableBuildCheck' capability is set to 'true'`);
        }
        const {version, executable} = cds[0];
        log.warn(`Chrome build check disabled. Using most recent Chromedriver version (${version}, at '${executable}')`);
        log.warn(`If this is wrong, set 'chromedriverDisableBuildCheck' capability to 'false'`);
        return executable;
      }

      const chromeVersion = await this.getChromeVersion();
      if (!chromeVersion) {
        // unable to get the chrome version
        if (_.isEmpty(cds)) {
          log.errorAndThrow(`There must be at least one Chromedriver executable available for use if ` +
            `the current Chrome version cannot be determined`);
        }
        const {version, executable} = cds[0];
        log.warn(`Unable to discover Chrome version. Using Chromedriver ${version} at '${executable}'`);
        return executable;
      }
      log.debug(`Found Chrome bundle '${this.bundleId}' version '${chromeVersion}'`);

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
            log.warn(`Cannot synchronize local chromedrivers with the remote storage at ${CD_CDN}: ` +
              e.message);
            log.debug(e.stack);
          }
        }
        const autodownloadSuggestion =
          'You could also try to enable automated chromedrivers download server feature';
        throw new Error(`No Chromedriver found that can automate Chrome '${chromeVersion}'. ` +
          (!this.storageClient ? `${autodownloadSuggestion}. ` : '') +
          `See ${CHROMEDRIVER_TUTORIAL} for more details`);
      }

      const binPath = matchingDrivers[0].executable;
      log.debug(`Found ${util.pluralize('executable', matchingDrivers.length, true)} ` +
        `capable of automating Chrome '${chromeVersion}'.\nChoosing the most recent, '${binPath}'.`);
      log.debug('If a specific version is required, specify it with the `chromedriverExecutable`' +
        'desired capability.');
      return binPath;
    // eslint-disable-next-line no-constant-condition
    } while (true);
  }

  async initChromedriverPath () {
    if (this.executableVerified) return; //eslint-disable-line curly

    // the executable might be set (if passed in)
    // or we might want to use the basic one installed with this driver
    // or we want to figure out the best one
    if (!this.chromedriver) {
      this.chromedriver = this.useSystemExecutable
        ? await getChromedriverBinaryPath()
        : await this.getCompatibleChromedriver();
    }

    if (!await fs.exists(this.chromedriver)) {
      throw new Error(`Trying to use a chromedriver binary at the path ` +
                      `${this.chromedriver}, but it doesn't exist!`);
    }
    this.executableVerified = true;
    log.info(`Set chromedriver binary as: ${this.chromedriver}`);
  }

  syncProtocol (cdVersion = null) {
    const coercedVersion = semver.coerce(cdVersion);
    if (!coercedVersion || coercedVersion.major < MIN_CD_VERSION_WITH_W3C_SUPPORT) {
      log.debug(`Chromedriver v. ${cdVersion} does not fully support ${PROTOCOLS.W3C} protocol. ` +
        `Defaulting to ${PROTOCOLS.MJSONWP}`);
      return;
    }
    const chromeOptions = getCapValue(this.capabilities, 'chromeOptions', {});
    if (chromeOptions.w3c === false) {
      log.info(`Chromedriver v. ${cdVersion} supports ${PROTOCOLS.W3C} protocol, ` +
        `but ${PROTOCOLS.MJSONWP} one has been explicitly requested`);
      return;
    }
    this.desiredProtocol = PROTOCOLS.W3C;
    // given caps might not be properly prefixed
    // so we try to fix them in order to properly init
    // the new W3C session
    this.capabilities = toW3cCapNames(this.capabilities);
  }

  async start (caps, emitStartingState = true) {
    this.capabilities = _.cloneDeep(caps);

    // set the logging preferences to ALL the console logs
    this.capabilities.loggingPrefs = _.cloneDeep(getCapValue(caps, 'loggingPrefs', {}));
    if (_.isEmpty(this.capabilities.loggingPrefs.browser)) {
      this.capabilities.loggingPrefs.browser = 'ALL';
    }

    if (emitStartingState) {
      this.changeState(Chromedriver.STATE_STARTING);
    }

    const args = ['--url-base=wd/hub', `--port=${this.proxyPort}`];
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
    const startDetector = (stdout) => stdout.startsWith('Starting ');

    let processIsAlive = false;
    let webviewVersion;
    try {
      await this.initChromedriverPath();
      await this.killAll();

      // set up our subprocess object
      this.proc = new SubProcess(this.chromedriver, args);
      processIsAlive = true;

      // handle log output
      this.proc.on('output', (stdout, stderr) => {
        // if the cd output is not printed, find the chrome version and print
        // will get a response like
        //   DevTools response: {
        //      "Android-Package": "io.appium.sampleapp",
        //      "Browser": "Chrome/55.0.2883.91",
        //      "Protocol-Version": "1.2",
        //      "User-Agent": "...",
        //      "WebKit-Version": "537.36"
        //   }
        const out = stdout + stderr;
        let match = /"Browser": "(.*)"/.exec(out);
        if (match) {
          webviewVersion = match[1];
          log.debug(`Webview version: '${webviewVersion}'`);
        }

        // also print chromedriver version to logs
        // will output something like
        //  Starting ChromeDriver 2.33.506106 (8a06c39c4582fbfbab6966dbb1c38a9173bfb1a2) on port 9515
        match = /Starting ChromeDriver ([.\d]+)/.exec(out);
        if (match) {
          log.debug(`Chromedriver version: '${match[1]}'`);
          this.syncProtocol(match[1]);
        }

        // give the output if it is requested
        if (this.verbose) {
          for (let line of (stdout || '').trim().split('\n')) {
            if (!line.trim().length) continue; // eslint-disable-line curly
            log.debug(`[STDOUT] ${line}`);
          }
          for (let line of (stderr || '').trim().split('\n')) {
            if (!line.trim().length) continue; // eslint-disable-line curly
            log.error(`[STDERR] ${line}`);
          }
        }
      });

      // handle out-of-bound exit by simply emitting a stopped state
      this.proc.on('exit', (code, signal) => {
        processIsAlive = false;
        if (this.state !== Chromedriver.STATE_STOPPED &&
            this.state !== Chromedriver.STATE_STOPPING &&
            this.state !== Chromedriver.STATE_RESTARTING) {
          let msg = `Chromedriver exited unexpectedly with code ${code}, ` +
                    `signal ${signal}`;
          log.error(msg);
          this.changeState(Chromedriver.STATE_STOPPED);
        }
      });
      log.info(`Spawning chromedriver with: ${this.chromedriver} ` +
               `${args.join(' ')}`);
      // start subproc and wait for startDetector
      await this.proc.start(startDetector);
      await this.waitForOnline();
      await this.startSession();
    } catch (e) {
      log.debug(e);
      this.emit(Chromedriver.EVENT_ERROR, e);
      // just because we had an error doesn't mean the chromedriver process
      // finished; we should clean up if necessary
      if (processIsAlive) {
        await this.proc.stop();
      }

      let message = '';
      // often the user's Chrome version is too low for the version of Chromedriver
      if (e.message.includes('Chrome version must be')) {
        message += 'Unable to automate Chrome version because it is too old for this version of Chromedriver.\n';
        if (webviewVersion) {
          message += `Chrome version on the device: ${webviewVersion}\n`;
        }
        message += `Visit '${CHROMEDRIVER_TUTORIAL}' to troubleshoot the problem.\n`;
      }

      message += e.message;
      log.errorAndThrow(message);
    }
  }

  sessionId () {
    if (this.state !== Chromedriver.STATE_ONLINE) {
      return null;
    }

    return this.jwproxy.sessionId;
  }

  async restart () {
    log.info('Restarting chromedriver');
    if (this.state !== Chromedriver.STATE_ONLINE) {
      throw new Error("Can't restart when we're not online");
    }
    this.changeState(Chromedriver.STATE_RESTARTING);
    await this.stop(false);
    await this.start(this.capabilities, false);
  }

  async waitForOnline () {
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

  async getStatus () {
    return await this.jwproxy.command('/status', 'GET');
  }

  async startSession () {
    const sessionCaps = this.desiredProtocol === PROTOCOLS.W3C
      ? {capabilities: {alwaysMatch: this.capabilities}}
      : {desiredCapabilities: this.capabilities};
    log.info(`Starting ${this.desiredProtocol} Chromedriver session with capabilities: ` +
      JSON.stringify(sessionCaps, null, 2));
    await this.jwproxy.command('/session', 'POST', sessionCaps);
    this.changeState(Chromedriver.STATE_ONLINE);
  }

  async stop (emitStates = true) {
    if (emitStates) {
      this.changeState(Chromedriver.STATE_STOPPING);
    }
    try {
      await this.jwproxy.command('', 'DELETE');
      await this.proc.stop('SIGTERM', 20000);
      if (emitStates) {
        this.changeState(Chromedriver.STATE_STOPPED);
      }
    } catch (e) {
      log.error(e);
    }
  }

  changeState (state) {
    this.state = state;
    log.debug(`Changed state to '${state}'`);
    this.emit(Chromedriver.EVENT_CHANGED, {state});
  }

  async sendCommand (url, method, body) {
    return await this.jwproxy.command(url, method, body);
  }

  async proxyReq (req, res) {
    return await this.jwproxy.proxyReqRes(req, res);
  }

  async killAll () {
    let cmd = system.isWindows()
      ? `wmic process where "commandline like '%chromedriver.exe%--port=${this.proxyPort}%'" delete`
      : `pkill -15 -f "${this.chromedriver}.*--port=${this.proxyPort}"`;
    log.debug(`Killing any old chromedrivers, running: ${cmd}`);
    try {
      await (B.promisify(cp.exec))(cmd);
      log.debug('Successfully cleaned up old chromedrivers');
    } catch (err) {
      log.warn('No old chromedrivers seem to exist');
    }

    if (this.adb) {
      const udidIndex = this.adb.executable.defaultArgs.findIndex((item) => item === '-s');
      const udid = udidIndex > -1 ? this.adb.executable.defaultArgs[udidIndex + 1] : null;

      if (udid) {
        log.debug(`Cleaning this device's adb forwarded port socket connections: ${udid}`);
      } else {
        log.debug(`Cleaning any old adb forwarded port socket connections`);
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
      } catch (err) {
        log.warn(`Unable to clean forwarded ports. Error: '${err.message}'. Continuing.`);
      }
    }
  }

  async hasWorkingWebview () {
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

export { Chromedriver };
export default Chromedriver;
