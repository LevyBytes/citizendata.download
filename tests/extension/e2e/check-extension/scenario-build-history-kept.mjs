import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadEvents } from "./answers-to-browser-requests.mjs";
import { dashboard, extensionPage, rsi } from "./browser-pages-and-account-in-use.mjs";
import { keptOrgsJsonIsListedSavedAndDeleted } from "./build-history-kept-orgs-json-step.mjs";
import { freshDashboard, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { downloads, out } from "./options-and-run-folders.mjs";
import { click, clickExpression } from "./page-clicks-and-extension-pages.mjs";
import { POLL_MS, pause } from "./polling-intervals.mjs";
import { historyState, noticeIs, reloadPopup } from "./popup-build-history-readings-and-actions.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { downloadedDocuments, waitForDownloads } from "./stored-state-alarms-and-saved-files.mjs";

async function replacedBuildIsKeptAndSaved(first) {
  await reloadPopup();
  // The update changed the account, so the build it replaced is kept: one copy, dated as the first build.
  const one = await historyState();
  assert.deepEqual(one.copies.map((copy) => [copy.exportedAt, copy.fileName]), [[first.document.exportedAt, first.name]], "The replaced build was not kept under its own date and file name.");
  assertStep(
    one.rows.length === 1 && one.rows[0].buttons.join("/") === "Save/Delete" && / file, .* stored$/u.test(one.rows[0].detail) && /^1 earlier build kept, .* stored\.$/u.test(one.summary) && one.recoveryNote && one.problem === null,
    `The popup did not list the kept build: ${JSON.stringify(one)}`
  );
  assertStep(
    one.copies[0].fileBytes === Buffer.byteLength(first.text) && one.copies[0].storedBytes < one.copies[0].fileBytes / 4 && one.storedBytes === one.copies[0].storedBytes,
    `The kept build's sizes are wrong: ${JSON.stringify(one.copies[0])} for a ${Buffer.byteLength(first.text)} byte file`
  );

  // Save gives back the file the dashboard saved for that build, byte for byte.
  // The file is saved under the build's own name, so the one the dashboard saved is moved aside first.
  await rm(path.join(downloads, first.name));
  const begunBefore = downloadEvents.length;
  await clickExpression(extensionPage, "document.querySelector('#historyList li button')");
  await noticeIs(`Saved ${first.name}.`);
  for (const deadline = Date.now() + 15000; !(downloadEvents.at(-1)?.state === "completed" && downloadEvents.length > begunBefore && existsSync(path.join(downloads, first.name)));) {
    if (Date.now() > deadline) throw new Error(`The kept build was not saved as a file. Downloads Chrome began: ${JSON.stringify(downloadEvents.slice(begunBefore))}; files: ${JSON.stringify(await readdir(downloads))}`);
    await pause(POLL_MS);
  }
  assert.deepEqual(downloadEvents.slice(begunBefore).map((event) => event.name), [first.name], "The kept build was not offered once, under the file name of its build.");
  assert.equal(await readFile(path.join(downloads, first.name), "utf8"), first.text, "The saved copy differs from the file the dashboard saved for that build.");
  return one;
}

async function secondChangedBuildIsKept(first, second) {
  // A second changed build is kept as well, newest first; the latest build is never in the list.
  await freshDashboard();
  rsi.addPledges(1);
  await startBuild(dashboard);
  await waitForSavedDialog(dashboard, 120000);
  await waitForDownloads(3);
  await reloadPopup();
  const two = await historyState();
  assert.deepEqual(two.copies.map((copy) => copy.exportedAt), [second.document.exportedAt, first.document.exportedAt], "The kept builds are not the two earlier builds, newest first.");
  assertStep(/^2 earlier builds kept, .* stored\.$/u.test(two.summary) && two.rows.length === 2, `The popup did not list both kept builds: ${JSON.stringify(two.rows)} ${two.summary}`);
  await writeFile(path.join(out, "popup-build-history-kept.png"), await extensionPage.screenshot());
  return two;
}

async function historyOffAsksAndDeleteTakesTwoClicks(second, two) {
  // Turning the history off deletes nothing and asks about the kept builds.
  await click(extensionPage, "historyEnabled");
  await noticeIs("Build history is off.");
  const asked = await historyState();
  assert.deepEqual(
    { stored: asked.stored, question: asked.question, copies: asked.copies.length, keepDisabled: asked.keepDisabled },
    { stored: { enabled: false, keep: 3 }, question: "Build history is off. 2 earlier builds are still kept. Delete them?", copies: 2, keepDisabled: true }
  );
  await writeFile(path.join(out, "popup-build-history-off-question.png"), await extensionPage.screenshot());
  await click(extensionPage, "historyKeepAll");
  const left = await historyState();
  assert.deepEqual({ question: left.question, copies: left.copies.length, rows: left.rows.length }, { question: null, copies: 2, rows: 2 }, "Keeping the builds must leave both in place.");

  // Delete needs a second click, and removes that build alone.
  const older = "document.querySelectorAll('#historyList li')[1].querySelector('button.danger')";
  await clickExpression(extensionPage, older);
  assert.deepEqual(await extensionPage.evaluate(`({ label: ${older}.textContent, pressed: ${older}.getAttribute('aria-pressed') })`), { label: "Confirm", pressed: "true" });
  assert.equal((await historyState()).copies.length, 2, "One click must not delete a kept build.");
  await clickExpression(extensionPage, older);
  await extensionPage.waitFor("document.querySelectorAll('#historyList li').length === 1", 8000, "the deleted build to leave the list");
  const after = await historyState();
  assert.deepEqual(after.copies.map((copy) => copy.exportedAt), [second.document.exportedAt]);
  assert.deepEqual(await extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'GET_BUILD_HISTORY_COPY', historyId: ${JSON.stringify(two.copies[1].historyId)} })`), { ok: false, code: "BUILD_HISTORY_COPY_NOT_FOUND" });
  return after;
}

export async function buildHistoryKept() {
  const [first, second] = (await downloadedDocuments()).map((saved) => ({ ...saved, document: JSON.parse(saved.text) })).sort((left, right) => left.document.exportedAt.localeCompare(right.document.exportedAt));
  const one = await replacedBuildIsKeptAndSaved(first);
  const two = await secondChangedBuildIsKept(first, second);
  await keptOrgsJsonIsListedSavedAndDeleted(first, second);
  const after = await historyOffAsksAndDeleteTakesTwoClicks(second, two);
  return { fileBytes: one.copies[0].fileBytes, storedBytes: one.copies[0].storedBytes, storage: after.storage };
}
