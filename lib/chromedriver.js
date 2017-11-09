// transpile:main

import events from 'events';
import { JWProxy } from 'appium-base-driver';
import cp from 'child_process';
import { system, fs, logger } from 'appium-support';
import { retryInterval } from 'asyncbox';
import { SubProcess } from 'teen_process';
import B from 'bluebird';
import { getChromedriverBinaryPath } from './install';


const log = logger.getLogger('Chromedriver');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9515;

class Chromedriver extends events.EventEmitter {
  constructor (args = {}) {
    const {host, port, executable, cmdArgs, adb, verbose, logPath} = args;
    super();
    this.proxyHost = host || DEFAULT_HOST;
    this.proxyPort = port || DEFAULT_PORT;
    this.adb = adb;
    this.cmdArgs = cmdArgs;
    this.proc = null;
    this.chromedriver = executable;
    this.executableVerified = false;
    this.state = Chromedriver.STATE_STOPPED;
    this.jwproxy = new JWProxy({server: this.proxyHost, port: this.proxyPort});
    this.verbose = verbose;
    this.logPath = logPath;
  }

  async initChromedriverPath () {
    if (this.executableVerified) return; //eslint-disable-line curly
    let binPath = this.chromedriver || (await getChromedriverBinaryPath());
    if (!await fs.exists(binPath)) {
      throw new Error(`Trying to use a chromedriver binary at the path ` +
                      `${binPath}, but it doesn't exist!`);
    }
    this.chromedriver = binPath;
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

  _statePromise (state = null) {
    return new B((resolve) => {
      const listener = (msg) => {
        if (state === null || msg.state === state) {
          resolve(msg.state);
          this.removeListener(Chromedriver.EVENT_CHANGED, listener);
        }
      };
      this.on(Chromedriver.EVENT_CHANGED, listener);
    });
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
