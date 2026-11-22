(function initializeCitizenDataMediaPackage(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataMediaPackage = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataMediaPackage(root) {
  "use strict";

  const encoder = new TextEncoder();

  function requireApi(name, value) {
    if (!value) throw new Error(`${name} is unavailable.`);
    return value;
  }

  function safeStem(value) {
    const stem = String(value ?? "account")
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 64);
    return stem || "account";
  }

  function mediaMapScript(assets) {
    const entries = new Map();
    for (const asset of assets) {
      if (!["downloaded", "reused"].includes(asset.status) || !asset.relativePath) continue;
      const keys = new Set([asset.assetId, ...(Array.isArray(asset.sourceImageKeys) ? asset.sourceImageKeys : [])]);
      for (const key of keys) {
        const previous = entries.get(key);
        if (previous && previous !== asset.relativePath) throw new Error(`Conflicting offline-media path for image key ${key}.`);
        entries.set(key, asset.relativePath);
      }
    }
    const map = Object.fromEntries([...entries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    const json = JSON.stringify(map, null, 2)
      .replaceAll("<", "\\u003c")
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
    return `(() => { "use strict"; globalThis.CITIZENDATA_OFFLINE_MEDIA = Object.freeze(${json}); })();\n`;
  }

  async function sha256(value) {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    const digest = new Uint8Array(await root.crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function fileReceipt(file) {
    return { relativePath: file.name, byteLength: file.bytes.byteLength, contentHash: await sha256(file.bytes) };
  }

  function summary(assets, totalBytes) {
    const result = { desiredAssets: assets.length, downloaded: 0, reused: 0, missing: 0, blocked: 0, failed: 0, skipped: 0, totalBytes };
    for (const asset of assets) result[asset.status] += 1;
    return result;
  }

  async function buildArchive(options) {
    const documentApi = requireApi("Account-document tooling", root.CitizenDataAccountDocument);
    const zipApi = requireApi("ZIP tooling", root.CitizenDataZip);
    const accountSchema = requireApi("Account schema", options?.accountSchema ?? root.CITIZENDATA_ACCOUNT_SCHEMA);
    const offlineSchema = requireApi("Offline-package schema", options?.offlineSchema ?? root.CITIZENDATA_OFFLINE_SCHEMA);
    const accountDocument = await documentApi.acceptAccountDocument(options?.accountDocument, accountSchema);
    const materialized = options?.materialized;
    const policy = options?.policy;
    if (!materialized || !Array.isArray(materialized.assets) || !Array.isArray(materialized.files)) throw new TypeError("A completed media result is required.");
    if (!policy || !Array.isArray(policy.allowedImageHosts) || policy.allowedImageHosts.length === 0) throw new TypeError("A bounded media policy is required.");

    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const scriptBytes = encoder.encode(mediaMapScript(materialized.assets));
    const files = [...materialized.files.map((file) => ({ name: file.name, bytes: file.bytes })), { name: "scripts/offline-media.js", bytes: scriptBytes }]
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const seen = new Set();
    for (const file of files) {
      if (!zipApi.safePath(file.name) || seen.has(file.name)) throw new Error(`Unsafe or duplicate media-package path: ${file.name}`);
      seen.add(file.name);
    }
    const packageSummary = summary(materialized.assets, materialized.totalBytes ?? 0);
    const complete = packageSummary.failed === 0 && packageSummary.blocked === 0 && packageSummary.missing === 0;
    const fileReceipts = await Promise.all(files.map(fileReceipt));
    const manifest = await documentApi.stampIntegrity({
      packageVersion: 1,
      packageId: options.packageId ?? root.crypto.randomUUID(),
      generatedAt,
      generator: { name: "CitizenData Offline Images", version: options.version ?? "0.42.1" },
      dashboardVersion: options.version ?? "0.42.1",
      parserVersion: accountDocument.generator?.version ?? "unknown",
      imageUrlNormalizationVersion: 1,
      account: { localAccountId: accountDocument.account.localAccountId, handle: accountDocument.account.handle ?? null },
      sourceExport: {
        schemaVersion: accountDocument.schemaVersion,
        exportedAt: accountDocument.exportedAt,
        contentHash: accountDocument.integrity.contentHash
      },
      priorPackage: options.priorPackage ?? null,
      policy: { ...policy },
      entryPoint: "scripts/offline-media.js",
      assets: materialized.assets,
      summary: packageSummary,
      materializationReceipt: {
        status: complete ? "complete" : "partial",
        startedAt: options.startedAt ?? generatedAt,
        endedAt: options.endedAt ?? generatedAt,
        requestCount: Number.isSafeInteger(options.requestCount) ? options.requestCount : materialized.assets.filter((asset) => asset.status !== "reused").length,
        // Today's retries, and the attempts RSI refused, which an image's attempts do not count (§14).
        retryCount: materialized.assets.reduce((total, asset) => total + Math.max(0, (asset.attempts ?? 1) - 1), 0) + (Number.isSafeInteger(materialized.refusedAttempts) && materialized.refusedAttempts > 0 ? materialized.refusedAttempts : 0),
        effectiveMinimumInterRequestDelayMs: policy.minimumInterRequestDelayMs,
        // The run's pacing summary (§4.7): the controller and settings that paced it, and what the image hosts answered.
        ...(materialized.pacing ? { pacing: JSON.parse(JSON.stringify(materialized.pacing)) } : {}),
        // Where the image history came from, what it held, the samples used, and the history with this run (§14).
        ...(materialized.paceHistory ? { paceHistory: JSON.parse(JSON.stringify(materialized.paceHistory)) } : {}),
        warnings: complete ? [] : ["Some images could not be downloaded. Successful images remain usable."],
        promoted: complete
      },
      files: fileReceipts,
      integrity: { algorithm: "SHA-256" }
    });
    documentApi.assertValid(manifest, offlineSchema, "Offline media package manifest");
    if (!await documentApi.verifyIntegrity(manifest)) throw new Error("Offline media package integrity verification failed.");
    const archive = zipApi.build([...files, { name: "offline-package.json", bytes: `${JSON.stringify(manifest, null, 2)}\n` }]);
    const timestamp = root.CitizenDataFileTimestamp?.format?.(generatedAt) ?? "undated-000000-000Z";
    const fileName = `citizendata-media-${safeStem(accountDocument.account.handle)}-${timestamp}.zip`;
    return Object.freeze({ archive, fileName, manifest });
  }

  function download(result, documentValue = root.document) {
    const blob = new Blob([result.archive], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const anchor = documentValue.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.hidden = true;
    documentValue.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function save(result) {
    if (typeof root.showSaveFilePicker !== "function") {
      download(result);
      return "download";
    }
    const handle = await root.showSaveFilePicker({
      suggestedName: result.fileName,
      types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }]
    });
    const writable = await handle.createWritable();
    try { await writable.write(result.archive); }
    finally { await writable.close(); }
    return "picker";
  }

  return Object.freeze({ buildArchive, download, mediaMapScript, safeStem, save, sha256 });
});
