// The builds of the Pause and Cancel race scenario (PARSER_HARDENING.md §15.5): a fresh synthetic account for each
// race, the RSI requests it has had, and the check that a late event after Cancel leaves the cancelled job as it was.
import assert from "node:assert/strict";
import { createSyntheticRsi, dashboard, extensionPage, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { freshDashboard, selectCurrentRsiAccount } from "./dashboard-pages-and-builds.mjs";
import { RSI_ORIGIN } from "./origins-keys-and-stand-in-image.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { pause, QUIET_MS } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { waitForState } from "./stored-state-alarms-and-saved-files.mjs";

export const COUNTS = { pledges: 8, buybacks: 6, orders: 3, storeCredit: 4, uec: 2, rec: 2, prospects: 3 };
export const REFUSED = { status: 429, retryAfterSeconds: 2, body: "<html><body>Too Many Requests</body></html>" };

export const rsiRequests = (account) => account.requests.filter((request) => request.origin === RSI_ORIGIN).length;

export function storedJob(jobId) {
  return extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'EXPORT_BACKUP' }).then(({ backup }) => backup.stores.jobs.find((job) => job.jobId === ${JSON.stringify(jobId)}) ?? null)`);
}

export async function build(handle) {
  await freshDashboard();
  const account = createSyntheticRsi({ handle, counts: COUNTS });
  setRsi(account);
  await selectCurrentRsiAccount(dashboard, handle);
  return account;
}

// A refusal or a status result that lands after Cancel: nothing more is sent and the cancelled job stays as it was.
export async function cancelledJobStaysAsItWas(account, lateEvent, description) {
  await click(dashboard, "cancelCollection");
  const cancelled = await waitForState((state) => state.status === "cancelled" && state.activeJobId === null, 8000, "the job to cancel");
  await pause(QUIET_MS);
  const jobId = cancelled.lastTerminalJobId;
  const before = await storedJob(jobId);
  const sent = rsiRequests(account);
  await lateEvent();
  // Past the late answer's Retry-After and the status merge.
  await pause(2500);
  const after = await storedJob(jobId);
  assertStep(before?.status === "cancelled" && JSON.stringify(after) === JSON.stringify(before),
    `${description} rewrote the cancelled job: ${JSON.stringify({ before: before?.status, after: after?.status, updatedBefore: before?.updatedAt, updatedAfter: after?.updatedAt })}`);
  assert.equal(rsiRequests(account), sent, `${description}: a request was sent after Cancel.`);
}
