// transpile:mocha

import {expect, use} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {Chromedriver} from '../../lib/chromedriver';
import {install} from '../helpers/install';
import B from 'bluebird';
import {exec} from 'teen_process';
import _ from 'lodash';

use(chaiAsPromised);

function nextState(cd: Chromedriver) {
  return new B((resolve) => {
    cd.on(Chromedriver.EVENT_CHANGED, (msg) => {
      resolve(msg.state);
    });
  });
}

function nextError(cd: Chromedriver) {
  return new B((resolve) => {
    cd.on(Chromedriver.EVENT_ERROR, (err) => {
      resolve(err);
    });
  });
}

async function assertNoRunningChromedrivers() {
  const {stdout} = await exec('ps', ['aux']);
  let count = 0;
  for (const line of stdout.split('\n')) {
    if (line.match(/chromedriver/i)) {
      count++;
    }
  }

  expect(count).to.eql(0);
}

function buildReqRes(url: string, method: string, body: any) {
  const req = {originalUrl: url, method, body};
  const res: any = {};
  res.headers = {};
  res.setHeader = (k: string, v: string) => {
    res.headers[k] = v;
  };
  res.status = (code: number) => {
    res.sentCode = code;
    return {
      json: (body: any) => {
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

  before(async function () {
    await install();
  });

  it('should start with a binary that exists', async function () {
    const cd = new Chromedriver();
    await cd.initChromedriverPath();
  });
});

const caps = {browserName: 'chrome'};
const expectedCaps = {browserName: 'chrome', loggingPrefs: {browser: 'ALL'}};

describe('chromedriver with EventEmitter', function () {
  let cd: Chromedriver | null = null;

  this.timeout(120000);
  before(function () {
    cd = new Chromedriver({});
  });
  it('should start a session', async function () {
    expect(cd!.state).to.eql('stopped');
    const nextStatePromise = nextState(cd!);
    cd!.start(caps);
    expect(_.size(cd!.capabilities)).to.be.at.least(_.size(expectedCaps));
    await expect(nextStatePromise).to.become(Chromedriver.STATE_STARTING);
    await expect(nextState(cd!)).to.become(Chromedriver.STATE_ONLINE);
    expect(cd!.jwproxy.sessionId).to.exist;
    expect(cd!.sessionId()).to.exist;
  });
  it('should run some commands', async function () {
    let res = await cd!.sendCommand('/url', 'POST', {url: 'http://google.com'});
    expect(res).to.not.exist;
    res = await cd!.sendCommand('/url', 'GET', undefined);
    expect(res).to.contain('google');
  });
  it('should proxy commands', async function () {
    const [req, res] = buildReqRes('/url', 'GET', null);
    await cd!.proxyReq(req, res);
    expect(res.headers['content-type']).to.contain('application/json');
    expect(res.sentCode).to.equal(200);
    expect(res.sentBody.value).to.contain('google');
  });
  it('should say whether there is a working webview', async function () {
    const res = await cd!.hasWorkingWebview();
    expect(res).to.equal(true);
  });
  it('should restart a session', async function () {
    const p1 = nextState(cd!);
    const restartPromise = cd!.restart();
    await expect(p1).to.become(Chromedriver.STATE_RESTARTING);
    // we miss the opportunity to listen for the 'starting' state
    await expect(nextState(cd!)).to.become(Chromedriver.STATE_ONLINE);

    await restartPromise;
  });
  it('should stop a session', async function () {
    const nextStatePromise = nextState(cd!);
    cd!.stop();
    await expect(nextStatePromise).to.become(Chromedriver.STATE_STOPPING);
    expect(cd!.sessionId()).to.not.exist;
    await expect(nextState(cd!)).to.become(Chromedriver.STATE_STOPPED);
    expect(cd!.sessionId()).to.not.exist;
    await assertNoRunningChromedrivers();
  });
  it.skip('should change state to stopped if chromedriver crashes', async function () {
    // test works but is skipped because it leaves a chrome window orphaned
    // and I can't figure out a way to safely kill only that one
    expect(cd!.state).to.eql(Chromedriver.STATE_STOPPED);
    let nextStatePromise = nextState(cd!);
    cd!.start(caps);
    expect(_.size(cd!.capabilities)).to.be.at.least(_.size(caps));
    await expect(nextStatePromise).to.become(Chromedriver.STATE_STARTING);
    await expect(nextState(cd!)).to.become(Chromedriver.STATE_ONLINE);
    expect(cd!.jwproxy.sessionId).to.exist;
    expect(cd!.sessionId()).to.exist;
    nextStatePromise = nextState(cd!);
    await cd!.killAll();
    await expect(nextStatePromise).to.become(Chromedriver.STATE_STOPPED);
  });
  it('should throw an error when chromedriver does not exist', async function () {
    const cd2 = new Chromedriver({
      executable: '/does/not/exist',
    });
    const nextErrP = nextError(cd2);
    await expect(cd2.start({})).to.eventually.be.rejectedWith(/Trying to use/);
    const err = await nextErrP;
    expect((err as Error).message).to.contain('Trying to use');
  });
});

describe('chromedriver with async/await', function () {
  let cd: Chromedriver | null = null;

  this.timeout(120000);
  before(function () {
    cd = new Chromedriver({});
  });
  it('should start a session', async function () {
    expect(cd!.state).to.eql('stopped');
    expect(cd!.sessionId()).to.not.exist;
    await cd!.start(caps);
    expect(_.size(cd!.capabilities)).to.be.at.least(_.size(expectedCaps));
    expect(cd!.state).to.eql(Chromedriver.STATE_ONLINE);
    expect(cd!.jwproxy.sessionId).to.exist;
    expect(cd!.sessionId()).to.exist;
  });
  it('should restart a session', async function () {
    expect(cd!.state).to.eql(Chromedriver.STATE_ONLINE);
    await cd!.restart();
    expect(cd!.state).to.eql(Chromedriver.STATE_ONLINE);
  });
  it('should stop a session', async function () {
    expect(cd!.state).to.eql(Chromedriver.STATE_ONLINE);
    await cd!.stop();
    expect(cd!.state).to.eql(Chromedriver.STATE_STOPPED);
    expect(cd!.sessionId()).to.not.exist;
    await assertNoRunningChromedrivers();
  });
  it('should throw an error during start if spawn does not work', async function () {
    const badCd = new Chromedriver({
      port: '1',
    });
    await expect(badCd.start(caps)).to.eventually.be.rejectedWith(
      'ChromeDriver crashed during startup'
    );
    await assertNoRunningChromedrivers();
  });
  it('should throw an error during start if session does not work', async function () {
    const badCd = new Chromedriver({});
    await expect(badCd.start({chromeOptions: {badCap: 'foo'}})).to.eventually.be.rejectedWith(
      'cannot parse capability'
    );
    await assertNoRunningChromedrivers();
  });
});

