#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-disable promise/prefer-await-to-callbacks */

const fs = require('fs');
const path = require('path');
const log = require('fancy-log');
const _ = require('lodash');


function waitForDeps (cb) {
  // see if we can import the necessary code
  // try it a ridiculous (but finite) number of times
  let i = 0;
  function check () {
    i++;
    try {
      require('./build/lib/install');
      cb();
    } catch (err) {
      const pathString = path.join('build', 'lib', 'install');
      if (err.message.includes(`Cannot find module '${pathString}'`)) {
        console.warn('Project does not appear to be built yet. Please run `gulp transpile` first.');
        return cb('Could not install module: ' + err);
      }
      console.warn('Error trying to install Chromedriver binary. Waiting and trying again.', err.message);
      if (i <= 200) {
        setTimeout(check, 1000);
      } else {
        cb('Could not import installation module: ' + err);
      }
    }
  }
  check();
}

function main () {
  // check if we should skip install
  if (!_.isEmpty(process.env.APPIUM_SKIP_CHROMEDRIVER_INSTALL) || !_.isEmpty(process.env.npm_config_chromedriver_skip_install)) {
    log.warn(`'APPIUM_SKIP_CHROMEDRIVER_INSTALL' environment variable set, or '--chromedriver-skip-install' flag set.`);
    log.warn(`Skipping Chromedriver installation. Android web/hybrid testing will not be possible`);
    return;
  }

  // check if cur dir exists
  const installScript = path.resolve(__dirname, 'build', 'lib', 'install.js');
  waitForDeps(function wait (err) {
    if (err) {
      console.warn('Unable to import install script. Re-run `install appium-chromedriver` manually.');
      console.warn(err.message);
      return;
    }
    fs.stat(installScript, function installScriptExists (err) {
      if (err) {
        console.warn(`NOTE: Run 'gulp transpile' before using`);
        return;
      }
      require('./build/lib/install').doInstall().catch(function installError (err) {
        console.error(err.stack ? err.stack : err);
        process.exit(1);
      });
    });
  });
}

if (require.main === module) {
  main();
}
