import _ from 'lodash';
import path from 'path';
import { getLogger } from 'appium-logger';
import request from 'request-promise';
import AdmZip from 'adm-zip';
import { parallel as ll } from 'asyncbox';
import { system, tempDir, fs } from 'appium-support';


const log = getLogger('Chromedriver Install');

const CD_VER = process.env.npm_config_chromedriver_version || "2.23";
const CD_CDN = process.env.npm_config_chromedriver_cdnurl ||
               process.env.CHROMEDRIVER_CDNURL ||
               "http://chromedriver.storage.googleapis.com";
const CD_BASE_DIR = path.resolve(__dirname, "..", "..", "chromedriver");
const CD_PLATS = ["linux", "win", "mac"];
const CD_ARCHS = ["32", "64"];

function getCurPlatform () {
  return system.isWindows() ? "win" : (system.isMac() ? "mac" : "linux");
}

function getChromedriverDir (platform = null) {
  if (!platform) {
    platform = getCurPlatform();
  }
  return path.resolve(CD_BASE_DIR, platform);
}

async function getChromedriverBinaryPath (platform = null, arch = null) {
  if (!platform) {
    platform = getCurPlatform();
  }
  const baseDir = getChromedriverDir(platform);
  let ext = "";
  if (platform === "win") {
    ext = ".exe";
  } else if (platform === "linux") {
    if (!arch) {
      arch = await system.arch();
    }
    ext = "_" + arch;
  }
  return path.resolve(baseDir, `chromedriver${ext}`);
}

function getDownloadUrl (version, platform, arch) {
  return `${CD_CDN}/${version}/chromedriver_${platform}${arch}.zip`;
}

function validatePlatform (platform, arch) {
  if (!_.contains(CD_PLATS, platform)) {
    throw new Error(`Invalid platform: ${platform}`);
  }
  if (!_.contains(CD_ARCHS, arch)) {
    throw new Error(`Invalid arch: ${arch}`);
  }
  if (arch === "64" && platform !== "linux" && platform !== "mac") {
    throw new Error("Only linux and mac have a 64-bit version of Chromedriver");
  }
}

async function installForPlatform (version, platform, arch) {
  validatePlatform(platform, arch);
  const url = getDownloadUrl(version, platform, arch);

  log.info(`Installing Chromedriver version '${version}' for platform '${platform}' and architecture '${arch}'`);

  // set up a temp file to download the chromedriver zipfile to
  let binarySpec = `chromedriver_${platform}${arch}`;
  log.info(`Opening temp file to write ${binarySpec} to...`);
  let tempFile = await tempDir.open({
    prefix: binarySpec,
    suffix: '.zip'
  });

  // actually download the zipfile and write it with appropriate perms
  log.info(`Downloading ${url}...`);
  let body = await request.get({url, encoding: 'binary'});
  log.info(`Writing binary content to ${tempFile.path}...`);
  await fs.writeFile(tempFile.path, body, {encoding: 'binary'});
  await fs.chmod(tempFile.path, 0o0644);

  // extract downloaded zipfile to tempdir
  let tempUnzipped = path.resolve(path.dirname(tempFile.path), binarySpec);
  log.info(`Extracting ${tempFile.path} to ${tempUnzipped}`);
  await fs.mkdir(tempUnzipped);
  let zip = new AdmZip(tempFile.path);
  zip.extractAllTo(tempUnzipped, true);
  let extractedBin = path.resolve(tempUnzipped, "chromedriver");
  if (platform === "win") {
    extractedBin += ".exe";
  }

  // make build dirs that will hold the chromedriver binary
  log.info(`Creating ${path.resolve(CD_BASE_DIR, platform)}...`);
  await fs.mkdir(CD_BASE_DIR);
  await fs.mkdir(path.resolve(CD_BASE_DIR, platform));

  // copy the extracted binary to the correct build dir
  let newBin = await getChromedriverBinaryPath(platform, arch);
  log.info(`Copying unzipped binary, reading from ${extractedBin}...`);
  let binContents = await fs.readFile(extractedBin, {encoding: 'binary'});
  log.info(`Writing to ${newBin}...`);
  await fs.writeFile(newBin, binContents, {encoding: 'binary', mode: 0o755});
  log.info(`${newBin} successfully put in place`);
}

async function install () {
  let arch = await system.arch(), platform = getCurPlatform();
  if (platform !== "linux" && platform !== "mac" && arch === "64") {
    arch = "32";
  }
  await installForPlatform(CD_VER, platform, arch);
}

async function conditionalInstall () {
  let arch = await system.arch(), platform = getCurPlatform();
  if (platform !== "linux" && platform !== "mac" && arch === "64") {
    arch = "32";
  }
  let binPath = await getChromedriverBinaryPath(platform, arch);
  if (!await fs.exists(binPath)) {
    await installForPlatform(CD_VER, platform, arch);
  } else {
    log.info(`No need to install chromedriver, ${binPath} exists`);
  }
}

async function installAll () {
  const plats = [
    ['linux', '32'],
    ['linux', '64'],
    ['win', '32'],
    ['mac', '64']
  ];
  let downloads = [];
  for (let [platform, arch] of plats) {
    downloads.push(installForPlatform(CD_VER, platform, arch));
  }
  await ll(downloads);
}

async function doInstall () {
  if (_.contains(process.argv, '--all') ||
      process.env.npm_config_chromedriver_install_all) {
    await installAll();
  } else if (_.contains(process.argv, '--conditional')) {
    await conditionalInstall();
  } else {
    await install();
  }
}

export { getChromedriverBinaryPath, install, installAll, CD_BASE_DIR,
         getCurPlatform, conditionalInstall, doInstall };
