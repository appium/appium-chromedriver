// transpile:mocha

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { fs } from 'appium-support';
import { CD_BASE_DIR, install, installAll, getChromedriverBinaryPath,
         getCurPlatform, getPlatforms } from '../lib/install';
import Chromedriver from '../lib/chromedriver';


let should = chai.should();
chai.use(chaiAsPromised);

async function assertNoPreviousDirs () {
  let err;
  try {
    await fs.stat(CD_BASE_DIR);
  } catch (e) {
    err = e;
  }
  should.exist(err);
  err.code.should.eql("ENOENT");
}

describe('install scripts', function () {
  this.timeout(2000000);
  beforeEach(async function () {
    await fs.rimraf(CD_BASE_DIR);
  });
  it('should install for this platform', async function () {
    await assertNoPreviousDirs();
    await install();
    let cdPath = await getChromedriverBinaryPath();
    let cdStat = await fs.stat(cdPath);
    cdStat.size.should.be.above(500000);
    cdPath.should.contain(getCurPlatform());
    let cd = new Chromedriver();
    await cd.initChromedriverPath();
    cd.chromedriver.should.equal(cdPath);
  });
  it('should install for all platforms', async function () {
    this.timeout(120000);
    await assertNoPreviousDirs();
    await installAll();

    for (let [platform, arch] of getPlatforms()) {
      let cdPath = await getChromedriverBinaryPath(platform, arch);
      let cdStat = await fs.stat(cdPath);
      cdStat.size.should.be.above(500000);
      cdPath.should.contain(platform);
      if (platform === "linux") {
        cdPath.should.contain(arch);
      } else {
        cdPath.should.not.contain(arch);
      }
    }
  });
  it('should throw an error in chromedriver if nothing is installed', async function () {
    await assertNoPreviousDirs();
    let cd = new Chromedriver();
    let err;
    try {
      await cd.initChromedriverPath();
    } catch (e) {
      err = e;
    }
    should.exist(err);
    err.message.should.contain("path");
  });
});
