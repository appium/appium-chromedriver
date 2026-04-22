import cp from 'node:child_process';
import {system} from '@appium/support';
import {retryInterval} from 'asyncbox';
import B from 'bluebird';
import _ from 'lodash';
import {CHROMEDRIVER_STATES} from '../constants';
import type {ChromedriverCommandContext} from './types';

const VERSION_PATTERN = /([\d.]+)/;

export function buildChromedriverArgs(this: ChromedriverCommandContext): string[] {
  const args = [`--port=${this.proxyPort}`];
  if (this.adb?.adbPort) {
    args.push(`--adb-port=${this.adb.adbPort}`);
  }
  if (_.isArray(this.cmdArgs)) {
    args.push(...this.cmdArgs);
  }
  if (this.logPath) {
    args.push(`--log-path=${this.logPath}`);
  }
  if (this.disableBuildCheck) {
    args.push('--disable-build-check');
  }
  args.push('--verbose');
  return args;
}

export async function getStatus(this: ChromedriverCommandContext): Promise<any> {
  return await this.jwproxy.command('/status', 'GET');
}

export async function waitForOnline(this: ChromedriverCommandContext): Promise<void> {
  let chromedriverStopped = false;
  await retryInterval(20, 200, async () => {
    if (this.state === CHROMEDRIVER_STATES.STOPPED) {
      chromedriverStopped = true;
      return;
    }
    const status: any = await getStatus.call(this);
    if (!_.isPlainObject(status) || !status.ready) {
      throw new Error(`The response to the /status API is not valid: ${JSON.stringify(status)}`);
    }
    this._onlineStatus = status;
    const versionMatch = VERSION_PATTERN.exec(status.build?.version ?? '');
    if (versionMatch) {
      this._driverVersion = versionMatch[1];
      this.log.info(`Chromedriver version: ${this._driverVersion}`);
    } else {
      this.log.info('Chromedriver version cannot be determined from the /status API response');
    }
  });
  if (chromedriverStopped) {
    throw new Error('ChromeDriver crashed during startup.');
  }
}

export async function killAll(this: ChromedriverCommandContext): Promise<void> {
  const cmd = system.isWindows()
    ? `wmic process where "commandline like '%chromedriver.exe%--port=${this.proxyPort}%'" delete`
    : `pkill -15 -f "${this.chromedriver}.*--port=${this.proxyPort}"`;
  this.log.debug(`Killing any old chromedrivers, running: ${cmd}`);
  try {
    await B.promisify(cp.exec)(cmd);
    this.log.debug('Successfully cleaned up old chromedrivers');
  } catch {
    this.log.warn('No old chromedrivers seem to exist');
  }

  if (this.adb) {
    const udidIndex = this.adb.executable.defaultArgs.findIndex((item: string) => item === '-s');
    const udid = udidIndex > -1 ? this.adb.executable.defaultArgs[udidIndex + 1] : null;
    if (udid) {
      this.log.debug(`Cleaning this device's adb forwarded port socket connections: ${udid}`);
    } else {
      this.log.debug(`Cleaning any old adb forwarded port socket connections`);
    }

    try {
      for (const conn of await this.adb.getForwardList()) {
        if (!(conn.includes('webview_devtools') && (!udid || conn.includes(udid)))) {
          continue;
        }
        const params = conn.split(/\s+/);
        if (params.length > 1) {
          await this.adb.removePortForward(params[1].replace(/[\D]*/, ''));
        }
      }
    } catch (e) {
      const err = e as Error;
      this.log.warn(`Unable to clean forwarded ports. Error: '${err.message}'. Continuing.`);
    }
  }
}
