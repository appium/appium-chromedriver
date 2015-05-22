var _ require('lodash');
var doInstall = require('./lib/install').doInstall;

doInstall().catch((err) => {
  console.error(err.stack);
  process.exit(1);
});
