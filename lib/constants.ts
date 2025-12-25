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

