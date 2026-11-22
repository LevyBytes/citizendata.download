// GraphQL answers with errors beside data (PARSER_HARDENING.md §5.7), and the RSI adapter's failed step, shared by
// the profile, referral and CCU tests.
import assert from "node:assert/strict";

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const ERROR = { message: "Field badgeIcons failed", extensions: { code: "INTERNAL", stack: "not kept" } };

export const LIMIT = { message: "Too many requests, try again later" };

export async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("The step was expected to fail.");
}
