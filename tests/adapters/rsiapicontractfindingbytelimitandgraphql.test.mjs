// The bounds of a changed contract's finding (PARSER_HARDENING.md §5.7): at most 2 MiB of the exact bytes is read and
// hashed, the byte length is the answer's own safe length, and a GraphQL change names its operations and top-level
// keys.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { plain, MISMATCH, finding } from "./rsiapicontractfinding.mjs";

const MIB = 1024 * 1024;

test("at most 2 MiB is read: at the bound the exact bytes are hashed, above it the copy is cancelled and no hash is kept", async () => {
  const atBound = await finding([{ kind: "json", body: MISMATCH, stream: { chunkBytes: MIB, chunks: 2 } }]);
  const expected = createHash("sha256").update(new Uint8Array(MIB).fill(1)).update(new Uint8Array(MIB).fill(2)).digest("hex");
  assert.deepEqual([atBound.finding.bodySha256, atBound.finding.bodyTruncated, atBound.finding.byteLength], [expected, false, 2 * MIB]);
  assert.deepEqual(plain(atBound.sandbox.streams), [{ chunksRead: 2, cancelled: false }]);

  const over = await finding([{ kind: "json", body: MISMATCH, stream: { chunkBytes: MIB, chunks: 3 } }]);
  assert.deepEqual([over.finding.bodySha256, over.finding.bodyTruncated, over.finding.byteLength], [null, true, null]);
  assert.deepEqual(plain(over.sandbox.streams), [{ chunksRead: 3, cancelled: true }], "reading stops at the first chunk past the bound");
  assert.notEqual(over.finding.findingKey, atBound.finding.findingKey);
});

test("the byte length is the answer's own safe length when it gives one, otherwise the bytes read", async () => {
  const declared = await finding([{ kind: "json", body: MISMATCH, headers: { "content-length": "12345" } }]);
  assert.equal(declared.finding.byteLength, 12345);
  const unsafe = await finding([{ kind: "json", body: MISMATCH, headers: { "content-length": "many" } }]);
  assert.equal(unsafe.finding.byteLength, Buffer.byteLength(JSON.stringify(MISMATCH)));
});

test("a GraphQL contract change names its operations and the answer's top-level keys", async () => {
  const descriptor = { id: "referrals.legacy.recruits", parserOptions: { ladder: "legacy", kind: "recruits" } };
  const { finding: kept } = await finding([[{ data: { referralRecruitsList: { data: [] } } }]], descriptor);
  assert.deepEqual([kept.section, kept.code, kept.operationNames, kept.topLevelKeys], ["referrals.legacy.recruits", "RSI_REFERRAL_CONTRACT_CHANGED", ["GetReferralRecruitsList"], ["data"]]);
});
