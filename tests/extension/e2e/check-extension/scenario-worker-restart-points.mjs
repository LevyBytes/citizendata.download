import assert from "node:assert/strict";
import { createSyntheticRsi, dashboard, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { assertCompleteDocument } from "./complete-document-expectations.mjs";
import { freshDashboard, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { afterRequests, holdRsiWhen, reach, refuseRsiWhen, settled } from "./held-rsi-requests.mjs";
import { STATUS_ORIGIN } from "./origins-keys-and-stand-in-image.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { pause } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { stopServiceWorker } from "./service-worker-stop-storage-heap-and-errors.mjs";
import { clearStore, storedState, waitForExportedFile, waitForState } from "./stored-state-alarms-and-saved-files.mjs";
import { assertRepeatsOnlyByDesign, assertStatusReadsAndFinalPanel, tally, WATCH_ANNOUNCEMENTS } from "./workerrestartrequestsandpanel.mjs";

const LEDGER_PATHS = new Set(["/api/account/creditLog", "/api/account/uecLog", "/api/account/recLog"]);
const COUNTS = { pledges: 12, buybacks: 8, orders: 4, storeCredit: 6, uec: 4, rec: 3, prospects: 4 };

async function waitUntil(condition, timeoutMs, complaint) {
  for (const deadline = Date.now() + timeoutMs; !condition();) {
    assertStep(Date.now() < deadline, complaint);
    await pause(100);
  }
}

// A real MV3 worker is stopped at the points of PARSER_HARDENING.md §15.5: after its first durable lane slot while a
// request is on its way, during a backoff while its status request is outstanding, again inside that backoff, and
// while paused. Each time the dashboard's poll wakes it. It sends no request before its wait and none twice, except
// the one request let go into the stopped worker, and the build saves the same backup an uninterrupted build saves.
// The dashboard takes pushed and polled statuses across the restarts and ends with no log row and no announcement
// twice.
export async function workerRestartPoints() {
  // The uninterrupted build of an identical account: the requests a build of this account sends.
  await freshDashboard();
  const baseline = createSyntheticRsi({ handle: "RestartBaseline", counts: COUNTS });
  setRsi(baseline);
  await startBuild(dashboard);
  await waitForSavedDialog(dashboard, 120000);
  const expected = tally(baseline, "RestartBaseline");

  await freshDashboard();
  const account = createSyntheticRsi({ handle: "RestartCitizen", counts: COUNTS });
  setRsi(account);
  // Another scenario's status read must not answer this one's warning from the cache.
  await clearStore("statusFeedCache");
  await dashboard.evaluate(WATCH_ANNOUNCEMENTS);

  // After the first durable lane slot: the third request is held, the worker stopped, and the request let go into the
  // stopped worker. The restarted worker sends it again and carries on.
  const held = holdRsiWhen(afterRequests(account, 2));
  await startBuild(dashboard);
  await reach(held, "the build's third request");
  await stopServiceWorker();
  const lost = account.requests.length;
  held.release();
  // The next points are armed while the worker is still stopped, so the build cannot pass the ledgers first.
  const statusHeld = holdRsiWhen((request) => new URL(request.url).origin === STATUS_ORIGIN);
  const limit = refuseRsiWhen((request) => LEDGER_PATHS.has(new URL(request.url).pathname), { status: 429, retryAfterSeconds: 10, forMs: 10000 });
  await waitUntil(() => account.requests.length > lost + 1, 20000, "The restarted worker did not carry on after the request it lost.");

  // During a backoff, with the status request outstanding: the first ledger request is refused with Retry-After: 10.
  // The warning makes the worker ask RSI's status feed; that request is held, the worker stopped while it is
  // outstanding, and the request let go. Five seconds on, still inside the wait, the worker is stopped again. No
  // ledger request goes out before the 10 seconds have passed, and the feed is asked again at most once.
  await reach(limit, "the build to reach Financial ledgers", 60000);
  const refusedAt = limit.refusedAt[0];
  await reach(statusHeld, "the worker's status request during the backoff", 15000);
  await stopServiceWorker();
  statusHeld.release();
  await pause(Math.max(0, refusedAt + 5000 - Date.now()));
  await stopServiceWorker().catch(() => {});
  await waitUntil(() => account.requests.some((request) => request.at > refusedAt && LEDGER_PATHS.has(request.path)), 40000, "The restarted worker did not read the ledgers after the wait.");
  limit.lift();
  const afterBackoff = account.requests.find((request) => request.at > refusedAt && LEDGER_PATHS.has(request.path));
  assertStep(limit.refusedAt.length === 1 && afterBackoff.at >= refusedAt + 10000,
    `A ledger request went out inside the backoff after a restart: ${afterBackoff.at - refusedAt} ms after the refusal, ${limit.refusedAt.length} refused`);

  // While paused: the worker is stopped and woken by the dashboard's polls; nothing is sent and the job stays paused
  // until Resume.
  const pausing = holdRsiWhen(afterRequests(account, account.requests.length + 1));
  await reach(pausing, "the build to be under way after the backoff", 30000);
  await click(dashboard, "pauseCollection");
  await waitForState((state) => state.status === "paused", 8000, "the job to pause");
  pausing.release();
  const atPause = await settled(account, "A paused job kept sending requests.");
  await stopServiceWorker();
  // Longer than the dashboard's 5-second poll while a job is paused, so the worker is woken at least once.
  await pause(6500);
  assert.equal(account.requests.length, atPause, "A paused job sent a request after its worker restarted.");
  assert.equal((await storedState()).status, "paused", "The restarted worker changed the paused job.");
  await click(dashboard, "resumeCollection");

  const saved = await waitForSavedDialog(dashboard, 120000);
  assertCompleteDocument(JSON.parse((await waitForExportedFile("RestartCitizen")).text), account);
  assert.equal((await storedState()).status, "complete");
  const twice = assertRepeatsOnlyByDesign(account, "RestartCitizen", expected);
  const { statusRequests, announcements } = await assertStatusReadsAndFinalPanel(account);
  return { requests: account.requests.length, repeated: twice.map((entry) => entry.name), statusRequests, announcements, title: saved.title };
}
