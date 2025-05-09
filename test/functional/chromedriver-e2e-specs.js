// transpile:mocha

import {Chromedriver} from '../../lib/chromedriver';
import {install} from '../helpers/install';
import B from 'bluebird';
import {exec} from 'teen_process';
import _ from 'lodash';

function nextState(cd) {
  return new B((resolve) => {
    cd.on(Chromedriver.EVENT_CHANGED, (msg) => {
      resolve(msg.state);
    });
  });
}

function nextError(cd) {
  return new B((resolve) => {
    cd.on(Chromedriver.EVENT_ERROR, (err) => {
      resolve(err);
    });
  });
}

async function assertNoRunningChromedrivers() {
  let {stdout} = await exec('ps', ['aux']);
  let count = 0;
  for (let line of stdout.split('\n')) {
    if (line.indexOf(/chromedriver/i) !== -1) {
      count++;
    }
  }

  count.should.eql(0);
}

function buildReqRes(url, method, body) {
  let req = {originalUrl: url, method, body};
  let res = {};
  res.headers = {};
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.status = (code) => {
    res.sentCode = code;
    return {
      send: (body) => {
        try {
          body = JSON.parse(body);
        } catch {}
        res.sentBody = body;
      },
    };
  };
  return [req, res];
}

describe('chromedriver binary setup', function () {
  this.timeout(20000);
  let chai;

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);

    await install();
  });

  it('should start with a binary that exists', async function () {
    let cd = new Chromedriver();
    await cd.initChromedriverPath();
  });
});

const caps = {browserName: 'chrome'};
const expectedCaps = {browserName: 'chrome', loggingPrefs: {browser: 'ALL'}};

describe('chromedriver with EventEmitter', function () {
  let chai;
  let cd = null;
  let should;

  this.timeout(120000);
  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    should = chai.should();
    chai.use(chaiAsPromised.default);

    cd = new Chromedriver({});
  });
  it('should start a session', async function () {
    cd.state.should.eql('stopped');
    let nextStatePromise = nextState(cd);
    cd.start(caps);
    _.size(cd.capabilities).should.be.at.least(_.size(expectedCaps));
    await nextStatePromise.should.become(Chromedriver.STATE_STARTING);
    await nextState(cd).should.become(Chromedriver.STATE_ONLINE);
    should.exist(cd.jwproxy.sessionId);
    should.exist(cd.sessionId());
  });
  it('should run some commands', async function () {
    let res = await cd.sendCommand('/url', 'POST', {url: 'http://google.com'});
    should.not.exist(res);
    res = await cd.sendCommand('/url', 'GET');
    res.should.contain('google');
  });
  it('should proxy commands', async function () {
    let [req, res] = buildReqRes('/url', 'GET');
    await cd.proxyReq(req, res);
    res.headers['content-type'].should.contain('application/json');
    res.sentCode.should.equal(200);
    res.sentBody.value.should.contain('google');
  });
  it('should say whether there is a working webview', async function () {
    let res = await cd.hasWorkingWebview();
    res.should.equal(true);
  });
  it('should restart a session', async function () {
    let p1 = nextState(cd);
    let restartPromise = cd.restart();
    await p1.should.become(Chromedriver.STATE_RESTARTING);
    // we miss the opportunity to listen for the 'starting' state
    await nextState(cd).should.become(Chromedriver.STATE_ONLINE);

    await restartPromise;
  });
  it('should stop a session', async function () {
    let nextStatePromise = nextState(cd);
    cd.stop();
    await nextStatePromise.should.become(Chromedriver.STATE_STOPPING);
    should.not.exist(cd.sessionId());
    await nextState(cd).should.become(Chromedriver.STATE_STOPPED);
    should.not.exist(cd.sessionId());
    await assertNoRunningChromedrivers();
  });
  it.skip('should change state to stopped if chromedriver crashes', async function () {
    // test works but is skipped because it leaves a chrome window orphaned
    // and I can't figure out a way to safely kill only that one
    cd.state.should.eql(Chromedriver.STATE_STOPPED);
    let nextStatePromise = nextState(cd);
    cd.start(caps);
    _.size(cd.capabilities).should.be.at.least(_.size(caps));
    await nextStatePromise.should.become(Chromedriver.STATE_STARTING);
    await nextState(cd).should.become(Chromedriver.STATE_ONLINE);
    should.exist(cd.jwproxy.sessionId);
    should.exist(cd.sessionId());
    nextStatePromise = nextState(cd);
    await cd.killAll();
    await nextStatePromise.should.become(Chromedriver.STATE_STOPPED);
  });
  it('should throw an error when chromedriver does not exist', async function () {
    let cd2 = new Chromedriver({
      executable: '/does/not/exist',
    });
    let nextErrP = nextError(cd2);
    await cd2.start({}).should.eventually.be.rejectedWith(/Trying to use/);
    let err = await nextErrP;
    err.message.should.contain('Trying to use');
  });
});

describe('chromedriver with async/await', function () {
  let cd = null;
  let chai;
  let should;

  this.timeout(120000);
  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    should = chai.should();
    chai.use(chaiAsPromised.default);

    cd = new Chromedriver({});
  });
  it('should start a session', async function () {
    cd.state.should.eql('stopped');
    should.not.exist(cd.sessionId());
    await cd.start(caps);
    _.size(cd.capabilities).should.be.at.least(_.size(expectedCaps));
    cd.state.should.eql(Chromedriver.STATE_ONLINE);
    should.exist(cd.jwproxy.sessionId);
    should.exist(cd.sessionId());
  });
  it('should restart a session', async function () {
    cd.state.should.eql(Chromedriver.STATE_ONLINE);
    await cd.restart();
    cd.state.should.eql(Chromedriver.STATE_ONLINE);
  });
  it('should stop a session', async function () {
    cd.state.should.eql(Chromedriver.STATE_ONLINE);
    await cd.stop();
    cd.state.should.eql(Chromedriver.STATE_STOPPED);
    should.not.exist(cd.sessionId());
    await assertNoRunningChromedrivers();
  });
  it('should throw an error during start if spawn does not work', async function () {
    let badCd = new Chromedriver({
      port: 1,
    });
    await badCd
      .start(caps)
      .should.eventually.be.rejectedWith('ChromeDriver crashed during startup');
    await assertNoRunningChromedrivers();
  });
  it('should throw an error during start if session does not work', async function () {
    let badCd = new Chromedriver({});
    await badCd
      .start({chromeOptions: {badCap: 'foo'}})
      .should.eventually.be.rejectedWith('cannot parse capability');
    await assertNoRunningChromedrivers();
  });
});
