// transpile:mocha

import fs from 'fs';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import rimraf from 'rimraf';
import Q from 'q';
import 'mochawait';
import { CD_BASE_DIR, install, installAll, getChromedriverBinaryPath,
         getCurPlatform } from '../lib/install';
import Chromedriver from '../lib/chromedriver';

const stat = Q.denodeify(fs.stat);

let should = chai.should();
chai.use(chaiAsPromised);

describe('install scripts', () => {

  async function assertNoPreviousDirs () {
    let err;
    try {
      await stat(CD_BASE_DIR);
    } catch (e) {
      err = e;
    }
    should.exist(err);
    err.code.should.eql("ENOENT");
  }

  beforeEach(async () => {
    await Q.denodeify(rimraf)(CD_BASE_DIR);
  });

  it('should install for this platform', async () => {
    await assertNoPreviousDirs();
    await install();
    let cdPath = await getChromedriverBinaryPath();
    let cdStat = await stat(cdPath);
    cdStat.size.should.be.above(5000000);
    cdPath.should.contain(getCurPlatform());
    let cd = new Chromedriver();
    await cd.initChromedriverPath();
    cd.chromedriver.should.equal(cdPath);
  });

  it('should install for all platforms', async () => {
    await assertNoPreviousDirs();
    await installAll();
    const plats = [
      ['linux', '32'],
      ['linux', '64'],
      ['win', '32'],
      ['mac', '32']
    ];
    for (let [platform, arch] of plats) {
      let cdPath = await getChromedriverBinaryPath(platform, arch);
      let cdStat = await stat(cdPath);
      cdStat.size.should.be.above(5000000);
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
