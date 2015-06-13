var fs = require('fs')
  , path = require('path');

if (require.main === module) {
  // check if cur dir exists
  var installScript = path.resolve(__dirname, "build", "lib",
     "install.js");
  fs.stat(installScript, function (err) {
    if (err) {
      console.warn("NOTE: Run 'npm run-script chromedriver' before using");
      return;
    }
    require('./build/lib/install').doInstall().catch(function (err) {
      console.error(err.stack ? err.stack : err);
      process.exit(1);
    });
  });
}
