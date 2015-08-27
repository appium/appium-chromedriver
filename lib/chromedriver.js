// transpile:main

import events from 'events';
import { JWProxy } from 'appium-jsonwp-proxy';
import { getLogger } from 'appium-logger';
import cp from 'child_process';
import support from 'appium-support';
import { retryInterval } from 'asyncbox';
import { SubProcess } from 'teen_process';
import Q from 'q';
import { getChromedriverBinaryPath } from './install';
import { exists } from './utils';
const log = getLogger('Chromedriver');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9515;
class Chromedriver extends events.EventEmitter {
  constructor (args = {}) {
    const {host, port, executable, cmdArgs} = args;
    super();
    this.proxyHost = host || DEFAULT_HOST;
    this.proxyPort = port || DEFAULT_PORT;
    this.cmdArgs = cmdArgs;
    this.proc = null;
    this.chromedriver = executable;
    this.executableVerified = false;
    this.state = Chromedriver.STATE_STOPPED;
    this.jwproxy = new JWProxy({server: this.proxyHost, port: this.proxyPort});
  }

  async initChromedriverPath () {
    if (this.executableVerified) return;
    let binPath = this.chromedriver || (await getChromedriverBinaryPath());
    if (!(await exists(binPath))) {
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
    let processIsAlive = true;
    const args = ["--url-base=wd/hub", `--port=${this.proxyPort}`];

    // what are the process stdout/stderr conditions wherein we know that
    // the process has started to our satisfaction?
    const startDetector = (stdout) => {
      return stdout.indexOf('Starting ') === 0;
    };

    try {
      await this.initChromedriverPath();
      await this.killAll();
      // set up our subprocess object
      this.proc = new SubProcess(this.chromedriver, args);

      // handle log output
      this.proc.on('output', (stdout, stderr) => {
        if (stdout) {
          log.info(`[STDOUT] ${stdout.trim()}`);
        }
        if (stderr) {
          log.info(`[STDERR] ${stderr.trim()}`);
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
    let d = Q.defer();
    const listener = function (msg) {
      if (state === null || msg.state === state) {
        d.resolve(msg.state);
        this.removeListener(Chromedriver.EVENT_CHANGED, listener);
      }
    }.bind(this);
    this.on(Chromedriver.EVENT_CHANGED, listener);
    return d.promise;
  }

  async waitForOnline () {
    await retryInterval(20, 200, this.getStatus.bind(this));
  }

  async getStatus () {
    return await this.jwproxy.command('/status', 'GET');
  }

  async startSession () {
    // retry session start 4 times, sometimes this fails due to adb
    await retryInterval(4, 200, this.jwproxy.command.bind(this.jwproxy),
        '/session', 'POST', {desiredCapabilities: this.capabilities});
    this.changeState(Chromedriver.STATE_ONLINE);
  }

  async stop (emitStates = true) {
    if (emitStates) {
      this.changeState(Chromedriver.STATE_STOPPING);
    }
    try {
      await this.jwproxy.command('', 'DELETE');
      await this.proc.stop();
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

  sendCommand (url, method, body) {
    return this.jwproxy.command(url, method, body);
  }

  proxyReq (req, res) {
    return this.jwproxy.proxyReqRes(req, res);
  }

  async killAll () {
    let cmd;
    if (support.system.isWindows()) {
      cmd = "FOR /F \"usebackq tokens=5\" %a in (`netstat -nao ^| " +
            "findstr /R /C:\"" + this.proxyPort + " \"`) do (" +
            "FOR /F \"usebackq\" %b in (`TASKLIST /FI \"PID eq %a\" ^| " +
            "findstr /I chromedriver.exe`) do (IF NOT %b==\"\" TASKKILL " +
            "/F /PID %a))";
    } else {
      cmd = "ps -ef | grep " + this.chromedriver + " | grep -v grep |" +
            "grep -e '--port=" + this.proxyPort + "\\(\\s.*\\)\\?$' | awk " +
            "'{ print $2 }' | xargs kill -15";
    }
    log.info(`Killing any old chromedrivers, running: ${cmd}`);
    try {
      await Q.nfcall(cp.exec, cmd);
      log.info("Successfully cleaned up old chromedrivers");
    } catch (err) {
      log.info("No old chromedrivers seemed to exist");
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
