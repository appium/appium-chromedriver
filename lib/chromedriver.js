import events from 'events';
import { JWProxy } from 'appium-jsonwp-proxy';
import npmlog from 'npmlog';
import npmChromedriver from 'chromedriver';
import cp from 'child_process';
import through from 'through';
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

 start (caps) {
    this.capabilities = caps;
    this.changeState(STARTING);
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

  async proxyReq (req, res) {
    await this.jwproxy.proxyReqRes(req, res);
  }

  static getPath () {
    return npmChromedriver.path;
  }
}

export default Chromedriver;
