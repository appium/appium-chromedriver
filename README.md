[![Build Status](https://travis-ci.org/appium/appium-chromedriver.svg)](https://travis-ci.org/appium/appium-chromedriver) [![Coverage Status](https://coveralls.io/repos/appium/appium-chromedriver/badge.svg?branch=master&service=github)](https://coveralls.io/github/appium/appium-chromedriver?branch=master)
[![Greenkeeper badge](https://badges.greenkeeper.io/appium/appium-chromedriver.svg)](https://greenkeeper.io/)

appium-chromedriver
===================

Node.js wrapper around [Chromedriver](https://sites.google.com/a/chromium.org/chromedriver/)

Issues for this repo are disabled. Log any issues at the [main Appium repo's issue tracker](https://github.com/appium/appium/issues).

## Local installation

Because of the oddities of `npm`'s lifecycle hooks, installing locally the first time _will_ fail, saying `Project does not appear to built yet. Please run `gulp transpile` first.`. This is because we transpile in the `prepublish` phase, but run the install script in the `install` phase. Any other way would make development dependencies necessary on user's machines, or make the binary not install, unfortunately.

The solution, however, is simple. Simple run `gulp transpile` and then `npm install`. The former will build the project and the latter will simply install the binary.


## Usage

```js
import Chromedriver from 'appium-chromedriver';

// 'sync'-like await/Promise usage
async function runSession() {
    let driver = new Chromedriver();
    const desiredCaps = {browserName: 'chrome'};
    await driver.start(desiredCaps);
    let status = await driver.sendCommand('/status', 'GET');
    await driver.stop();
}

// EventEmitter usage
function runSession2() {
    let driver = new Chromedriver();
    const desiredCaps = {browserName: 'chrome'};
    driver.start(desiredCaps);
    driver.on(Chromedriver.EVENT_CHANGED, function (msg) {
        if (msg.state === Chromedriver.STATE_ONLINE) {
            driver.sendCommand('/status', 'GET').then(function (status) {
                driver.stop();
            });
        }
    });
    driver.on(Chromedriver.EVENT_ERROR, function (err) {
        // :-(
    });
}
```

## States

Here's what the Chromedriver state machine looks like:

![Chromedriver States](./doc/states.png)

Here are the events you can listen for:

* `Chromedriver.EVENT_ERROR`: gives you an error object
* `Chromedriver.EVENT_CHANGED`: gives you a state change object, with a `state` property that can be one of:
    * `Chromedriver.STATE_STOPPED`
    * `Chromedriver.STATE_STARTING`
    * `Chromedriver.STATE_ONLINE`
    * `Chromedriver.STATE_STOPPING`
    * `Chromedriver.STATE_RESTARTING`

## Custom Chromedriver version

To use a version of Chromedriver not set in the code, use npm config property `chromedriver_version`.

```bash
npm install appium-chromedriver --chromedriver_version="2.16"
```

Or add the property into your [`.npmrc`](https://docs.npmjs.com/files/npmrc) file.

```bash
chromedriver_version=2.16
```

## Custom binaries url

To use a mirror of the ChromeDriver binaries use npm config property `chromedriver_cdnurl`.
Default is `http://chromedriver.storage.googleapis.com`.

```bash
npm install appium-chromedriver --chromedriver_cdnurl=http://npm.taobao.org/mirrors/chromedriver
```

Or add the property into your [`.npmrc`](https://docs.npmjs.com/files/npmrc) file.

```bash
chromedriver_cdnurl=http://npm.taobao.org/mirrors/chromedriver
```

Another option is to use PATH variable `CHROMEDRIVER_CDNURL`.

```bash
CHROMEDRIVER_CDNURL=http://npm.taobao.org/mirrors/chromedriver npm install appium-chromedriver
```

## Dev

We use Gulp for building/transpiling.

### Watch

```
npm run watch
```

### Run Tests

```
npm test
```

## Upgrading Chromedriver Version

When a new [Chromedriver](http://chromedriver.chromium.org/) version is released,
the details will be [here](http://chromedriver.chromium.org/downloads). Which
Chromedriver this package selects is based on the `CHROMEDRIVER_CHROME_MAPPING`
in `lib/chromedriver`. Add a new entry to the top, with the correct version number
and a random, but low, "minimum chrome version" (this will make it so that while
this version is chosen, the test in the next step will fail for the right reason
and give us the correct value to put here). To install, build then re-install
the package:
```
npm run build
npm install
```
To get the minimum version of Chrome needed for the new Chromedriver, in one
shell run Chromedriver
```shell
./chromedriver/<PLATFORM>/chromedriver[.exe] --verbose
```
And in anther shell, create a session by running the [curl](https://curl.haxx.se/) command
```shell
curl \
  -d '{"desiredCapabilities":{"chromeOptions":{"androidPackage":"com.android.chrome","androidDeviceSerial":"emulator-5554"}}}' \
  -H "Content-Type: application/json" \
  -XPOST http://localhost:9515/session
```
This **will** fail, but in the error message will be the actual minimum Chrome
version for this version of Chromedriver:
```json
{
  "sessionId": "55dcde971731f3d1ce04b54d7664069c",
  "status": 33,
  "value": {
    "message": "session not created: Chrome version must be >= 68.0.3440.0\n  (Driver info: chromedriver=2.42.591059 (a3d9684d10d61aa0c45f6723b327283be1ebaad8),platform=Mac OS X 10.13.6 x86_64)"
  }
}
```
Take the number (e.g., here, `68.0.3440.0`) and put the first three parts
(`68.0.3440.0`) into the `CHROMEDRIVER_CHROME_MAPPING`, replacing the random value
inserted at the beginning of this process.

Commit, push, and pull request!
