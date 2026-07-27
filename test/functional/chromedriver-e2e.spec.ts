import assert from 'node:assert/strict';
import {describe, it, before} from 'node:test';

import {exec} from 'teen_process';

import {Chromedriver, type ChromedriverState} from '../../lib/chromedriver.js';
import {install} from '../helpers/install.js';

function nextState(cd: Chromedriver): Promise<ChromedriverState> {
  return new Promise((resolve) => {
    cd.once(Chromedriver.EVENT_CHANGED, (msg) => {
      resolve(msg.state);
    });
  });
}

function nextError(cd: Chromedriver): Promise<Error> {
  return new Promise((resolve) => {
    cd.once(Chromedriver.EVENT_ERROR, (err) => {
      resolve(err);
    });
  });
}

async function assertNoRunningChromedrivers(): Promise<void> {
  try {
    const {stdout} = await exec('pgrep', ['-x', 'chromedriver']);
    const pids = stdout.trim().split('\n').filter(Boolean);

    assert.strictEqual(pids.length, 0);
  } catch (err: any) {
    // pgrep exits with code 1 when no matching processes are found.
    if (err.code !== 1) {
      throw err;
    }
  }
}

function buildReqRes(url: string, method: string, body: any): [any, any] {
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

describe('chromedriver binary setup', {timeout: 20000}, function () {
  before(async function () {
    await install();
  });

  it('should start with a binary that exists', async function () {
    const cd = new Chromedriver();
    await (cd as any).initChromedriverPath();
  });
});

const caps = {browserName: 'chrome'};
const expectedCaps = {browserName: 'chrome', loggingPrefs: {browser: 'ALL'}};

describe('chromedriver with EventEmitter', {timeout: 120000}, function () {
  let cd: Chromedriver | null = null;

  before(function () {
    cd = new Chromedriver({});
  });
  it('should start a session', async function () {
    assert.strictEqual(cd!.state, 'stopped');
    const nextStatePromise = nextState(cd!);
    const startPromise = cd!.start(caps);
    assert.ok(Object.keys((cd as any).capabilities).length >= Object.keys(expectedCaps).length);
    assert.strictEqual(await nextStatePromise, Chromedriver.STATE_STARTING);
    assert.strictEqual(await nextState(cd!), Chromedriver.STATE_ONLINE);
    await startPromise;
    assert.ok(cd!.jwproxy.sessionId);
    assert.ok(cd!.sessionId());
  });
  it('should run some commands', async function () {
    let res = await cd!.sendCommand('/url', 'POST', {url: 'http://google.com'});
    assert.ok(!res);
    res = await cd!.sendCommand('/url', 'GET', undefined);
    assert.ok(res.includes('google'));
  });
  it('should proxy commands', async function () {
    const [req, res] = buildReqRes('/url', 'GET', null);
    await cd!.proxyReq(req, res);
    assert.ok(res.headers['content-type'].includes('application/json'));
    assert.strictEqual(res.sentCode, 200);
    assert.ok(res.sentBody.value.includes('google'));
  });
  it('should say whether there is a working webview', async function () {
    const res = await cd!.hasWorkingWebview();
    assert.strictEqual(res, true);
  });
  it('should restart a session', async function () {
    const p1 = nextState(cd!);
    const restartPromise = cd!.restart();
    assert.strictEqual(await p1, Chromedriver.STATE_RESTARTING);
    // we miss the opportunity to listen for the 'starting' state
    assert.strictEqual(await nextState(cd!), Chromedriver.STATE_ONLINE);

    await restartPromise;
  });
  it('should stop a session', async function () {
    const nextStatePromise = nextState(cd!);
    const stopPromise = cd!.stop();
    assert.strictEqual(await nextStatePromise, Chromedriver.STATE_STOPPING);
    assert.ok(!cd!.sessionId());
    assert.strictEqual(await nextState(cd!), Chromedriver.STATE_STOPPED);
    await stopPromise;
    assert.ok(!cd!.sessionId());
    await assertNoRunningChromedrivers();
  });
  it.skip('should change state to stopped if chromedriver crashes', async function () {
    // test works but is skipped because it leaves a chrome window orphaned
    // and I can't figure out a way to safely kill only that one
    assert.strictEqual(cd!.state, Chromedriver.STATE_STOPPED);
    let nextStatePromise = nextState(cd!);
    const startPromise = cd!.start(caps);
    assert.ok(Object.keys((cd as any).capabilities).length >= Object.keys(caps).length);
    assert.strictEqual(await nextStatePromise, Chromedriver.STATE_STARTING);
    assert.strictEqual(await nextState(cd!), Chromedriver.STATE_ONLINE);
    await startPromise;
    assert.ok(cd!.jwproxy.sessionId);
    assert.ok(cd!.sessionId());
    nextStatePromise = nextState(cd!);
    await (cd as any).killAll();
    assert.strictEqual(await nextStatePromise, Chromedriver.STATE_STOPPED);
  });
  it('should throw an error when chromedriver does not exist', async function () {
    const cd2 = new Chromedriver({
      executable: '/does/not/exist',
    });
    const nextErrP = nextError(cd2);
    await assert.rejects(cd2.start({}), /Trying to use/);
    const err = await nextErrP;
    assert.ok((err as Error).message.includes('Trying to use'));
  });
});

describe('chromedriver with async/await', {timeout: 120000}, function () {
  let cd: Chromedriver | null = null;

  before(function () {
    cd = new Chromedriver({});
  });
  it('should start a session', async function () {
    assert.strictEqual(cd!.state, 'stopped');
    assert.ok(!cd!.sessionId());
    await cd!.start(caps);
    assert.ok(Object.keys((cd as any).capabilities).length >= Object.keys(expectedCaps).length);
    assert.strictEqual(cd!.state, Chromedriver.STATE_ONLINE);
    assert.ok(cd!.jwproxy.sessionId);
    assert.ok(cd!.sessionId());
  });
  it('should restart a session', async function () {
    assert.strictEqual(cd!.state, Chromedriver.STATE_ONLINE);
    await cd!.restart();
    assert.strictEqual(cd!.state, Chromedriver.STATE_ONLINE);
  });
  it('should stop a session', async function () {
    assert.strictEqual(cd!.state, Chromedriver.STATE_ONLINE);
    await cd!.stop();
    assert.strictEqual(cd!.state, Chromedriver.STATE_STOPPED);
    assert.ok(!cd!.sessionId());
    await assertNoRunningChromedrivers();
  });
  it('should throw an error during start if spawn does not work', async function () {
    const badCd = new Chromedriver({
      port: '1',
    });
    await assert.rejects(badCd.start(caps), /ChromeDriver crashed during startup/);
    await assertNoRunningChromedrivers();
  });
  it('should throw an error during start if session does not work', async function () {
    const badCd = new Chromedriver({});
    await assert.rejects(badCd.start({chromeOptions: {badCap: 'foo'}}), /cannot parse capability/);
    await assertNoRunningChromedrivers();
  });
});
