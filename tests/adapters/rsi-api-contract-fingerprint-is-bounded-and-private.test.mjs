// A changed contract leaves a privacy-safe finding before its answer is let go (PARSER_HARDENING.md §5.7): the
// request and answer's shape, the hash of the exact bytes, and a key that is the same for the same answer. No body,
// token, cookie, authorization, other origin or unbounded name reaches the finding.
import assert from "node:assert/strict";
import test from "node:test";
import { sha256, MISMATCH, finding } from "./rsiapicontractfinding.mjs";

test("the finding holds what was asked, what came back and its shape, and the hash of the exact bytes", async () => {
  const { finding: kept } = await finding([MISMATCH]);
  const bytes = JSON.stringify(MISMATCH);
  assert.deepEqual(
    { ...kept, findingKey: "key", observedAt: "time" },
    {
      findingKey: "key",
      section: "hangarLog",
      code: "RSI_HANGAR_LOG_PAGE_MISMATCH_REQUESTED_1_OBSERVED_3",
      method: "POST",
      route: "/api/account/pledgeLog",
      page: 1,
      httpStatus: 200,
      contentType: "application/json",
      byteLength: Buffer.byteLength(bytes),
      bodySha256: sha256(bytes),
      bodyTruncated: false,
      finalRoute: "/api/account/pledgeLog",
      pageMarkers: {},
      topLevelKeys: ["success", "data"],
      operationNames: [],
      observedAt: "time",
      sourceUrls: kept.sourceUrls
    }
  );
  assert.ok(!Number.isNaN(Date.parse(kept.observedAt)));
});

test("the finding key is the hash of the canonical field list: the same answer, the same key; another body, another key", async () => {
  const { finding: first } = await finding([MISMATCH]);
  const { finding: again } = await finding([MISMATCH]);
  assert.equal(first.findingKey, again.findingKey);
  const listed = [first.section, first.code, first.method, first.route, first.page, first.httpStatus, first.contentType, first.byteLength, first.bodySha256, first.bodyTruncated, first.finalRoute, first.pageMarkers, first.topLevelKeys,
    first.operationNames];
  assert.equal(first.findingKey, sha256(JSON.stringify(listed)));
  const { finding: other } = await finding([{ ...MISMATCH, extra: true }]);
  assert.notEqual(other.findingKey, first.findingKey);
});

test("no body value, token, cookie or authorization reaches the finding, and only bounded names are kept", async () => {
  const names = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`key${index}`, index]));
  const body = { ...MISMATCH, email: "pilot@example.com", note: "private words", ["x".repeat(81)]: 1, "has space": 1, ...names };
  const headers = { "set-cookie": "Rsi-Token=cookie-value", authorization: "Bearer header-value", "x-rsi-token": "answer-token" };
  const { finding: kept, sandbox } = await finding([{ kind: "json", body, headers }]);
  const text = JSON.stringify(kept);
  for (const secret of ["pilot@example.com", "private words", "cookie-value", "header-value", "answer-token", "transient-test-token", "Bearer"]) {
    assert.ok(!text.includes(secret), `${secret} is not kept`);
  }
  // The request did carry the session token: the finding leaves it out.
  assert.equal(sandbox.calls.find((call) => call.kind === "fetch").options.headers["X-Rsi-Token"], "transient-test-token");
  assert.equal(kept.topLevelKeys.length, 32);
  assert.ok(kept.topLevelKeys.every((key) => key.length <= 80 && /^[A-Za-z0-9_.$@-]+$/u.test(key)));
  assert.ok(!kept.topLevelKeys.includes("has space"));
});

test("the final route is same-origin path and query only: no credentials, fragment or other origin", async () => {
  const at = async (finalUrl) => (await finding([{ kind: "json", body: MISMATCH, finalUrl }])).finding.finalRoute;
  assert.equal(await at("https://user:secret@robertsspaceindustries.com/api/account/pledgeLog?page=1#private"), "/api/account/pledgeLog?page=1");
  assert.equal(await at("https://elsewhere.example/api/account/pledgeLog"), null);
  assert.equal(await at(""), null, "an answer without its own address proves no final route");
});
