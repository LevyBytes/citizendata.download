import assert from "node:assert/strict";
import { createExtensionHarness } from "../support/extension-harness.mjs";

export function resultOf(tab) {
  return tab.events.find((event) => event.result)?.result ?? null;
}

export function longestGap(requests) {
  let longest = 0;
  for (let index = 1; index < requests.length; index += 1) longest = Math.max(longest, requests[index].at - requests[index - 1].at);
  return longest;
}

// Requests for a page after the first, by path: the lists an update paged through.
export function pagedThrough(requests) {
  return [...new Set(requests.filter((request) => (request.page ?? 1) > 1).map((request) => request.path))].sort();
}

// Starts a build from a hosted dashboard tab and lets it run until `requests` RSI requests were made.
export async function runningBuild(options = {}, requests = 8) {
  const harness = await createExtensionHarness(options);
  const tab = harness.openTab();
  const started = await tab.build();
  assert.equal(started.code, "RUN_STARTED", started.message);
  await harness.advance(() => harness.rsi.requests.length >= requests);
  return { harness, tab, started };
}

// What the extension's database holds for collection, read straight from the in-memory stand-in for IndexedDB.
export function kept(harness) {
  const stores = harness.repository.inspect();
  const plain = (map) => JSON.parse(JSON.stringify([...map.values()]));
  return { pages: plain(stores.pages), stagedRuns: plain(stores.stagedRuns), jobs: plain(stores.jobs), snapshots: plain(stores.snapshots) };
}
