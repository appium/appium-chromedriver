import _ from 'lodash';
import path from 'path';
import fs from 'fs';
import support from 'appium-support';
import { getLogger } from 'appium-logger';
import Q from 'q';
import request from 'request-promise';
import AdmZip from 'adm-zip';
import { parallel as ll } from 'asyncbox';
import { exists } from './utils';
const { system, tempDir, util } = support;
const log = getLogger('Chromedriver Install');

const CD_VER = process.env.npm_config_chromedriver_version || "2.18";
const CD_CDN = process.env.npm_config_chromedriver_cdnurl ||
               process.env.CHROMEDRIVER_CDNURL ||
               "http://chromedriver.storage.googleapis.com";
const CD_BASE_DIR = path.resolve(__dirname, "..", "..", "chromedriver");
const CD_PLATS = ["linux", "win", "mac"];
const CD_ARCHS = ["32", "64"];

const getCurArch = Q.denodeify(system.arch);
const writeFile = Q.denodeify(fs.writeFile);
const readFile = Q.denodeify(fs.readFile);
const mkdir = Q.denodeify(fs.mkdir);
const chmod = Q.denodeify(fs.chmod);
const mkdirp = util.mkdirp;

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
      arch = await getCurArch();
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
  if (arch === "64" && platform !== "linux") {
    throw new Error("Only linux has a 64-bit version of Chromedriver");
  }
}

async function installForPlatform (version, platform, arch) {
  validatePlatform(platform, arch);
  const url = getDownloadUrl(version, platform, arch);

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
  await writeFile(tempFile.path, body, {encoding: 'binary'});
  await chmod(tempFile.path, 0o0644);

  // extract downloaded zipfile to tempdir
  let tempUnzipped = path.resolve(path.dirname(tempFile.path), binarySpec);
  log.info(`Extracting ${tempFile.path} to ${tempUnzipped}`);
  await mkdir(tempUnzipped);
  let zip = new AdmZip(tempFile.path);
  zip.extractAllTo(tempUnzipped, true);
  let extractedBin = path.resolve(tempUnzipped, "chromedriver");
  if (platform === "win") {
    extractedBin += ".exe";
  }

  // make build dirs that will hold the chromedriver binary
  log.info(`Creating ${path.resolve(CD_BASE_DIR, platform)}...`);
  await mkdirp(CD_BASE_DIR);
  await mkdirp(path.resolve(CD_BASE_DIR, platform));

  // copy the extracted binary to the correct build dir
  let newBin = await getChromedriverBinaryPath(platform, arch);
  log.info(`Copying unzipped binary, reading from ${extractedBin}...`);
  let binContents = await readFile(extractedBin, {encoding: 'binary'});
  log.info(`Writing to ${newBin}...`);
  await writeFile(newBin, binContents, {encoding: 'binary', mode: 0o755});
  log.info(`${newBin} successfully put in place`);
}

async function install () {
  let arch = await getCurArch(), platform = getCurPlatform();
  if (platform !== "linux" && arch === "64") {
    arch = "32";
  }
  await installForPlatform(CD_VER, platform, arch);
}

async function conditionalInstall () {
  let arch = await getCurArch(), platform = getCurPlatform();
  if (platform !== "linux" && arch === "64") {
    arch = "32";
  }
  let binPath = await getChromedriverBinaryPath(platform, arch);
  if (!(await exists(binPath))) {
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
    ['mac', '32']
  ];
  let downloads = [];
  for (let [platform, arch] of plats) {
    downloads.push(installForPlatform(CD_VER, platform, arch));
  }
  await ll(downloads);
}

async function doInstall () {
  if (_.contains(process.argv, '--all')) {
    await installAll();
  } else if (_.contains(process.argv, '--conditional')) {
    await conditionalInstall();
  } else {
    await install();
  }
}

export { getChromedriverBinaryPath, install, installAll, CD_BASE_DIR,
         getCurPlatform, conditionalInstall, doInstall};
