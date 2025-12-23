import _ from 'lodash';
import {isStandardCap} from '@appium/base-driver';

const W3C_PREFIX = 'goog:';

/**
 * Converts a capability name to W3C format by adding the 'goog:' prefix if needed.
 * @param capName - The capability name to convert.
 * @returns The W3C-formatted capability name.
 */
export function toW3cCapName(capName: string): string {
  return (_.isString(capName) && !capName.includes(':') && !isStandardCap(capName))
    ? `${W3C_PREFIX}${capName}`
    : capName;
}

/**
 * Gets a capability value from a capabilities object, handling both standard and W3C format names.
 * @param allCaps - The capabilities object to search in.
 * @param rawCapName - The capability name to look for (can be in either format).
 * @param defaultValue - Optional default value to return if the capability is not found.
 * @returns The capability value or the default value.
 */
export function getCapValue(allCaps: Record<string, any> = {}, rawCapName: string, defaultValue?: any): any {
  for (const [capName, capValue] of _.toPairs(allCaps)) {
    if (toW3cCapName(capName) === toW3cCapName(rawCapName)) {
      return capValue;
    }
  }
  return defaultValue;
}

/**
 * Converts all capability names in an object to W3C format.
 * @param originalCaps - The original capabilities object.
 * @returns A new object with W3C-formatted capability names.
 */
export function toW3cCapNames(originalCaps: Record<string, any> = {}): Record<string, any> {
  return _.reduce(originalCaps, (acc, value, key) => {
    acc[toW3cCapName(key)] = value;
    return acc;
  }, {} as Record<string, any>);
}

