import _ from 'lodash';
import xpath from 'xpath';
import {util, logger} from '@appium/support';
import {retrieveData} from '../utils';
import B from 'bluebird';
import {
  STORAGE_REQ_TIMEOUT_MS,
  GOOGLEAPIS_CDN,
  ARCH,
  CPU,
  APPLE_ARM_SUFFIXES,
} from '../constants';
import {DOMParser, MIME_TYPE} from '@xmldom/xmldom';
import path from 'node:path';


const log = logger.getLogger('ChromedriverGoogleapisStorageClient');
const MAX_PARALLEL_DOWNLOADS = 5;

/**
 *
 * @param {Node|Attr} parent
 * @param {string?} childName
 * @param {string?} text
 * @returns
 */
export function findChildNode(parent, childName = null, text = null) {
  if (!childName && !text) {
    return null;
  }
  if (!parent.hasChildNodes()) {
    return null;
  }

  for (let childNodeIdx = 0; childNodeIdx < parent.childNodes.length; childNodeIdx++) {
    const childNode = /** @type {Element|Attr} */ (parent.childNodes[childNodeIdx]);
    if (childName && !text && childName === childNode.localName) {
      return childNode;
    }
    if (text) {
      const childText = extractNodeText(childNode);
      if (!childText) {
        continue;
      }
      if (childName && childName === childNode.localName && text === childText) {
        return childNode;
      }
      if (!childName && text === childText) {
        return childNode;
      }
    }
  }
  return null;
}

/**
 *
 * @param {Node?} node
 * @returns
 */
function extractNodeText(node) {
  return !node || !node.firstChild || !util.hasValue(node.firstChild.nodeValue)
    ? null
    : node.firstChild.nodeValue;
}

/**
 * Gets additional chromedriver details from chromedriver
 * release notes
 *
 * @param {string} content - Release notes of the corresponding chromedriver
 * @returns {import('../types').AdditionalDriverDetails}
 */
export function parseNotes(content) {
  const result = {};
  const versionMatch = /^\s*[-]+ChromeDriver[\D]+([\d.]+)/im.exec(content);
  if (versionMatch) {
    result.version = versionMatch[1];
  }
  const minBrowserVersionMatch = /^\s*Supports Chrome[\D]+(\d+)/im.exec(content);
  if (minBrowserVersionMatch) {
    result.minBrowserVersion = minBrowserVersionMatch[1];
  }
  return result;
}

/**
 * Parses chromedriver storage XML and returns
 * the parsed results
 *
 * @param {string} xml - The chromedriver storage XML
 * @param {boolean} shouldParseNotes [true] - If set to `true`
 * then additional drivers information is going to be parsed
 * and assigned to `this.mapping`
 * @returns {Promise<ChromedriverDetailsMapping>}
 */
export async function parseGoogleapiStorageXml(xml, shouldParseNotes = true) {
  const doc = new DOMParser().parseFromString(xml, MIME_TYPE?.XML_TEXT ?? 'text/xml');
  const driverNodes = /** @type {Array<Node|Attr>} */ (
    // @ts-expect-error Misssing Node properties are not needed.
    // https://github.com/xmldom/xmldom/issues/724
    xpath.select(`//*[local-name(.)='Contents']`, doc)
  );
  log.debug(`Parsed ${driverNodes.length} entries from storage XML`);
  if (_.isEmpty(driverNodes)) {
    throw new Error('Cannot retrieve any valid Chromedriver entries from the storage config');
  }

  const promises = [];
  const chunk = [];
  /** @type {ChromedriverDetailsMapping} */
  const mapping = {};
  for (const driverNode of driverNodes) {
    const k = extractNodeText(findChildNode(driverNode, 'Key'));
    if (!_.includes(k, '/chromedriver_')) {
      continue;
    }
    const key = String(k);

    const etag = extractNodeText(findChildNode(driverNode, 'ETag'));
    if (!etag) {
      log.debug(`The entry '${key}' does not contain the checksum. Skipping it`);
      continue;
    }

    const filename = path.basename(key);
    const osNameMatch = /_([a-z]+)/i.exec(filename);
    if (!osNameMatch) {
      log.debug(`The entry '${key}' does not contain valid OS name. Skipping it`);
      continue;
    }

    /** @type {ChromedriverDetails} */
    const cdInfo = {
      url: `${GOOGLEAPIS_CDN}/${key}`,
      etag: _.trim(etag, '"'),
      version: /** @type {string} */ (_.first(key.split('/'))),
      minBrowserVersion: null,
      os: {
        name: osNameMatch[1],
        arch: filename.includes(ARCH.X64) ? ARCH.X64 : ARCH.X86,
        cpu: APPLE_ARM_SUFFIXES.some((suffix) => filename.includes(suffix)) ? CPU.ARM : CPU.INTEL,
      }
    };
    mapping[key] = cdInfo;

    const notesPath = `${cdInfo.version}/notes.txt`;
    const isNotesPresent = !!driverNodes.reduce(
      (acc, node) => Boolean(acc || findChildNode(node, 'Key', notesPath)),
      false
    );
    if (!isNotesPresent) {
      cdInfo.minBrowserVersion = null;
      if (shouldParseNotes) {
        log.info(`The entry '${key}' does not contain any notes. Skipping it`);
      }
      continue;
    } else if (!shouldParseNotes) {
      continue;
    }

    const promise = B.resolve(retrieveAdditionalDriverInfo(key, `${GOOGLEAPIS_CDN}/${notesPath}`, cdInfo));
    promises.push(promise);
    chunk.push(promise);
    if (chunk.length >= MAX_PARALLEL_DOWNLOADS) {
      await B.any(chunk);
    }
    _.remove(chunk, (p) => p.isFulfilled());
  }
  await B.all(promises);
  log.info(`The total count of entries in the mapping: ${_.size(mapping)}`);
  return mapping;
}

/**
 * Downloads chromedriver release notes and puts them
 * into the dictionary argument
 *
 * The method call mutates by merging `AdditionalDriverDetails`
 * @param {string} driverKey - Driver version plus archive name
 * @param {string} notesUrl - The URL of chromedriver notes
 * @param {ChromedriverDetails} infoDict - The dictionary containing driver info.
 * @param {number} timeout
 * @throws {Error} if the release notes cannot be downloaded
 */
async function retrieveAdditionalDriverInfo(driverKey, notesUrl, infoDict, timeout = STORAGE_REQ_TIMEOUT_MS) {
  const notes = await retrieveData(
    notesUrl,
    {
      'user-agent': 'appium',
      accept: '*/*',
    },
    {timeout}
  );
  const {minBrowserVersion} = parseNotes(notes);
  if (!minBrowserVersion) {
    log.debug(
      `The driver '${driverKey}' does not contain valid release notes at ${notesUrl}. ` +
        `Skipping it`
    );
    return;
  }
  infoDict.minBrowserVersion = minBrowserVersion;
}

/**
 * @typedef {import('../types').SyncOptions} SyncOptions
 * @typedef {import('../types').OSInfo} OSInfo
 * @typedef {import('../types').ChromedriverDetails} ChromedriverDetails
 * @typedef {import('../types').ChromedriverDetailsMapping} ChromedriverDetailsMapping
 */
