import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { FIRST, History, SECOND, backup, extraPledge } from "./build-history-loaded-with-fixture-backups.mjs";

test("the setting is on with five copies until the user chooses otherwise", () => {
  assert.deepEqual(History.DEFAULT_SETTINGS, { enabled: true, keep: 5 });
  assert.deepEqual(History.settingsFrom(undefined), { enabled: true, keep: 5 });
  assert.deepEqual(History.settingsFrom({ enabled: false, keep: 12 }), { enabled: false, keep: 12 });
  assert.deepEqual(History.settingsFrom({ enabled: true, keep: 12 }), { enabled: true, keep: 12 });
  // Anything that is not a whole number from 1 to 100 falls back to five; only `false` turns the history off.
  for (const keep of [0, 101, 2.5, "7", null, -1, Number.NaN]) assert.deepEqual(History.settingsFrom({ enabled: "no", keep }), { enabled: true, keep: 5 }, String(keep));
  assert.equal(History.isKeep(1) && History.isKeep(100), true);
});

test("two builds have the same fingerprint exactly when their account data is the same", async () => {
  const first = await History.fingerprint(backup(FIRST));
  // Read a day later by a newer reader, with nothing different on the account.
  const later = backup(SECOND);
  later.generator.version = "newer";
  later.pledges[0].observation.parserVersion = "2.0.0";
  later.dataQuality.anomalies.push({ code: "EXAMPLE" });
  assert.equal(await History.fingerprint(later), first);
  // Key order does not matter.
  assert.equal(await History.fingerprint(Object.fromEntries(Object.entries(backup(FIRST)).reverse())), first);
  // Any difference in the account's own data does.
  assert.notEqual(await History.fingerprint(backup(FIRST, { pledges: [extraPledge] })), first);
  assert.notEqual(await History.fingerprint(backup(FIRST, { storeCredit: "30.00" })), first);
  const removed = backup(FIRST);
  removed.pledges[0].state = "not-reconcilable";
  removed.pledges[0].removal = { lastSeenAt: FIRST, firstMissingAt: SECOND, returnedAt: null };
  assert.notEqual(await History.fingerprint(removed), first);
  const repriced = backup(FIRST);
  repriced.buybackDetails[0].price.amount = "18.00";
  assert.notEqual(await History.fingerprint(repriced), first);
});

test("a kept build is the file the dashboard saved for it, under the same name", () => {
  const document = backup(FIRST);
  document.account.handle = "Zoë  O'Neil/Ω";
  document.pledges[0].title = "Ship \u{1F680} — “quoted”";
  const Download = globalThis.CitizenDataCanonicalDownload;
  let saved = null;
  Download.download(document, {
    documentValue: { body: { append() {} }, createElement: () => ({ click() {}, remove() {} }) },
    urlApi: { createObjectURL: (blob) => { saved = blob; return "blob:test"; }, revokeObjectURL() {} },
    BlobValue: class { constructor(parts) { this.text = parts.join(""); } },
    schedule() {}
  });
  assert.equal(History.fileText(document), saved.text);
  assert.equal(History.fileName(document), Download.canonicalFileName(document));
  assert.equal(History.fileName(document), "citizendata-Zoe-O-Neil-2026-11-01-120000-000Z.json");
  assert.equal(History.fileName({ exportedAt: "not a date" }), "citizendata-account-undated-000000-000Z.json");
});

test("packing is gzip of the UTF-8 text and unpacking gives the same bytes back", async () => {
  // Longer than one piece, with a character outside the basic plane across the piece boundary.
  const text = `${"a".repeat((1 << 20) - 1)}\u{1F680}${"é".repeat(5000)}\n`;
  const expected = Buffer.from(text, "utf8");
  const packed = await History.pack(text);
  assert.equal(packed.fileBytes, expected.byteLength);
  assert.match(packed.gzipBase64, /^[A-Za-z0-9+/]+=*$/u);
  assert.equal(gunzipSync(Buffer.from(packed.gzipBase64, "base64")).equals(expected), true);
  assert.equal(Buffer.from(await History.unpack(packed.gzipBase64)).equals(expected), true);
  assert.ok(packed.gzipBase64.length < expected.byteLength / 50);
});
