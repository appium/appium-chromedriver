#!/usr/bin/env node
/* eslint-disable no-console */

var fs = require('fs')
  , path = require('path');


function waitForDeps (cb) {
  // see if we can import the necessary code
  // try it a ridiculous (but finite) number of times
  var i = 0;
  function check () {
    i++;
    try {
      require('./build/lib/install');
      cb();
    } catch (err) {
      if (err.message.indexOf("Cannot find module './build/lib/install'") !== -1) {
        console.warn('Project does not appear to built yet. Please run `gulp transpile` first.');
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

if (require.main === module) {
  // check if cur dir exists
  var installScript = path.resolve(__dirname, 'build', 'lib', 'install.js');
  waitForDeps(function (err) {
    if (err) {
      console.warn("Unable to import install script. Re-run `install appium-chromedriver` manually.");
      return;
    }
    fs.stat(installScript, function (err) {
      if (err) {
        console.warn("NOTE: Run 'gulp transpile' before using");
        return;
      }
      require('./build/lib/install').doInstall().catch(function (err) {
        console.error(err.stack ? err.stack : err);
        process.exit(1);
      });
    });
  });
}
