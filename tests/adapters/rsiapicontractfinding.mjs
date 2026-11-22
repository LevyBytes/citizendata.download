// A changed contract's finding (PARSER_HARDENING.md §5.7), read from the RSI adapter in its sandbox, for the tests of
// the finding's contents and bounds.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export const ACCOUNT = { accountId: "VerifiedCitizen", cursor: null };

// An accepted Hangar Log answer for another page than the one asked: a changed contract.
export const MISMATCH = { success: 1, data: { page: 3, pagecount: 4, rendered: "" } };

export async function finding(responses, descriptor = { id: "hangarLog" }) {
  const sandbox = harness(responses);
  try {
    await sandbox.api.collectStep(descriptor, ACCOUNT);
  } catch (error) {
    assert.equal(error.signal.kind, "contract", error.message);
    return { finding: plain(error.contractFinding), sandbox };
  }
  return assert.fail("The step was expected to fail.");
}
