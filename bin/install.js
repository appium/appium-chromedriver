import _ from 'lodash';
import { install, conditionalInstall, installAll } from '../lib/install';

function doInstall () {
  if (_.contains(process.argv, '--all')) {
    return installAll();
  } else if (_.contains(process.argv, '--conditional')) {
    return conditionalInstall();
  } else {
    return install();
  }
}

if (require.main === module) {
  doInstall().catch((err) => {
    console.error(err.stack);
    process.exit(1);
  });
}

export { doInstall };
