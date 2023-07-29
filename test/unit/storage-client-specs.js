import ChromedriverStorageClient from '../../lib/storage-client/storage-client';
import chai from 'chai';
import _ from 'lodash';

chai.should();

describe('ChromedriverStorageClient', function () {
  describe('selectMatchingDrivers', function () {
    const defaultMapping = {
      '2.0/chromedriver_linux32.zip': {
        url: 'https://chromedriver.storage.googleapis.com/2.0/chromedriver_linux32.zip',
        etag: 'c0d96102715c4916b872f91f5bf9b12c',
        version: '2.0',
        minBrowserVersion: '20',
        os: {
          name: 'linux',
          arch: '32',
          cpu: 'intel',
        }
      },
      '2.0/chromedriver_linux64.zip': {
        url: 'https://chromedriver.storage.googleapis.com/2.0/chromedriver_linux64.zip',
        etag: '858ebaf47e13dce7600191ed59974c09',
        version: '2.0',
        minBrowserVersion: '20',
        os: {
          name: 'linux',
          arch: '64',
          cpu: 'intel',
        }
      },
      '2.0/chromedriver_mac32.zip': {
        url: 'https://chromedriver.storage.googleapis.com/2.0/chromedriver_mac32.zip',
        etag: 'efc13db5afc518000d886c2bdcb3a4bc',
        version: '2.0',
        minBrowserVersion: '20',
        os: {
          name: 'mac',
          arch: '32',
          cpu: 'intel',
        }
      },
      '2.0/chromedriver_win32.zip': {
        url: 'https://chromedriver.storage.googleapis.com/2.0/chromedriver_win32.zip',
        etag: 'bbf8fd0fe525a06dda162619cac2b200',
        version: '2.0',
        minBrowserVersion: '20',
        os: {
          name: 'win',
          arch: '32',
          cpu: 'intel',
        }
      },
      '76.0.3809.12/chromedriver_linux64.zip': {
        url: 'https://chromedriver.storage.googleapis.com/76.0.3809.12/chromedriver_linux64.zip',
        etag: '91e0d276a462019afdabb91333643a5a',
        version: '76.0.3809.12',
        minBrowserVersion: '60',
        os: {
          name: 'linux',
          arch: '64',
          cpu: 'intel',
        }
      },
      '76.0.3809.12/chromedriver_mac64.zip': {
        url: 'https://chromedriver.storage.googleapis.com/76.0.3809.12/chromedriver_mac64.zip',
        etag: '80b9f345478d2a64c62678176de4b6f6',
        version: '76.0.3809.12',
        minBrowserVersion: '60',
        os: {
          name: 'mac',
          arch: '64',
          cpu: 'intel',
        }
      },
      '76.0.3809.12/chromedriver_win32.zip': {
        url: 'https://chromedriver.storage.googleapis.com/76.0.3809.12/chromedriver_win32.zip',
        etag: 'b8d1935aa3f3480c4ceed221af0be9d4',
        version: '76.0.3809.12',
        minBrowserVersion: '60',
        os: {
          name: 'win',
          arch: '32',
          cpu: 'intel',
        }
      },
    };

    it('should select appropriate drivers if no options are set', function () {
      const client = new ChromedriverStorageClient();
      client.mapping = _.cloneDeep(defaultMapping);
      const selectedDrivers = client.selectMatchingDrivers({
        name: 'win',
        arch: '64',
        cpu: 'intel',
      });
      selectedDrivers.should.eql([
        '2.0/chromedriver_win32.zip',
        '76.0.3809.12/chromedriver_win32.zip',
      ]);
    });

    it('should select appropriate drivers if versions are set', function () {
      const client = new ChromedriverStorageClient();
      client.mapping = _.cloneDeep(defaultMapping);
      const selectedDrivers = client.selectMatchingDrivers({
        name: 'linux',
        arch: '64',
        cpu: 'intel',
      }, {
        versions: ['76.0.3809.12'],
      });
      selectedDrivers.should.eql([
        '76.0.3809.12/chromedriver_linux64.zip',
      ]);
    });

    it('should select appropriate drivers if minBrowserVersion is set', function () {
      const client = new ChromedriverStorageClient();
      client.mapping = _.cloneDeep(defaultMapping);
      const selectedDrivers = client.selectMatchingDrivers({
        name: 'mac',
        arch: '64',
        cpu: 'intel',
      }, {
        minBrowserVersion: 60,
      });
      selectedDrivers.should.eql([
        '76.0.3809.12/chromedriver_mac64.zip',
      ]);
    });

    it('should select appropriate drivers if both minBrowserVersion and versions are set', function () {
      const client = new ChromedriverStorageClient();
      client.mapping = _.cloneDeep(defaultMapping);
      const selectedDrivers = client.selectMatchingDrivers({
        name: 'mac',
        arch: '64',
        cpu: 'intel',
      }, {
        versions: ['76.0.3809.12'],
        minBrowserVersion: 60,
      });
      selectedDrivers.should.eql([
        '76.0.3809.12/chromedriver_mac64.zip',
      ]);
    });
  });
});
