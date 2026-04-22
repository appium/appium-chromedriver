import {PROTOCOLS} from '@appium/base-driver';
import {toW3cCapNames, getCapValue, toW3cCapName} from '../protocol-helpers';
import {generateLogPrefix} from '../utils';
import {CHROMEDRIVER_STATES} from '../constants';
import _ from 'lodash';
import * as semver from 'semver';
import type {ChromedriverCommandContext} from './types';

const MIN_CD_VERSION_WITH_W3C_SUPPORT = 75;

export async function startSession(this: ChromedriverCommandContext): Promise<Record<string, any>> {
  const sessionCaps =
    this._desiredProtocol === PROTOCOLS.W3C
      ? {capabilities: {alwaysMatch: toW3cCapNames(this.capabilities)}}
      : {desiredCapabilities: this.capabilities};
  this.log.info(
    `Starting ${this._desiredProtocol} Chromedriver session with capabilities: ` +
      JSON.stringify(sessionCaps, null, 2),
  );
  const response = (await this.jwproxy.command('/session', 'POST', sessionCaps)) as Record<string, any>;
  this.log.prefix = generateLogPrefix(this, this.jwproxy.sessionId);
  (this as any).changeState(CHROMEDRIVER_STATES.ONLINE);
  return _.has(response, 'capabilities') && response.capabilities ? response.capabilities : response;
}

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

  const isOperaDriver = _.includes(this._onlineStatus?.message, 'OperaDriver');
  const chromeOptions = getCapValue(this.capabilities, 'chromeOptions');
  if (_.isPlainObject(chromeOptions) && chromeOptions.w3c === false) {
    this.log.info(
      `The ChromeDriver v. ${this.driverVersion} supports ${PROTOCOLS.W3C} protocol, ` +
        `but ${PROTOCOLS.MJSONWP} one has been explicitly requested`,
    );
    this._desiredProtocol = PROTOCOLS.MJSONWP;
    return this._desiredProtocol;
  } else if (isOperaDriver) {
    // OperaDriver requires explicit W3C request or it falls back to JWP.
    if (_.isPlainObject(chromeOptions)) {
      chromeOptions.w3c = true;
    } else {
      this.capabilities[toW3cCapName('chromeOptions')] = {w3c: true};
    }
  }

  this._desiredProtocol = PROTOCOLS.W3C;
  return this._desiredProtocol;
}
