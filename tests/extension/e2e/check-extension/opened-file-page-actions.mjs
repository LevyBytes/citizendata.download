import path from "node:path";
import { dashboard, extensionPage } from "./browser-pages-and-account-in-use.mjs";
import { freshDashboard } from "./dashboard-pages-and-builds.mjs";
import { options } from "./options-and-run-folders.mjs";
import { assertStep } from "./scenario-runner.mjs";

// Chooses the backup in the dashboard's file input: the file on disk when one was named, else the text of a saved one.
export async function openBackupFile(chosen, file) {
  if (chosen) {
    const input = await dashboard.send("Runtime.evaluate", { expression: "document.getElementById('jsonFileInput')" });
    await dashboard.send("DOM.setFileInputFiles", { files: [chosen], objectId: input.result.objectId });
    return;
  }
  await dashboard.evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(file.text)}], ${JSON.stringify(file.name)}, { type: 'application/json' }));
    const input = document.getElementById('jsonFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

export const popupRequest = (type) => extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: '${type}' })`);
export const heldSnapshots = async () => (await popupRequest("EXPORT_BACKUP")).backup.stores.snapshots.map((snapshot) => [snapshot.accountId, snapshot.document.integrity.contentHash]);

async function chooseFile(inputId, filePath) {
  const input = await dashboard.send("Runtime.evaluate", { expression: `document.getElementById('${inputId}')` });
  await dashboard.send("DOM.setFileInputFiles", { files: [path.resolve(filePath)], objectId: input.result.objectId });
}

// With --open-orgs: the Orgs JSON that belongs to the chosen account file is chosen in its input too.
export async function keepChosenOrgsJson(others) {
  await chooseFile("orgFileInput", options["open-orgs"]);
  await dashboard.waitFor("document.getElementById('messageDialog').open && document.getElementById('dialogMessage').textContent.includes('The extension ')", 120000, "the Orgs JSON to open and the extension to answer");
  const answer = await dashboard.evaluate("({ title: document.getElementById('dialogTitle').textContent, message: document.getElementById('dialogMessage').textContent })");
  assertStep(answer.title === "Organization data verified" && answer.message.endsWith("The extension now keeps these rosters with your latest build."), `The Orgs JSON was not taken in: ${answer.title}: ${answer.message.slice(-120)}`);
  await dashboard.evaluate("document.getElementById('messageDialog').close()");
  const kept = (await popupRequest("EXPORT_BACKUP")).backup.stores.snapshots[0].document;
  others.rosterMembersKept = kept.organizations.members.length;
  others.rostersKept = Object.keys(kept.sync.organizationMemberOutcomes).length;
  others.orgsJsonKept = (await popupRequest("GET_BUILD_HISTORY")).copies.filter((copy) => copy.kind === "organizations").length;
}

// With --open-zip: the Images ZIP that belongs to the chosen account file is chosen in its input too.
export async function keepChosenImagesZip(others, file) {
  const startedZip = Date.now();
  await chooseFile("mediaZipInput", options["open-zip"]);
  await dashboard.waitFor("document.getElementById('messageDialog').open", 120000, "the Images ZIP to open");
  const title = await dashboard.evaluate("document.getElementById('dialogTitle').textContent");
  assertStep(title === "Image package verified", `The Images ZIP was not opened: ${title}`);
  await dashboard.evaluate("document.getElementById('messageDialog').close()");
  await dashboard.waitFor("/kept in the extension|already keeps these images|could not keep/u.test(document.getElementById('mediaStatus').textContent)", 300000, "the extension to answer about the images");
  const status = await dashboard.evaluate("document.getElementById('mediaStatus').textContent");
  assertStep(/ [0-9,]+ images? (is|are) now kept in the extension\.$/u.test(status), `The images of the ZIP were not kept: ${status.slice(-160)}`);
  const images = (await popupRequest("GET_BUILD_HISTORY")).images;
  others.imagesKept = images.count;
  others.imageMegabytes = Number((images.bytes / 1048576).toFixed(1));
  others.secondsToKeepImages = Number(((Date.now() - startedZip) / 1000).toFixed(1));
  // A page that loads afterwards shows the kept images without the ZIP.
  await freshDashboard();
  await dashboard.waitFor(`document.getElementById('accountHandle').textContent === ${JSON.stringify(file.document.account.handle)}`, 120000, "the kept build to open again");
  await dashboard.waitFor("/kept in the extension|Kept in the extension|extension/u.test(document.getElementById('imageFileStatus').textContent)", 120000, "the kept images to be attached");
  others.imageCardAfterReload = await dashboard.evaluate("document.getElementById('imageFileStatus').textContent");
}
