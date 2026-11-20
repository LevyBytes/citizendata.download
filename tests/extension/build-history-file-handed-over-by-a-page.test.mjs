import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { AccountDocument, SMALL, account, plain } from "./build-history-loaded-with-fixture-builds-and-rosters.mjs";

test("a file a page hands over is not kept unless it is a complete, verified build, the history is on, and no build is running", async () => {
  const { first } = await account();
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const refused = async (payload, code) => {
    const response = plain(await tab.request("KEEP_BUILD", payload));
    assert.deepEqual([response.ok, response.code], [false, code], JSON.stringify(payload).slice(0, 120));
    assert.equal(harness.repository.inspect().snapshots.size, 0);
    assert.equal(harness.rsi.requests.length, 0);
  };
  const stamped = async (change) => {
    const copy = structuredClone(first);
    change(copy);
    return AccountDocument.stampIntegrity(copy);
  };

  // Changed after it was saved, or not an account file at all.
  const changed = structuredClone(first);
  changed.pledges.pop();
  await refused({ document: changed }, "INVALID_BUILD");
  await refused({ document: { schemaVersion: 1 } }, "INVALID_BUILD");
  // A build whose section failed, a build whose run did not finish, and a file that names no account.
  await refused({ document: await stamped((copy) => { copy.sync.sectionOutcomes.hangarLog.status = "failed"; }) }, "INCOMPLETE_BUILD");
  await refused({ document: await stamped((copy) => { copy.sync.runs.at(-1).status = "failed"; }) }, "INCOMPLETE_BUILD");
  await refused({ document: await stamped((copy) => { copy.account.handle = null; }) }, "INCOMPLETE_BUILD");
  // Anything beside the document, and a secret field inside it, is refused before the extension looks at the file.
  await refused({ document: first, sourceUrl: "https://example.invalid/" }, "FORBIDDEN_PAYLOAD_FIELD");
  await refused({ document: { ...first, cookie: "x" } }, "FORBIDDEN_PAYLOAD_FIELD");
  await refused(null, "FORBIDDEN_PAYLOAD_FIELD");

  // With the history off the extension keeps nothing a page hands over.
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: false });
  await refused({ document: first }, "BUILD_HISTORY_OFF");
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });

  // While a build runs, the file is not taken in; the build finishes as usual.
  const started = await tab.build();
  assert.equal(started.code, "RUN_STARTED", started.message);
  const during = plain(await tab.request("KEEP_BUILD", { document: first }));
  assert.deepEqual([during.ok, during.code], [false, "BUILD_IN_PROGRESS"]);
  assert.equal((await harness.finishJob()).status, "complete");
});
