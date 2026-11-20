// Runs the real extension under Node for tests.
//
// The service worker, its imported scripts, the offscreen parser, and the page extractors are the shipped files, each
// loaded unmodified into its own VM context. The harness supplies what Chrome and RSI would: the `chrome` API, tabs that
// stand in for dashboard pages, the popup as a message sender, alarms, storage, a synthetic RSI behind `fetch`, and a
// clock. Storage is the repository's own in-memory implementation in place of IndexedDB.
//
// Time is virtual. Timers and alarms fire only when `advance` is called, so a collection that paces itself over minutes
// runs in milliseconds and the same way every time. A stopped worker instance never runs again: every asynchronous API
// it could be waiting on stays pending, as it would for a worker Chrome ended.
import { alarmSchedule } from "./extension-harness/chrome-storage-and-alarms.mjs";
import { addTabOpener } from "./extension-harness/dashboard-tab.mjs";
import { EXTENSION_ID, createSyntheticRsi } from "./extension-harness/extension-files-and-identifiers.mjs";
import { harnessState, recordingConsoleFor } from "./extension-harness/harness-state-and-recording-console.mjs";
import { deliveryAndTime } from "./extension-harness/message-delivery-and-virtual-time.mjs";
import { offscreenParser } from "./extension-harness/offscreen-parser-document.mjs";
import { startWorker } from "./extension-harness/service-worker-instance.mjs";
import { createClock, virtualDateClass } from "./extension-harness/virtual-clock.mjs";
import { addWorkerLifecycle } from "./extension-harness/worker-and-browser-lifecycle.mjs";

export { EXTENSION_ID, HOSTED_DASHBOARD_URL, RSI_TOKEN, STATE_KEY, WATCHDOG_ALARM } from "./extension-harness/extension-files-and-identifiers.mjs";

export async function createExtensionHarness(options = {}) {
  const clock = createClock(Date.parse(options.startAt ?? "2026-11-01T12:00:00.000Z"));
  const harness = harnessState(clock);
  // What the parts of the stand-in browser share: the clock, the harness record, the running worker, and counters.
  const world = { clock, harness, VirtualDate: virtualDateClass(clock), recordingConsole: recordingConsoleFor(harness, options), pendingRealWork: 0, worker: null, offscreen: null, tabSequence: 100 };
  world.tracked = async (operation) => {
    world.pendingRealWork += 1;
    try {
      return await operation();
    } finally {
      world.pendingRealWork -= 1;
    }
  };

  function createAccount(accountOptions = {}) {
    return createSyntheticRsi({
      ...accountOptions,
      now: () => clock.now,
      wait: (milliseconds) => new Promise((resolve) => clock.setTimeout("rsi", resolve, milliseconds))
    });
  }
  harness.rsi = createAccount(options.account);

  world.alarms = alarmSchedule(world);
  world.ensureOffscreen = offscreenParser(world);
  world.ensureWorker = () => world.worker ?? startWorker(world);
  const { deliver, settle } = deliveryAndTime(world);
  addWorkerLifecycle(world, settle);
  harness.switchAccount = (accountOptions) => {
    harness.rsi = createAccount(accountOptions);
    return harness.rsi;
  };

  addTabOpener(world, deliver);

  harness.popup = {
    request: (type, fields = {}, forge = {}) => deliver({ kind: "EXTENSION_UI_REQUEST", type, ...fields }, { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/popup/popup.html`, ...forge.sender })
  };
  harness.deliver = deliver;

  // Approves the local copy shown in `tab` the way the popup does and returns the worker's answer.
  harness.approveLocalDashboard = async (tab) => {
    await tab.hello();
    return harness.popup.request("APPROVE_LOCAL_DASHBOARD", { tabId: tab.id });
  };

  // Runs the active job until it is no longer running or paused, and returns the final state.
  harness.finishJob = async (limitMs) => {
    await harness.advance(() => !["running", "connecting"].includes(harness.state()?.status), { limitMs });
    return harness.state();
  };

  world.ensureWorker();
  await settle();
  return harness;
}
