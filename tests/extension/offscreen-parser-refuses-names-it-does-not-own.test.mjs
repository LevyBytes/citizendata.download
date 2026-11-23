// The offscreen parser runs only a parser its own table names (platform/chromium/offscreen/parser.js): a name every
// object inherits, such as `constructor` or `toString`, an unknown name and a name that is not a string are refused
// before any markup is read, and a named parser still runs.
import assert from "node:assert/strict";
import test from "node:test";
import { offscreenParser } from "../support/extension-harness/offscreen-parser-document.mjs";

const parse = offscreenParser({ recordingConsole: console })().parse;
const request = (fragmentType) => parse({ kind: "CITIZENDATA_PARSE_RSI_MARKUP", fragmentType, html: "<main><p>x</p></main>", context: {} });

test("inherited, unknown and non-string fragment types are refused as not allowed", async () => {
  for (const fragmentType of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__", "isPrototypeOf", "unknownFragment", "", 7, null, ["profile"]]) {
    assert.deepEqual(await request(fragmentType), { ok: false, message: "RSI_FRAGMENT_TYPE_NOT_ALLOWED" }, String(fragmentType));
  }
});

test("a fragment type the parser table names still runs", async () => {
  const answer = await request("profile");
  assert.equal(answer.ok, true);
  assert.equal(typeof answer.pageRecognized, "boolean");
});
