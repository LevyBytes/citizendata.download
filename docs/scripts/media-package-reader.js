(function initializeCitizenDataMediaPackageReader(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataMediaPackageReader = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataMediaPackageReader(root) {
  "use strict";

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const EOCD_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  const LOCAL_SIGNATURE = 0x04034b50;
  const MAXIMUM_ENTRIES = 65535;
  const MAXIMUM_MANIFEST_BYTES = 16 * 1024 * 1024;

  function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  async function bytes(blob, start, length) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > blob.size) throw new Error("ZIP entry exceeds the package bounds.");
    return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
  }

  function findEndRecord(tail) {
    const data = view(tail);
    for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
      if (data.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
    }
    throw new Error("ZIP end record is missing.");
  }

  async function open(file, options = {}) {
    const maximumBytes = options.maximumBytes ?? 512 * 1024 * 1024;
    if (!(file instanceof Blob) || file.size < 22 || file.size > maximumBytes) throw new Error("Images ZIP is empty or exceeds the configured package limit.");
    const tailStart = Math.max(0, file.size - 65557);
    const tail = await bytes(file, tailStart, file.size - tailStart);
    const endOffset = findEndRecord(tail);
    const end = view(tail);
    if (end.getUint16(endOffset + 4, true) !== 0 || end.getUint16(endOffset + 6, true) !== 0) throw new Error("Multi-disk ZIP packages are not supported.");
    const entryCount = end.getUint16(endOffset + 10, true);
    const centralSize = end.getUint32(endOffset + 12, true);
    const centralOffset = end.getUint32(endOffset + 16, true);
    if (entryCount < 1 || entryCount > MAXIMUM_ENTRIES || centralOffset + centralSize > file.size) throw new Error("ZIP central directory is invalid.");
    const central = await bytes(file, centralOffset, centralSize);
    const centralView = view(central);
    const entries = new Map();
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > central.byteLength || centralView.getUint32(offset, true) !== CENTRAL_SIGNATURE) throw new Error("ZIP central entry is invalid.");
      const flags = centralView.getUint16(offset + 8, true);
      const method = centralView.getUint16(offset + 10, true);
      const compressedSize = centralView.getUint32(offset + 20, true);
      const uncompressedSize = centralView.getUint32(offset + 24, true);
      const nameLength = centralView.getUint16(offset + 28, true);
      const extraLength = centralView.getUint16(offset + 30, true);
      const commentLength = centralView.getUint16(offset + 32, true);
      const localOffset = centralView.getUint32(offset + 42, true);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > central.byteLength || method !== 0 || compressedSize !== uncompressedSize || (flags & 0x0001) !== 0) throw new Error("Images ZIP must use unencrypted stored entries.");
      const name = decoder.decode(central.subarray(offset + 46, offset + 46 + nameLength));
      if (!root.CitizenDataZip.safePath(name) || entries.has(name)) throw new Error(`Unsafe or duplicate ZIP path: ${name}`);
      const local = await bytes(file, localOffset, 30);
      const localView = view(local);
      if (localView.getUint32(0, true) !== LOCAL_SIGNATURE || localView.getUint16(8, true) !== 0) throw new Error(`Invalid stored ZIP entry: ${name}`);
      const localNameLength = localView.getUint16(26, true);
      const localExtraLength = localView.getUint16(28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      if (dataOffset + uncompressedSize > centralOffset) throw new Error(`ZIP entry overlaps the central directory: ${name}`);
      entries.set(name, { name, dataOffset, byteLength: uncompressedSize });
      offset = end;
    }
    if (offset !== central.byteLength) throw new Error("ZIP central directory has trailing data.");
    const manifestEntry = entries.get("offline-package.json");
    if (!manifestEntry || manifestEntry.byteLength > MAXIMUM_MANIFEST_BYTES) throw new Error("Images ZIP manifest is missing or oversized.");
    const manifestText = decoder.decode(await bytes(file, manifestEntry.dataOffset, manifestEntry.byteLength));
    const manifest = root.CitizenDataSafeJson.parseBoundedJson(manifestText, { maxBytes: MAXIMUM_MANIFEST_BYTES });
    root.CitizenDataAccountDocument.assertValid(manifest, root.CITIZENDATA_OFFLINE_SCHEMA, "Images ZIP manifest");
    if (!await root.CitizenDataAccountDocument.verifyIntegrity(manifest)) throw new Error("Images ZIP manifest integrity verification failed.");
    const receipts = new Map(manifest.files.map((receipt) => [receipt.relativePath, receipt]));
    for (const receipt of receipts.values()) {
      const entry = entries.get(receipt.relativePath);
      if (!entry || entry.byteLength !== receipt.byteLength) throw new Error(`Images ZIP file receipt mismatch: ${receipt.relativePath}`);
    }
    const verified = new Map();
    async function fileBlob(relativePath, mediaType = "application/octet-stream") {
      const receipt = receipts.get(relativePath);
      const entry = entries.get(relativePath);
      if (!receipt || !entry) throw new Error(`Images ZIP file is not declared: ${relativePath}`);
      const existing = verified.get(relativePath);
      if (existing) return existing;
      const fileBlob = file.slice(entry.dataOffset, entry.dataOffset + entry.byteLength, mediaType);
      const hash = await root.CitizenDataMediaMaterializer.sha256(new Uint8Array(await fileBlob.arrayBuffer()));
      if (hash !== receipt.contentHash) throw new Error(`Images ZIP file integrity failed: ${relativePath}`);
      verified.set(relativePath, fileBlob);
      return fileBlob;
    }
    return Object.freeze({ file, manifest, entries, fileBlob });
  }

  async function prepareDelta(plan, loadedPackage) {
    if (!loadedPackage) return { reused: { assets: [], files: [], totalBytes: 0, downloadedBytes: 0 }, pending: [...plan] };
    const priorBySource = new Map(loadedPackage.manifest.assets.filter((asset) => ["downloaded", "reused"].includes(asset.status) && asset.relativePath).map((asset) => [asset.sourceUrl, asset]));
    const assets = [];
    const filesByPath = new Map();
    const pending = [];
    for (const entry of plan) {
      const prior = priorBySource.get(entry.normalizedUrl);
      if (!prior) {
        pending.push(entry);
        continue;
      }
      const blob = await loadedPackage.fileBlob(prior.relativePath, prior.mediaType);
      if (!filesByPath.has(prior.relativePath)) filesByPath.set(prior.relativePath, { name: prior.relativePath, bytes: new Uint8Array(await blob.arrayBuffer()) });
      assets.push({ ...prior, assetId: entry.imageKey, sourceImageKeys: entry.sourceImageKeys.length ? [...entry.sourceImageKeys] : [entry.imageKey], sourceUrl: entry.normalizedUrl, status: "reused", entityReferences: entry.references, attempts: 0, errorCode: null });
    }
    const files = [...filesByPath.values()].sort((left, right) => left.name.localeCompare(right.name, "en"));
    const totalBytes = files.reduce((total, file) => total + file.bytes.byteLength, 0);
    return { reused: { assets, files, totalBytes, downloadedBytes: 0 }, pending };
  }

  return Object.freeze({ open, prepareDelta });
});
