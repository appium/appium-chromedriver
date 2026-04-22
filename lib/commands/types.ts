import type {PROTOCOLS} from '@appium/base-driver';
import type {ADB} from 'appium-adb';
import type {HTTPMethod, HTTPBody} from '@appium/types';
import type {ChromedriverOpts} from '../types';

export interface ChromedriverCommandContext {
  state: string;
  proxyPort: number;
  adb?: ADB;
  cmdArgs?: string[];
  logPath?: string;
  disableBuildCheck: boolean;
  mappingPath?: string;
  executableDir: string;
  isCustomExecutableDir: boolean;
  useSystemExecutable: boolean;
  chromedriver?: string;
  executableVerified: boolean;
  bundleId?: string;
  details?: ChromedriverOpts['details'];
  storageClient: {
    retrieveMapping: () => Promise<Record<string, {version: string; minBrowserVersion: string | null}>>;
    syncDrivers: (opts: {minBrowserVersion: number}) => Promise<string[]>;
  } | null;
  _execFunc: typeof import('teen_process').exec;
  _driverVersion: string | null;
  _onlineStatus: Record<string, any> | null;
  _desiredProtocol: keyof typeof PROTOCOLS | null;
  capabilities: Record<string, any>;
  jwproxy: {
    command: (url: string, method: HTTPMethod, body?: HTTPBody) => Promise<any>;
    sessionId: string | null;
  };
  log: {
    debug: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    prefix: string;
    errorWithException: (msg: string) => Error;
  };
  driverVersion: string | null;
}
