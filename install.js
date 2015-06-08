var doInstall = require('./build/lib/install').doInstall;

doInstall().catch(function (err) {
  console.error(err.stack);
  process.exit(1);
});
