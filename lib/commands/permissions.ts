import {CHROME_BUNDLE_ID} from '../constants';
import type {Chromedriver} from '../chromedriver';

/**
 * Grants all Android runtime permissions declared by the Chrome package, so the session is
 * not interrupted by a native permission dialog (geolocation, camera, file access, ...).
 *
 * Invoked before the Chromedriver process starts (and thus before Chrome is launched) when the
 * `grantPermissions` option is enabled. Because the grant was requested explicitly, any failure
 * is propagated rather than swallowed.
 *
 * @throws If `adb` is not available or the permissions could not be granted.
 */
export async function grantChromePermissions(this: Chromedriver): Promise<void> {
  if (!this.adb) {
    throw new Error(
      `Cannot grant permissions to the Chrome package: the 'grantPermissions' option ` +
        `requires an 'adb' instance, which is not available.`,
    );
  }
  const bundleId = this.bundleId ?? CHROME_BUNDLE_ID;
  await this.adb.grantAllPermissions(bundleId);
}
