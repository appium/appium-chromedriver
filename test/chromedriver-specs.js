// transpile:mocha

import Chromedriver from '../..';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import Q from 'q';
import psNode from 'ps-node';
import 'mochawait';

let should = chai.should();
chai.use(chaiAsPromised);

function nextState (cd) {
  let d = Q.defer();
  cd.on(Chromedriver.EVENT_CHANGED, msg => {
    d.resolve(msg.state);
  });
  return d.promise;
}

function nextError (cd) {
  let d = Q.defer();
  cd.on(Chromedriver.EVENT_ERROR, err => {
    d.resolve(err);
  });
  return d.promise;
}

async function assertNoRunningChromedrivers () {
  let res = await Q.nfcall(psNode.lookup, {command: 'chromedriver'});
  res.should.have.length(0);
}

describe('chromedriver', () => {
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
  });
  it('should run some commands', async () => {
    let res = await cd.sendCommand('/url', 'POST', {url: 'http://google.com'});
    should.not.exist(res);
    res = await cd.sendCommand('/url', 'GET');
    res.should.contain('google');
  });
  it('should say whether there is a working webview', async () => {
    let res = await cd.hasWorkingWebview();
    res.should.equal(true);
  });
  it('should restart a session', async () => {
    let p1 = nextState(cd);
    cd.restart();
    await p1.should.become(Chromedriver.STATE_STOPPING);
    await nextState(cd).should.become(Chromedriver.STATE_STOPPED);
    // we miss the opportunity to listen for the 'starting' state
    await nextState(cd).should.become(Chromedriver.STATE_ONLINE);
  });
  it('should stop a session', async () => {
    let nextStatePromise = nextState(cd);
    cd.stop();
    await nextStatePromise.should.become(Chromedriver.STATE_STOPPING);
    await nextState(cd).should.become(Chromedriver.STATE_STOPPED);
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
    nextStatePromise = nextState(cd);
    await cd.killAll();
    await nextStatePromise.should.become(Chromedriver.STATE_STOPPED);
  });
  it('should throw an error when chromedriver doesnt exist', async () => {
    let cd2 = new Chromedriver({executable: '/does/not/exist'});
    let nextErrP = nextError(cd2);
    cd2.start({});
    let err = await nextErrP;
    err.message.should.contain('ENOENT');
  });
});
