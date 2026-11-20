// Holds every workflow under .github/workflows to the release controls: which events start it, what its token may do,
// how actions are pinned, and where the DCO check is read from. The files are read as text; nothing is run.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.github/workflows");
const workflows = readdirSync(workflowsFolder).map((name) => ({ name, lines: readFileSync(path.join(workflowsFolder, name), "utf8").split("\n") }));

// The lines under a top-level key, up to the next top-level key.
function block(lines, key) {
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}: `));
  assert.notEqual(start, -1, `no top-level ${key}`);
  const length = lines.slice(start + 1).findIndex((line) => /^\S/u.test(line));
  return lines.slice(start + 1, length === -1 ? lines.length : start + 1 + length).filter((line) => line.trim() !== "");
}

test("there is a workflow to hold to the contract", () => {
  assert.ok(workflows.length > 0);
});

test("a workflow starts on a pull request or a push to main, never on an event that hands a pull request's code a token that can write", () => {
  for (const { name, lines } of workflows) {
    const events = block(lines, "on").filter((line) => /^ {2}\S/u.test(line)).map((line) => line.trim());
    assert.deepEqual(events, ["pull_request:", "push:"], name);
    assert.deepEqual(block(lines, "on").filter((line) => /^ {4}\S/u.test(line)).map((line) => line.trim()), ["branches: [main]"], name);
    for (const refused of ["pull_request_target", "workflow_run", "issue_comment", "workflow_dispatch", "schedule"]) {
      assert.equal(lines.some((line) => line.includes(refused)), false, `${name} names ${refused}`);
    }
  }
});

test("a workflow's token reads the repository and nothing else, and no secret is named", () => {
  for (const { name, lines } of workflows) {
    assert.deepEqual(block(lines, "permissions"), ["  contents: read"], name);
    assert.equal(lines.filter((line) => /^\s*permissions:/u.test(line)).length, 1, `${name} sets permissions in one place`);
    assert.equal(lines.some((line) => /secrets\.|GITHUB_TOKEN|github\.token/u.test(line)), false, `${name} names a secret or the token`);
  }
});

test("every action is pinned to a full commit SHA with its version beside it, and a checkout keeps no credentials", () => {
  for (const { name, lines } of workflows) {
    const uses = lines.filter((line) => /^\s*(?:- )?uses:/u.test(line));
    assert.ok(uses.length > 0, name);
    for (const line of uses) assert.match(line, /uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u, `${name}: ${line.trim()}`);
    const checkouts = uses.filter((line) => line.includes("actions/checkout@")).length;
    assert.equal(lines.filter((line) => line.trim() === "persist-credentials: false").length, checkouts, `${name}: every checkout sets persist-credentials: false`);
  }
});

test("a value from the pull request reaches a command only as an environment value", () => {
  for (const { name, lines } of workflows) {
    for (const line of lines.filter((candidate) => candidate.includes("${{"))) assert.match(line, /^\s+(?:group|BASE|HEAD): /u, `${name}: ${line.trim()}`);
  }
});

test("the DCO check a pull request is held to is the one of its base, not its own copy", () => {
  const lines = workflows.find(({ name }) => name === "ci.yml").lines;
  const start = lines.indexOf("  dco:");
  assert.notEqual(start, -1);
  const job = lines.slice(start);
  assert.ok(job.includes("    if: github.event_name == 'pull_request'"));
  assert.ok(job.some((line) => line.trim() === 'git show "$BASE:scripts/check-dco.mjs" > "$RUNNER_TEMP/check-dco.mjs"'));
  assert.ok(job.some((line) => line.trim() === 'node "$RUNNER_TEMP/check-dco.mjs" "$BASE..$HEAD"'));
  assert.equal(job.some((line) => line.includes("node scripts/check-dco.mjs")), false);
});
