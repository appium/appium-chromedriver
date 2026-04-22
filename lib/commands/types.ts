import type {PROTOCOLS, JWProxy} from '@appium/base-driver';
import type {ADB} from 'appium-adb';
import type {AppiumLogger} from '@appium/types';
import type {ChromedriverOpts} from '../types';
import type {ChromedriverStorageClient} from '../storage-client/storage-client';
import type { EventEmitter } from 'node:events';

export interface ChromedriverCommandContext extends EventEmitter {
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
  storageClient: ChromedriverStorageClient | null;
  _execFunc: typeof import('teen_process').exec;
  _driverVersion: string | null;
  _onlineStatus: Record<string, any> | null;
  _desiredProtocol: keyof typeof PROTOCOLS | null;
  capabilities: Record<string, any>;
  jwproxy: JWProxy;
  log: AppiumLogger;
  driverVersion: string | null;
}
