import _ from 'lodash';
import { install, installAll } from '../lib/install';

function main () {
  if (_.contains(process.argv, '--all')) {
    return installAll();
  } else {
    return install();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack);
    process.exit(1);
  });
}
