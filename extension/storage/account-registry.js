(function initializeCitizenDataAccountRegistry(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataAccountRegistry = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataAccountRegistry() {
  "use strict";

  // Builds are ordered by the instant they were exported, never by the text of the time: the comparison of
  // shared/account-document.js, which the service worker, the popup and the tests load before this file.
  const compareExportedAt = (left, right) => globalThis.CitizenDataAccountDocument.compareExportedAt(left, right);

  // The accounts the user added with Add new account, as safe identity summaries: the RSI handle, the display name
  // RSI shows, and when it was found. It is kept in chrome.storage.local under STORAGE_KEY, apart from the builds, so an
  // account added without a build is listed; Clear All removes it. A retained build is listed beside it only while
  // Build History is on. Nothing here is a cookie, a token, an address or account data beyond the summary.
  const STORAGE_KEY = "citizendata.accounts.v1";
  const MAXIMUM_ACCOUNTS = 50;
  const MAXIMUM_DISPLAY_NAME = 64;
  const HANDLE = /^[A-Za-z0-9_-]{1,64}$/u;
  // One stable key an account is chosen by: its handle, which decides whether two files are of one account
  // (CitizenDataOrganizationDocument.sameAccount), in lower case.
  const ACCOUNT_KEY = /^rsi:[a-z0-9_-]{1,64}$/u;
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
  }

  function accountKey(handle) {
    const trimmed = typeof handle === "string" ? handle.trim() : "";
    return HANDLE.test(trimmed) ? `rsi:${trimmed.toLowerCase()}` : null;
  }

  function isAccountKey(value) {
    return typeof value === "string" && ACCOUNT_KEY.test(value);
  }

  // A display name as one line of at most MAXIMUM_DISPLAY_NAME characters, without control characters, or null.
  function boundedName(value) {
    if (typeof value !== "string") return null;
    const control = (character) => character.codePointAt(0) < 32 || (character.codePointAt(0) >= 127 && character.codePointAt(0) < 160);
    const spaced = [...value].map((character) => control(character) ? " " : character).join("");
    const line = [...spaced.replace(/\s+/gu, " ").trim()].slice(0, MAXIMUM_DISPLAY_NAME).join("").trim();
    return line || null;
  }

  function validEntry(entry) {
    return isPlainObject(entry) && accountKey(entry.handle) === entry.key && (entry.displayName === null || boundedName(entry.displayName) === entry.displayName)
      && typeof entry.discoveredAt === "string" && TIMESTAMP.test(entry.discoveredAt);
  }

  // The stored registry, with every entry that fails its checks left out; a missing or damaged record is empty.
  function normalizeRegistry(stored) {
    const accounts = [];
    const keys = new Set();
    for (const entry of Array.isArray(stored?.accounts) ? stored.accounts.slice(0, MAXIMUM_ACCOUNTS) : []) {
      if (!validEntry(entry) || keys.has(entry.key)) continue;
      keys.add(entry.key);
      accounts.push({ key: entry.key, handle: entry.handle, displayName: entry.displayName, discoveredAt: entry.discoveredAt });
    }
    const selectedKey = isAccountKey(stored?.selectedKey) ? stored.selectedKey : null;
    return { accounts, selectedKey };
  }

  // The summary of the account RSI's identify route named, or null when it named no usable handle.
  function summaryFromIdentity(identity, discoveredAt) {
    const key = accountKey(identity?.accountId);
    if (!key || !TIMESTAMP.test(discoveredAt)) return null;
    return { key, handle: identity.accountId.trim(), displayName: boundedName(identity.displayName), discoveredAt };
  }

  // Adds a summary, or refreshes the one of the same account; the account found is selected. Refuses a new account
  // past MAXIMUM_ACCOUNTS.
  function register(registry, summary) {
    const current = normalizeRegistry(registry);
    const index = current.accounts.findIndex((entry) => entry.key === summary.key);
    if (index === -1 && current.accounts.length >= MAXIMUM_ACCOUNTS) return { ok: false, code: "ACCOUNT_LIMIT", registry: current };
    const accounts = [...current.accounts];
    if (index === -1) accounts.push(summary);
    else accounts[index] = { ...summary, displayName: summary.displayName ?? accounts[index].displayName };
    return { ok: true, added: index === -1, registry: { accounts, selectedKey: summary.key }, entry: accounts[index === -1 ? accounts.length - 1 : index] };
  }

  // The accounts the dashboard is told of: every added account, and, while Build History is on, every account the
  // extension holds a finished build of. One entry an account, in the order added, then by handle.
  function listed({ registry, snapshots, historyEnabled }) {
    const current = normalizeRegistry(registry);
    const builds = new Map();
    if (historyEnabled) {
      for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
        const key = accountKey(snapshot?.document?.account?.handle);
        const exportedAt = snapshot?.document?.exportedAt;
        if (!key || typeof exportedAt !== "string" || (builds.has(key) && compareExportedAt(builds.get(key).exportedAt, exportedAt) >= 0)) continue;
        builds.set(key, { handle: snapshot.document.account.handle.trim(), displayName: boundedName(snapshot.document.profile?.displayName), exportedAt });
      }
    }
    const entries = current.accounts.map((entry) => ({
      key: entry.key, handle: entry.handle, displayName: entry.displayName ?? builds.get(entry.key)?.displayName ?? null, registered: true,
      hasRetainedBuild: builds.has(entry.key), retainedExportedAt: builds.get(entry.key)?.exportedAt ?? null
    }));
    const added = new Set(entries.map((entry) => entry.key));
    const built = [...builds].filter(([key]) => !added.has(key)).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    for (const [key, build] of built) entries.push({ key, handle: build.handle, displayName: build.displayName, registered: false, hasRetainedBuild: true, retainedExportedAt: build.exportedAt });
    return entries;
  }

  // The registry with `key` selected, or null when no listed account has that key.
  function select(registry, key, listedEntries) {
    if (!isAccountKey(key) || !listedEntries.some((entry) => entry.key === key)) return null;
    return { ...normalizeRegistry(registry), selectedKey: key };
  }

  return Object.freeze({ STORAGE_KEY, MAXIMUM_ACCOUNTS, MAXIMUM_DISPLAY_NAME, accountKey, isAccountKey, boundedName, normalizeRegistry, summaryFromIdentity, register, listed, select });
});
