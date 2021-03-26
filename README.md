appium-chromedriver
===================

[![Build Status](https://travis-ci.org/appium/appium-chromedriver.svg)](https://travis-ci.org/appium/appium-chromedriver)

Node.js wrapper around [Chromedriver](https://sites.google.com/a/chromium.org/chromedriver/)

Issues for this repo are disabled. Log any issues at the [main Appium repo's issue tracker](https://github.com/appium/appium/issues).

## Local installation

Because of the oddities of `npm`'s lifecycle hooks, installing locally the first time _will_ fail, saying `Project does not appear to built yet. Please run `gulp transpile` first.`. This is because we transpile in the `prepublish` phase, but run the install script in the `install` phase. Any other way would make development dependencies necessary on user's machines, or make the binary not install, unfortunately.

The solution, however, is simple. Simple run `gulp transpile` and then `npm install`. The former will build the project and the latter will simply install the binary.

## Skipping binary installation

If, for some reason, you want to install without installing the Chromedriver
binary, either set the `APPIUM_SKIP_CHROMEDRIVER_INSTALL` environment variable,
pass the `--chromedriver-skip-install` flag while running `npm install`
or add the following property into your [`.npmrc`](https://docs.npmjs.com/files/npmrc) file.

```bash
chromedriver_skip_install=true
```


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
