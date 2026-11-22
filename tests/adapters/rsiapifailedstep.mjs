// A step of the RSI adapter in its own sandbox, run until it fails, for the tests of what a failed step keeps.
import assert from "node:assert/strict";

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const ACCOUNT = { accountId: "VerifiedCitizen", cursor: null };

export async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("The step was expected to fail.");
}
