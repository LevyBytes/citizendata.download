import assert from "node:assert/strict";
import test from "node:test";
import { parseBoundedJson } from "./safe-json-under-test.mjs";

test("accepted documents equal the native parse", () => {
  const cases = [
    "null",
    "0",
    "-0",
    "-12.5e+3",
    "1E-7",
    "\"plain\"",
    "\"escapes \\\" \\\\ \\/ \\b \\f \\n \\r \\t \\u00e9 \\ud83d\\ude80\"",
    "[]",
    "{}",
    " \t\r\n{ \"a\" : [ 1 , -2.5 , true , false , null , \"x\" ] , \"b\" : { \"c\" : {} } } \r\n",
    "[1,[2,[3,[4]]]]"
  ];
  for (const source of cases) assert.deepEqual(parseBoundedJson(source), JSON.parse(source), source);
});

test("malformed documents are rejected before the native parse", () => {
  const cases = [
    "",
    " ",
    "{\"a\":01}",
    "[1,]",
    "{\"a\":1,}",
    "[1 2]",
    "[-]",
    "[1.]",
    "[.5]",
    "[+1]",
    "1e",
    "[1e+]",
    "{a:1}",
    "{\"a\" 1}",
    "[\"unterminated]",
    "[\"bad \\x escape\"]",
    "[\"bad \\u12g4 escape\"]",
    "[\"raw\ttab\"]",
    "[1]]",
    "[1] trailing",
    "nul",
    "[tru]"
  ];
  for (const source of cases) assert.throws(() => parseBoundedJson(source), Error, JSON.stringify(source));
});

test("only the four JSON whitespace characters separate tokens", () => {
  for (const space of [" ", "\t", "\n", "\r"]) assert.deepEqual(parseBoundedJson(`${space}[1,${space}2]${space}`), [1, 2]);
  for (const other of ["\u00a0", "\u2028", "\ufeff", "\u000b", "\u000c"]) {
    assert.throws(() => parseBoundedJson(`${other}[1]`), Error, `leading U+${other.charCodeAt(0).toString(16)}`);
    assert.throws(() => parseBoundedJson(`[1,${other}2]`), Error, `inner U+${other.charCodeAt(0).toString(16)}`);
    assert.throws(() => parseBoundedJson(`[1]${other}`), Error, `trailing U+${other.charCodeAt(0).toString(16)}`);
  }
});

test("duplicate keys are rejected at every depth and distinct keys are kept", () => {
  assert.throws(() => parseBoundedJson("{\"a\":1,\"a\":2}"), /Duplicate JSON key "a"/u);
  assert.throws(() => parseBoundedJson("{\"outer\":{\"k\":1,\"k\":1}}"), /Duplicate JSON key "k"/u);
  assert.throws(() => parseBoundedJson("{\"a\":1,\"\\u0061\":2}"), /Duplicate JSON key "a"/u);
  assert.deepEqual(parseBoundedJson("{\"a\":{\"k\":1},\"b\":{\"k\":2}}"), { a: { k: 1 }, b: { k: 2 } });
});
