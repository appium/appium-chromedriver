#!/usr/bin/env node

/**
 * This is the `postinstall` script which:
 * 1. Builds the project if it isn't yet built (only happens in a dev environment), and
 * 2. Downloads Chromedriver (which can be disabled);
 *
 * Because `prepare` is run _after_ `postinstall`, we cannot just use `prepare` to build the project
 * because this script depends on the project being built!
 */

const B = require('bluebird');
const util = require('util');

// this is here because we're using async/await, and this must be set _before_ we use async/await,
// given that bluebird is used elsewhere via `doInstall()`.
B.config({
  cancellation: true,
});

const fs = require('fs/promises');
const path = require('path');
const log = require('fancy-log');
const _ = require('lodash');
const {exec} = require('teen_process');

const BUILD_PATH = path.join(__dirname, 'build', 'lib', 'install.js');

async function main() {
  // always build if not yet built.
  // this should only happen in a working copy / dev environment.
  try {
    await fs.stat(BUILD_PATH);
  } catch {
    log.info(
      `The Chromedriver install script cannot be found at '${BUILD_PATH}'. ` +
        `Building appium-chromedriver package`
    );
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
      await exec(npmCommand, ['run', 'build'], {logger: log, cwd: __dirname});
    } catch (e) {
      throw new Error(`appium-chromedriver package cannot be built: ${util.inspect(e)}`);
    }
  }

  // check if we should skip install
  if (
    !_.isEmpty(process.env.APPIUM_SKIP_CHROMEDRIVER_INSTALL) ||
    !_.isEmpty(process.env.npm_config_chromedriver_skip_install)
  ) {
    log.warn(
      `'APPIUM_SKIP_CHROMEDRIVER_INSTALL' environment variable is set; skipping Chromedriver installation.`
    );
    log.warn(`Android web/hybrid testing will not be possible without Chromedriver.`);
    return;
  }

  try {
    await require(BUILD_PATH).doInstall();
  } catch (err) {
    log.error(`Error installing Chromedriver: ${err.message}`);
    log.error(err.stack ? err.stack : err);
    log.error(
      `Downloading Chromedriver can be skipped by setting the` +
        `'APPIUM_SKIP_CHROMEDRIVER_INSTALL' environment variable.`
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
