import _ from 'lodash';
import { isStandardCap } from 'appium-base-driver';

const W3C_PREFIX = 'goog:';

function toW3cCapName (capName) {
  return (_.isString(capName) && !capName.includes(':') && !isStandardCap(capName))
    ? `${W3C_PREFIX}${capName}`
    : capName;
}

function getCapValue (allCaps = {}, rawCapName, defaultValue) {
  for (const [capName, capValue] of _.toPairs(allCaps)) {
    if (toW3cCapName(capName) === toW3cCapName(rawCapName)) {
      return capValue;
    }
  }
  return defaultValue;
}

function toW3cCapNames (originalCaps = {}) {
  return _.reduce(originalCaps, (acc, value, key) => {
    acc[toW3cCapName(key)] = value;
    return acc;
  }, {});
}

export { toW3cCapNames, getCapValue };
