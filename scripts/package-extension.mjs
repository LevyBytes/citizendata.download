import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repositoryRoot, "extension");
const outputRoot = path.join(repositoryRoot, "dist");

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

export async function collectFiles(directory, relativeRoot = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(relativeRoot, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Extension packages may not contain symbolic links: ${relative}`);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute, relative));
    else if (entry.isFile()) files.push({ name: relative, bytes: await readFile(absolute) });
  }
  return files.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

const forbiddenPackagePath = /(?:^|\/)(?:\.|private-data(?:\/|$)|captures(?:\/|$)|(?:account-data[^/]*|rsi-account[^/]*|citizendata-[^/]*|hangarlink[^/]*)\.(?:json|zip)$)|\.(?:crx|log|map|pem|tmp)$/iu;

export function assertPackageFilePolicy(files) {
  const names = new Set();
  for (const file of files) {
    if (typeof file?.name !== "string" || file.name.length === 0 || file.name.includes("\\") || file.name.startsWith("/") || file.name.split("/").includes("..")) {
      throw new Error(`Unsafe extension package path: ${String(file?.name)}`);
    }
    const normalized = file.name.toLowerCase();
    if (names.has(normalized)) throw new Error(`Duplicate extension package path: ${file.name}`);
    if (forbiddenPackagePath.test(file.name)) throw new Error(`Private or development-only file is not allowed in the extension package: ${file.name}`);
    names.add(normalized);
  }
  for (const required of ["manifest.json", "service-worker.js", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    if (!names.has(required.toLowerCase())) throw new Error(`Required extension package file is missing: ${required}`);
  }
  return files;
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

export function validateManifestVersion(version) {
  if (!/^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}$/u.test(version)) throw new Error(`Invalid Chrome manifest version: ${version}`);
  const parts = version.split(".").map(Number);
  if (parts.every((part) => part === 0) || parts.some((part) => part > 65535)) throw new Error(`Invalid Chrome manifest version: ${version}`);
  return version;
}

export function includeLegalFiles(files, legalFiles) {
  const names = new Set(files.map((file) => file.name.toLowerCase()));
  for (const file of legalFiles) {
    if (names.has(file.name.toLowerCase())) throw new Error(`Extension source already contains a ${file.name} entry.`);
    names.add(file.name.toLowerCase());
  }
  return [...files, ...legalFiles.map((file) => ({ name: file.name, bytes: Buffer.from(file.bytes) }))];
}

async function main() {
  for (const script of ["scripts/verify.mjs", "scripts/run-tests.mjs"]) {
    const result = spawnSync(process.execPath, [script], { cwd: repositoryRoot, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
  const version = String(manifest.version ?? "");
  validateManifestVersion(version);

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await cp(extensionRoot, path.join(outputRoot, "extension"), { recursive: true, force: true });

  const legalFiles = await Promise.all(["LICENSE", "THIRD_PARTY_NOTICES.md"].map(async (name) => ({
    name,
    bytes: await readFile(path.join(repositoryRoot, name))
  })));
  for (const file of legalFiles) await writeFile(path.join(outputRoot, "extension", file.name), file.bytes);
  const files = assertPackageFilePolicy(includeLegalFiles(await collectFiles(extensionRoot), legalFiles));
  const zip = buildStoredZip(files);
  const fileName = `citizendata-extension-${version}.zip`;
  const zipPath = path.join(outputRoot, fileName);
  await writeFile(zipPath, zip);
  const digest = createHash("sha256").update(zip).digest("hex");
  await writeFile(path.join(outputRoot, "SHA256SUMS.txt"), `${digest}  ${fileName}\n`, "utf8");

  console.log(`PASS extension package: ${path.relative(repositoryRoot, zipPath)}`);
  console.log(`PASS package files: ${files.length}`);
  console.log(`PASS SHA-256: ${digest}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) await main();

