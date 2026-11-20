import { chrome, extensionId, extensionOrigin, extensionPage, settings } from "./browser-pages-and-account-in-use.mjs";
import { POLL_MS, pause } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";

// Ends the extension's service worker the way Chrome does when it reclaims one.
export async function stopServiceWorker() {
  const isWorker = (target) => target.type === "service_worker" && target.url.startsWith(extensionOrigin);
  const before = [...chrome.targets.values()].filter(isWorker).map((target) => target.targetId);
  assertStep(before.length === 1, "The extension service worker was not running when the check tried to stop it.");
  await extensionPage.send("ServiceWorker.enable");
  await extensionPage.send("ServiceWorker.stopAllWorkers");
  await extensionPage.send("ServiceWorker.disable");
  const deadline = Date.now() + 5000;
  while ([...chrome.targets.values()].some((target) => before.includes(target.targetId))) {
    if (Date.now() > deadline) throw new Error("Chrome did not stop the extension service worker.");
    await pause(POLL_MS);
  }
}

// What the extension's database holds for collection: stored pages, staged runs, and saved backups.
export function storedCollection() {
  return extensionPage.evaluate(`chrome.runtime.sendMessage({ kind: 'EXTENSION_UI_REQUEST', type: 'EXPORT_BACKUP' }).then(({ backup }) => ({
    pages: backup.stores.pages.map((page) => ({ section: page.section, step: page.step, characters: page.text.length })),
    stagedRuns: backup.stores.stagedRuns.map((staged) => ({ status: staged.status, results: Array.isArray(staged.results) ? staged.results.length : null, document: 'document' in staged })),
    snapshots: backup.stores.snapshots.length,
    largestJobCharacters: Math.max(0, ...backup.stores.jobs.map((job) => JSON.stringify(job).length))
  }))`);
}

// The service worker's JavaScript heap in megabytes, as it stands and after a collection. The debugger is attached
// only for the reading, so Chrome goes on treating the worker as it treats any other.
export async function workerHeap() {
  const target = [...chrome.targets.values()].find((candidate) => candidate.type === "service_worker" && candidate.url.startsWith(extensionOrigin));
  if (!target) return null;
  const session = await chrome.attach(target.targetId);
  try {
    const megabytes = async () => Number(((await session.send("Runtime.getHeapUsage")).usedSize / 1048576).toFixed(1));
    const inUse = await megabytes();
    await session.send("HeapProfiler.collectGarbage");
    return { inUse, held: await megabytes() };
  } finally {
    await chrome.send("Target.detachFromTarget", { sessionId: session.sessionId }).catch(() => {});
  }
}

export function extensionErrors() {
  return settings.evaluate(`chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }).then((items) => items.filter((item) => item.id === ${JSON.stringify(extensionId)}).flatMap((item) => [...item.manifestErrors, `
    + `...item.runtimeErrors].map((error) => error.message)))`);
}
