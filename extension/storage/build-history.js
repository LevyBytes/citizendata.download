(function initializeCitizenDataBuildHistory(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataBuildHistory = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataBuildHistory(root) {
  "use strict";

  // Builds are ordered by the instant they were exported, never by the text of the time: the comparison of
  // shared/account-document.js, which the service worker, the popup and the tests load before this file.
  const compareExportedAt = (left, right) => globalThis.CitizenDataAccountDocument.compareExportedAt(left, right);

  // Earlier finished builds of the account data, kept when the user turns the build history on in the popup.
  //
  // The latest build is always kept, uncompressed, because updates read it. When a new build replaces it and the
  // account data differs, the replaced build is kept here as the exact text of the file the dashboard saved for it,
  // gzip-compressed. A build whose account data equals the one before is not kept, so repeated updates that find
  // nothing new do not push out older, different builds. A kept build is the account JSON alone; it holds image
  // addresses, never images. The images the dashboard downloads are kept apart (media-store.js).
  //
  // While the history is on, the account's organization rosters are kept as well, as one Orgs JSON for each account:
  // the file the dashboard saves for them, replaced whenever a finished build carries different rosters. It is not an
  // earlier build, so it is never counted against the number of builds to keep.
  const DEFAULT_KEEP = 5;
  const MINIMUM_KEEP = 1;
  const MAXIMUM_KEEP = 100;
  // Build history is on until the user turns it off.
  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, keep: DEFAULT_KEEP });
  // Parts of a backup that describe the run that wrote it, not the account.
  const RUN_FIELDS = Object.freeze(["schemaVersion", "generator", "exportedAt", "dataQuality", "sync", "integrity"]);
  // On any record: when it was read, and by which reader version.
  const READING_FIELDS = Object.freeze(["observation", "observedAt", "capturedAt"]);
  const TEXT_CHUNK = 1 << 20;
  const ORGANIZATIONS_KIND = "organizations";

  function isKeep(value) {
    return Number.isSafeInteger(value) && value >= MINIMUM_KEEP && value <= MAXIMUM_KEEP;
  }

  // The stored setting, or the default for anything missing or invalid.
  function settingsFrom(stored) {
    return { enabled: typeof stored?.enabled === "boolean" ? stored.enabled : DEFAULT_SETTINGS.enabled, keep: isKeep(stored?.keep) ? stored.keep : DEFAULT_KEEP };
  }

  // The account's data as one canonical text: object keys sorted, run and reading fields left out.
  function accountDataText(value, skipped = RUN_FIELDS) {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map((item) => accountDataText(item, READING_FIELDS)).join(",")}]`;
    const parts = [];
    for (const key of Object.keys(value).sort()) {
      if (skipped.includes(key) || value[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${accountDataText(value[key], READING_FIELDS)}`);
    }
    return `{${parts.join(",")}}`;
  }

  // Two builds with the same fingerprint hold the same account data, whenever and however each was read.
  async function fingerprint(document) {
    const digest = new Uint8Array(await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(accountDataText(document))));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // The name and text of the file the dashboard saves for a build (docs/scripts/canonical-download.js and
  // file-timestamp.js). A test holds the two to the same result.
  function fileName(document) {
    const stem = String(document?.account?.handle ?? "account").normalize("NFKD").replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64) || "account";
    const date = new Date(document?.exportedAt);
    const match = Number.isNaN(date.getTime()) ? null : /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u.exec(date.toISOString());
    return `citizendata-${stem}-${match ? `${match[1]}-${match[2]}${match[3]}${match[4]}-${match[5]}Z` : "undated-000000-000Z"}.json`;
  }

  // The name of the file the dashboard saves for an Organization JSON (docs/scripts/canonical-download.js).
  function organizationsFileName(document) {
    return fileName(document).replace(/^citizendata-/u, "citizendata-organizations-");
  }

  function organizationsId(accountId) {
    return `${accountId}:${ORGANIZATIONS_KIND}`;
  }

  function isOrganizations(entry) {
    return entry?.kind === ORGANIZATIONS_KIND;
  }

  function fileText(document) {
    return `${JSON.stringify(document, null, 2)}\n`;
  }

  // The text as UTF-8, a piece at a time, never cutting a character in two.
  function* encodedPieces(text) {
    const encoder = new TextEncoder();
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + TEXT_CHUNK);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
      yield encoder.encode(text.slice(start, end));
      start = end;
    }
  }

  // Writes `pieces` into a compression or decompression stream and gathers what comes out.
  async function through(stream, pieces) {
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    let written = 0;
    const output = [];
    let length = 0;
    const writing = (async () => {
      for (const piece of pieces) {
        written += piece.byteLength;
        await writer.write(piece);
      }
      await writer.close();
    })();
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        output.push(value);
        length += value.byteLength;
      }
    })();
    await Promise.all([writing, reading]);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of output) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return { bytes, written };
  }

  function toBase64(bytes) {
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(start, start + 0x8000));
    return root.btoa(binary);
  }

  function fromBase64(text) {
    const binary = root.atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  // The file text, gzip-compressed and written as base64 so it is stored and sent as plain text.
  async function pack(text) {
    const { bytes, written } = await through(new root.CompressionStream("gzip"), encodedPieces(text));
    return { gzipBase64: toBase64(bytes), fileBytes: written };
  }

  // The bytes of the file a kept build was made from.
  async function unpack(gzipBase64) {
    return (await through(new root.DecompressionStream("gzip"), [fromBase64(gzipBase64)])).bytes;
  }

  const newestFirst = (left, right) => compareExportedAt(right.exportedAt, left.exportedAt);

  function historyId(accountId, exportedAt) {
    return `${accountId}:${exportedAt}`;
  }

  // What to write to the history when `document` replaces `previous` as the account's latest build:
  // `{ add: { entry, data }, remove: [historyId] }`, or null when nothing is to be written. `entries` are the kept
  // builds of every account. The number to keep is applied here, when a build is added, and nowhere else, so
  // entering a smaller number deletes nothing by itself.
  async function plan({ settings, accountId, previous, document, entries = [], archivedAt }) {
    const checked = settingsFrom(settings);
    if (!checked.enabled || typeof accountId !== "string" || !accountId) return null;
    if (!previous || typeof previous !== "object" || !document || typeof document !== "object") return null;
    const [earlier, latest] = await Promise.all([fingerprint(previous), fingerprint(document)]);
    if (earlier === latest) return null;
    const id = historyId(accountId, previous.exportedAt);
    const kept = entries.filter((entry) => entry.accountId === accountId && !isOrganizations(entry));
    // A build that was stored and then interrupted before the new one was saved is already kept.
    if (kept.some((entry) => entry.historyId === id)) return null;
    const packed = await pack(fileText(previous));
    const entry = {
      historyId: id,
      accountId,
      handle: typeof previous.account?.handle === "string" ? previous.account.handle : null,
      exportedAt: previous.exportedAt,
      archivedAt,
      fingerprint: earlier,
      fileName: fileName(previous),
      fileBytes: packed.fileBytes,
      storedBytes: packed.gzipBase64.length
    };
    const remove = [entry, ...kept].sort(newestFirst).slice(checked.keep).map((old) => old.historyId).filter((old) => old !== id);
    return { add: { entry, data: { historyId: id, gzipBase64: packed.gzipBase64 } }, remove };
  }

  // The record that keeps `organizations`, the account's Organization JSON, in place of the one kept before:
  // `{ entry, data }`, or null when the history is off, there are no rosters, or the kept one holds the same rosters.
  async function planOrganizations({ settings, accountId, organizations, entries = [], archivedAt }) {
    if (!settingsFrom(settings).enabled || typeof accountId !== "string" || !accountId) return null;
    if (!organizations || typeof organizations !== "object" || Array.isArray(organizations)) return null;
    const id = organizationsId(accountId);
    const print = await fingerprint(organizations);
    if (entries.some((entry) => entry.historyId === id && entry.fingerprint === print)) return null;
    const packed = await pack(fileText(organizations));
    return {
      entry: {
        historyId: id,
        kind: ORGANIZATIONS_KIND,
        accountId,
        handle: typeof organizations.account?.handle === "string" ? organizations.account.handle : null,
        exportedAt: organizations.exportedAt,
        archivedAt,
        fingerprint: print,
        fileName: organizationsFileName(organizations),
        fileBytes: packed.fileBytes,
        storedBytes: packed.gzipBase64.length,
        organizations: Array.isArray(organizations.rosterIndex) ? organizations.rosterIndex.filter((roster) => roster?.status !== "notDownloaded").length : 0,
        members: Array.isArray(organizations.members) ? organizations.members.length : 0
      },
      data: { historyId: id, gzipBase64: packed.gzipBase64 }
    };
  }

  return Object.freeze({ DEFAULT_KEEP, MINIMUM_KEEP, MAXIMUM_KEEP, DEFAULT_SETTINGS, ORGANIZATIONS_KIND, isKeep, isOrganizations, settingsFrom, accountDataText, fingerprint, fileName, organizationsFileName, organizationsId, fileText, pack, unpack, plan, planOrganizations, newestFirst });
});
