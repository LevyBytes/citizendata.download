import assert from "node:assert/strict";
import test from "node:test";
import { SafeJson } from "./dashboard-scripts-under-test.mjs";

test("bounded parser accepts strict JSON and rejects duplicate keys", () => {
  assert.deepEqual(SafeJson.parseBoundedJson('{"a":1,"b":[true,null]}'), { a: 1, b: [true, null] });
  assert.throws(() => SafeJson.parseBoundedJson('{"a":1,"a":2}'), /Duplicate JSON key/u);
});

test("bounded parser enforces bytes, depth, and item ceilings", () => {
  assert.throws(() => SafeJson.parseBoundedJson('{"value":"abcd"}', { maxBytes: 8 }), /byte limit/u);
  assert.throws(() => SafeJson.parseBoundedJson('[[[0]]]', { maxDepth: 2 }), /nesting is too deep/u);
  assert.throws(() => SafeJson.parseBoundedJson('[1,2,3]', { maxArrayItems: 2 }), /too many items/u);
  assert.throws(() => SafeJson.parseBoundedJson('[1,2,3]', { maxNodes: 3 }), /too many values/u);
});

test("bounded parser accepts account-scale JSON beyond the former 25 MiB and 250,000-value ceilings", () => {
  assert.equal(SafeJson.DEFAULT_LIMITS.maxBytes, 128 * 1024 * 1024);
  const source = JSON.stringify({ records: Array.from({ length: 300000 }, () => 0) });
  assert.equal(SafeJson.parseBoundedJson(source).records.length, 300000);
});
