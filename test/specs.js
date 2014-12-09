// transpile:mocha
/* global it:true, describe:true, before:true */

import { default as Chromedriver } from '../lib/chromedriver';
import chai from 'chai';
import Q from 'q';
//let cbIt = it;
//import 'mochawait';

chai.should();

async function nextState (cd) {
  let d = Q.defer();
  cd.on('stateChanged', d.resolve);
  return d.promise;
}

async function assertNextState (cd, state) {
  let msg = await nextState(cd);
  msg.state.should.equal(state);
}

async function assertNoRunningChromedrivers () {
}

describe('chromedriver', () => {
  let cd = null;
  const caps = {browserName: 'chrome'};
  before(async () => {
    let opts = {};
    cd = new Chromedriver(opts);
    await assertNoRunningChromedrivers();
  });
  it('should start a session', async () => {
    cd.state.should.eql('stopped');
    cd.start(caps);
    cd.capabilities.should.eql(caps);
    await assertNextState(cd, 'starting');
    await assertNextState(cd, 'online');
  });
  it('should stop a session', async () => {
    cd.stop();
    await assertNextState(cd, 'stopping');
    await assertNextState(cd, 'stopped');
    await assertNoRunningChromedrivers();
  });
});
