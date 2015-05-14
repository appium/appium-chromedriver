import Q from 'q';
import fs from 'fs';

async function exists (p) {
  try {
    await Q.denodeify(fs.stat)(p);
  } catch (e) {
    if (e.code === "ENOENT") {
      return false;
    } else {
      throw e;
    }
  }
  return true;
}

export { exists };
