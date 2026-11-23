import assert from "node:assert/strict";
import test from "node:test";
import { nameFailure } from "../../scripts/check-file-names.mjs";

test("a name that says what the file is passes, with the numbers that are part of that", () => {
  for (const name of ["runner-pause-and-resume.test.mjs", "synthetic-rsi.js", "check-source-limits.mjs", "sha256-of-a-saved-backup.test.mjs", "layout-at-380px.mjs",
    "watchdog-after-30-seconds.mjs", "files-over-100-lines.test.mjs", "release-0.42.2.test.mjs"]) {
    assert.equal(nameFailure(name, true), null, name);
  }
  for (const name of ["web", "hero-motion", "e2e"]) assert.equal(nameFailure(name, false), null, name);
});

test("a position, a hash, a line of code, or a name too short is refused", () => {
  assert.equal(nameFailure("dashboard-checks-2.mjs", true), "a number where its name should say what it is");
  assert.equal(nameFailure("part3", false), "a number where its name should say what it is");
  assert.equal(nameFailure("data12.js", true), "a number where its name should say what it is");
  assert.equal(nameFailure("fixture-97dc70bf.json", true), "a hash where its name should say what it is");
  assert.equal(nameFailure("document-add-event-listener-click.mjs", true), 'named after its code ("add-event-listener") instead of what it is');
  assert.equal(nameFailure("const-rows.mjs", true), 'named after its code ("const") instead of what it is');
  assert.equal(nameFailure("io.mjs", true), "a name too short to say what it is");
  assert.equal(nameFailure("ab.test.mjs", true), "a name too short to say what it is");
});
