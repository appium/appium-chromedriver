import ChromedriverStorageClient from '../lib/storage-client';
import chai from 'chai';
import _ from 'lodash';

chai.should();

describe('ChromedriverStorageClient', function () {
  describe('parseNotes', function () {
    const client = new ChromedriverStorageClient();

    it('should parse valid notes.txt', function () {
      const info = client.parseNotes(`
      ----------ChromeDriver v2.16 (2015-06-08)----------
      Supports Chrome v42-45
      Resolved issue 1111: Touch Actions fail on WebView [OS-Android, Pri-0]
      Resolved issue 1118: Tests that use GoBack or GoForward can be flaky [OS-All, Pri-0]
      Resolved issue 1106: ChromeDriver does not switch back to top frame after navigation events [OS-All, Pri-0]
      Resolved issue 1102: ChromeDriver does not report ""hasTouchScreen"" when it has a touchscreen [OS-Android, Pri-1]

      ----------ChromeDriver v2.15 (2015-03-26)----------
      Supports Chrome v40-43


      ----------ChromeDriver v2.14 (2015-01-28)----------
      Supports Chrome v39-42
      Resolved issue 537: Manually clicking on javascript alert causes chromedriver to return UnexpectedAlertPresentException for all subsequent calls [Pri-3]
      Resolved issue 1: Implement /sessions command [Pri-3]
      Resolved issue 975: driver.findElements(By.id("..")) not working correctly when id contains semicolon []
      Resolved issue 852: Support shadow dom in chromedriver. []

      ----------ChromeDriver v2.13 (2014-12-10)----------
      Supports Chrome v38-41
      Resolved issue 997: Chromedriver times out waiting for Tracing.end command to respond [OS-All, Pri-0]
      Resolved issue 980: GoBack command times out on all platforms [OS-All, Pri-0]
      Resolved issue 978: ChromeDriver port server fails to reserve port [OS-Linux, Pri-0]
      Resolved issue 653: Commands goBack and goForward have race condition. [Pri-1]
      Resolved issue 845: chromedriver fails with "Chrome version must be >= 31.0.1650.59" on Android 4.4.3 webviews [OS-Android, Pri-1]
      Resolved issue 626: silence chrome logging by default on windows [Pri-1]
      Resolved issue 973: ChromeDriver fails to close DevTools UI before executing commands [OS-All, Pri-2]
      `);
      info.should.eql({
        version: '2.16',
        minBrowserVersion: '42',
      });
    });

    it('should parse valid notes.txt in newer format', function () {
      const info = client.parseNotes(`
      ----------ChromeDriver 76.0.3809.12 (2019-06-07)----------
      Supports Chrome version 76
      Resolved issue 1897: Implement Actions API [Pri-1]
      Resolved issue 2556: Script timeout handling is not spec compliant [Pri-2]
      Resolved issue 2745: Improve cyclic data structure detection in Execute Script command [Pri-2]
      Resolved issue 1071: Incorrect serialization in webdriver command response. [Pri-2]
      Resolved issue 2264: moveToElement() scrolls the top left corner of the element into view [Pri-2]
      Resolved issue 2852: Do not scroll partially visible elements [Pri-2]
      Resolved issue 2840: Element Send Keys: Codepoint "U+E001" not supported [Pri-2]
      Resolved issue 2869: ChromeDriver should return user prompt (or alert) text in unhandled alert error response [Pri-2]
      Resolved issue 1062: <details> children are always considered displayed [Pri-2]
      Resolved issue 2555: Script result serialization is not spec compliant [Pri-3]
      Resolved issue 2892: excludeSwitches option should allow leading dashes in switch names [Pri-3]
      `);
      info.should.eql({
        version: '76.0.3809.12',
        minBrowserVersion: '76',
      });
    });

    it('should parse invalid notes.txt', function () {
      const info = client.parseNotes('');
      info.should.eql({});
    });

    it('should parse semivalid notes.txt', function () {
      const info = client.parseNotes(`
      ----------ChromeDriver v2.16 (2015-06-08)----------
      Resolved issue 1111: Touch Actions fail on WebView [OS-Android, Pri-0]
      Resolved issue 1118: Tests that use GoBack or GoForward can be flaky [OS-All, Pri-0]
      Resolved issue 1106: ChromeDriver does not switch back to top frame after navigation events [OS-All, Pri-0]
      Resolved issue 1102: ChromeDriver does not report ""hasTouchScreen"" when it has a touchscreen [OS-Android, Pri-1]
      `);
      info.should.eql({
        version: '2.16',
      });
    });
  });

  describe('selectMatchingDrivers', function () {
    const defaultMapping = {
      '2.0/chromedriver_linux32.zip': {
        url: 'https://chromedriver.storage.googleapis.com/2.0/chromedriver_linux32.zip',
        etag: 'c0d96102715c4916b872f91f5bf9b12c',
        version: '2.0',
        minBrowserVersion: '20',
      },
      '2.0/chromedriver_linux64.zip': {
        url: 'https://chromedriver.storage.googleapis.com/2.0/chromedriver_linux64.zip',
        etag: '858ebaf47e13dce7600191ed59974c09',
        version: '2.0',
        minBrowserVersion: '20',
      },
      '2.0/chromedriver_mac32.zip': {
        url: 'https://chromedriver.storage.googleapis.com/2.0/chromedriver_mac32.zip',
        etag: 'efc13db5afc518000d886c2bdcb3a4bc',
        version: '2.0',
        minBrowserVersion: '20',
      },
      '2.0/chromedriver_win32.zip': {
        url: 'https://chromedriver.storage.googleapis.com/2.0/chromedriver_win32.zip',
        etag: 'bbf8fd0fe525a06dda162619cac2b200',
        version: '2.0',
        minBrowserVersion: '20',
      },
      '76.0.3809.12/chromedriver_linux64.zip': {
        url: 'https://chromedriver.storage.googleapis.com/76.0.3809.12/chromedriver_linux64.zip',
        etag: '91e0d276a462019afdabb91333643a5a',
        version: '76.0.3809.12',
        minBrowserVersion: '60',
      },
      '76.0.3809.12/chromedriver_mac64.zip': {
        url: 'https://chromedriver.storage.googleapis.com/76.0.3809.12/chromedriver_mac64.zip',
        etag: '80b9f345478d2a64c62678176de4b6f6',
        version: '76.0.3809.12',
        minBrowserVersion: '60',
      },
      '76.0.3809.12/chromedriver_win32.zip': {
        url: 'https://chromedriver.storage.googleapis.com/76.0.3809.12/chromedriver_win32.zip',
        etag: 'b8d1935aa3f3480c4ceed221af0be9d4',
        version: '76.0.3809.12',
        minBrowserVersion: '60',
      },
    };

    it('should select appropriate drivers if no options are set', function () {
      const client = new ChromedriverStorageClient();
      client.mapping = _.cloneDeep(defaultMapping);
      const selectedDrivers = client.selectMatchingDrivers({
        name: 'win',
        arch: '64',
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
      }, {
        minBrowserVersion: '60',
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
      }, {
        versions: ['76.0.3809.12'],
        minBrowserVersion: '60',
      });
      selectedDrivers.should.eql([
        '76.0.3809.12/chromedriver_mac64.zip',
      ]);
    });
  });
});
