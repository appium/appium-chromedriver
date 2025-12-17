import {expect} from 'chai';
import {toW3cCapNames, getCapValue} from '../../lib/protocol-helpers';

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
    expect(result).to.eql({
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
    expect(v1).to.eql({
      detach: true,
    });

    const v2 = getCapValue(caps, 'goog:perfLoggingPrefs');
    expect(v2).to.eql({
      enableNetwork: true,
    });

    const v3 = getCapValue(
      {
        proxy: 'some',
      },
      'proxy'
    );
    expect(v3).to.eql('some');

    const v4 = getCapValue(
      {
        proxy: 'some',
      },
      'goog:proxy',
      {}
    );
    expect(v4).to.eql({});
  });
});

