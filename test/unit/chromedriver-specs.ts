import {expect, use} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {Chromedriver} from '../../lib/chromedriver';
import {CHROME_BUNDLE_ID, DEFAULT_CHROME_PERMISSIONS} from '../../lib/constants';
import sinon from 'sinon';
import {fs} from '@appium/support';
import path from 'node:path';
import * as utils from '../../lib/utils';

use(chaiAsPromised);

describe('chromedriver', function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });
  afterEach(function () {
    sandbox.restore();
  });

  describe('getCompatibleChromedriver', function () {
    describe('desktop', function () {
      it('should find generic binary', async function () {
        sandbox.stub(utils, 'getChromedriverBinaryPath').resolves('/path/to/chromedriver');

        const cd = new Chromedriver({});
        const binPath = await (cd as any).getCompatibleChromedriver();
        expect(binPath).to.eql('/path/to/chromedriver');
      });

      it('should search specified directory if provided', async function () {
        const cd = new Chromedriver({
          executableDir: '/some/local/dir/for/chromedrivers',
        });

        sandbox.stub(utils, 'getChromeVersion').resolves('63.0.3239.99');
        sandbox.stub(fs, 'glob').resolves(['/some/local/dir/for/chromedrivers/chromedriver']);
        sandbox.stub(cd, '_execFunc').resolves({
          stdout: 'ChromeDriver 2.36.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
        } as any);

        const binPath = await (cd as any).getCompatibleChromedriver();
        expect(binPath).to.eql('/some/local/dir/for/chromedrivers/chromedriver');
      });
    });

    describe('Android', function () {
      let cd: Chromedriver;
      let getChromedriverBinaryPathSpy: sinon.SinonSpy;
      before(function () {
        cd = new Chromedriver({
          adb: {
            getApiLevel: async () => 25,
          } as any,
        });
      });
      beforeEach(function () {
        getChromedriverBinaryPathSpy = sandbox.spy(utils, 'getChromedriverBinaryPath');
      });
      afterEach(function () {
        expect(getChromedriverBinaryPathSpy.called).to.be.false;
      });

      it('should find a compatible binary if only one binary exists', async function () {
        sandbox.stub(utils, 'getChromeVersion').resolves('63.0.3239.99');
        sandbox.stub(fs, 'glob').resolves(['/path/to/chromedriver']);
        sandbox.stub(cd, '_execFunc').resolves({
          stdout: 'ChromeDriver 2.36.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
        } as any);

        const binPath = await (cd as any).getCompatibleChromedriver();
        expect(binPath).to.eql('/path/to/chromedriver');
      });

      it('should find most recent compatible binary for older driver versions', async function () {
        sandbox.stub(utils, 'getChromeVersion').resolves('70.0.3029.42');
        sandbox
          .stub(fs, 'glob')
          .resolves([
            '/path/to/chromedriver-36',
            '/path/to/chromedriver-35',
            '/path/to/chromedriver-34',
            '/path/to/chromedriver-33',
            '/path/to/chromedriver-32',
            '/path/to/chromedriver-31',
            '/path/to/chromedriver-30',
          ]);
        const execStub = sandbox.stub(cd, '_execFunc');
        execStub
          .onCall(0)
          .resolves({
            stdout: 'ChromeDriver 2.36.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(1)
          .resolves({
            stdout: 'ChromeDriver 2.35.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(2)
          .resolves({
            stdout: 'ChromeDriver 2.34.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(3)
          .resolves({
            stdout: 'ChromeDriver 2.33.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(4)
          .resolves({
            stdout: 'ChromeDriver 2.32.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(5)
          .resolves({
            stdout: 'ChromeDriver 2.31.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(6)
          .resolves({
            stdout: 'ChromeDriver 2.30.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any);

        const binPath = await (cd as any).getCompatibleChromedriver();
        expect(binPath).to.eql('/path/to/chromedriver-36');
      });

      it('should correctly determine Chromedriver versions', async function () {
        sandbox
          .stub(fs, 'glob')
          .resolves([
            '/path/to/chromedriver-74.0.3729.6',
            '/path/to/chromedriver-36',
            '/path/to/chromedriver-35',
            '/path/to/chromedriver-34',
            '/path/to/chromedriver-33',
            '/path/to/chromedriver-32',
            '/path/to/chromedriver-31',
            '/path/to/chromedriver-30',
          ]);
        const execStub = sandbox.stub(cd, '_execFunc');
        execStub
          .onCall(0)
          .resolves({
            stdout: 'ChromeDriver 74.0.3729.6 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(1)
          .resolves({
            stdout: 'ChromeDriver 2.36.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(2)
          .resolves({
            stdout: 'ChromeDriver 2.35.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(3)
          .resolves({
            stdout: 'ChromeDriver 2.34.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(4)
          .resolves({
            stdout: 'ChromeDriver 2.33.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(5)
          .resolves({
            stdout: 'ChromeDriver 2.32.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(6)
          .resolves({
            stdout: 'ChromeDriver 2.31.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(7)
          .resolves({
            stdout: 'ChromeDriver 2.30.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any);

        const chromedrivers = await (cd as any).getChromedrivers(utils.CHROMEDRIVER_CHROME_MAPPING);
        const expectedVersions = [
          '74.0.3729.6',
          '2.36',
          '2.35',
          '2.34',
          '2.33',
          '2.32',
          '2.31',
          '2.30',
        ];
        for (let i = 0; i < chromedrivers.length; i++) {
          const chromedriver = chromedrivers[i];
          const expectedVersion = expectedVersions[i];
          expect(chromedriver.version).to.eql(expectedVersion);
          expect(chromedriver.minChromeVersion).to.not.be.null;
        }
      });

      it('should fail when chrome is too new', async function () {
        sandbox.stub(utils, 'getChromeVersion').resolves('10000.0.0.42');
        sandbox
          .stub(fs, 'glob')
          .resolves([
            '/path/to/chromedriver-9000',
            '/path/to/chromedriver-8999',
            '/path/to/chromedriver-36',
            '/path/to/chromedriver-35',
          ]);
        const execStub = sandbox.stub(cd, '_execFunc');
        execStub
          .onCall(0)
          .resolves({
            stdout: 'ChromeDriver 2.9000.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(1)
          .resolves({
            stdout: 'ChromeDriver 2.8999.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(2)
          .resolves({
            stdout: 'ChromeDriver 2.36.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any)
          .onCall(3)
          .resolves({
            stdout: 'ChromeDriver 2.35.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          } as any);

        await expect((cd as any).getCompatibleChromedriver()).to.eventually.be.rejected;
      });

      it('should search specified directory if provided', async function () {
        const cd = new Chromedriver({
          adb: {
            getApiLevel: async () => 25,
          } as any,
          executableDir: '/some/local/dir/for/chromedrivers',
        });

        sandbox.stub(utils, 'getChromeVersion').resolves('63.0.3239.99');
        sandbox.stub(fs, 'glob').resolves(['/some/local/dir/for/chromedrivers/chromedriver']);
        sandbox.stub(cd, '_execFunc').resolves({
          stdout: 'ChromeDriver 2.36.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
        } as any);

        const binPath = await (cd as any).getCompatibleChromedriver();
        expect(binPath).to.eql('/some/local/dir/for/chromedrivers/chromedriver');
      });

      it('should use alternative mapping if provided', async function () {
        const cd = new Chromedriver({
          adb: {
            getApiLevel: async () => 25,
          } as any,
          mappingPath: path.resolve(__dirname, '..', 'fixtures', 'alt-mapping.json'),
        });

        sandbox.stub(utils, 'getChromeVersion').resolves('63.0.3239.99');
        sandbox.stub(fs, 'glob').resolves(['/path/to/chromedriver-42']);
        sandbox.stub(cd, '_execFunc').resolves({
          stdout: 'ChromeDriver 2.42.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
        } as any);

        const binPath = await (cd as any).getCompatibleChromedriver();
        expect(binPath).to.eql('/path/to/chromedriver-42');
      });

      it('should use alternative mapping if provided even if semver is broken', async function () {
        const cd = new Chromedriver({
          adb: {
            getApiLevel: async () => 25,
          } as any,
          mappingPath: path.resolve(__dirname, '..', 'fixtures', 'alt-mapping-nonsemver.json'),
        });
        sandbox.stub(utils, 'getChromeVersion').resolves('63.0.3239.99');
        sandbox.stub(fs, 'glob').resolves(['/path/to/chromedriver-42']);
        sandbox.stub(cd, '_execFunc').resolves({
          stdout: 'ChromeDriver 2.42.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
        } as any);
        const binPath = await (cd as any).getCompatibleChromedriver();
        expect(binPath).to.eql('/path/to/chromedriver-42');
      });
    });
  });

  describe('getMostRecentChromedriver', function () {
    it('should get a value by default', function () {
      expect(utils.getMostRecentChromedriver()).to.be.a('string');
    });
    it('should get the most recent version', function () {
      const mapping = {
        2.12: '36.0.1985',
        2.11: '36.0.1985',
        '2.10': '33.0.1751',
        2.9: '31.0.1650',
        2.8: '30.0.1573',
        2.7: '30.0.1573',
        2.6: '29.0.1545',
      };
      expect(utils.getMostRecentChromedriver(mapping)).to.eql('2.12');
    });
    it('should handle broken semver', function () {
      const mapping = {
        2.12: '36.0.1985',
        'v2.11': '36.0.1985',
        '2.10.0.0': '33.0.1751',
        '2.9.3-beta': '31.0.1650',
        2.8: '30.0.1573',
        2.7: '30.0.1573',
        2.6: '29.0.1545',
      };
      expect(utils.getMostRecentChromedriver(mapping)).to.eql('2.12');
    });
    it('should fail for empty mapping', function () {
      expect(() => utils.getMostRecentChromedriver({})).to.throw(/empty/);
    });
  });

  describe('grantDefaultPermissions', function () {
    it('should be a no-op when no adb is available', async function () {
      const cd = new Chromedriver({grantPermissions: true});
      // should resolve without throwing even though there is no adb
      await cd.grantDefaultPermissions();
    });

    it('should grant the default permission set to the Chrome package', async function () {
      const grantStub = sinon.stub().resolves();
      const cd = new Chromedriver({
        adb: {grantPermissions: grantStub} as any,
        grantPermissions: true,
      });
      await cd.grantDefaultPermissions();
      expect(grantStub.calledOnce).to.be.true;
      expect(grantStub.firstCall.args[0]).to.eql(CHROME_BUNDLE_ID);
      expect(grantStub.firstCall.args[1]).to.eql([...DEFAULT_CHROME_PERMISSIONS]);
    });

    it('should grant a custom permission list when provided as an array', async function () {
      const grantStub = sinon.stub().resolves();
      const perms = ['android.permission.CAMERA'];
      const cd = new Chromedriver({
        adb: {grantPermissions: grantStub} as any,
        grantPermissions: perms,
      });
      await cd.grantDefaultPermissions();
      expect(grantStub.firstCall.args[1]).to.eql(perms);
    });

    it('should target a custom bundleId when one is set', async function () {
      const grantStub = sinon.stub().resolves();
      const cd = new Chromedriver({
        adb: {grantPermissions: grantStub} as any,
        bundleId: 'com.android.chrome.beta',
        grantPermissions: true,
      });
      await cd.grantDefaultPermissions();
      expect(grantStub.firstCall.args[0]).to.eql('com.android.chrome.beta');
    });

    it('should swallow adb errors instead of failing the session', async function () {
      const grantStub = sinon.stub().rejects(new Error('pm grant failed'));
      const cd = new Chromedriver({
        adb: {grantPermissions: grantStub} as any,
        grantPermissions: true,
      });
      await expect(cd.grantDefaultPermissions()).to.eventually.be.fulfilled;
    });
  });
});
