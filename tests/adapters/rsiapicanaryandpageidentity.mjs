// The RSI adapter's failed step, shared by the canary and page identity tests (PARSER_HARDENING.md §5.3, §5.4).
import assert from "node:assert/strict";

export async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("The step was expected to fail.");
}
