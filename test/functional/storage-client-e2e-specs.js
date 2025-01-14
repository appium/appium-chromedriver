import { ChromedriverStorageClient } from '../../lib/storage-client/storage-client';
import _ from 'lodash';
import { fs, tempDir } from '@appium/support';

describe('ChromedriverStorageClient', function () {
  let chai;

  this.timeout(2000000);

  before(async function () {
    chai = await import('chai');
    const chaiAsPromised = await import('chai-as-promised');

    chai.should();
    chai.use(chaiAsPromised.default);
  });

  it('should retrieve chromedrivers mapping', async function () {
    const client = new ChromedriverStorageClient();
    const mapping = await client.retrieveMapping();
    _.size(mapping).should.be.greaterThan(0);
  });

  it('should retrieve older chromedrivers by versions', async function () {
    const tmpRoot = await tempDir.openDir();
    const client = new ChromedriverStorageClient({
      chromedriverDir: tmpRoot,
    });
    try {
      (await client.syncDrivers({
        versions: ['2.35', '2.34'],
      })).length.should.be.greaterThan(0);
      (await fs.readdir(tmpRoot)).length.should.be.eql(2);
    } finally {
      await fs.rimraf(tmpRoot);
    }
  });

  it('should retrieve newer chromedrivers by versions', async function () {
    const tmpRoot = await tempDir.openDir();
    const client = new ChromedriverStorageClient({
      chromedriverDir: tmpRoot,
    });
    try {
      (await client.syncDrivers({
        versions: ['115.0.5790.102', '116.0.5791.0'],
      })).length.should.be.greaterThan(0);
      (await fs.readdir(tmpRoot)).length.should.be.eql(2);
    } finally {
      await fs.rimraf(tmpRoot);
    }
  });

  it('should retrieve chromedrivers by minBrowserVersion (non exact match)', async function () {
    const tmpRoot = await tempDir.openDir();
    const client = new ChromedriverStorageClient({
      chromedriverDir: tmpRoot,
    });
    try {
      (await client.syncDrivers({
        minBrowserVersion: 44,
      })).length.should.be.greaterThan(0);
      (await fs.readdir(tmpRoot)).length.should.be.greaterThan(0);
    } finally {
      await fs.rimraf(tmpRoot);
    }
  });

  it('should retrieve chromedrivers by minBrowserVersion (exact match)', async function () {
    const tmpRoot = await tempDir.openDir();
    const client = new ChromedriverStorageClient({
      chromedriverDir: tmpRoot,
    });
    try {
      (await client.syncDrivers({
        minBrowserVersion: 74,
      })).length.should.be.greaterThan(0);
      (await fs.readdir(tmpRoot)).length.should.be.greaterThan(0);
    } finally {
      await fs.rimraf(tmpRoot);
    }
  });
});
