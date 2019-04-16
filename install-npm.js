#!/usr/bin/env node
/* eslint-disable promise/prefer-await-to-callbacks */

const fs = require('fs');
const path = require('path');
const log = require('fancy-log');
const _ = require('lodash');


/**
 * Because of the way npm lifecycle scripts work, on a local install, when the
 * code has not been tranpiled yet (i.e., the first time, or after the 'build'
 * directory has been deleted) the download **will** fail, and 'npm run chromedriver'
 * will need to be run.
 */

const BUILD_RETRIES = 200;
const BUILD_RETRY_INTERVAL = 1000;

const BUILD_PATH = path.join(__dirname, 'build', 'lib', 'install.js');

function waitForDeps (cb) {
  // see if we can import the necessary code
  // try it a ridiculous (but finite) number of times
  let i = 0;
  function check () {
    i++;
    try {
      require(BUILD_PATH);
      cb();
    } catch (err) {
      if (err.message.includes(`Cannot find module '${BUILD_PATH}'`)) {
        log.warn(`Project does not appear to be built yet. Please run 'npm run chromedriver' first.`);
        return cb(new Error(`Could not install module: ${err.message}`));
      }
      log.warn(`Error trying to install Chromedriver binary. Waiting ${BUILD_RETRY_INTERVAL}ms and trying again: ${err.message}`);
      if (i <= BUILD_RETRIES) {
        setTimeout(check, BUILD_RETRY_INTERVAL);
      } else {
        cb(new Error(`Could not import installation module: ${err.message}`));
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

  // check if the code has been transpiled
  waitForDeps(function wait (err) {
    if (err) {
      // this should only happen on local install (i.e., npm install in this directory)
      log.warn(`Unable to import install script: ${err.message}`);
      log.warn(`Re-run 'npm run chromedriver' manually.`);
      return;
    }
    fs.stat(BUILD_PATH, function installScriptExists (err) {
      if (err) {
        // this should only happen on local install
        log.warn(`NOTE: Run 'npx gulp transpile' before using`);
        return;
      }
      require(BUILD_PATH).doInstall().catch(function installError (err) {
        log.error(`Error installing Chromedriver: ${err.message}`);
        log.error(err.stack ? err.stack : err);
        log.error(`Downloading Chromedriver can be skipped by using the ` +
                  `'--chromedriver-skip-install' flag or ` +
                  `setting the 'APPIUM_SKIP_CHROMEDRIVER_INSTALL' environment ` +
                  `variable.`);
        process.exit(1);
      });
    });
  });
}

if (require.main === module) {
  main();
}
