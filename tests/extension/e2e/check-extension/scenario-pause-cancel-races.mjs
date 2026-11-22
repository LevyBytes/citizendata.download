import assert from "node:assert/strict";
import { dashboard } from "./browser-pages-and-account-in-use.mjs";
import { startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { afterRequests, holdRsiWhen, reach, refuseRsiWhen, settled } from "./held-rsi-requests.mjs";
import { RSI_ORIGIN, STATUS_ORIGIN } from "./origins-keys-and-stand-in-image.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { pause } from "./polling-intervals.mjs";
import { build, cancelledJobStaysAsItWas, REFUSED, rsiRequests } from "./pausecancelracebuilds.mjs";
import { clearStore, storedState, waitForState } from "./stored-state-alarms-and-saved-files.mjs";

// Pause and Cancel race with a refusal and with a late status result (PARSER_HARDENING.md §15.5): no later request
// is sent, a paused job stays paused until Resume, and a cancelled job is not rewritten.
export async function pauseCancelRaces() {
  // Pause, then the request on its way is refused.
  let account = await build("PauseRefusedCitizen");
  let held = holdRsiWhen(afterRequests(account, 6), REFUSED);
  await startBuild(dashboard);
  await reach(held, "the build to be under way");
  await click(dashboard, "pauseCollection");
  await waitForState((state) => state.status === "paused", 8000, "the job to pause");
  held.release();
  await settled(account, "A paused job kept sending requests after a refusal.");
  let atPause = rsiRequests(account);
  await pause(REFUSED.retryAfterSeconds * 1000 + 500);
  assert.equal(rsiRequests(account), atPause, "A paused job sent a request once the refusal's wait had passed.");
  assert.equal((await storedState()).status, "paused", "A refusal after Pause changed the paused job.");
  await click(dashboard, "resumeCollection");
  await waitForSavedDialog(dashboard, 120000);

  // Cancel, then the request on its way is refused.
  account = await build("CancelRefusedCitizen");
  held = holdRsiWhen(afterRequests(account, 6), REFUSED);
  await startBuild(dashboard);
  await reach(held, "the build to be under way");
  await cancelledJobStaysAsItWas(account, async () => held.release(), "A refusal after Cancel");

  // Cancel, then the status feed answers. A refusal shows a warning and the worker asks the feed; Cancel lands while
  // that request is outstanding.
  account = await build("CancelStatusCitizen");
  await clearStore("statusFeedCache");
  let statusHeld = holdRsiWhen((request) => new URL(request.url).origin === STATUS_ORIGIN);
  let limit = refuseRsiWhen((request) => new URL(request.url).origin === RSI_ORIGIN && account.requests.length >= 6, { status: 429, retryAfterSeconds: 3, forMs: 500 });
  await startBuild(dashboard);
  await reach(statusHeld, "the worker's status request", 30000);
  limit.lift();
  await cancelledJobStaysAsItWas(account, async () => statusHeld.release(), "A status result after Cancel");

  // Pause, then the status feed answers: the job stays paused and sends nothing until Resume.
  account = await build("PauseStatusCitizen");
  await clearStore("statusFeedCache");
  statusHeld = holdRsiWhen((request) => new URL(request.url).origin === STATUS_ORIGIN);
  limit = refuseRsiWhen((request) => new URL(request.url).origin === RSI_ORIGIN && account.requests.length >= 6, { status: 429, retryAfterSeconds: 3, forMs: 500 });
  await startBuild(dashboard);
  await reach(statusHeld, "the worker's status request", 30000);
  limit.lift();
  await click(dashboard, "pauseCollection");
  await waitForState((state) => state.status === "paused", 8000, "the job to pause");
  await settled(account, "A paused job kept sending requests.");
  atPause = rsiRequests(account);
  statusHeld.release();
  // Past the refusal's Retry-After and the status merge.
  await pause(3500);
  assert.equal(rsiRequests(account), atPause, "A paused job sent a request after the status result.");
  assert.equal((await storedState()).status, "paused", "A status result after Pause changed the paused job.");
  await click(dashboard, "resumeCollection");
  await waitForSavedDialog(dashboard, 120000);
  return { races: 4 };
}
