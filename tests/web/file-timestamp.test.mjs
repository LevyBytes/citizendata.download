import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/scripts/file-timestamp.js");

test("download timestamps include UTC date, time, and milliseconds", () => {
  const api = globalThis.CitizenDataFileTimestamp;
  assert.equal(api.format("2026-11-18T22:33:47.621Z"), "2026-11-18-223347-621Z");
  assert.equal(api.format("invalid"), "undated-000000-000Z");
});
