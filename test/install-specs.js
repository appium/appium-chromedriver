// transpile:mocha

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { fs } from 'appium-support';
import { CD_VER, CD_BASE_DIR, install, installAll, getChromedriverBinaryPath,
         getCurPlatform } from '../lib/install';
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
  beforeEach(async () => {
    await fs.rimraf(CD_BASE_DIR);
  });
  it('should install for this platform', async () => {
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
    const plats = [
      ['linux', '32'],
      ['linux', '64'],
      ['win', '32']
    ];
    plats.push(parseFloat(CD_VER) < 2.23 ? ['mac', '32'] : ['mac', '64']);
    for (let [platform, arch] of plats) {
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
  it('should throw an error in chromedriver if nothing is installed', async () => {
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
