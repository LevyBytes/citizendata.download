// The two trees the check compares, each a folder that holds docs/ and extension/: the reference, read from a commit
// with `git cat-file` (Git only reads) or copied from --reference-folder, and the current files of this checkout.
import { spawnSync } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { reference, referenceFolder, repositoryRoot, scratch } from "./options-and-evidence-folders.mjs";

const FOLDERS = ["docs", "extension"];

function git(parameters, input) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...parameters], { input, maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
  if (result.error) throw new Error(`git could not be run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${parameters[0]} failed: ${result.stderr.toString("utf8").trim()}`);
  return result.stdout;
}

// The files of docs/ and extension/ at the commit, written under `target`. One `git cat-file --batch` reads them all;
// it answers each name with "<object> <type> <size>", a newline, the bytes, and a newline.
async function writeCommit(commit, target) {
  const names = git(["ls-tree", "-r", "-z", "--name-only", commit, "--", ...FOLDERS]).toString("utf8").split("\0").filter(Boolean);
  if (names.length === 0) throw new Error(`${commit} holds no docs/ or extension/ files`);
  const answer = git(["cat-file", "--batch"], names.map((name) => `${commit}:${name}\n`).join(""));
  let offset = 0;
  for (const name of names) {
    const headerEnd = answer.indexOf(0x0a, offset);
    const [, type, size] = answer.subarray(offset, headerEnd).toString("utf8").split(" ");
    if (type !== "blob") throw new Error(`${commit}:${name} is not a file (${type ?? "no answer"})`);
    const start = headerEnd + 1;
    const end = start + Number(size);
    const file = path.join(target, ...name.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, answer.subarray(start, end));
    offset = end + 1;
  }
}

// Returns { referenceTree, currentTree, referenceName }.
export async function prepareTrees() {
  const referenceTree = path.join(scratch, "reference");
  const currentTree = path.join(scratch, "current");
  let referenceName;
  if (referenceFolder) {
    for (const folder of FOLDERS) await cp(path.join(referenceFolder, folder), path.join(referenceTree, folder), { recursive: true });
    referenceName = referenceFolder;
  } else {
    const commit = git(["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`]).toString("utf8").trim();
    await writeCommit(commit, referenceTree);
    referenceName = `${reference} (${commit.slice(0, 12)})`;
  }
  for (const folder of FOLDERS) await cp(path.join(repositoryRoot, folder), path.join(currentTree, folder), { recursive: true });
  return { referenceTree, currentTree, referenceName };
}
