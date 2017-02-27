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
    const {host, port, executable, cmdArgs, adbPort, verbose, logPath} = args;
    super();
    this.proxyHost = host || DEFAULT_HOST;
    this.proxyPort = port || DEFAULT_PORT;
    this.adbPort = adbPort;
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
    if (this.executableVerified) return;
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
    if (this.adbPort) {
      args = args.concat([`--adb-port=${this.adbPort}`]);
    }
    if (this.cmdArgs) {
      args = args.concat(this.cmdArgs);
    }
    if (this.verbose) {
      args = args.concat(['--verbose']);
    }
    if (this.logPath) {
      args = args.concat([`--log-path=${this.logPath}`]);
    }

    // what are the process stdout/stderr conditions wherein we know that
    // the process has started to our satisfaction?
    const startDetector = (stdout) => {
      return stdout.indexOf('Starting ') === 0;
    };

    let processIsAlive = false;
    try {
      await this.initChromedriverPath();
      await this.killAll();

      // set up our subprocess object
      this.proc = new SubProcess(this.chromedriver, args);
      processIsAlive = true;

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
      let res = await this.jwproxy.command('/session', 'POST', {desiredCapabilities: this.capabilities});
      // ChromeDriver can return a positive status despite failing
      if (res.status) {
        throw new Error(res.value.message);
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
    log.info(`Killing any old chromedrivers, running: ${cmd}`);
    try {
      await (B.promisify(cp.exec))(cmd);
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
