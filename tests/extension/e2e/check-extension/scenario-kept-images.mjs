import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mediaRequests } from "./answers-to-browser-requests.mjs";
import { dashboard, extensionPage } from "./browser-pages-and-account-in-use.mjs";
import { freshDashboard } from "./dashboard-pages-and-builds.mjs";
import { downloadImages, imageState, keptImageTotals, openCutDownBackup, zipFiles } from "./kept-images-page-actions.mjs";
import { out } from "./options-and-run-folders.mjs";
import { PNG } from "./origins-keys-and-stand-in-image.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { POLL_MS, QUIET_MS, pause } from "./polling-intervals.mjs";
import { noticeIs, reloadPopup } from "./popup-build-history-readings-and-actions.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { downloadedDocuments } from "./stored-state-alarms-and-saved-files.mjs";

export async function keptImages() {
  // The latest saved backup, cut down to a few records so the download is short, opened as a file.
  const latest = (await downloadedDocuments()).map((saved) => JSON.parse(saved.text)).sort((left, right) => left.exportedAt.localeCompare(right.exportedAt)).at(-1);
  const openBackup = (page) => openCutDownBackup(page, latest);

  // Build history off: the images are downloaded and saved as a ZIP, and the extension keeps none. A page that
  // has just loaded is handed no build either, and shows the example.
  await freshDashboard();
  await pause(QUIET_MS);
  assert.equal(await dashboard.evaluate("document.getElementById('snapshotEyebrow').textContent"), "EXAMPLE ACCOUNT", "With build history off, the dashboard that has just loaded was handed a build.");
  const planned = await openBackup(dashboard);
  assertStep(planned >= 10, `The cut-down backup holds too few images to be a check: ${planned}`);
  assert.deepEqual(await keptImageTotals(), { count: 0, bytes: 0 });
  const withoutKeeping = await downloadImages(dashboard);
  assertStep(
    withoutKeeping.summary === "COMPLETED" && withoutKeeping.status.includes("All images completed.") && !withoutKeeping.status.includes("extension"),
    `With build history off the image download did not finish as a plain ZIP: ${JSON.stringify(withoutKeeping)}`
  );
  assert.equal(mediaRequests.length, planned, "Each planned image is asked for once.");
  assertStep(mediaRequests.every((request) => !request.hasCookie && !request.referrer), `An image request carried a cookie or a referrer: ${JSON.stringify(mediaRequests.find((request) => request.hasCookie || request.referrer))}`);
  assert.deepEqual(await keptImageTotals(), { count: 0, bytes: 0 }, "With build history off the extension must keep no image.");
  assert.equal((await zipFiles()).length, 1, "The Images ZIP was not saved.");

  // Build history on: the same download, reusing the open ZIP, hands every image to the extension.
  await reloadPopup();
  await click(extensionPage, "historyEnabled");
  await noticeIs("Build history is on.");
  await freshDashboard();
  assert.equal(await openBackup(dashboard), planned);
  const first = await downloadImages(dashboard);
  assertStep(first.summary === "COMPLETED" && first.status.endsWith(` ${planned} images are now kept in the extension.`), `The downloaded images were not handed to the extension: ${JSON.stringify(first)}`);
  assert.equal(mediaRequests.length, planned * 2);
  const kept = await keptImageTotals();
  assert.equal(kept.count, planned, "The extension does not keep every downloaded image.");
  assertStep(kept.bytes > planned * PNG.length, `The kept images are smaller than what was downloaded: ${JSON.stringify(kept)}`);
  assert.equal((await zipFiles()).length, 2);

  // A new visit: the kept images are opened from the extension and shown, and nothing is downloaded.
  await freshDashboard();
  await openBackup(dashboard);
  await dashboard.waitFor("document.getElementById('imageFileStatus').textContent === 'Images kept in the extension'", 15000, "the kept images to open");
  const reopened = await imageState(dashboard);
  assert.deepEqual([reopened.status, reopened.health], [`${planned} of ${planned} images are kept in the extension and shown from it.`, `${planned} packaged images loaded`]);
  // Every row of the page shows its thumbnail without being selected.
  await dashboard.waitFor("(() => { const rows = [...document.querySelectorAll('#inventoryRows tr')]; return rows.length > 1 && rows.every((row) => { const image = row.querySelector('.row-thumbnail'); return Boolean(image && !image.hidden && "
    + "image.src.startsWith('blob:') && image.complete && image.naturalWidth > 0); }); })()", 15000, "the thumbnail of every row shown from the extension");
  await writeFile(path.join(out, "dashboard-images-from-extension.png"), await dashboard.screenshot());
  assert.equal(mediaRequests.length, planned * 2, "Showing kept images must not download any.");

  // Build Images now reuses every kept image: no request to RSI, and a complete ZIP is saved again.
  const reused = await downloadImages(dashboard);
  assertStep(reused.summary === "COMPLETED" && reused.status.includes("All images completed.") && reused.status.endsWith(" The extension already keeps these images."), `The second image build did not reuse the kept images: ${JSON.stringify(reused)}`);
  assert.equal(mediaRequests.length, planned * 2, "A build with every image kept must download none.");
  // With nothing to download the build ends at once, so the file is given a moment to reach the disk.
  for (const deadline = Date.now() + 10000; (await zipFiles()).length < 3 && Date.now() < deadline;) await pause(POLL_MS);
  assert.equal((await zipFiles()).length, 3, "The Images ZIP built from the kept images was not saved.");
  assert.equal((await keptImageTotals()).count, planned);

  // The popup says what is kept and deletes it with a second click. The ZIP files are untouched.
  await reloadPopup();
  const shown = await extensionPage.evaluate("({ summary: document.getElementById('imagesSummary').textContent, deleteHidden: document.getElementById('imagesDelete').hidden })");
  assertStep(new RegExp(`^${planned} images kept, .+\\. The dashboard saves them as its Images ZIP\\.$`, "u").test(shown.summary) && !shown.deleteHidden, `The popup did not say which images are kept: ${JSON.stringify(shown)}`);
  await extensionPage.evaluate("document.getElementById('imagesSummary').scrollIntoView({ block: 'center' })");
  await writeFile(path.join(out, "popup-kept-images.png"), await extensionPage.screenshot());
  await click(extensionPage, "imagesDelete");
  assert.equal((await keptImageTotals()).count, planned, "One click must not delete the kept images.");
  await click(extensionPage, "imagesDelete");
  await noticeIs("The kept images were deleted. Your Images ZIP files are untouched.");
  assert.deepEqual(await keptImageTotals(), { count: 0, bytes: 0 });
  assert.equal(await extensionPage.evaluate("document.getElementById('imagesSummary').textContent"), "No image is kept yet. They are kept when the dashboard downloads them.");
  assert.equal((await zipFiles()).length, 3);

  // Build history is put back as the scenarios after this one expect it: off, with the kept build left in place.
  await click(extensionPage, "historyEnabled");
  await noticeIs("Build history is off.");
  await click(extensionPage, "historyKeepAll");
  return { images: planned, keptBytes: kept.bytes };
}
