// Checks the size of every file of the test suite and of the tooling that tests: at most 100 lines a file, and at
// most 256 characters a line, whatever kind of file it is. Every line counts, comments and blank lines included, and
// nothing written in a file exempts it.
//
// Usage: node scripts/check-source-limits.mjs
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAXIMUM_LINES = 100;
export const MAXIMUM_LINE_CHARACTERS = 256;
// Every file under tests/, of any kind, and the tooling that tests or checks. The scripts that build or package
// (package-extension, sync-schemas, build-hangar-link-ships) are not covered yet.
const FOLDERS = ["tests", "scripts/verify"];
const TESTING_FILES = ["scripts/run-tests.mjs", "scripts/verify.mjs", "scripts/check-dco.mjs", "scripts/check-source-limits.mjs", "scripts/check-file-names.mjs",
  "scripts/run-linters.mjs", "eslint.config.mjs", "deno.jsonc", "biome.jsonc"];
// Folders a test run writes and removes.
const SKIPPED_FOLDER = /^(?:node_modules|work-temp-.*)$/u;

// What is wrong with one file's text, as sentences. No sentence when the text is within both limits.
export function limitFailures(text) {
  const lines = text.trimEnd().split(/\r?\n/u);
  const failures = [];
  if (lines.length > MAXIMUM_LINES) failures.push(`${lines.length} lines; the most a file may have is ${MAXIMUM_LINES}`);
  for (const [index, line] of lines.entries()) {
    const characters = [...line].length;
    if (characters > MAXIMUM_LINE_CHARACTERS) failures.push(`line ${index + 1} has ${characters} characters; the most a line may have is ${MAXIMUM_LINE_CHARACTERS}`);
  }
  return failures;
}

function filesUnder(folder) {
  const found = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDER.test(entry.name)) found.push(...filesUnder(path.join(folder, entry.name)));
    } else if (entry.isFile()) {
      found.push(path.join(folder, entry.name));
    }
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = [...FOLDERS.flatMap((folder) => filesUnder(path.join(repositoryRoot, folder))), ...TESTING_FILES.map((name) => path.join(repositoryRoot, name))];
  const failures = [];
  for (const file of files.sort()) {
    const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
    const text = readFileSync(file, "utf8");
    // A file that holds a zero byte is not text and has no lines.
    if (text.includes("\u0000")) continue;
    for (const failure of limitFailures(text)) failures.push(`${relative}: ${failure}`);
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(`FAIL source limits: ${failures.length} findings in ${new Set(failures.map((failure) => failure.split(":")[0])).size} of ${files.length} files`);
    process.exit(1);
  }
  console.log(`PASS source limits: ${files.length} files, each at most ${MAXIMUM_LINES} lines of at most ${MAXIMUM_LINE_CHARACTERS} characters`);
}
