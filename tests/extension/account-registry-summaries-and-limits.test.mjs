// The rules of the extension's added-accounts record (extension/storage/account-registry.js): one key an account,
// bounded summaries, damaged entries left out, a limit on how many accounts are added, and what is listed.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadClassicScript } from "./load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
await import("../../docs/scripts/account-document.js");
const { api: Registry, context } = await loadClassicScript(path.join(root, "extension", "storage", "account-registry.js"), "CitizenDataAccountRegistry");
// The registry orders kept builds with the shared comparison, which the service worker loads before it.
context.CitizenDataAccountDocument = globalThis.CitizenDataAccountDocument;
const AT = "2026-11-22T10:00:00.000Z";
// The script runs in its own context, so its objects are compared as plain JSON values.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("an account's key is its handle in lower case; anything else has no key", () => {
  assert.equal(Registry.accountKey(" Synthetic_Citizen-1 "), "rsi:synthetic_citizen-1");
  for (const bad of ["", "two words", "a/b", "x".repeat(65), null, 42]) assert.equal(Registry.accountKey(bad), null, String(bad));
  assert.equal(Registry.isAccountKey("rsi:synthetic"), true);
  assert.equal(Registry.isAccountKey("rsi:Synthetic"), false);
});

test("a display name is one bounded line without control characters", () => {
  assert.equal(Registry.boundedName("  Synthetic\u0007 \n Citizen  "), "Synthetic Citizen");
  assert.equal([...Registry.boundedName("é".repeat(200))].length, Registry.MAXIMUM_DISPLAY_NAME);
  assert.equal(Registry.boundedName("\u0000\u0001"), null);
  assert.equal(Registry.boundedName({ name: "x" }), null);
});

test("a summary holds the handle, the display name and when it was found, and nothing else", () => {
  const summary = Registry.summaryFromIdentity({ accountId: "SyntheticCitizen", displayName: "Synthetic Citizen", avatar: "https://example.invalid/a.png", memberId: 4 }, AT);
  assert.deepEqual(plain(summary), { key: "rsi:syntheticcitizen", handle: "SyntheticCitizen", displayName: "Synthetic Citizen", discoveredAt: AT });
  assert.equal(Registry.summaryFromIdentity({ accountId: "no handle here" }, AT), null);
  assert.equal(Registry.summaryFromIdentity({ accountId: "SyntheticCitizen" }, "yesterday"), null);
});

test("damaged, duplicate and foreign entries are left out of the stored record", () => {
  const good = { key: "rsi:one", handle: "One", displayName: null, discoveredAt: AT };
  const stored = { accounts: [good, { ...good }, { ...good, key: "rsi:two" }, { key: "rsi:three", handle: "Three", displayName: "x\u0000", discoveredAt: AT }, "text", null], selectedKey: "RSI:ONE" };
  assert.deepEqual(plain(Registry.normalizeRegistry(stored)), { accounts: [good], selectedKey: null });
  assert.deepEqual(plain(Registry.normalizeRegistry(undefined)), { accounts: [], selectedKey: null });
});

test("adding refreshes the same account, selects it, and refuses a new account past the limit", () => {
  const first = Registry.register(null, Registry.summaryFromIdentity({ accountId: "One", displayName: "First" }, AT));
  assert.deepEqual([first.ok, first.added, first.registry.selectedKey], [true, true, "rsi:one"]);
  const again = Registry.register(first.registry, Registry.summaryFromIdentity({ accountId: "ONE", displayName: null }, AT));
  assert.deepEqual([again.added, again.registry.accounts.length, again.entry.displayName, again.entry.handle], [false, 1, "First", "ONE"]);
  let registry = null;
  for (let index = 0; index < Registry.MAXIMUM_ACCOUNTS; index += 1) registry = Registry.register(registry, Registry.summaryFromIdentity({ accountId: `Account${index}` }, AT)).registry;
  const full = Registry.register(registry, Registry.summaryFromIdentity({ accountId: "OneTooMany" }, AT));
  assert.deepEqual([full.ok, full.code, full.registry.accounts.length], [false, "ACCOUNT_LIMIT", Registry.MAXIMUM_ACCOUNTS]);
});

test("added accounts are always listed; retained builds only while Build History is on, the newest of each account", () => {
  const registry = Registry.register(null, Registry.summaryFromIdentity({ accountId: "Added" }, AT)).registry;
  const build = (handle, exportedAt, displayName = null) => ({ document: { account: { handle }, exportedAt, profile: { displayName } } });
  const snapshots = [build("Built", "2026-11-20T00:00:00.000Z", "Older"), build("built", "2026-11-21T00:00:00.000Z", "Newer"), build("Added", "2026-11-19T00:00:00.000Z", "Added Name"), { document: null }];
  const on = Registry.listed({ registry, snapshots, historyEnabled: true });
  assert.deepEqual(plain(on.map((entry) => [entry.key, entry.registered, entry.hasRetainedBuild, entry.displayName, entry.retainedExportedAt])), [
    ["rsi:added", true, true, "Added Name", "2026-11-19T00:00:00.000Z"],
    ["rsi:built", false, true, "Newer", "2026-11-21T00:00:00.000Z"]
  ]);
  const off = Registry.listed({ registry, snapshots, historyEnabled: false });
  assert.deepEqual(plain(off.map((entry) => [entry.key, entry.hasRetainedBuild])), [["rsi:added", false]]);
  assert.equal(Registry.select(registry, "rsi:built", off), null);
  assert.equal(Registry.select(registry, "rsi:built", on).selectedKey, "rsi:built");
});
