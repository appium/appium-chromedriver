import Chromedriver from '../lib/chromedriver';
import * as install from '../lib/install';
import * as utils from '../lib/utils';
import sinon from 'sinon';
import chai from 'chai';
import { fs } from 'appium-support';
import * as tp from 'teen_process';


chai.should();

describe('chromedriver', function () {
  let sandbox;
  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });
  afterEach(function () {
    sandbox.restore();
  });

  describe('getCompatibleChromedriver', function () {
    describe('desktop', function () {
      it('should find generic binary', async function () {
        sandbox.stub(install, 'getChromedriverBinaryPath')
          .returns('/path/to/chromedriver');

        const cd = new Chromedriver({});
        const binPath = await cd.getCompatibleChromedriver();
        binPath.should.eql('/path/to/chromedriver');
      });
    });

    describe('Android', function () {
      let cd;
      let getChromedriverBinaryPathSpy;
      before(function () {
        cd = new Chromedriver({
          adb: {},
        });
      });
      beforeEach(function () {
        getChromedriverBinaryPathSpy = sandbox.spy(install, 'getChromedriverBinaryPath');
      });
      afterEach(function () {
        getChromedriverBinaryPathSpy.called.should.be.false;
      });

      it('should find a compatible binary if only one binary exists', async function () {
        sandbox.stub(utils, 'getChromeVersion')
          .returns('63.0.3239.99');
        sandbox.stub(fs, 'glob')
          .returns([
            '/path/to/chromedriver',
          ]);
        sandbox.stub(tp, 'exec')
          .returns({
            stdout: 'ChromeDriver 2.36.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          });

        const binPath = await cd.getCompatibleChromedriver();
        binPath.should.eql('/path/to/chromedriver');
      });

      it('should find most recent compatible binary from a number of possibilities', async function () {
        sandbox.stub(utils, 'getChromeVersion')
          .returns('59.0.3029.42');
        sandbox.stub(fs, 'glob')
          .returns([
            '/path/to/chromedriver-36',
            '/path/to/chromedriver-35',
            '/path/to/chromedriver-34',
            '/path/to/chromedriver-33',
            '/path/to/chromedriver-32',
            '/path/to/chromedriver-31',
            '/path/to/chromedriver-30',
          ]);
        sandbox.stub(tp, 'exec')
          .onCall(0)
            .returns({
              stdout: 'ChromeDriver 2.36.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
            })
          .onCall(0)
            .returns({
              stdout: 'ChromeDriver 2.35.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
            })
          .onCall(0)
            .returns({
              stdout: 'ChromeDriver 2.34.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
            })
          .onCall(0)
            .returns({
              stdout: 'ChromeDriver 2.33.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
            })
          .onCall(0)
            .returns({
              stdout: 'ChromeDriver 2.32.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
            })
          .onCall(0)
            .returns({
              stdout: 'ChromeDriver 2.31.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
            })
          .onCall(0)
            .returns({
              stdout: 'ChromeDriver 2.30.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
            });

        const binPath = await cd.getCompatibleChromedriver();
        binPath.should.eql('/path/to/chromedriver-36');
      });

      it('should search specified directory if provided', async function () {
        const cd = new Chromedriver({
          adb: {},
          executableDir: '/some/local/dir/for/chromedrivers',
        });

        sandbox.stub(utils, 'getChromeVersion')
          .returns('63.0.3239.99');
        sandbox.stub(fs, 'glob')
          .withArgs('/some/local/dir/for/chromedrivers/*')
            .returns([
              '/some/local/dir/for/chromedrivers/chromedriver',
            ]);
        sandbox.stub(tp, 'exec')
          .returns({
            stdout: 'ChromeDriver 2.36.540469 (1881fd7f8641508feb5166b7cae561d87723cfa8)',
          });

        const binPath = await cd.getCompatibleChromedriver();
        binPath.should.eql('/some/local/dir/for/chromedrivers/chromedriver');
      });
    });
  });
});
