import { toW3cCapNames, getCapValue } from '../lib/protocol-helpers';
import chai from 'chai';

chai.should();

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
    result.should.eql({
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
    v1.should.eql({
      detach: true,
    });

    const v2 = getCapValue(caps, 'goog:perfLoggingPrefs');
    v2.should.eql({
      enableNetwork: true,
    });

    const v3 = getCapValue({
      proxy: 'some',
    }, 'proxy');
    v3.should.eql('some');

    const v4 = getCapValue({
      proxy: 'some',
    }, 'goog:proxy', {});
    v4.should.eql({});
  });
});
