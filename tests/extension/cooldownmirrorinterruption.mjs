// The helpers of service-worker-cool-down-record-and-mirror-interruption.test.mjs: the mirror keys, a worker ended at
// a mirror write, and the checks that the mirrors and every shown revision agree with the runtime record.
import assert from "node:assert/strict";
import { STATE_KEY } from "../support/extension-harness.mjs";
import { IDENTIFY, RETRY_NOT_BEFORE_KEY, refused } from "./serviceworkeridentifyrefusals.mjs";

export const START_DIAGNOSIS_KEY = "citizendata.startDiagnosis";
export const COOL_DOWN_ALARM = "citizendata.coolDownEnds";
export const coolDownOf = (value) => value?.retryNotBefore ?? null;
export const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
// Each mirror write, and how its value reads while a cool-down holds.
export const MIRRORS = [[STATE_KEY, (value) => coolDownOf(value) !== null], [RETRY_NOT_BEFORE_KEY, (value) => value !== null], [START_DIAGNOSIS_KEY, (value) => value !== null]];

// Ends the worker at the next write of `key` whose value `matches`: before that write is stored, or just after it.
export function endWorkerAtMirrorWrite(harness, key, matches, afterWrite) {
  const set = harness.local.set.bind(harness.local);
  const ended = { at: null };
  harness.local.set = (name, value) => {
    if (name !== key || ended.at || !matches(value)) return set(name, value);
    ended.at = afterWrite ? "after" : "before";
    if (afterWrite) set(name, value);
    harness.stopWorker();
    return harness.local;
  };
  return ended;
}

// Every status the dashboard was shown, pushed or polled: one revision is never shown with two cool-downs.
export function assertOneCoolDownPerRevision(statuses) {
  const shownWith = new Map();
  for (const status of statuses) {
    const shape = JSON.stringify([status.retryNotBefore ?? null, status.startDiagnosis?.checkedAt ?? null]);
    const earlier = shownWith.get(status.statusRevision);
    assert.ok(earlier === undefined || earlier === shape, `revision ${status.statusRevision} was shown as ${earlier} and as ${shape}`);
    shownWith.set(status.statusRevision, shape);
  }
}

// After the restart, every mirror agrees with the record, and the alarm at the cool-down's end exists while it lasts.
export async function assertMirrorsRepaired(harness) {
  const record = await harness.repository.getRuntime();
  assert.equal(coolDownOf(harness.state()), coolDownOf(record));
  assert.equal(harness.local.get(RETRY_NOT_BEFORE_KEY) ?? null, coolDownOf(record));
  assert.deepEqual(plain(harness.local.get(START_DIAGNOSIS_KEY)), plain(record.startDiagnosis));
  assert.equal(harness.alarms.has(COOL_DOWN_ALARM), coolDownOf(record) !== null, "the alarm at the cool-down's end");
  return record;
}

export async function refusedStart(harness, tab) {
  harness.rsi.failNext((request) => request.path === IDENTIFY, { ...refused(), times: 1000 });
  return tab.build().then((answer) => answer, () => null);
}
