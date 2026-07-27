import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {toW3cCapNames, getCapValue} from '../../lib/commands/session.js';

describe('Protocol Helpers', function () {
  const caps = {
    loggingPrefs: {
      detach: true,
    },
    'goog:perfLoggingPrefs': {
      enableNetwork: true,
    },
    'some:chromeOptions': {
      detach: true,
    },
  };

  it('should properly add w3c prefixes where needed', function () {
    const result = toW3cCapNames(caps);
    assert.deepStrictEqual(result, {
      'goog:loggingPrefs': {
        detach: true,
      },
      'goog:perfLoggingPrefs': {
        enableNetwork: true,
      },
      'some:chromeOptions': {
        detach: true,
      },
    });
  });

  it('should properly parse values from different caps', function () {
    const v1 = getCapValue(caps, 'loggingPrefs');
    assert.deepStrictEqual(v1, {
      detach: true,
    });

    const v2 = getCapValue(caps, 'goog:perfLoggingPrefs');
    assert.deepStrictEqual(v2, {
      enableNetwork: true,
    });

    const v3 = getCapValue(
      {
        proxy: 'some',
      },
      'proxy',
    );
    assert.strictEqual(v3, 'some');

    const v4 = getCapValue(
      {
        proxy: 'some',
      },
      'goog:proxy',
      {},
    );
    assert.deepStrictEqual(v4, {});
  });
});
