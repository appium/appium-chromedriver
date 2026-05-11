import {PROTOCOLS, isStandardCap} from '@appium/base-driver';
import {util} from '@appium/support';
import {generateLogPrefix} from '../utils';
import {CHROMEDRIVER_EVENTS, CHROMEDRIVER_STATES} from '../constants';
import * as semver from 'semver';
import type {ChromedriverCommandContext} from './types';

const MIN_CD_VERSION_WITH_W3C_SUPPORT = 75;
const W3C_PREFIX = 'goog:';

export type SessionCapabilities = Record<string, any>;

/**
 * Converts a capability name to W3C format by adding the 'goog:' prefix if needed.
 */
export function toW3cCapName(capName: string): string {
  return typeof capName === 'string' && !capName.includes(':') && !isStandardCap(capName)
    ? `${W3C_PREFIX}${capName}`
    : capName;
}

/**
 * Gets a capability value from a capabilities object, handling both standard and W3C format names.
 */
export function getCapValue(
  allCaps: Record<string, any> = {},
  rawCapName: string,
  defaultValue?: any,
): any {
  for (const [capName, capValue] of Object.entries(allCaps)) {
    if (toW3cCapName(capName) === toW3cCapName(rawCapName)) {
      return capValue;
    }
  }
  return defaultValue;
}

/**
 * Converts all capability names in an object to W3C format.
 */
export function toW3cCapNames(originalCaps: Record<string, any> = {}): Record<string, any> {
  return Object.fromEntries(
    Object.entries(originalCaps).map(([key, value]) => [toW3cCapName(key), value]),
  );
}

/**
 * Creates a new Chromedriver session using the negotiated downstream protocol.
 */
export async function startSession(this: ChromedriverCommandContext): Promise<SessionCapabilities> {
  const sessionCaps =
    this._desiredProtocol === PROTOCOLS.W3C
      ? {capabilities: {alwaysMatch: toW3cCapNames(this.capabilities)}}
      : {desiredCapabilities: this.capabilities};
  this.log.info(
    `Starting ${this._desiredProtocol} Chromedriver session with capabilities: ` +
      JSON.stringify(sessionCaps, null, 2),
  );
  const response = (await this.jwproxy.command('/session', 'POST', sessionCaps)) as Record<
    string,
    any
  >;
  this.log.prefix = generateLogPrefix(this, this.jwproxy.sessionId);
  changeState.call(this, CHROMEDRIVER_STATES.ONLINE);
  return response?.capabilities ?? response;
}

/**
 * Chooses W3C or MJSONWP protocol based on driver/capability constraints.
 */
export function syncProtocol(this: ChromedriverCommandContext): keyof typeof PROTOCOLS {
  if (this.driverVersion) {
    const coercedVersion = semver.coerce(this.driverVersion);
    if (!coercedVersion || coercedVersion.major < MIN_CD_VERSION_WITH_W3C_SUPPORT) {
      this.log.info(
        `The ChromeDriver v. ${this.driverVersion} does not fully support ${PROTOCOLS.W3C} protocol. ` +
          `Defaulting to ${PROTOCOLS.MJSONWP}`,
      );
      this._desiredProtocol = PROTOCOLS.MJSONWP;
      return this._desiredProtocol;
    }
  }

  const statusMsg = this._onlineStatus?.message;
  const isOperaDriver = typeof statusMsg === 'string' && statusMsg.includes('OperaDriver');
  const chromeOptions = getCapValue(this.capabilities, 'chromeOptions');
  if (util.isPlainObject(chromeOptions) && chromeOptions.w3c === false) {
    this.log.info(
      `The ChromeDriver v. ${this.driverVersion} supports ${PROTOCOLS.W3C} protocol, ` +
        `but ${PROTOCOLS.MJSONWP} one has been explicitly requested`,
    );
    this._desiredProtocol = PROTOCOLS.MJSONWP;
    return this._desiredProtocol;
  } else if (isOperaDriver) {
    // OperaDriver requires explicit W3C request or it falls back to JWP.
    if (util.isPlainObject(chromeOptions)) {
      chromeOptions.w3c = true;
    } else {
      this.capabilities[toW3cCapName('chromeOptions')] = {w3c: true};
    }
  }

  this._desiredProtocol = PROTOCOLS.W3C;
  return this._desiredProtocol;
}

/**
 * Updates driver state and emits state-change event payload.
 */
export function changeState(this: ChromedriverCommandContext, state: string): void {
  this.state = state;
  this.log.debug(`Changed state to '${state}'`);
  this.emit(CHROMEDRIVER_EVENTS.CHANGED, {state});
}
