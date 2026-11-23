// Packages one extension target. Usage: node scripts/package-extension.mjs [--target chromium] [--out <folder>]
// Chromium is the only target that can be packaged: it verifies the repository, runs the unit tests, composes
// extension/ + platform/chromium/ + manifests/chrome.json (scripts/extension-composition.mjs), and writes the unpacked
// extension to <out>/chromium, its ZIP and SHA256SUMS.txt. <out> is dist/ unless named. A Firefox target is refused
// with FIREFOX_PLATFORM_NOT_IMPLEMENTED before anything runs or is written.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CompositionError, composeTarget, targetDefinition, writeComposedDirectory } from "./extension-composition.mjs";

export { assertPackageFilePolicy } from "./extension-composition.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function crcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc >>> 0;
  });
}

const CRC_TABLE = crcTable();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildStoredZip(files) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  const utf8Flag = 0x0800;
  const dosDate = 0x0021;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const size = file.bytes.length;
    if (size > 0xffffffff) throw new Error(`ZIP64 is not supported: ${file.name}`);
    const crc = crc32(file.bytes);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localRecords.push(local, name, file.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralRecords.push(central, name);

    localOffset += local.length + name.length + size;
  }

  if (files.length > 0xffff) throw new Error("ZIP64 is not supported for more than 65,535 files.");
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

// The entries of a ZIP that buildStoredZip wrote, read back through its central directory.
export function readStoredZip(zip) {
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error("The ZIP has no end-of-central-directory record where a stored ZIP of this packager puts it.");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error(`ZIP central directory entry ${index} is malformed.`);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    entries.push({ name, bytes: zip.subarray(dataStart, dataStart + size) });
    offset += 46 + nameLength;
  }
  return entries;
}

// Every file below a written package folder, as package paths with their bytes.
export function readPackageDirectory(directory, relative = "") {
  const files = [];
  for (const entry of readdirSync(path.join(directory, ...relative.split("/").filter(Boolean)), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...readPackageDirectory(directory, name));
    else files.push({ name, bytes: readFileSync(path.join(directory, ...name.split("/"))) });
  }
  return files.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

// Where the unpacked folder and the ZIP differ, by path and SHA-256, as sentences. None when they hold the same files.
export function packageDifferences(directoryFiles, zipEntries) {
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const unpacked = new Map(directoryFiles.map((file) => [file.name, digest(file.bytes)]));
  const zipped = new Map(zipEntries.map((entry) => [entry.name, digest(entry.bytes)]));
  const differences = [];
  for (const [name, hash] of unpacked) if (zipped.get(name) !== hash) differences.push(zipped.has(name) ? `${name} differs` : `${name} is missing from the ZIP`);
  for (const name of zipped.keys()) if (!unpacked.has(name)) differences.push(`${name} is missing from the unpacked folder`);
  return differences;
}

export function validateManifestVersion(version) {
  if (!/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/u.test(version)) throw new Error(`Invalid Chrome manifest version: ${version}`);
  const parts = version.split(".").map(Number);
  if (parts.every((part) => part === 0) || parts.some((part) => part > 65535)) throw new Error(`Invalid Chrome manifest version: ${version}`);
  return version;
}

async function main() {
  const { values } = parseArgs({ options: { target: { type: "string", default: "chromium" }, out: { type: "string" } }, strict: true });
  const outputRoot = path.resolve(values.out ?? path.join(repositoryRoot, "dist"));
  try {
    targetDefinition(values.target);
  } catch (error) {
    if (!(error instanceof CompositionError)) throw error;
    console.error(error.message);
    process.exit(2);
  }

  for (const script of ["scripts/verify.mjs", "scripts/run-tests.mjs"]) {
    const result = spawnSync(process.execPath, [script], { cwd: repositoryRoot, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  const { files, version } = composeTarget(repositoryRoot, values.target);
  validateManifestVersion(version);
  const unpackedRoot = path.join(outputRoot, values.target);
  // dist/ is this script's own output and is written afresh. A folder named with --out must be new or empty.
  if (values.out === undefined) await rm(outputRoot, { recursive: true, force: true });
  else if (existsSync(outputRoot) && readdirSync(outputRoot).length > 0) throw new Error(`--out must name a new or empty folder: ${outputRoot}`);
  await mkdir(unpackedRoot, { recursive: true });
  writeComposedDirectory(files, unpackedRoot);
  const zip = buildStoredZip(files);
  const fileName = `citizendata-extension-${version}.zip`;
  const zipPath = path.join(outputRoot, fileName);
  await writeFile(zipPath, zip);
  const digest = createHash("sha256").update(zip).digest("hex");
  await writeFile(path.join(outputRoot, "SHA256SUMS.txt"), `${digest}  ${fileName}\n`, "utf8");

  const differences = packageDifferences(readPackageDirectory(unpackedRoot), readStoredZip(zip));
  if (differences.length > 0) throw new Error(`The unpacked ${values.target} folder and the ZIP differ: ${differences.join("; ")}`);
  console.log(`PASS unpacked ${values.target} extension: ${path.relative(repositoryRoot, unpackedRoot) || unpackedRoot}`);
  console.log(`PASS extension package: ${path.relative(repositoryRoot, zipPath) || zipPath}`);
  console.log(`PASS package files: ${files.length}, the same paths and SHA-256 in the folder and the ZIP`);
  console.log(`PASS SHA-256: ${digest}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) await main();
