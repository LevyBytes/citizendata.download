// The status feed checker with a stand-in host and a stored job, for the tests of its cache and races.
import path from "node:path";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { STATUS_FEED_VARIANTS } from "../support/synthetic-rsi/status-feed-answers.mjs";
import { authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { localAccountId, runnerApi } from "./runner-under-test.mjs";
import { root } from "../adapters/repository-root.mjs";

export const context = await loadClassicScripts([
  path.join(root, "extension", "shared", "request-pacing-settings.js"),
  path.join(root, "extension", "adapters", "rsi-status-page.js")
], { AbortController, setTimeout, clearTimeout, TextEncoder });

export const StatusPage = context.CitizenDataRsiStatusPage;

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const flush = () => new Promise((resolve) => setImmediate(resolve));

// The status host: each request recorded, answered with a named variant once `release()` is called, or at once.
export function statusHost(variant = "ok", { held = false } = {}) {
  const requests = [];
  let releases = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    if (held) await new Promise((resolve) => releases.push(resolve));
    const answer = STATUS_FEED_VARIANTS[variant]();
    return { status: answer.status, headers: { get: (name) => (name.toLowerCase() === "content-type" ? answer.contentType : null) }, text: async () => answer.body };
  };
  const release = () => {
    for (const resolve of releases) resolve();
    releases = [];
  };
  return { requests, fetcher, release };
}

// A checker as the worker configures it: the repository's durable cache and the status host's grant.
export function checkerOf(repository, host, clock) {
  return StatusPage.createChecker({ fetcher: host.fetcher, hasPermission: async () => true, cache: { get: () => repository.getStatusFeedCache(), put: (record) => repository.putStatusFeedCache(record) }, nowMs: () => clock.now });
}

export const page = (checkedAt, status = "issue") => ({ status, reason: null, components: status === "issue" ? [{ name: "Platform", state: "disrupted" }] : [], httpStatus: 200, checkedAt });

// A pledges job in the repository, with the warning and status page given.
export async function storedJob(repository, { status = "running", warning = "limited", statusPage = null, runId = null } = {}) {
  const clock = 2_000_000;
  const auth = authorizationRecord(clock, { selectedSections: ["pledges"], maximumRecordsBySection: { pledges: 500 }, parserVersions: { pledges: "1" }, expiresAt: new Date(clock + 6 * 3_600_000).toISOString(), idleTtlMs: 3_600_000,
    idleExpiresAt: new Date(clock + 3_600_000).toISOString() });
  const created = runnerApi.createJob({ jobId: `job-${status}-${warning}`, runId: runId ?? auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan: { selectedSections: ["pledges"],
    maximumRecordsBySection: { pledges: 500 }, minimumInterRequestDelayMs: 900 }, now: new Date(clock).toISOString() });
  const job = { ...created, status, pace: { ...created.pace, warning, statusPage } };
  await repository.saveJob(job);
  return job;
}
