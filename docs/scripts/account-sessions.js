// The accounts open in this page, for Switch Account: one session for each account, held in page memory only. A
// session is found by the maintained same-account rule (CitizenDataOrganizationDocument.sameAccount): the handle
// decides when both name one, the local identifier only when a handle is absent.
(function exposeAccountSessions(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataAccountSessions = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  const MAXIMUM_SESSIONS = 50;
  const MAXIMUM_LABEL = 64;
  // The handle form the extension keys its added accounts by (extension/storage/account-registry.js).
  const HANDLE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

  function textOrNull(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  // One line of at most MAXIMUM_LABEL characters, without control characters.
  function boundedLabel(value) {
    if (typeof value !== "string") return null;
    const characters = [...value].filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && code !== 127 && !(code >= 128 && code < 160);
    });
    const line = characters.join("").replace(/\s+/gu, " ").trim();
    return line ? [...line].slice(0, MAXIMUM_LABEL).join("") : null;
  }

  function identityOf(account) {
    return { handle: textOrNull(account?.handle), localAccountId: textOrNull(account?.localAccountId) };
  }

  // The newer file decides; what it leaves out is kept from the session.
  function mergedIdentity(identity, account) {
    const next = identityOf(account);
    return { handle: next.handle ?? identity?.handle ?? null, localAccountId: next.localAccountId ?? identity?.localAccountId ?? null };
  }

  // The key the extension knows the account by, or null when the handle has another form or is absent.
  function extensionKey(identity) {
    const handle = textOrNull(identity?.handle);
    return handle && HANDLE_PATTERN.test(handle) ? `rsi:${handle.toLowerCase()}` : null;
  }

  function sessionKey(identity) {
    const handle = textOrNull(identity?.handle);
    if (handle) return extensionKey(identity) ?? `handle:${handle.toLowerCase()}`;
    const localAccountId = textOrNull(identity?.localAccountId);
    return localAccountId ? `local:${localAccountId}` : null;
  }

  // What the menu shows for a session: its display name with the handle beside it, its handle, or its file name.
  // A local identifier is never shown.
  function menuLabel(session) {
    const handle = boundedLabel(session?.identity?.handle ?? "");
    const displayName = boundedLabel(session?.displayName ?? "");
    if (displayName && handle && displayName.toLowerCase() !== handle.toLowerCase()) return { label: displayName, detail: handle };
    if (handle || displayName) return { label: handle ?? displayName, detail: null };
    return { label: boundedLabel(session?.fileName ?? "") ?? "Account", detail: null };
  }

  function createRegistry({ sameAccount, maximum = MAXIMUM_SESSIONS }) {
    if (typeof sameAccount !== "function") throw new TypeError("The same-account rule is required.");
    const sessions = new Map();

    // The one session of this account, none, or a conflict when the account matches more than one session.
    function match(account) {
      const found = [...sessions.values()].filter((session) => sameAccount(session.identity, account));
      return found.length > 1 ? { conflict: true, session: null } : { conflict: false, session: found[0] ?? null };
    }

    function add(session) {
      if (!session || typeof session.key !== "string" || sessions.has(session.key)) throw new Error("This account session cannot be added.");
      if (sessions.size >= maximum) throw new Error(`This page holds ${maximum} accounts, the most it can, so this account was not added.`);
      sessions.set(session.key, session);
      return session;
    }

    function remove(key) {
      return sessions.delete(key);
    }

    // A key no session holds. A session keeps the key it was added with, so a later file can leave a key taken by a
    // session whose identity has changed since.
    function availableKey(identity) {
      const base = sessionKey(identity) ?? "account";
      let key = base;
      for (let suffix = 2; sessions.has(key); suffix += 1) key = `${base}~${suffix}`;
      return key;
    }

    // In the order the accounts were added to the page.
    function entries(activeKey) {
      return [...sessions.values()].map((session) => ({ key: session.key, ...menuLabel(session), current: session.key === activeKey }));
    }

    return Object.freeze({
      add,
      availableKey,
      entries,
      get: (key) => sessions.get(key) ?? null,
      match,
      remove,
      get size() { return sessions.size; },
      values: () => [...sessions.values()]
    });
  }

  return Object.freeze({ HANDLE_PATTERN, MAXIMUM_LABEL, MAXIMUM_SESSIONS, boundedLabel, createRegistry, extensionKey, identityOf, menuLabel, mergedIdentity, sessionKey });
});
