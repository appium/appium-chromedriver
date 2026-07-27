import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {fs, tempDir} from '@appium/support';

import {ChromedriverStorageClient} from '../../lib/storage-client/storage-client.js';

describe('ChromedriverStorageClient', {timeout: 2000000}, function () {
  it('should retrieve chromedrivers mapping', async function () {
    const client = new ChromedriverStorageClient();
    const mapping = await client.retrieveMapping();
    assert.ok(Object.keys(mapping).length > 0);
  });

  it('should retrieve older chromedrivers by versions', async function () {
    const tmpRoot = await tempDir.openDir();
    const client = new ChromedriverStorageClient({
      chromedriverDir: tmpRoot,
    });
    try {
      assert.ok((await client.syncDrivers({versions: ['2.35', '2.34']})).length > 0);
      assert.strictEqual((await fs.readdir(tmpRoot)).length, 2);
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
      assert.ok((await client.syncDrivers({versions: ['115.0.5790.102', '116.0.5791.0']})).length > 0);
      assert.strictEqual((await fs.readdir(tmpRoot)).length, 2);
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
      assert.ok((await client.syncDrivers({minBrowserVersion: 44})).length > 0);
      assert.ok((await fs.readdir(tmpRoot)).length > 0);
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
      assert.ok((await client.syncDrivers({minBrowserVersion: 74})).length > 0);
      assert.ok((await fs.readdir(tmpRoot)).length > 0);
    } finally {
      await fs.rimraf(tmpRoot);
    }
  });
});
