import events from 'events';
import npmlog from 'npmlog';
import npmChromedriver from 'chromedriver';
import cp from 'child_process';
import through from 'through';
import _ from 'lodash';
import request from 'request';
import { retryInterval, sleep } from 'asyncbox';
import Q from 'q';
let { spawn } = cp;
let log = process.env.GLOBAL_NPMLOG ? global.log : npmlog;

const STOPPED = 'stopped', STARTING = 'starting', ONLINE = 'online',
      STOPPING = 'stopping';

export default class Chromedriver extends events.EventEmitter {
  constructor (args) {
    this.proxyHost = args.host || '127.0.0.1';
    this.proxyPort = args.port || 9515;
    this.deviceId = args.deviceId;
    this.cmdArgs = args.cmdArgs;
    this.proc = null;
    this.chromedriver = args.executable || Chromedriver.getPath();
    this.state = STOPPED;
    this.sessionId = null;
    log.info("Set chromedriver binary as: " + this.chromedriver);
  }

 start (caps) {
    this.capabilities = caps;
    this.changeState(STARTING);
    let args = ["--url-base=wd/hub", `--port=${this.proxyPort}`];
    this.proc = spawn(this.chromedriver, args);
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');

    this.proc.on('error', err => {
      log.error('Chromedriver process failed with error: ' + err.message);
    });

    this.proc.stdout.pipe(through(data => {
      log.info('[CHROMEDRIVER] ' + data.trim());
      if (data.indexOf('Starting ') === 0) {
        (async () => {
          try {
            await this.waitForOnline();
            await this.startSession();
          } catch (e) {
            log.error(e);
          }
        })();
      }
    }));

    this.proc.stderr.pipe(through(data => {
      log.info('[CHROMEDRIVER STDERR] ' + data.trim());
    }));

    //this.proc.on('exit', this.onClose.bind(this));
  }

  async doRequest (url, method, body) {
    const contentType = "application/json;charset=UTF-8";
    if (!(/^https?:\/\//.exec(url))) {
      url = `http://${this.proxyHost}:${this.proxyPort}/wd/hub${url}`;
    }
    var opts = {
      url: url
    , method: method
    };
    if (_.contains(['put', 'post', 'patch'], method.toLowerCase())) {
      if (typeof body === "object") {
        opts.json = body;
      } else {
        opts.body = body || "";
      }
    }
    // explicitly set these headers with correct capitalization to work around
    // an issue in node/requests
    log.info("Making http request with opts: " + JSON.stringify(opts));
    let [res, resBody] = await Q.nfcall(request, opts);
    // TODO: throw if we get a 500
    return resBody;
  }

  async waitForOnline () {
    await retryInterval(20, 200, this.getStatus.bind(this));
  }

  async getStatus () {
    return await this.doRequest('/status', 'GET');
  }

  async startSession () {
    let res = await this.doRequest('/session', 'POST',
        {desiredCapabilities: this.capabilities});
    this.sessionId = res.sessionId;
    this.changeState(ONLINE);
  }

  stop () {
    this.changeState(STOPPING);
    var d = Q.defer();
    this.proc.on('close', d.resolve);
    (async () => {
      try {
        await this.doRequest(`/session/${this.sessionId}`, 'DELETE');
        this.proc.kill();
        await d.promise;
        this.changeState(STOPPED);
      } catch (e) {
        logger.error(e);
      }
    })();
  }

  changeState (state) {
    this.state = state;
    this.emit('stateChanged', {state: state});
  }

  static getPath () {
    return npmChromedriver.path;
  };
}
