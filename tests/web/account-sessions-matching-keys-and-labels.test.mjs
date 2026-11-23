// The accounts open in one dashboard page (docs/scripts/account-sessions.js): sessions are found by the maintained
// same-account rule, a conflict is reported instead of merged, the number of sessions is bounded, and the menu shows
// names and handles, never a local identifier.
import assert from "node:assert/strict";
import test from "node:test";

await import("../../docs/scripts/account-document.js");
await import("../../docs/scripts/organization-document.js");
await import("../../docs/scripts/account-sessions.js");
const Sessions = globalThis.CitizenDataAccountSessions;
const { sameAccount } = globalThis.CitizenDataOrganizationDocument;
const LOCAL_A = "00000000-0000-4000-8000-00000000000a";
const LOCAL_B = "00000000-0000-4000-8000-00000000000b";

function session(registry, account, extra = {}) {
  const identity = Sessions.identityOf(account);
  return registry.add({ key: registry.availableKey(identity), identity, displayName: null, fileName: null, ...extra });
}

test("a handle decides when both name one, in any letter case; a local identifier only when a handle is absent", () => {
  const registry = Sessions.createRegistry({ sameAccount });
  const alpha = session(registry, { handle: "AlphaCitizen", localAccountId: LOCAL_A });
  const local = session(registry, { handle: null, localAccountId: LOCAL_B });
  assert.equal(registry.match({ handle: " alphacitizen ", localAccountId: LOCAL_B }).conflict, true, "the handle names one session, the identifier another");
  assert.equal(registry.match({ handle: "ALPHACITIZEN", localAccountId: "00000000-0000-4000-8000-0000000000ff" }).session, alpha);
  assert.equal(registry.match({ handle: null, localAccountId: LOCAL_B }).session, local);
  assert.equal(registry.match({ handle: "BravoCitizen", localAccountId: LOCAL_A }).session, null, "another handle is another account");
  assert.deepEqual([alpha.key, local.key], ["rsi:alphacitizen", `local:${LOCAL_B}`]);
});

test("a later file keeps what it leaves out of the identity, and a key once taken is never given again", () => {
  assert.deepEqual(Sessions.mergedIdentity({ handle: "AlphaCitizen", localAccountId: LOCAL_A }, { handle: null, localAccountId: LOCAL_B }), { handle: "AlphaCitizen", localAccountId: LOCAL_B });
  const registry = Sessions.createRegistry({ sameAccount });
  const first = session(registry, { handle: null, localAccountId: LOCAL_A });
  first.identity = { handle: null, localAccountId: LOCAL_B };
  const second = session(registry, { handle: null, localAccountId: LOCAL_A });
  assert.equal(second.key, `local:${LOCAL_A}~2`);
  assert.throws(() => registry.add({ key: second.key, identity: second.identity }), /cannot be added/u);
});

test("the extension's key is given only to a handle of the form it keeps", () => {
  assert.equal(Sessions.extensionKey({ handle: " Alpha_Citizen-1 " }), "rsi:alpha_citizen-1");
  for (const handle of ["two words", "a/b", "x".repeat(65), "", null]) assert.equal(Sessions.extensionKey({ handle }), null, String(handle));
  assert.equal(Sessions.sessionKey({ handle: "two words" }), "handle:two words");
  assert.equal(Sessions.sessionKey({ handle: null, localAccountId: null }), null);
});

test("the number of accounts open in one page is bounded", () => {
  const registry = Sessions.createRegistry({ sameAccount, maximum: 3 });
  for (const handle of ["One", "Two", "Three"]) session(registry, { handle });
  assert.throws(() => session(registry, { handle: "Four" }), /holds 3 accounts, the most it can/u);
  assert.equal(registry.size, 3);
  assert.equal(registry.remove("rsi:two"), true);
  assert.equal(session(registry, { handle: "Four" }).key, "rsi:four");
});

test("the menu shows the display name beside the handle, in the order the accounts were opened, and never an identifier", () => {
  const registry = Sessions.createRegistry({ sameAccount });
  session(registry, { handle: "AlphaCitizen", localAccountId: LOCAL_A }, { displayName: "Alpha Pilot" });
  session(registry, { handle: "BravoCitizen" }, { displayName: "bravocitizen" });
  session(registry, { handle: null, localAccountId: LOCAL_B }, { fileName: "hangar-backup.json" });
  session(registry, { handle: null, localAccountId: LOCAL_A.replace("a", "c") });
  assert.deepEqual(registry.entries("rsi:bravocitizen").map(({ label, detail, current }) => [label, detail, current]), [
    ["Alpha Pilot", "AlphaCitizen", false],
    ["BravoCitizen", null, true],
    ["hangar-backup.json", null, false],
    ["Account", null, false]
  ]);
  assert.equal(registry.entries(null).some(({ label, detail }) => `${label} ${detail}`.includes("00000000")), false, "what is shown names no identifier");
});

test("a name shown is one bounded line without control characters", () => {
  assert.equal(Sessions.boundedLabel("  Alpha\u0007 \n Pilot\u009b "), "Alpha Pilot");
  assert.equal([...Sessions.boundedLabel("é".repeat(100))].length, Sessions.MAXIMUM_LABEL);
  assert.equal(Sessions.boundedLabel("\u0000"), null);
  assert.equal(Sessions.boundedLabel(42), null);
});
