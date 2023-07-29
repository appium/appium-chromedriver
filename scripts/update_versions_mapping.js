const fs = require('fs/promises');
const _ = require('lodash');

async function main () {
  const [latestVersion, jsonPath] = process.argv.slice(2);
  if (!latestVersion) {
    throw new Error(
      'The latest Chromedriver version must be provided as the first command line argument'
    );
  }
  if (!jsonPath) {
    throw new Error(
      'The path to the versions mapping json must be provided as the second command line argument'
    );
  }

  const json = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  if (latestVersion in json) {
    process.stdout.write('0');
    return;
  }

  const pairs = _.toPairs(json);
  pairs.unshift([latestVersion, latestVersion]);
  await fs.writeFile(jsonPath, JSON.stringify(_.fromPairs(pairs), null, 2), 'utf8');
  process.stdout.write('1');
}

(async () => await main())();
