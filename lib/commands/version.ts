import * as semver from 'semver';
import {getChromeVersion} from '../utils';
import type {ChromedriverCommandContext} from './types';

const CHROME_BUNDLE_ID = 'com.android.chrome';
const WEBVIEW_SHELL_BUNDLE_ID = 'org.chromium.webview_shell';
const WEBVIEW_BUNDLE_IDS = ['com.google.android.webview', 'com.android.webview'] as const;
const VERSION_PATTERN = /([\d.]+)/;

/**
 * Detects Chrome/WebView version to drive Chromedriver compatibility matching.
 */
export async function getChromeVersionForAutodetection(
  this: ChromedriverCommandContext,
): Promise<semver.SemVer | null> {
  // Prefer already-collected CDP details when available.
  const fromDetails = tryCoerceVersionFromCdpDetails(this);
  if (fromDetails) {
    return fromDetails;
  }

  // In WebView shell mode, probe known system webview packages first.
  if (this.bundleId === WEBVIEW_SHELL_BUNDLE_ID) {
    return await resolveChromeVersionForWebviewShell(this);
  }

  // Android 7-9 webviews are backed by main Chrome package.
  await remapLegacyWebviewBundleId(this);

  // Default to generic Chrome and fall back to known webview providers.
  let chromeVersion: string | null = await resolveChromeVersionByProbingWebviews(this);

  // If no webview package matched, check the selected/default bundle id directly.
  if (!chromeVersion && this.adb) {
    const bundleId = this.bundleId ?? CHROME_BUNDLE_ID;
    chromeVersion = (await getChromeVersion(this.adb, bundleId)) ?? null;
  }
  return chromeVersion ? semver.coerce(chromeVersion) : null;
}

function tryCoerceVersionFromCdpDetails(ctx: ChromedriverCommandContext): semver.SemVer | null {
  if (ctx.details?.info) {
    ctx.log.debug(`Browser version in the supplied details: ${ctx.details?.info?.Browser}`);
  }
  const versionMatch = VERSION_PATTERN.exec(ctx.details?.info?.Browser ?? '');
  if (!versionMatch) {
    return null;
  }
  return semver.coerce(versionMatch[1]);
}

async function resolveChromeVersionForWebviewShell(
  ctx: ChromedriverCommandContext,
): Promise<semver.SemVer | null> {
  if (!ctx.adb) {
    return null;
  }
  for (const bundleId of WEBVIEW_BUNDLE_IDS) {
    const chromeVersion = await getChromeVersion(ctx.adb, bundleId);
    if (chromeVersion) {
      ctx.bundleId = bundleId;
      return semver.coerce(chromeVersion);
    }
  }
  return null;
}

async function remapLegacyWebviewBundleId(ctx: ChromedriverCommandContext): Promise<void> {
  if (!ctx.adb) {
    return;
  }
  const apiLevel = await ctx.adb.getApiLevel();
  const isLegacyWebviewBundle = [WEBVIEW_SHELL_BUNDLE_ID, ...WEBVIEW_BUNDLE_IDS].includes(
    ctx.bundleId ?? '',
  );
  if (apiLevel >= 24 && apiLevel <= 28 && isLegacyWebviewBundle) {
    ctx.bundleId = CHROME_BUNDLE_ID;
  }
}

/**
 * When no bundle id is set, default to Chrome and probe known WebView providers.
 * Returns a version string if a WebView package reports one; otherwise leaves bundleId as Chrome.
 */
async function resolveChromeVersionByProbingWebviews(
  ctx: ChromedriverCommandContext,
): Promise<string | null> {
  if (ctx.bundleId) {
    return null;
  }
  ctx.bundleId = CHROME_BUNDLE_ID;
  if (!ctx.adb) {
    return null;
  }
  for (const bundleId of WEBVIEW_BUNDLE_IDS) {
    const chromeVersion = await getChromeVersion(ctx.adb, bundleId);
    if (chromeVersion) {
      ctx.bundleId = bundleId;
      return chromeVersion;
    }
  }
  return null;
}
