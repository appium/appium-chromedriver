// transpile:mocha
/* global it:true, describe:true, before:true */

import Chromedriver from '../lib/chromedriver';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import Q from 'q';
import psNode from 'ps-node';
import cp from 'child_process';
import should from 'should';
const { exec } = cp;
import 'mochawait';

chai.should();
chai.use(chaiAsPromised);

function nextState (cd) {
  let d = Q.defer();
  cd.on('stateChanged', msg => {
    d.resolve(msg.state);
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
    try {
      await Q.nfcall(exec, `pkill -f ${Chromedriver.getPath()}`);
    } catch (e) {}
  });
  it('should start a session', async () => {
    cd.state.should.eql('stopped');
    let nextStatePromise = nextState(cd);
    cd.start(caps);
    cd.capabilities.should.eql(caps);
    await nextStatePromise.should.become('starting');
    await nextState(cd).should.become('online');
    should.ok(cd.sessionId);
  });
  it('should stop a session', async () => {
    let nextStatePromise = nextState(cd);
    cd.stop();
    await nextStatePromise.should.become('stopping');
    await nextState(cd).should.become('stopped');
    await assertNoRunningChromedrivers();
  });
});
