import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LIMITS, parseBoundedJson } from "./safe-json-under-test.mjs";

test("every configured limit is enforced", () => {
  assert.throws(() => parseBoundedJson("{\"value\":\"abcd\"}", { maxBytes: 8 }), /byte limit/u);
  assert.throws(() => parseBoundedJson("\"\u00e9\u00e9\u00e9\"", { maxBytes: 7 }), /byte limit/u);
  assert.throws(() => parseBoundedJson("[[[0]]]", { maxDepth: 2 }), /nesting is too deep/u);
  assert.deepEqual(parseBoundedJson("[[[0]]]", { maxDepth: 3 }), [[[0]]]);
  assert.throws(() => parseBoundedJson("[1,2,3]", { maxNodes: 3 }), /too many values/u);
  assert.deepEqual(parseBoundedJson("[1,2,3]", { maxNodes: 4 }), [1, 2, 3]);
  assert.throws(() => parseBoundedJson("\"abcdef\"", { maxStringLength: 5 }), /string is too long/u);
  assert.throws(() => parseBoundedJson("{\"abcdef\":1}", { maxStringLength: 5 }), /string is too long/u);
  assert.throws(() => parseBoundedJson("[1,2,3]", { maxArrayItems: 2 }), /too many items/u);
  assert.throws(() => parseBoundedJson("{\"a\":1,\"b\":2,\"c\":3}", { maxObjectProperties: 2 }), /too many properties/u);
  assert.throws(() => parseBoundedJson(42), /must be text/u);
  assert.equal(DEFAULT_LIMITS.maxBytes, 128 * 1024 * 1024);
  assert.ok(Object.isFrozen(DEFAULT_LIMITS));
});

test("number scanning is position based and does not depend on earlier matches", () => {
  const numbers = Array.from({ length: 2000 }, (_, index) => (index % 2 ? -index * 1.25 : index * 1e3));
  const source = JSON.stringify({ numbers, nested: numbers.map((value) => ({ value })) });
  assert.deepEqual(parseBoundedJson(source), JSON.parse(source));
  assert.deepEqual(parseBoundedJson("[10,20]"), [10, 20]);
  assert.throws(() => parseBoundedJson("[10,x20]"), /Invalid JSON number/u);
  assert.deepEqual(parseBoundedJson("[7]"), [7]);
});

test("a large record list is scanned in linear time", () => {
  const build = (count) => JSON.stringify(Array.from({ length: count }, (_, index) => ({ id: index, price: index * 1.5, title: `Record ${index}` })));
  const small = build(20000);
  const large = build(160000);
  const time = (source) => {
    const started = performance.now();
    parseBoundedJson(source);
    return performance.now() - started;
  };
  time(small);
  const smallMs = Math.max(1, time(small));
  const largeMs = time(large);
  // Eight times the input should cost roughly eight times the work; a quadratic scan would cost about sixty-four times.
  assert.ok(largeMs < smallMs * 32, `8x input took ${(largeMs / smallMs).toFixed(1)}x the time`);
});
