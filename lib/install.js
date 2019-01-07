import _ from 'lodash';
import path from 'path';
import request from 'request-promise';
import { parallel as ll } from 'asyncbox';
import { system, tempDir, fs, zip, mkdirp } from 'appium-support';
import { CD_VER } from './chromedriver';
import { CD_BASE_DIR, getChromedriverBinaryPath, getCurPlatform,
         getPlatforms, MAC_32_ONLY } from './utils';
import logger from 'fancy-log';
import semver from 'semver';


function log (line) {
  logger(`[Chromedriver Install] ${line}`);
}

const CD_CDN = process.env.npm_config_chromedriver_cdnurl ||
               process.env.CHROMEDRIVER_CDNURL ||
               'https://chromedriver.storage.googleapis.com';
const CD_PLATS = ['linux', 'win', 'mac'];
const CD_ARCHS = ['32', '64'];

async function getArchAndPlatform () {
  let arch = await system.arch();
  let platform = getCurPlatform();
  if (platform !== 'linux' && platform !== 'mac') {
    arch = '32';
  }

  const cdVer = semver.coerce(CD_VER);
  if (platform === 'mac' && semver.lt(cdVer, MAC_32_ONLY)) {
    arch = '32';
  }
  return {arch, platform};
}

function getDownloadUrl (version, platform, arch) {
  return `${CD_CDN}/${version}/chromedriver_${platform}${arch}.zip`;
}

function validatePlatform (platform, arch) {
  if (!_.includes(CD_PLATS, platform)) {
    throw new Error(`Invalid platform: ${platform}`);
  }
  if (!_.includes(CD_ARCHS, arch)) {
    throw new Error(`Invalid arch: ${arch}`);
  }
  if (arch === '64' && platform !== 'linux' && platform !== 'mac') {
    throw new Error('Only linux has a 64-bit version of Chromedriver');
  }
}

async function installForPlatform (version, platform, arch) {
  if (version === 'LATEST') {
    version = (await request.get({uri: `${CD_CDN}/LATEST_RELEASE`})).trim();
  }
  validatePlatform(platform, arch);

  const url = getDownloadUrl(version, platform, arch);

  log(`Installing Chromedriver version '${version}' for platform '${platform}' and architecture '${arch}'`);

  // set up a temp file to download the chromedriver zipfile to
  const binarySpec = `chromedriver_${platform}${arch}`;
  log(`Opening temp file to write '${binarySpec}' to...`);
  const tempFile = await tempDir.open({
    prefix: binarySpec,
    suffix: '.zip'
  });
  log(`Opened temp file '${tempFile.path}'`);

  // actually download the zipfile and write it with appropriate perms
  log(`Downloading ${url}...`);
  const body = await request.get({url, encoding: 'binary'});
  log(`Writing binary content to ${tempFile.path}...`);
  await fs.writeFile(tempFile.path, body, {encoding: 'binary'});
  await fs.chmod(tempFile.path, 0o0644);

  // extract downloaded zipfile to tempdir
  const tempUnzipped = path.resolve(path.dirname(tempFile.path), binarySpec);
  log(`Extracting ${tempFile.path} to ${tempUnzipped}`);
  await mkdirp(tempUnzipped);
  await zip.extractAllTo(tempFile.path, tempUnzipped);
  let extractedBin = path.resolve(tempUnzipped, 'chromedriver');
  if (platform === 'win') {
    extractedBin += '.exe';
  }

  // make build dirs that will hold the chromedriver binary
  log(`Creating ${path.resolve(CD_BASE_DIR, platform)}...`);
  await mkdirp(path.resolve(CD_BASE_DIR, platform));

  // copy the extracted binary to the correct build dir
  const newBin = await getChromedriverBinaryPath(platform, arch);
  log(`Copying unzipped binary, reading from ${extractedBin}...`);
  const binContents = await fs.readFile(extractedBin, {encoding: 'binary'});
  log(`Writing to ${newBin}...`);
  await fs.writeFile(newBin, binContents, {encoding: 'binary', mode: 0o755});
  log(`${newBin} successfully put in place`);
}

async function install () {
  const {arch, platform} = await getArchAndPlatform();
  await installForPlatform(CD_VER, platform, arch);
}

async function conditionalInstall () {
  const {arch, platform} = await getArchAndPlatform();
  const binPath = await getChromedriverBinaryPath(platform, arch);
  if (!await fs.exists(binPath)) {
    await installForPlatform(CD_VER, platform, arch);
  } else {
    log(`No need to install chromedriver, ${binPath} exists`);
  }
}

async function installAll () {
  let downloads = [];
  for (let [platform, arch] of getPlatforms()) {
    downloads.push(installForPlatform(CD_VER, platform, arch));
  }
  await ll(downloads);
}

async function doInstall () {
  if (_.includes(process.argv, '--all') ||
      process.env.npm_config_chromedriver_install_all) {
    await installAll();
  } else if (_.includes(process.argv, '--conditional')) {
    await conditionalInstall();
  } else {
    await install();
  }
}

export { install, installAll, conditionalInstall, doInstall };
