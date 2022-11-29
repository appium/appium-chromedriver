appium-chromedriver
===================

[![Release](https://github.com/appium/appium-chromedriver/actions/workflows/publish.js.yml/badge.svg)](https://github.com/appium/appium-chromedriver/actions/workflows/publish.js.yml)

Node.js wrapper around [Chromedriver](https://sites.google.com/a/chromium.org/chromedriver/).
This wrapper is not used directly in Appium, but rather by various Android drivers to automate
Chrome/Chromium-based browsers
and web views using Hybrid Mode approach. Check the corresponding driver tutorials to get
more details on it.

> **Note**
>
> The normal use of this package is via an Appium driver such as [UiAutomator2](https://github.com/appium/appium-uiautomator2-driver/) and not directly.
> Please ensure you know what you are doing before using this package directly.

## Skipping binary installation

By default, upon installation the package downloads the most recent known Chromedriver version from
Chromedriver CDN server: http://chromedriver.storage.googleapis.com.
If, for some reason, you want to install the package without downloading the Chromedriver
binary set the `APPIUM_SKIP_CHROMEDRIVER_INSTALL` environment variable:

```bash
APPIUM_SKIP_CHROMEDRIVER_INSTALL=1 npm install appium-chromedriver
```

## Custom Chromedriver version

By default, the package uses the most recent known Chromedriver version.
The full list of known Chromedriver versions and their corresponding supported
Chrome version could be found in
[mapping.json](https://github.com/appium/appium-chromedriver/blob/master/config/mapping.json)

To download a custom version of Chromedriver, please set `CHROMEDRIVER_VERSION` environment variable:

```bash
CHROMEDRIVER_VERSION=107.0.5304.62 npm install appium-chromedriver
```

## Custom binaries url

If you want Chromedriver to be downloaded from another CDN, which differs from the
default one http://chromedriver.storage.googleapis.com, then either set the npm config property `chromedriver_cdnurl`:

```bash
npm install appium-chromedriver --chromedriver_cdnurl=http://npm.taobao.org/mirrors/chromedriver
```

The property could also be added into your [`.npmrc`](https://docs.npmjs.com/files/npmrc) file.

```bash
chromedriver_cdnurl=http://npm.taobao.org/mirrors/chromedriver
```

Or set the new URL to `CHROMEDRIVER_CDNURL` environment variable:

```bash
CHROMEDRIVER_CDNURL=http://npm.taobao.org/mirrors/chromedriver npm install appium-chromedriver
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


## Development

### Build & Lint

```bash
npm run build
npm run lint
```

### Run Tests

```bash
npm test
npm e2e-test
```
