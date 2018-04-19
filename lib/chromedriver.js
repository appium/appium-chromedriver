// transpile:main

import events from 'events';
import { JWProxy } from 'appium-base-driver';
import cp from 'child_process';
import { system, fs, logger } from 'appium-support';
import { retryInterval, asyncmap } from 'asyncbox';
import { SubProcess, exec } from 'teen_process';
import B from 'bluebird';
import { getChromedriverBinaryPath, getChromedriverDir } from './install';
import { getChromeVersion } from './utils';
import semver from 'semver';
import _ from 'lodash';


const log = logger.getLogger('Chromedriver');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9515;
const CHROMEDRIVER_CHROME_MAPPING = {
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

class Chromedriver extends events.EventEmitter {
  constructor (args = {}) {
    super();

    const {
      host = DEFAULT_HOST,
      port = DEFAULT_PORT,
      executable,
      executableDir = getChromedriverDir(),
      bundleId = 'com.android.chrome',
      mappingPath,
      cmdArgs,
      adb,
      verbose,
      logPath,
    } = args;

    this.proxyHost = host;
    this.proxyPort = port;
    this.adb = adb;
    this.cmdArgs = cmdArgs;
    this.proc = null;
    this.chromedriver = executable;
    this.executableDir = executableDir;
    this.mappingPath = mappingPath;
    this.bundleId = bundleId;
    this.executableVerified = false;
    this.state = Chromedriver.STATE_STOPPED;
    this.jwproxy = new JWProxy({server: this.proxyHost, port: this.proxyPort});
    this.verbose = verbose;
    this.logPath = logPath;
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
    return mapping;
  }

  async getChromedrivers (mapping) {
    // go through the versions available
    const executables = await fs.glob(`${this.executableDir}/*`);
    const cds = (await asyncmap(executables, async function (executable) {
      try {
        const {stdout} = await exec(executable, ['--version']);
        const match = /ChromeDriver\s(\d+\.\d+)\.\d+\s/.exec(stdout);
        if (match) {
          const version = match[1];
          return {
            executable,
            version,
            minCDVersion: mapping[version],
          };
        }
      } catch (ign) {}
    }))
      .filter((cd) => !!cd)
      .sort((a, b) => semver.gte(semver.coerce(b.version), semver.coerce(a.version)) ? 1 : -1);
    if (_.isEmpty(cds)) {
      log.errorAndThrow(`No Chromedriver found`);
    }
    log.debug(`The following Chromedriver executables were found:`);
    for (const cd of cds) {
      log.debug(`    ${cd.executable} (minimum Chrome version '${cd.minCDVersion ? cd.minCDVersion : 'Unknown'}')`);
    }
    return cds;
  }

  async getCompatibleChromedriver () {
    if (!this.adb) {
      return await getChromedriverBinaryPath();
    }

    const mapping = await this.getMapping();
    const cds = await this.getChromedrivers(mapping);

    const chromeVersion = semver.coerce(await getChromeVersion(this.adb, this.bundleId));
    if (!chromeVersion) {
      // unable to get the chrome version
      let cd = cds[0];
      log.warn(`Unable to discover Chrome version. Using Chromedriver ${cd.version} at '${cd.executable}'`);
      return cd.executable;
    }

    if (semver.gt(chromeVersion, _.values(mapping)[0]) &&
        !_.isUndefined(cds[0]) && _.isUndefined(cds[0].minCDVersion)) {
      // this is a chrome above the latest version we know about,
      // and we have a chromedriver that is beyond what we know,
      // so use the most recent chromedriver that we found
      let cd = cds[0];
      log.warn(`No known Chromedriver available to automate Chrome version '${chromeVersion}'.\n` +
               `Using Chromedriver version '${cd.version}', which has not been tested with Appium.`);
      return cd.executable;
    }

    const workingCds = cds.filter((cd) => {
      return !_.isUndefined(cd.minCDVersion) && semver.gte(chromeVersion, cd.minCDVersion);
    });

    if (_.isEmpty(workingCds)) {
      log.errorAndThrow(`No Chromedriver found that can automate Chrome '${chromeVersion}'. ` +
                        `See https://github.com/appium/appium/blob/master/docs/en/writing-running-appium/web/chromedriver.md ` +
                        `for more details.`);
    }

    const binPath = workingCds[0].executable;
    log.debug(`Found ${workingCds.length} Chromedriver executable${workingCds.length === 1 ? '' : 's'}\n` +
              `capable of automating Chrome '${chromeVersion}'. ` +
              `Choosing the most recent, '${binPath}'.`);
    log.debug('If a specific version is required, specify it with the `chromedriverExecutable`' +
              'desired capability.');
    return binPath;
  }

  async initChromedriverPath () {
    if (this.executableVerified) return; //eslint-disable-line curly

    this.chromedriver = this.chromedriver || await this.getCompatibleChromedriver();
    if (!await fs.exists(this.chromedriver)) {
      throw new Error(`Trying to use a chromedriver binary at the path ` +
                      `${this.chromedriver}, but it doesn't exist!`);
    }
    this.executableVerified = true;
    log.info(`Set chromedriver binary as: ${this.chromedriver}`);
  }

  async start (caps, emitStartingState = true) {
    this.capabilities = caps;
    if (emitStartingState) {
      this.changeState(Chromedriver.STATE_STARTING);
    }

    let args = ["--url-base=wd/hub", `--port=${this.proxyPort}`];
    if (this.adb && this.adb.adbPort) {
      args = args.concat([`--adb-port=${this.adb.adbPort}`]);
    }
    if (this.cmdArgs) {
      args = args.concat(this.cmdArgs);
    }
    if (this.logPath) {
      args = args.concat([`--log-path=${this.logPath}`]);
    }
    args = args.concat(['--verbose']);
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
        match = /Starting ChromeDriver ([\.\d]+)/.exec(out);
        if (match) {
          log.debug(`Chromedriver version: '${match[1]}'`);
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

      // often the user's Chrome version is too low for the version of Chromedriver
      if (e.message.indexOf('Chrome version must be') !== -1) {
        log.error('Unable to automate Chrome version because it is too old for this version of Chromedriver.');
        if (webviewVersion) {
          log.error(`Chrome version on device: ${webviewVersion}`);
        }
        log.error(`Please see 'https://github.com/appium/appium/blob/master/docs/en/writing-running-appium/web/chromedriver.md'`);
      }
      log.errorAndThrow(e);
    }
  }

  sessionId () {
    if (this.state !== Chromedriver.STATE_ONLINE) {
      return null;
    }

    return this.jwproxy.sessionId;
  }

  async restart () {
    log.info("Restarting chromedriver");
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
    // retry session start 4 times, sometimes this fails due to adb
    await retryInterval(4, 200, async () => {
      try {
        let res = await this.jwproxy.command('/session', 'POST', {desiredCapabilities: this.capabilities});
        // ChromeDriver can return a positive status despite failing
        if (res.status) {
          throw new Error(res.value.message);
        }
      } catch (err) {
        log.errorAndThrow(`Failed to start Chromedriver session: ${err.message}`);
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
    let cmd;
    if (system.isWindows()) {
      // js hint cannot handle backticks, even escaped, within template literals
      cmd = "FOR /F \"usebackq tokens=5\" %a in (`netstat -nao ^| " +
            "findstr /R /C:\"" + this.proxyPort + " \"`) do (" +
            "FOR /F \"usebackq\" %b in (`TASKLIST /FI \"PID eq %a\" ^| " +
            "findstr /I chromedriver.exe`) do (IF NOT %b==\"\" TASKKILL " +
            "/F /PID %a))";
    } else {
      cmd = `pkill -15 -f "${this.chromedriver}.*--port=${this.proxyPort}"`;
    }
    log.debug(`Killing any old chromedrivers, running: ${cmd}`);
    try {
      await (B.promisify(cp.exec))(cmd);
      log.debug("Successfully cleaned up old chromedrivers");
    } catch (err) {
      log.warn("No old chromedrivers seemed to exist");
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

export default Chromedriver;
