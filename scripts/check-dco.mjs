// Checks that every commit of a Git revision range carries a Developer Certificate of Origin sign-off by its author:
// a line "Signed-off-by: <author name> <author e-mail>" in the commit message. Merge commits are not checked.
// Usage: node scripts/check-dco.mjs <revision range, as base..head>
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function hasSignOff({ name, email, message }) {
  const wanted = `${name} <${email}>`.toLowerCase();
  return String(message).split(/\r?\n/u).some((line) => {
    const match = /^Signed-off-by:\s*(.+?)\s*$/u.exec(line);
    return match !== null && match[1].toLowerCase() === wanted;
  });
}

function git(...parameters) {
  return execFileSync("git", parameters, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const range = process.argv[2];
  if (!range || range.startsWith("-")) {
    console.error("Usage: node scripts/check-dco.mjs <revision range, as base..head>");
    process.exit(2);
  }
  const commits = git("rev-list", "--no-merges", range, "--").split("\n").filter(Boolean);
  const missing = [];
  for (const commit of commits) {
    const [name, email, ...message] = git("show", "--no-patch", "--format=%an%n%ae%n%B", commit).split("\n");
    if (!hasSignOff({ name, email, message: message.join("\n") })) missing.push(`${commit.slice(0, 12)} ${name} <${email}>`);
  }
  if (missing.length > 0) {
    console.error(`FAIL ${missing.length} of ${commits.length} commits lack "Signed-off-by:" by their author (git commit --signoff):`);
    for (const line of missing) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`PASS ${commits.length} commits signed off by their author`);
}
