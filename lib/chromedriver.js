import events from 'events';
import { JWProxy } from 'appium-jsonwp-proxy';
import npmlog from 'npmlog';
import npmChromedriver from 'chromedriver';
import cp from 'child_process';
import through from 'through';
import support from 'appium-support';
import { retryInterval } from 'asyncbox';
import Q from 'q';
let { spawn } = cp;
let log = global._global_npmlog || npmlog;

const STOPPED = 'stopped', STARTING = 'starting', ONLINE = 'online',
      STOPPING = 'stopping';

class Chromedriver extends events.EventEmitter {
  constructor (args) {
    this.proxyHost = args.host || '127.0.0.1';
    this.proxyPort = args.port || 9515;
    this.deviceId = args.deviceId;
    this.cmdArgs = args.cmdArgs;
    this.proc = null;
    this.chromedriver = args.executable || Chromedriver.getPath();
    this.state = STOPPED;
    this.jwproxy = new JWProxy({server: this.proxyHost, port: this.proxyPort});
    log.info("Set chromedriver binary as: " + this.chromedriver);
  }

 async start (caps) {
    this.capabilities = caps;
    this.changeState(STARTING);
    await this.killAll();
    let args = ["--url-base=wd/hub", `--port=${this.proxyPort}`];
    log.info(`Spawning chromedriver with: ${this.chromedriver} ${args.join(' ')}`);
    this.proc = spawn(this.chromedriver, args);
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');

    this.proc.on('error', err => {
      let newErr = new Error('Chromedriver process failed with error: ' + err.message);
      log.error(newErr.message);
      this.emit('error', newErr);
    });

    this.proc.stdout.pipe(through(data => {
      log.info('[CHROMEDRIVER STDOUT] ' + data.trim());
      if (data.indexOf('Starting ') === 0) {
        (async () => {
          try {
            await this.waitForOnline();
            await this.startSession();
          } catch (e) {
            log.error(e);
            this.emit('error', e);
          }
        })();
      }
    }));

    this.proc.stderr.pipe(through(data => {
      log.info('[CHROMEDRIVER STDERR] ' + data.trim());
    }));

    this.proc.on('exit', (code, signal) => {
      if (this.state !== STOPPED && this.state !== STOPPING) {
        log.error(`Chromedriver exited unexpectedly with code ${code}, ` +
                  `signal ${signal}`);
        this.changeState(STOPPED);
      }
    });
  }

  async restart () {
    log.info("Restarting chromedriver");
    if (this.state !== ONLINE) {
      this.emit('error', new Error("Can't restart when we're not online"));
    }
    let p = this._statePromise(STOPPED);
    this.stop();
    log.info("Waiting for chromedriver to completely stop");
    await p;
    this.start(this.capabilities);
  }

  _statePromise (state = null) {
    let d = Q.defer();
    let listener = function (msg) {
      if (state === null || msg.state === state) {
        d.resolve(msg.state);
        this.removeListener('stateChanged', listener);
      }
    }.bind(this);
    this.on('stateChanged', listener);
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
    this.changeState(ONLINE);
  }

  stop () {
    this.changeState(STOPPING);
    var d = Q.defer();
    this.proc.on('close', d.resolve);
    (async () => {
      try {
        await this.jwproxy.command('', 'DELETE');
        this.proc.kill();
        await d.promise;
        this.changeState(STOPPED);
      } catch (e) {
        log.error(e);
      }
    })();
  }

  changeState (state) {
    this.state = state;
    this.emit('stateChanged', {state: state});
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
      cmd = "FOR /F \"usebackq tokens=5\" %%a in (`netstat -nao ^| " +
            "findstr /R /C:\"" + this.proxyPort + " \"`) do (" +
            "FOR /F \"usebackq\" %%b in (`TASKLIST /FI \"PID eq %%a\" ^| " +
            "findstr /I chromedriver.exe`) do (IF NOT %%b==\"\" TASKKILL " +
            "/F /PID %%b))";
    } else {
      cmd = "ps -ef | grep " + this.chromedriver + " | grep -v grep |" +
            "grep -e '--port=" + this.proxyPort + "\\(\\s.*\\)\\?$' | awk " +
            "'{ print $2 }' | xargs kill -15";
    }
    log.info("Killing any old chromedrivers, running: " + cmd);
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

  static getPath () {
    return npmChromedriver.path;
  }

}

export default Chromedriver;
