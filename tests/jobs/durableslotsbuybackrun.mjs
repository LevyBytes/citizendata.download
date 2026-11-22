// A slowed buyback run of the real runner, live runtime and RSI adapter, and the schedule its requests keep, for
// the durable request slot tests.
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { root } from "../adapters/repository-root.mjs";
import { harness } from "../adapters/rsi-api-in-a-sandbox.mjs";
import { authorizationRecord } from "./runner-fixture-authorization-profile-and-assembly.mjs";
import { databaseApi, localAccountId, paceApi, pacingSettings, runnerApi } from "./runner-under-test.mjs";
import { testClock } from "./durableslotsvirtualclock.mjs";

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const SECOND = 1000;

export const WINDOWS_MS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((seconds) => seconds * SECOND);

export const liveRuntimeSource = await readFile(path.join(root, "extension", "adapters", "live-runtime.js"), "utf8");

export const BUYBACKS = pacingSettings.accountBuild.sections.buybacks;

export const buybackPage = (page, pageCount) => ({ success: 1, code: "OK", data: { rendered: `<article data-page="${page}"></article>`, page, pagecount: pageCount } });

export const pageOf = (call) => JSON.parse(call.options.body).page;

// A worker: the RSI adapter and the live runtime in one realm, as in the service worker, with its own empty caches.
export function worker(responses, clock, starts) {
  const fixture = harness(responses, {
    buybacks: (message) => {
      const page = Number(/data-page="([0-9]+)"/u.exec(message.html)?.[1]);
      return { raw: [{ buybackId: page, title: `Buy-back ${page}` }] };
    }
  }, { globals: clock.globals });
  vm.runInContext(liveRuntimeSource, fixture.context, { filename: "live-runtime.js" });
  const live = fixture.context.CitizenDataLiveRuntime.createAdapter({ id: "buybacks", parser: "parseBuybacks", version: "1" });
  const adapter = {
    ...live,
    section: "buybacks",
    // Each request's start, as the runner reserves it before the request is sent.
    collectStep: (input) => live.collectStep({ ...input, onRequestActivity: async (activity) => { starts.push(clock.now); return input.onRequestActivity(activity); } })
  };
  return { fixture, adapter };
}

// A buy-backs run of `pageCount` pages that starts at `factor`. `restart()` replaces the worker, as when Chrome stops it.
export async function buybackRun({ factor, pageCount = 40, responses = null }) {
  const clock = testClock(5_000_000);
  const starts = [];
  const answers = responses ?? Array.from({ length: pageCount }, (_, index) => buybackPage(index + 1, pageCount));
  const repository = databaseApi.createMemoryRepository();
  const plan = { selectedSections: ["buybacks"], maximumRecordsBySection: { buybacks: 1000 }, minimumInterRequestDelayMs: 900 };
  const auth = authorizationRecord(clock.now, { selectedSections: ["buybacks"], maximumRecordsBySection: { buybacks: 1000 }, parserVersions: { buybacks: "1" }, expiresAt: new Date(clock.now + 6 * 3_600_000).toISOString(), idleTtlMs: 3_600_000,
    idleExpiresAt: new Date(clock.now + 3_600_000).toISOString() });
  const created = runnerApi.createJob({ jobId: "job-slots", runId: auth.runId, accountId: auth.accountId, authorizationId: auth.authorizationId, localAccountId, plan, now: new Date(clock.now).toISOString() });
  const job = { ...created, pace: { ...paceApi.atBaseline(pacingSettings), factor } };
  await repository.saveAuthorization(auth);
  await repository.saveJob(job);
  await repository.saveStagedRun({ runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], receipts: [] });
  const run = { clock, starts, answers, repository, job, steps: [], workers: [] };
  run.restart = () => {
    const { fixture, adapter } = worker(answers, clock, starts);
    run.workers.push(fixture);
    run.runner = runnerApi.createSerialRunner({ repository, registry: { adapters: [adapter] }, nowMs: () => clock.now, random: () => 0.5, assembleDocument: async () => ({ document: {} }) });
  };
  run.restart();
  run.pendingKey = databaseApi.pendingPageKey(job.collectionId, "buybacks");
  run.fetches = () => run.workers.flatMap((fixture) => fixture.calls.filter((call) => call.kind === "fetch"));
  // One tick at the job's next time, or `wake` past it. A step that starts here is noted with its interval and stagger.
  run.tick = async ({ wake = (dueMs) => dueMs } = {}) => {
    const current = await repository.getJob(job.jobId);
    clock.now = Math.max(clock.now, wake(Date.parse(current.nextEligibleAt)));
    if (current.pendingStep === null) {
      const intervalMs = paceApi.stepIntervalMs({ baseline: BUYBACKS, planFloorMs: plan.minimumInterRequestDelayMs, pace: current.pace, settings: pacingSettings, random: () => 0.5 });
      run.steps.push({ startedAtMs: clock.now, intervalMs, staggerMs: Math.floor((intervalMs * pacingSettings.accountBuild.staggerPercent) / 100), firstRequest: starts.length });
    }
    await run.runner.tick(job.jobId);
    return await repository.getJob(job.jobId);
  };
  return run;
}

// The most request starts any window of `windowMs` holds.
export function busiest(starts, windowMs) {
  let most = 0;
  for (let last = 0, first = 0; last < starts.length; last += 1) {
    while (starts[last] - starts[first] >= windowMs) first += 1;
    most = Math.max(most, last - first + 1);
  }
  return most;
}
