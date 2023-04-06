import _ from 'lodash';
import { isStandardCap } from '@appium/base-driver';

const W3C_PREFIX = 'goog:';

/**
 *
 * @param {string} capName
 */
function toW3cCapName (capName) {
  return (_.isString(capName) && !capName.includes(':') && !isStandardCap(capName))
    ? `${W3C_PREFIX}${capName}`
    : capName;
}

/**
 *
 * @param {Record<string,any>} allCaps
 * @param {string} rawCapName
 * @param {any} defaultValue
 * @returns
 */
function getCapValue (allCaps = {}, rawCapName, defaultValue) {
  for (const [capName, capValue] of _.toPairs(allCaps)) {
    if (toW3cCapName(capName) === toW3cCapName(rawCapName)) {
      return capValue;
    }
  }
  return defaultValue;
}

/**
 *
 * @param {any} originalCaps
 * @returns {Record<string,any>}
 */
function toW3cCapNames (originalCaps = {}) {
  return _.reduce(originalCaps, (acc, value, key) => {
    acc[toW3cCapName(key)] = value;
    return acc;
  }, /** @type {Record<string,any>} */({}));
}

export { toW3cCapNames, getCapValue };
