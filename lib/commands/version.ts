import * as semver from 'semver';
import {getChromeVersion} from '../utils';
import type {ChromedriverCommandContext} from './types';

const CHROME_BUNDLE_ID = 'com.android.chrome';
const WEBVIEW_SHELL_BUNDLE_ID = 'org.chromium.webview_shell';
const WEBVIEW_BUNDLE_IDS = ['com.google.android.webview', 'com.android.webview'] as const;
const VERSION_PATTERN = /([\d.]+)/;

export async function getChromeVersionForAutodetection(
  this: ChromedriverCommandContext,
): Promise<semver.SemVer | null> {
  // Prefer already-collected CDP details when available.
  if (this.details?.info) {
    this.log.debug(`Browser version in the supplied details: ${this.details?.info?.Browser}`);
  }
  const versionMatch = VERSION_PATTERN.exec(this.details?.info?.Browser ?? '');
  if (versionMatch) {
    const coercedVersion = semver.coerce(versionMatch[1]);
    if (coercedVersion) {
      return coercedVersion;
    }
  }

  let chromeVersion: string | undefined;
  // In WebView shell mode, probe known system webview packages first.
  if (this.bundleId === WEBVIEW_SHELL_BUNDLE_ID) {
    if (this.adb) {
      for (const bundleId of WEBVIEW_BUNDLE_IDS) {
        chromeVersion = await getChromeVersion(this.adb, bundleId);
        if (chromeVersion) {
          this.bundleId = bundleId;
          return semver.coerce(chromeVersion);
        }
      }
    }
    return null;
  }

  if (this.adb) {
    // Android 7-9 webviews are backed by main Chrome package.
    const apiLevel = await this.adb.getApiLevel();
    if (
      apiLevel >= 24 &&
      apiLevel <= 28 &&
      [WEBVIEW_SHELL_BUNDLE_ID, ...WEBVIEW_BUNDLE_IDS].includes(this.bundleId ?? '')
    ) {
      this.bundleId = CHROME_BUNDLE_ID;
    }
  }

  if (!this.bundleId) {
    // Default to generic Chrome and fall back to known webview providers.
    this.bundleId = CHROME_BUNDLE_ID;
    for (const bundleId of WEBVIEW_BUNDLE_IDS) {
      if (this.adb) {
        chromeVersion = await getChromeVersion(this.adb, bundleId);
        if (chromeVersion) {
          this.bundleId = bundleId;
          break;
        }
      }
    }
  }

  if (!chromeVersion && this.adb) {
    // If no webview package matched, check the selected/default bundle id directly.
    chromeVersion = await getChromeVersion(this.adb, this.bundleId);
  }
  return chromeVersion ? semver.coerce(chromeVersion) : null;
}
