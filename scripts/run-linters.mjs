// Runs ESLint, Deno's linter and Biome's linter over the repository, each with its configuration at the repository
// root (eslint.config.mjs, deno.jsonc, biome.jsonc). All three run even when one fails; the run fails when any does.
//
// The linters are not packages of this repository. Each is found, in this order, by
//   its environment variable, holding the path of its program: ESLINT_BIN (eslint, eslint.cmd, or ESLint's own
//     bin/eslint.js), DENO_BIN, BIOME_BIN;
//   the folder the environment variable DEVROOT names, laid out as eslint/node_modules/eslint/bin/eslint.js,
//     deno/<version>/deno, biome/<version>/biome, the highest version taken;
//   its name on the PATH.
//
// Usage: node scripts/run-linters.mjs [path ...]     (no path: everything each configuration covers)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = process.argv.slice(2);

const linters = [
  { name: "ESLint", variable: "ESLINT_BIN", program: "eslint", shared: () => underDevelopmentRoot("eslint", "node_modules", "eslint", "bin", "eslint.js"), parameters: paths.length > 0 ? paths : ["."] },
  { name: "Deno", variable: "DENO_BIN", program: "deno", shared: () => newestVersionOf("deno"), parameters: ["lint", ...paths] },
  // Biome's warnings fail the run like its errors: a finding is acted on or its rule is switched off with a reason.
  { name: "Biome", variable: "BIOME_BIN", program: "biome", shared: () => newestVersionOf("biome"), parameters: ["lint", "--error-on-warnings", ...paths] }
];

// A file under the folder DEVROOT names, or null when the variable is not set or the file is not there.
function underDevelopmentRoot(...parts) {
  const file = process.env.DEVROOT ? path.join(process.env.DEVROOT, ...parts) : null;
  return file !== null && existsSync(file) ? file : null;
}

// The program of a tool kept as <DEVROOT>/<tool>/<version>/<tool>, from the folder of the highest version.
function newestVersionOf(tool) {
  const home = underDevelopmentRoot(tool);
  if (home === null) return null;
  const versions = readdirSync(home).sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
  const endings = process.platform === "win32" ? [".exe", ""] : [""];
  for (const version of versions) for (const ending of endings) if (existsSync(path.join(home, version, tool + ending))) return path.join(home, version, tool + ending);
  return null;
}

// The file a program name stands for: the path itself when it names a file, or else the first match on the PATH,
// tried on Windows with the endings a program may have there. Null when there is none.
function programFile(program) {
  if (existsSync(program)) return program;
  if (path.basename(program) !== program) return null;
  const endings = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const folder of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ending of endings) if (existsSync(path.join(folder, program + ending))) return path.join(folder, program + ending);
  }
  return null;
}

// A JavaScript file is run with this Node, and a Windows command script through the shell.
function start(file, parameters) {
  const options = { cwd: repositoryRoot, stdio: "inherit" };
  if (/\.[cm]?js$/iu.test(file)) return spawnSync(process.execPath, [file, ...parameters], options);
  if (!/\.(?:cmd|bat)$/iu.test(file)) return spawnSync(file, parameters, options);
  return spawnSync([file, ...parameters].map((part) => `"${part}"`).join(" "), { ...options, shell: true });
}

const failed = [];
for (const linter of linters) {
  const file = process.env[linter.variable] ? programFile(process.env[linter.variable]) : linter.shared() ?? programFile(linter.program);
  console.log(`\n== ${linter.name}`);
  if (file === null) {
    console.error(`${linter.name} was not found. Set ${linter.variable} to the path of its program, or put it on the PATH.`);
    failed.push(`${linter.name} (not found)`);
  } else if (start(file, linter.parameters).status !== 0) {
    failed.push(linter.name);
  }
}

if (failed.length > 0) {
  console.error(`\nFAIL linters: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS linters: ESLint, Deno, Biome");
