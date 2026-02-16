import {expect, use} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {ChromedriverStorageClient} from '../../lib/storage-client/storage-client';
import _ from 'lodash';
import {fs, tempDir} from '@appium/support';

use(chaiAsPromised);

describe('ChromedriverStorageClient', function () {
  this.timeout(2000000);

  it('should retrieve chromedrivers mapping', async function () {
    const client = new ChromedriverStorageClient();
    const mapping = await client.retrieveMapping();
    expect(_.size(mapping)).to.be.greaterThan(0);
  });

  it('should retrieve older chromedrivers by versions', async function () {
    const tmpRoot = await tempDir.openDir();
    const client = new ChromedriverStorageClient({
      chromedriverDir: tmpRoot,
    });
    try {
      expect((await client.syncDrivers({versions: ['2.35', '2.34']})).length).to.be.greaterThan(0);
      expect((await fs.readdir(tmpRoot)).length).to.be.eql(2);
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
      expect(
        (await client.syncDrivers({versions: ['115.0.5790.102', '116.0.5791.0']})).length,
      ).to.be.greaterThan(0);
      expect((await fs.readdir(tmpRoot)).length).to.be.eql(2);
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
      expect((await client.syncDrivers({minBrowserVersion: 44})).length).to.be.greaterThan(0);
      expect((await fs.readdir(tmpRoot)).length).to.be.greaterThan(0);
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
      expect((await client.syncDrivers({minBrowserVersion: 74})).length).to.be.greaterThan(0);
      expect((await fs.readdir(tmpRoot)).length).to.be.greaterThan(0);
    } finally {
      await fs.rimraf(tmpRoot);
    }
  });
});
