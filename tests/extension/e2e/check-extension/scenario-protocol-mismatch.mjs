import assert from "node:assert/strict";
import { createSyntheticRsi, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { changeHostedFile } from "./answers-to-browser-requests.mjs";
import { openDashboard } from "./dashboard-pages-and-builds.mjs";
import { HOSTED_ORIGIN } from "./origins-keys-and-stand-in-image.mjs";
import { pause } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { storedState } from "./stored-state-alarms-and-saved-files.mjs";

const SHIPPED = "const PROTOCOL_VERSION = 2;";

// A dashboard of another connection version meets the real extension (PARSER_HARDENING.md §11.2 row 1, D16, §15.5):
// it shows UPDATE REQUIRED, and nothing it asks starts a run or reaches RSI.
export async function protocolMismatch() {
  const account = createSyntheticRsi({ handle: "MismatchCitizen" });
  setRsi(account);
  const before = (await storedState())?.status ?? null;
  changeHostedFile((pathname, bytes) => {
    if (pathname !== "/scripts/dashboard.js") return bytes;
    const source = bytes.toString("utf8");
    assert.equal(source.split(SHIPPED).length, 2, `The dashboard no longer writes its connection version as this check expects: ${SHIPPED}`);
    return Buffer.from(source.replace(SHIPPED, "const PROTOCOL_VERSION = 3;"));
  });
  const hosted = await openDashboard(`${HOSTED_ORIGIN}/`);
  try {
    await hosted.waitFor("document.getElementById('overlaySummary').textContent === 'UPDATE REQUIRED'", 15000, "the dashboard to show that it does not match the extension");
    const shown = await hosted.evaluate("({ state: document.getElementById('overlayState').textContent, detail: document.getElementById('overlayDetail').textContent, dialog: document.getElementById('messageDialog').open })");
    assertStep(shown.state === "Extension and dashboard do not match" && /^CitizenData extension [0-9.]+ uses a different connection version than this page\./u.test(shown.detail),
      `The mismatch is not told as §11 writes it: ${JSON.stringify(shown)}`);
    // The user tries anyway: Build, and the account backup if it is offered.
    await hosted.evaluate("document.getElementById('messageDialog').open && document.getElementById('messageDialog').close(); document.getElementById('buildButton').click(); true");
    await pause(500);
    await hosted.evaluate("(() => { const action = document.getElementById('buildAccountAction'); if (action && action.getClientRects().length > 0 && !action.disabled) action.click(); return true; })()");
    await pause(2000);
    assert.equal(account.requests.length, 0, "A dashboard of another connection version reached RSI.");
    assert.equal((await storedState())?.status ?? null, before, "A dashboard of another connection version changed the extension's state.");
    return { detail: shown.detail };
  } finally {
    changeHostedFile(null);
    await hosted.close();
  }
}
