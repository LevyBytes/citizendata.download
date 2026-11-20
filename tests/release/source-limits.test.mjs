import assert from "node:assert/strict";
import test from "node:test";
import { MAXIMUM_LINES, MAXIMUM_LINE_CHARACTERS, limitFailures } from "../../scripts/check-source-limits.mjs";

const lines = (count, line = "x") => `${Array.from({ length: count }, () => line).join("\n")}\n`;

test("a file may hold 100 lines of 256 characters, and every line counts", () => {
  assert.equal(MAXIMUM_LINES, 100);
  assert.equal(MAXIMUM_LINE_CHARACTERS, 256);
  assert.deepEqual(limitFailures(lines(100, "x".repeat(256))), []);
  assert.deepEqual(limitFailures(lines(101)), ["101 lines; the most a file may have is 100"]);
  // A comment or a blank line is a line like any other, and nothing a file says exempts it.
  assert.deepEqual(limitFailures(`// limits: off\n${"\n".repeat(99)}last`), ["101 lines; the most a file may have is 100"]);
  // Blank lines after the last line of text are not lines of the file.
  assert.deepEqual(limitFailures(`${lines(100)}\n\n\n`), []);
});

test("a line is measured in characters, and each line that is too long is named", () => {
  const long = "x".repeat(257);
  assert.deepEqual(limitFailures(`short\n${long}\nshort\r\n${long}`), [
    "line 2 has 257 characters; the most a line may have is 256",
    "line 4 has 257 characters; the most a line may have is 256"
  ]);
  // A character outside the basic plane is one character, though JavaScript stores it as two units.
  assert.deepEqual(limitFailures("\u{1F680}".repeat(256)), []);
  assert.deepEqual(limitFailures("\u{1F680}".repeat(257)), ["line 1 has 257 characters; the most a line may have is 256"]);
});
