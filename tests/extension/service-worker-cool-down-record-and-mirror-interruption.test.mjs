// The cool-down's end and the refused start's diagnosis are fields of the runtime record, written in the transaction
// that raises the status revision (PARSER_HARDENING.md §8.4, §12.1, §12.5); chrome.storage.local holds mirrors written
// after it. A worker ended just before or just after each mirror write, while a cool-down is created with its
// diagnosis, created by a run that gave up, or expired, restarts from the record: the mirrors are repaired from it, the
// alarm at the cool-down's end exists, and no revision is shown, pushed or polled, with two different cool-downs.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { assertMirrorsRepaired, assertOneCoolDownPerRevision, endWorkerAtMirrorWrite, MIRRORS, plain, refusedStart } from "./cooldownmirrorinterruption.mjs";
import { RETRY_NOT_BEFORE_KEY, refused } from "./serviceworkeridentifyrefusals.mjs";

for (const [key, holds] of MIRRORS) {
  for (const afterWrite of [false, true]) {
    const when = `${afterWrite ? "just after" : "before"} the ${key} mirror write`;

    test(`a refused start's cool-down and diagnosis survive a worker ended ${when}`, async () => {
      const harness = await createExtensionHarness();
      const tab = harness.openTab();
      const polled = [(await tab.request("GET_STATUS")).status];
      const ended = endWorkerAtMirrorWrite(harness, key, holds, afterWrite);
      const starting = refusedStart(harness, tab);
      await harness.advance(() => ended.at !== null);
      assert.equal(harness.workerRunning(), false);
      void starting;
      const stored = await harness.repository.getRuntime();
      assert.ok(Date.parse(stored.retryNotBefore) > harness.clock.now, "the record holds the cool-down");
      assert.equal(stored.startDiagnosis.probe, "not-run", "and the diagnosis, in the same write");
      polled.push((await tab.request("GET_STATUS")).status);
      // The restarted worker shows the record's cool-down and diagnosis; the poll may outlast the cool-down, whose
      // alarm then writes the expiry.
      const shown = plain([polled.at(-1).retryNotBefore, polled.at(-1).startDiagnosis]);
      const over = harness.clock.now >= Date.parse(stored.retryNotBefore);
      assert.ok(JSON.stringify(shown) === JSON.stringify(plain([stored.retryNotBefore, stored.startDiagnosis])) || over && shown[0] === null, JSON.stringify(shown));
      await assertMirrorsRepaired(harness);
      assert.ok(polled.at(-1).statusRevision > polled[0].statusRevision);
      assertOneCoolDownPerRevision([...polled, ...tab.events.map((event) => event.status).filter(Boolean)]);
    });

    test(`a cool-down's expiry survives a worker ended ${when}`, async () => {
      const harness = await createExtensionHarness();
      const tab = harness.openTab();
      const declined = await refusedStart(harness, tab);
      const polled = [(await tab.request("GET_STATUS")).status];
      assert.equal(polled[0].retryNotBefore, declined.retryNotBefore);
      // The expiry's write is the one that clears what the cool-down held.
      const ended = endWorkerAtMirrorWrite(harness, key, (value) => !holds(value), afterWrite);
      await harness.advanceBy(Date.parse(declined.retryNotBefore) - harness.clock.now + 1);
      assert.equal(ended.at, afterWrite ? "after" : "before", "the alarm at the cool-down's end wrote its expiry");
      const stored = await harness.repository.getRuntime();
      assert.deepEqual([stored.retryNotBefore, stored.startDiagnosis], [null, null], "the record holds the expiry");
      polled.push((await tab.request("GET_STATUS")).status);
      await assertMirrorsRepaired(harness);
      assert.deepEqual([polled.at(-1).retryNotBefore, polled.at(-1).startDiagnosis], [null, null]);
      assert.ok(polled.at(-1).statusRevision > polled[0].statusRevision, "the expiry raised the revision");
      assertOneCoolDownPerRevision(polled);
    });
  }
}

for (const afterWrite of [false, true]) {
  test(`a run that gives up starts its cool-down in the record, pushed and polled alike, with a worker ended ${afterWrite ? "just after" : "before"} the mirror write`, async () => {
    const harness = await createExtensionHarness();
    const tab = harness.openTab();
    harness.rsi.failNext((request) => request.path === "/api/account/pledgeLog", { ...refused("60"), times: 1000 });
    assert.equal((await tab.build()).code, "RUN_STARTED");
    const ended = endWorkerAtMirrorWrite(harness, RETRY_NOT_BEFORE_KEY, (value) => value !== null, afterWrite);
    await harness.advance(() => ended.at !== null);
    const stored = await harness.repository.getRuntime();
    assert.equal(stored.status, "failed");
    assert.ok(Date.parse(stored.retryNotBefore) > harness.clock.now, "the record holds the cool-down with the failed state");
    const polled = (await tab.request("GET_STATUS")).status;
    await assertMirrorsRepaired(harness);
    assert.equal(polled.retryNotBefore, stored.retryNotBefore);
    assertOneCoolDownPerRevision([polled, ...tab.events.map((event) => event.status).filter(Boolean)]);
    assert.equal((await tab.request("CONTINUE_PARTIAL")).code, "RSI_COOLING_DOWN");
  });
}
