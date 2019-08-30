// transpile:main

import events from 'events';
import { JWProxy, PROTOCOLS } from 'appium-base-driver';
import cp from 'child_process';
import { system, fs, logger } from 'appium-support';
import { retryInterval, asyncmap } from 'asyncbox';
import { SubProcess, exec } from 'teen_process';
import B from 'bluebird';
import {
  getChromeVersion, getChromedriverDir, getChromedriverBinaryPath
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
const CHROMEDRIVER_CHROME_MAPPING = {
  // Chromedriver version: minumum Chrome version
  '76.0.3809.126': '76.0.3809.126',
  '76.0.3809.68': '76.0.3809.68',
  '76.0.3809.25': '76.0.3809.25',
  '76.0.3809.12': '76.0.3809.12',
  '75.0.3770.140': '75.0.3770.140',
  '75.0.3770.90': '75.0.3770.90',
  '75.0.3770.8': '75.0.3770.8',
  '74.0.3729.6': '74.0.3729',
  '73.0.3683.68': '70.0.3538',
  '2.46': '71.0.3578',
  '2.45': '70.0.0',
  '2.44': '69.0.3497',
  '2.43': '69.0.3497',
  '2.42': '68.0.3440',
  '2.41': '67.0.3396',
  '2.40': '66.0.3359',
  '2.39': '66.0.3359',
  '2.38': '65.0.3325',
  '2.37': '64.0.3282',
  '2.36': '63.0.3239',
  '2.35': '62.0.3202',
  '2.34': '61.0.3163',
  '2.33': '60.0.3112',
  '2.32': '59.0.3071',
  '2.31': '58.0.3029',
  '2.30': '58.0.3029',
  '2.29': '57.0.2987',
  '2.28': '55.0.2883',
  '2.27': '54.0.2840',
  '2.26': '53.0.2785',
  '2.25': '53.0.2785',
  '2.24': '52.0.2743',
  '2.23': '51.0.2704',
  '2.22': '49.0.2623',
  '2.21': '46.0.2490',
  '2.20': '43.0.2357',
  '2.19': '43.0.2357',
  '2.18': '43.0.2357',
  '2.17': '42.0.2311',
  '2.16': '42.0.2311',
  '2.15': '40.0.2214',
  '2.14': '39.0.2171',
  '2.13': '38.0.2125',
  '2.12': '36.0.1985',
  '2.11': '36.0.1985',
  '2.10': '33.0.1751',
  '2.9': '31.0.1650',
  '2.8': '30.0.1573',
  '2.7': '30.0.1573',
  '2.6': '29.0.1545',
  '2.5': '29.0.1545',
  '2.4': '29.0.1545',
  '2.3': '28.0.1500',
  '2.2': '27.0.1453',
  '2.1': '27.0.1453',
  '2.0': '27.0.1453',
};
const CHROME_BUNDLE_ID = 'com.android.chrome';
const WEBVIEW_BUNDLE_IDS = [
  'com.google.android.webview',
  'com.android.webview',
];
const CHROMEDRIVER_TUTORIAL = 'https://github.com/appium/appium/blob/master/docs/en/writing-running-appium/web/chromedriver.md';

const CD_VER = process.env.npm_config_chromedriver_version ||
               process.env.CHROMEDRIVER_VERSION ||
               getMostRecentChromedriver();

const CD_VERSION_TIMEOUT = 5000;

function getMostRecentChromedriver (mapping = CHROMEDRIVER_CHROME_MAPPING) {
  if (_.isEmpty(mapping)) {
    throw new Error('Unable to get most recent Chromedriver from empty mapping');
  }
  return _.last(_.keys(mapping).sort(compareVersions));
}

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
    this.capabilities = {};
    this.desiredProtocol = PROTOCOLS.MJSONWP;
  }

  async getMapping () {
    let mapping = CHROMEDRIVER_CHROME_MAPPING;
    if (this.mappingPath) {
      log.debug(`Attempting to use Chromedriver-Chrome mapping from '${this.mappingPath}'`);
      if (!await fs.exists(this.mappingPath)) {
        log.warn(`No file found at '${this.mappingPath}'. Using default mapping`);
      } else {
        try {
          mapping = JSON.parse(await fs.readFile(this.mappingPath));
        } catch (err) {
          log.error(`Error parsing mapping from '${this.mappingPath}': ${err.message}`);
          log.warn('Using default mapping');
        }
      }
    }

    // make sure that the values for minimum chrome version are semver compliant
    for (const [cdVersion, chromeVersion] of _.toPairs(mapping)) {
      mapping[cdVersion] = semver.coerce(chromeVersion);
    }
    return mapping;
  }

  async getChromedrivers (mapping) {
    // go through the versions available
    const executables = await fs.glob(`${this.executableDir}/*`);
    log.debug(`Found ${executables.length} executable${executables.length === 1 ? '' : 's'} ` +
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
      const coercedVersion = semver.coerce(version);
      if (coercedVersion) {
        // before 2019-03-06 versions were of the form major.minor
        if (coercedVersion.major < NEW_CD_VERSION_FORMAT_MAJOR_VERSION) {
          version = `${coercedVersion.major}.${coercedVersion.minor}`;
        }
      }
      return {
        executable,
        version,
        minChromeVersion: mapping[version],
      };
    }))
      .filter((cd) => !!cd)
      .sort((a, b) => compareVersions(b.version, a.version));
    if (_.isEmpty(cds)) {
      log.errorAndThrow(`No Chromedrivers found in '${this.executableDir}'`);
    }
    log.debug(`The following Chromedriver executables were found:`);
    for (const cd of cds) {
      log.debug(`    '${cd.executable}' (version '${cd.version}', minimum Chrome version '${cd.minChromeVersion ? cd.minChromeVersion : 'Unknown'}')`);
    }
    return cds;
  }

  async getChromeVersion () {
    let chromeVersion;

    // on Android 7+ webviews are backed by the main Chrome, not the system webview
    if (this.adb && await this.adb.getApiLevel() >= 24) {
      this.bundleId = CHROME_BUNDLE_ID;
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

  async getCompatibleChromedriver () {
    if (!this.adb) {
      return await getChromedriverBinaryPath();
    }

    const mapping = await this.getMapping();
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
      let shouldUpdateGlobalMapping = true;
      if (await fs.exists(this.mappingPath)) {
        try {
          await fs.writeFile(this.mappingPath, JSON.stringify(mapping, null, 2), 'utf8');
          shouldUpdateGlobalMapping = false;
        } catch (e) {
          log.warn(`Cannot store the updated chromedrivers mapping into '${this.mappingPath}'. ` +
            `This may reduce the performance of further executions. Original error: ${e.message}`);
        }
      }
      if (shouldUpdateGlobalMapping) {
        Object.assign(CHROMEDRIVER_CHROME_MAPPING, mapping);
      }
      return true;
    };

    do {
      const cds = await this.getChromedrivers(mapping);

      if (this.disableBuildCheck) {
        const {version, executable} = cds[0];
        log.warn(`Chrome build check disabled. Using most recent Chromedriver version (${version}, at '${executable}')`);
        log.warn(`If this is wrong, set 'chromedriverDisableBuildCheck' capability to 'false'`);
        return executable;
      }

      const chromeVersion = await this.getChromeVersion();
      if (!chromeVersion) {
        // unable to get the chrome version
        const {version, executable} = cds[0];
        log.warn(`Unable to discover Chrome version. Using Chromedriver ${version} at '${executable}'`);
        return executable;
      }

      log.debug(`Found Chrome bundle '${this.bundleId}' version '${chromeVersion}'`);

      const autodownloadMsg = this.storageClient && didStorageSync
        ? ''
        : '. You could also try to enable automated chromedrivers download server feature';
      if (semver.gt(chromeVersion, _.values(mapping)[0]) && cds[0] && !cds[0].minChromeVersion) {
        if (this.storageClient && !didStorageSync) {
          try {
            if (await syncChromedrivers(chromeVersion)) {
              continue;
            }
          } catch (e) {
            log.warn(e.stack);
          }
        }
        // this is a chrome above the latest version we know about,
        // and we have a chromedriver that is beyond what we know,
        // so use the most recent chromedriver that we found
        const {version, executable} = cds[0];
        log.warn(`No known Chromedriver available to automate Chrome version '${chromeVersion}'.\n` +
          `Using Chromedriver version '${version}', which has not been tested with Appium` +
          autodownloadMsg);
        return executable;
      }

      const workingCds = cds.filter((cd) => {
        const versionObj = semver.coerce(cd.minChromeVersion);
        return versionObj && chromeVersion.major === versionObj.major;
      });
      if (_.isEmpty(workingCds)) {
        if (this.storageClient && !didStorageSync) {
          try {
            if (await syncChromedrivers(chromeVersion)) {
              continue;
            }
          } catch (e) {
            log.warn(e.stack);
          }
        }
        log.errorAndThrow(`No Chromedriver found that can automate Chrome '${chromeVersion}'. ` +
          `See ${CHROMEDRIVER_TUTORIAL} for more details` + autodownloadMsg);
      }

      const binPath = workingCds[0].executable;
      log.debug(`Found ${workingCds.length} Chromedriver executable${workingCds.length === 1 ? '' : 's'} ` +
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
    const startDetector = (stdout) => {
      return stdout.indexOf('Starting ') === 0;
    };

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
    // retry session start 4 times, sometimes this fails due to adb
    await retryInterval(4, 200, async () => {
      try {
        await this.jwproxy.command('/session', 'POST', sessionCaps);
      } catch (err) {
        log.warn(`Failed to start Chromedriver session: ${err.message}`);
        throw err;
      }
    });
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
      log.debug(`Cleaning any old adb forwarded port socket connections`);
      try {
        for (let conn of await this.adb.getForwardList()) {
          // chromedriver will ask ADB to forward a port like "deviceId tcp:port localabstract:webview_devtools_remote_port"
          if (conn.indexOf('webview_devtools') !== -1) {
            let params = conn.split(/\s+/);
            if (params.length > 1) {
              await this.adb.removePortForward(params[1].replace(/[\D]*/, ''));
            }
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

export {
  Chromedriver, CHROMEDRIVER_CHROME_MAPPING, getMostRecentChromedriver, CD_VER,
};
export default Chromedriver;
