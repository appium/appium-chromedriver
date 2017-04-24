// transpile:mocha

import Chromedriver from '../lib/chromedriver';
import { install } from '../lib/install';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import B from 'bluebird';
import { exec } from 'teen_process';

let should = chai.should();
chai.use(chaiAsPromised);

function nextState (cd) {
  return new B((resolve) => {
    cd.on(Chromedriver.EVENT_CHANGED, (msg) => {
      resolve(msg.state);
    });
  });
}

function nextError (cd) {
  return new B((resolve) => {
    cd.on(Chromedriver.EVENT_ERROR, (err) => {
      resolve(err);
    });
  });
}

async function assertNoRunningChromedrivers () {
  let {stdout} = await exec('ps', ['aux']);
  let count = 0;
  for (let line of stdout.split('\n')) {
    if (line.indexOf(/chromedriver/i) !== -1) {
      count++;
    }
  }

  count.should.eql(0);
}

function buildReqRes (url, method, body) {
  let req = {originalUrl: url, method, body};
  let res = {};
  res.headers = {};
  res.set = (k, v) => { res[k] = v; };
  res.status = (code) => {
    res.sentCode = code;
    return {
      send: (body) => {
        try {
          body = JSON.parse(body);
        } catch (e) {}
        res.sentBody = body;
      }
    };
  };
  return [req, res];
}

describe('chromedriver binary setup', function () {
  this.timeout(20000);
  before(async () => {
    let cd = new Chromedriver();
    try {
      await cd.initChromedriverPath();
    } catch (err) {
      if (err.message.indexOf("Trying to use") !== -1) {
        await install();
      }
    }
  });

  it('should start with a binary that exists', async () => {
    let cd = new Chromedriver();
    await cd.initChromedriverPath();
  });
});

describe('chromedriver with EventEmitter', function () {
  this.timeout(120000);
  let cd = null;
  const caps = {browserName: 'chrome'};
  before(async () => {
    let opts = {};
    cd = new Chromedriver(opts);
  });
  it('should start a session', async () => {
    cd.state.should.eql('stopped');
    let nextStatePromise = nextState(cd);
    cd.start(caps);
    cd.capabilities.should.eql(caps);
    await nextStatePromise.should.become(Chromedriver.STATE_STARTING);
    await nextState(cd).should.become(Chromedriver.STATE_ONLINE);
    should.exist(cd.jwproxy.sessionId);
    should.exist(cd.sessionId());
  });
  it('should run some commands', async () => {
    let res = await cd.sendCommand('/url', 'POST', {url: 'http://google.com'});
    should.not.exist(res);
    res = await cd.sendCommand('/url', 'GET');
    res.should.contain('google');
  });
  it('should proxy commands', async () => {
    let initSessId = cd.sessionId();
    let [req, res] = buildReqRes('/url', 'GET');
    await cd.proxyReq(req, res);
    res.headers['content-type'].should.contain('application/json');
    res.sentCode.should.equal(200);
    res.sentBody.status.should.equal(0);
    res.sentBody.value.should.contain('google');
    res.sentBody.sessionId.should.equal(initSessId);
  });
  it('should say whether there is a working webview', async () => {
    let res = await cd.hasWorkingWebview();
    res.should.equal(true);
  });
  it('should restart a session', async () => {
    let p1 = nextState(cd);
    cd.restart();
    await p1.should.become(Chromedriver.STATE_RESTARTING);
    // we miss the opportunity to listen for the 'starting' state
    await nextState(cd).should.become(Chromedriver.STATE_ONLINE);
  });
  it('should stop a session', async () => {
    let nextStatePromise = nextState(cd);
    cd.stop();
    await nextStatePromise.should.become(Chromedriver.STATE_STOPPING);
    should.not.exist(cd.sessionId());
    await nextState(cd).should.become(Chromedriver.STATE_STOPPED);
    should.not.exist(cd.sessionId());
    await assertNoRunningChromedrivers();
  });
  it.skip('should change state to stopped if chromedriver crashes', async () => {
    // test works but is skipped because it leaves a chrome window orphaned
    // and I can't figure out a way to safely kill only that one
    cd.state.should.eql(Chromedriver.STATE_STOPPED);
    let nextStatePromise = nextState(cd);
    cd.start(caps);
    cd.capabilities.should.eql(caps);
    await nextStatePromise.should.become(Chromedriver.STATE_STARTING);
    await nextState(cd).should.become(Chromedriver.STATE_ONLINE);
    should.exist(cd.jwproxy.sessionId);
    should.exist(cd.sessionId());
    nextStatePromise = nextState(cd);
    await cd.killAll();
    await nextStatePromise.should.become(Chromedriver.STATE_STOPPED);
  });
  it('should throw an error when chromedriver doesnt exist', async () => {
    let cd2 = new Chromedriver({executable: '/does/not/exist'});
    let nextErrP = nextError(cd2);
    await cd2.start({}).should.eventually.be.rejectedWith(/Trying to use/);
    let err = await nextErrP;
    err.message.should.contain('Trying to use');
  });
});


describe('chromedriver with async/await', function () {
  this.timeout(120000);
  let cd = null;
  const caps = {browserName: 'chrome'};
  before(async () => {
    let opts = {};
    cd = new Chromedriver(opts);
  });
  it('should start a session', async () => {
    cd.state.should.eql('stopped');
    should.not.exist(cd.sessionId());
    await cd.start(caps);
    cd.capabilities.should.eql(caps);
    cd.state.should.eql(Chromedriver.STATE_ONLINE);
    should.exist(cd.jwproxy.sessionId);
    should.exist(cd.sessionId());
  });
  it('should restart a session', async () => {
    cd.state.should.eql(Chromedriver.STATE_ONLINE);
    await cd.restart();
    cd.state.should.eql(Chromedriver.STATE_ONLINE);
  });
  it('should stop a session', async () => {
    cd.state.should.eql(Chromedriver.STATE_ONLINE);
    await cd.stop();
    cd.state.should.eql(Chromedriver.STATE_STOPPED);
    should.not.exist(cd.sessionId());
    await assertNoRunningChromedrivers();
  });
  it('should throw an error during start if spawn does not work', async () => {
    let badCd = new Chromedriver({port: 1});
    await badCd.start(caps).should.eventually.be.rejectedWith('ChromeDriver crashed during startup');
    await assertNoRunningChromedrivers();
  });
  it('should throw an error during start if session does not work', async () => {
    let badCd = new Chromedriver();
    await badCd.start({chromeOptions: {badCap: 'foo'}})
               .should.eventually.be.rejectedWith('cannot parse capability');
    await assertNoRunningChromedrivers();
  });
});
