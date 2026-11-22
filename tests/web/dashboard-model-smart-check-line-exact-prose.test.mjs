// The smart-check log line, W-19 (PARSER_HARDENING.md §11.3), in its exact prose for every result, and only as far as
// the evidence goes: "no answer" only when nothing came back, "refused" only for an HTTP answer in the limit or
// transient class, and any other answer as its HTTP status.
import assert from "node:assert/strict";
import test from "node:test";
import { Model } from "./dashboard-scripts-under-test.mjs";

const at = "2026-11-21T20:00:00.000Z";
const check = (kind, outcome, httpStatus = null) => ({ kind: "smart-check", at, section: "buybacks", check: kind, outcome, httpStatus });
const line = (probe, status) => Model.activityRows([{ ...probe, seq: 1 }, { ...status, seq: 2 }]).map((row) => row.message);

test("the give-up's two checks are one line, in W-19's exact words where the evidence shows them", () => {
  const statuses = { ok: "ok", issue: "problem", unknown: "unavailable" };
  const probes = [
    [check("public-page", "answered", 200), "answered"],
    [check("public-page", "refused", 429), "refused"],
    [check("public-page", "refused", 503), "refused"],
    [check("public-page", "refused", null), "no answer"],
    [check("public-page", "failed", null), "no answer"],
    [check("public-page", "failed", 404), "HTTP 404"],
    [check("public-page", "failed", 200), "HTTP 200"]
  ];
  for (const [probe, word] of probes) {
    for (const [outcome, status] of Object.entries(statuses)) {
      assert.deepEqual(line(probe, check("status-page", outcome, outcome === "unknown" ? null : 200)), [`Check · without login: ${word} · RSI status: ${status}.`], `${probe.outcome} ${probe.httpStatus} / ${outcome}`);
    }
  }
});

test("a status read alone names the status only, and an unknown result writes no line", () => {
  assert.deepEqual(Model.activityRows([{ ...check("status-page", "ok", 200), seq: 3 }]).map((row) => row.message), ["Check · RSI status: ok."]);
  assert.deepEqual(Model.activityRows([{ ...check("status-page", "issue", 200), seq: 4 }]).map((row) => row.message), ["Check · RSI status: problem."]);
  assert.deepEqual(Model.activityRows([{ ...check("status-page", "unknown"), seq: 5 }]).map((row) => row.message), ["Check · RSI status: unavailable."]);
  assert.deepEqual(Model.activityRows([{ ...check("public-page", "maybe", 200), seq: 6 }]), []);
  // Every line is a warning row and names no rate, count or factor.
  for (const row of Model.activityRows([{ ...check("public-page", "failed", 404), seq: 7 }, { ...check("status-page", "issue", 200), seq: 8 }])) {
    assert.equal(row.tone, "warning");
    assert.doesNotMatch(row.message, /\b(factor|requests?|per (second|minute|hour)|working)\b|%/iu);
  }
});
