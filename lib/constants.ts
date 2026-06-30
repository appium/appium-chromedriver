export const STORAGE_REQ_TIMEOUT_MS = 15000;
export const GOOGLEAPIS_CDN =
  process.env.npm_config_chromedriver_cdnurl ||
  process.env.CHROMEDRIVER_CDNURL ||
  'https://chromedriver.storage.googleapis.com';
export const USER_AGENT = 'appium';
export const CHROMELABS_URL =
  process.env.npm_config_chromelabs_url ||
  process.env.CHROMELABS_URL ||
  'https://googlechromelabs.github.io';
export const OS = {
  LINUX: 'linux',
  WINDOWS: 'win',
  MAC: 'mac',
} as const;
export const ARCH = {
  X64: '64',
  X86: '32',
} as const;
export const CPU = {
  INTEL: 'intel',
  ARM: 'arm',
} as const;
export const APPLE_ARM_SUFFIXES = ['64_m1', '_arm64'] as const;

export const CHROMEDRIVER_EVENTS = {
  ERROR: 'chromedriver_error',
  CHANGED: 'stateChanged',
} as const;

export const CHROMEDRIVER_STATES = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  ONLINE: 'online',
  STOPPING: 'stopping',
  RESTARTING: 'restarting',
} as const;

export const CHROME_BUNDLE_ID = 'com.android.chrome';

/**
 * Android runtime permissions granted to the Chrome package when `grantPermissions` is
 * enabled. These cover what web automation most commonly needs (camera for getUserMedia,
 * location for the Geolocation API, storage for download/upload) so Chrome does not
 * interrupt the session with a native permission dialog.
 */
export const DEFAULT_CHROME_PERMISSIONS = [
  'android.permission.CAMERA',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_EXTERNAL_STORAGE',
] as const;
