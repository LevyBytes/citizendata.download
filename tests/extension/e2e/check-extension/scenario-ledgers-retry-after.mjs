import assert from "node:assert/strict";
import { createSyntheticRsi, dashboard, extensionPage, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { assertCompleteDocument } from "./complete-document-expectations.mjs";
import { freshDashboard, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { reach, refuseRsiWhen } from "./held-rsi-requests.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { storedState, waitForExportedFile } from "./stored-state-alarms-and-saved-files.mjs";

const LEDGER_PATHS = new Set(["/api/account/creditLog", "/api/account/uecLog", "/api/account/recLog"]);
const LIMITED = "Potential website issue or rate limiting. Slowing down.";
// A test-only Retry-After, short so the suite waits it out in real time; the production waits of 60 seconds and 20
// minutes are proven on the virtual clock (service-worker-ledger-retry-after-waits-on-the-clock.test.mjs).
const RETRY_AFTER_SECONDS = 3;

// The running job's pace, as the service worker stored it.
function runningPace() {
  return extensionPage.evaluate("chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'EXPORT_BACKUP' }).then(({ backup }) => backup.stores.jobs.find((job) => job.status === 'running')?.pace ?? null)");
}

// RSI holds a limit in Financial ledgers (PARSER_HARDENING.md §15.5): every ledger request in the Retry-After window
// after the first is answered 429 with that Retry-After. The service worker reads the header in real Chrome and waits it out,
// the real Build Status panel shows the caution tape meanwhile, and the build then completes. A ledger request sent
// inside the window would have been refused too, so one refusal shows that none was. The user closes the panel
// while it brakes; it stays closed through the warning and the completion, and Build opens it again.
export async function ledgersRetryAfter() {
  await freshDashboard();
  const account = createSyntheticRsi({ handle: "LedgerCitizen", counts: { pledges: 6, buybacks: 4, orders: 2, storeCredit: 12, uec: 6, rec: 4 } });
  setRsi(account);
  const limit = refuseRsiWhen((request) => LEDGER_PATHS.has(new URL(request.url).pathname), { status: 429, retryAfterSeconds: RETRY_AFTER_SECONDS, forMs: RETRY_AFTER_SECONDS * 1000 });
  try {
    await startBuild(dashboard);
    await reach(limit, "the build to reach Financial ledgers", 120000);
    await dashboard.waitFor(
      `!document.getElementById('parserOverlay').hidden && document.getElementById('cautionTape').classList.contains('is-active') && document.getElementById('cautionTapeText').textContent === ${JSON.stringify(LIMITED)}`,
      15000, "the caution tape in the Build Status panel while the build waits out the limit"
    );
    let pace = null;
    for (const deadline = Date.now() + 8000; !pace?.lastSignal;) {
      assertStep(Date.now() < deadline, "The running job did not record the refusal.");
      pace = await runningPace();
    }
    const waitedMs = Date.parse(pace.retryNotBefore) - Date.parse(pace.lastRefusalAt);
    assertStep(pace.lastSignal.httpStatus === 429 && pace.lastSignal.retryAfterMs === RETRY_AFTER_SECONDS * 1000 && waitedMs >= RETRY_AFTER_SECONDS * 1000 && pace.warning === "limited",
      `The service worker did not read Retry-After: ${JSON.stringify({ signal: pace.lastSignal, retryNotBefore: pace.retryNotBefore, lastRefusalAt: pace.lastRefusalAt })}`);
    await click(dashboard, "closeOverlay");
    await dashboard.waitFor("document.getElementById('parserOverlay').hidden", 8000, "the panel to close");
    await dashboard.evaluate("(() => { const overlay = document.getElementById('parserOverlay'); window.__closed = { opened: 0 }; new MutationObserver(() => { if (!overlay.hidden) window.__closed.opened += 1; }).observe(overlay, { attributes: true, " +
      "attributeFilter: ['hidden'] }); return true; })()");
    const saved = await waitForSavedDialog(dashboard, 180000);
    assertStep(await dashboard.evaluate("document.getElementById('parserOverlay').hidden && window.__closed.opened === 0"), "The panel the user closed opened during the warning or at the completion.");
    await dashboard.evaluate("document.getElementById('buildButton').click()");
    await dashboard.waitFor("!document.getElementById('parserOverlay').hidden", 8000, "Build to open the panel again");
    assert.equal(limit.refusedAt.length, 1, `A ledger request was sent while the build waited out Retry-After: ${limit.refusedAt.length} refused`);
    // Every record, the ledgers' among them, and every section complete.
    assertCompleteDocument(JSON.parse((await waitForExportedFile("LedgerCitizen")).text), account);
    assert.equal((await storedState()).status, "complete");
    return { waitedSeconds: Math.round(waitedMs / 1000), title: saved.title };
  } finally {
    limit.lift();
  }
}
