async function getChromeVersion (adb, bundleId) {
  const output = await adb.getPackageInfo(bundleId);
  return output.versionName;
}

export { getChromeVersion };
