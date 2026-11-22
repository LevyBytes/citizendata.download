// What the worker restart scenario compares at its end (PARSER_HARDENING.md §15.5): the requests of the interrupted
// build against an uninterrupted build of an identical account, the status feed reads for one warning, and the
// dashboard's final state, log rows and announcements.
import assert from "node:assert/strict";
import { dashboard } from "./browser-pages-and-account-in-use.mjs";
import { STATUS_ORIGIN } from "./origins-keys-and-stand-in-image.mjs";
import { assertStep } from "./scenario-runner.mjs";

// The dashboard's live announcements, kept by the page itself across the worker's restarts.
export const WATCH_ANNOUNCEMENTS = `(() => { window.__restarts = { announced: [] }; const node = document.getElementById('buildStatusAnnouncement');
  new MutationObserver(() => window.__restarts.announced.push(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true }); return true; })()`;

// A request as RSI sees it, with the account's handle taken out so two accounts' builds compare.
export const key = (request, handle) => `${request.method} ${request.path.replace(handle, "{handle}")} ${request.page ?? ""} ${(request.operations ?? []).join(",")}`;
export function tally(account, handle) {
  const counts = new Map();
  for (const request of account.requests.filter((entry) => entry.origin !== STATUS_ORIGIN)) counts.set(key(request, handle), (counts.get(key(request, handle)) ?? 0) + 1);
  return counts;
}

// Against the uninterrupted build nothing was left out, and nothing was sent twice but what a restart is designed to
// repeat, each once. At this zero stagger a step runs in memory (§6.3: the durable phases apply only when the stagger
// is longer than brakes.maximumInStepWaitMs), so the profile step stopped at its third request runs again from its
// first. Billing page 1 is kept with the run's stored pages (§13.1), so a worker that restarted after reading it does
// not read it again. Returns the requests sent more than once.
export function assertRepeatsOnlyByDesign(account, handle, expected) {
  const sent = tally(account, handle);
  const mayRepeat = new Set([
    key({ method: "GET", path: `/en/citizens/${handle}`, page: null }, handle),
    key({ method: "POST", path: "/graphql", page: null, operations: ["GetAuthenticatedUser"] }, handle),
    key({ method: "POST", path: "/graphql", page: null, operations: ["GetAccountDashboardData"] }, handle)
  ]);
  const twice = [...sent].filter(([name, count]) => count > (expected.get(name) ?? 0)).map(([name, count]) => ({ name, more: count - (expected.get(name) ?? 0) }));
  const unexpected = twice.filter((entry) => !mayRepeat.has(entry.name) || entry.more > 1).map((entry) => `${entry.name} ${entry.more} more`);
  const missing = [...expected].filter(([name, count]) => (sent.get(name) ?? 0) < count).map(([name]) => name);
  assertStep(unexpected.length === 0 && missing.length === 0, `Against an uninterrupted build the restarted worker repeated: ${unexpected.join("; ")}; left out: ${missing.join("; ")}`);
  return twice;
}

// The status feed was asked once for one warning, across the worker restarts (criterion 25), and the dashboard ended on the final state, with no log
// row twice and no announcement repeated back to back. The page kept its announcements in window.__restarts.
export async function assertStatusReadsAndFinalPanel(account) {
  const statusRequests = account.requests.filter((entry) => entry.origin === STATUS_ORIGIN).length;
  assertStep(statusRequests === 1, `The worker asked the status feed ${statusRequests} times for one warning.`);
  const panel = await dashboard.evaluate("({ keys: [...document.querySelectorAll('#eventLog [data-log-key]')].map((row) => row.dataset.logKey), announced: window.__restarts.announced, " +
    "summary: document.getElementById('overlaySummary').textContent })");
  assert.equal(panel.summary, "COMPLETED", "The dashboard did not end on the final state.");
  assertStep(new Set(panel.keys).size === panel.keys.length, `The dashboard's log shows a row twice: ${panel.keys.length} rows, ${new Set(panel.keys).size} keys`);
  assertStep(panel.announced.length > 0 && panel.announced.every((text, index) => index === 0 || text !== panel.announced[index - 1]), `The dashboard announced a state twice in a row: ${JSON.stringify(panel.announced)}`);
  return { statusRequests, announcements: panel.announced.length };
}
