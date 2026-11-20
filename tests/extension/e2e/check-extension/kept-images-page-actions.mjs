import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { extensionPage } from "./browser-pages-and-account-in-use.mjs";
import { openChooser } from "./build-chooser.mjs";
import { downloads } from "./options-and-run-folders.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";

// Opens the backup `latest`, cut down to a few records so the download is short, as a file in `page`. Gives the number of images planned.
export async function openCutDownBackup(page, latest) {
  await page.evaluate(`(async () => {
    const copy = ${JSON.stringify({ ...latest, pledges: latest.pledges.slice(0, 5), buybacks: latest.buybacks.slice(0, 5), buybackDetails: [] })};
    copy.sync.sectionOutcomes.buybackDetails && (copy.sync.sectionOutcomes.buybackDetails.records = 0);
    const stamped = await CitizenDataAccountDocument.stampIntegrity(copy);
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(stamped)], 'kept-images-backup.json', { type: 'application/json' }));
    const input = document.getElementById('jsonFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.waitFor("document.getElementById('messageDialog').open", 15000, "the backup file to open");
  assert.equal(await page.evaluate("document.getElementById('dialogTitle').textContent"), "Account file verified", await page.evaluate("document.getElementById('dialogMessage').textContent"));
  await page.evaluate("document.getElementById('messageDialog').close()");
  await page.waitFor("/^[0-9]+ unique images$/u.test(document.getElementById('mediaSummary').textContent)", 15000, "the image plan");
  return page.evaluate("Number(document.getElementById('mediaSummary').textContent.split(' ')[0])");
}

export const imageState = (page) => page.evaluate("({ status: document.getElementById('mediaStatus').textContent, file: document.getElementById('imageFileStatus').textContent, health: document.getElementById('healthMedia').textContent, summary: "
  + "document.getElementById('overlaySummary').textContent })");
export const keptImageTotals = () => extensionPage.evaluate("chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'GET_BUILD_HISTORY' }).then((status) => status.images)");
export const zipFiles = async () => (await readdir(downloads)).filter((name) => name.endsWith(".zip"));
export async function downloadImages(page) {
  await openChooser(page);
  await click(page, "buildImagesAction");
  await page.waitFor("['COMPLETED', 'FAILED', 'READY TO SAVE'].includes(document.getElementById('overlaySummary').textContent)", 120000, "the image download to finish");
  return imageState(page);
}
