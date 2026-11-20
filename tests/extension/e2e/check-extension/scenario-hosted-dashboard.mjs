import assert from "node:assert/strict";
import { extensionPage } from "./browser-pages-and-account-in-use.mjs";
import { offersAccount, waitForChooser } from "./build-chooser.mjs";
import { openDashboard } from "./dashboard-pages-and-builds.mjs";
import { HOSTED_ORIGIN } from "./origins-keys-and-stand-in-image.mjs";

export async function hostedDashboard() {
  const hosted = await openDashboard(`${HOSTED_ORIGIN}/`);
  try {
    // The published site needs no approval and never shows the local-copy notice.
    await waitForChooser(hosted, offersAccount, "the hosted dashboard to be offered the account backup");
    const pending = await extensionPage.evaluate("chrome.storage.session.get('citizendata.localPending.v1').then((stored) => Object.keys(stored['citizendata.localPending.v1'] ?? {}).length)");
    assert.equal(pending, 0, "The hosted dashboard must not create an approval request.");
  } finally {
    await hosted.close();
  }
}
