import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { extensionPage } from "./browser-pages-and-account-in-use.mjs";
import { downloads } from "./options-and-run-folders.mjs";
import { STATE_KEY } from "./origins-keys-and-stand-in-image.mjs";
import { POLL_MS, pause } from "./polling-intervals.mjs";

export function storedState() {
  return extensionPage.evaluate(`chrome.storage.local.get(${JSON.stringify(STATE_KEY)}).then((stored) => stored[${JSON.stringify(STATE_KEY)}] ?? null)`);
}

export async function waitForState(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = await storedState();
    if (state && predicate(state)) return state;
    await pause(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${description}. Last extension state: ${JSON.stringify(state)}`);
}

// The extension's own database, opened from its page, which shares the worker's origin. `change` is the source of a
// function that is given the store and returns nothing.
function withStore(store, change) {
  return extensionPage.evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open('citizendata.jobs.v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result; const transaction = database.transaction(${JSON.stringify(store)}, 'readwrite');
      transaction.oncomplete = () => { database.close(); resolve(true); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      (${change})(transaction.objectStore(${JSON.stringify(store)}));
    };
  })`);
}

// Empties one store, as the status feed's cache before a scenario that needs the feed asked.
export const clearStore = (store) => withStore(store, "(objects) => objects.clear()");

// Changes the stored job with this id: `change` is the source of a function from the job to the job to store.
export function changeStoredJob(jobId, change) {
  return withStore("jobs", `(objects) => { const read = objects.get(${JSON.stringify(jobId)}); read.onsuccess = () => objects.put((${change})(read.result)); }`);
}

export function alarms() {
  return extensionPage.evaluate("chrome.alarms.getAll().then((all) => all.map((alarm) => ({ name: alarm.name, period: alarm.periodInMinutes, scheduledTime: alarm.scheduledTime })))");
}

// Saved account backups. A file exported for another tool is not one of them.
export async function downloadedDocuments() {
  const names = (await readdir(downloads)).filter((name) => name.endsWith(".json") && !name.includes("-hangar-link-")).sort();
  return Promise.all(names.map(async (name) => ({ name, text: await readFile(path.join(downloads, name), "utf8") })));
}

export async function waitForExportedFile(marker, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const name = (await readdir(downloads)).find((candidate) => candidate.includes(marker) && candidate.endsWith(".json"));
    if (name) return { name, text: await readFile(path.join(downloads, name), "utf8") };
    if (Date.now() > deadline) throw new Error(`The exported file did not arrive: ${marker}`);
    await pause(POLL_MS);
  }
}

export async function waitForDownloads(count, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const documents = await downloadedDocuments();
    if (documents.length >= count) return documents;
    if (Date.now() > deadline) throw new Error(`Expected ${count} saved backup file(s); found ${documents.length}.`);
    await pause(POLL_MS);
  }
}
