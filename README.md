appium-chromedriver
===================

[![Release](https://github.com/appium/appium-chromedriver/actions/workflows/publish.js.yml/badge.svg)](https://github.com/appium/appium-chromedriver/actions/workflows/publish.js.yml)

Node.js wrapper around [Chromedriver](https://sites.google.com/chromium.org/driver/)
and [Microsoft Edge WebDriver](https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/).
The Microsoft Edge WebDriver support is since v5.4.0.
This wrapper is not used directly in Appium, but rather by various Android drivers to automate
Chrome/Chromium-based browsers
and web views using Hybrid Mode approach. Check the corresponding driver tutorials to get
more details on it.

> **Note**
>
> This package is intended to be used as a helper module for Appium drivers such as
> [UiAutomator2](https://github.com/appium/appium-uiautomator2-driver/) and
> [appium-chromium-driver](https://github.com/appium/appium-chromium-driver).
> It was not created for standalone usage.
> Please ensure you know what you are doing before using this package directly.

> **Note**
>
> This package can work with Microsoft Edge WebDriver as well, but the support is limited.
> For example, automatic downloads do not work for Microsoft Edge WebDriver.

## Automatic Chromedriver download on module install

Since version 6.0.0 of this module automatic download of the latest known chromedriver
does not happen anymore. The below information is only relevant for older module versions:

### Skipping binary installation

By default, upon installation the package downloads the most recent known Chromedriver version from
Chromedriver CDN server: http://chromedriver.storage.googleapis.com.
If, for some reason, you want to install the package without downloading the Chromedriver
binary set the `APPIUM_SKIP_CHROMEDRIVER_INSTALL` environment variable:

```bash
APPIUM_SKIP_CHROMEDRIVER_INSTALL=1 npm install appium-chromedriver
```

### Custom Chromedriver version

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
default one https://chromedriver.storage.googleapis.com, then set the new URL to
the `CHROMEDRIVER_CDNURL` environment variable:

```bash
CHROMEDRIVER_CDNURL=http://npm.taobao.org/mirrors/chromedriver npm install appium-chromedriver
```

If you want automatic chromedrivers download feature to work with a custom CDN URL then make sure
the server returns a proper list of stored drivers in response to requests having
`Accept: application/xml` header. An example XML could be retrieved from the original URL using
`curl -H 'Accept: application/xml' https://chromedriver.storage.googleapis.com` command.

Since version 5.6 the second environment variable has been added: `CHROMELABS_URL`. By default, it points
to https://googlechromelabs.github.io, and is expected to contain the actual prefix of
[Chrome for Testing availability](https://github.com/GoogleChromeLabs/chrome-for-testing#json-api-endpoints)
JSON API. This API allows retrieval of chromedrivers whose major versions are greater than `114`.

Similarly to the above it could be also defined in the .npmrc file:

```bash
chromelabs_url=https://googlechromelabs.github.io
```

You may also want to skip checking for older Chromedriver versions by providing an
empty value to the `CHROMEDRIVER_CDNURL` variable.

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
npm run test
npm run e2e-test
```
