import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Model, docsRoot } from "./dashboard-scripts-under-test.mjs";

test("person links use fixed RSI routes and a handle, with explicit demo prospect routing", () => {
  assert.deepEqual(Model.personLinks("SpearmintVR"), {
    monikerUrl: "https://robertsspaceindustries.com/spectrum/messages/member/SpearmintVR",
    usernameUrl: "https://robertsspaceindustries.com/en/citizens/SpearmintVR"
  });
  const referral = "https://robertsspaceindustries.com/enlist?referral=STAR-GN2F-6JLW";
  assert.deepEqual(Model.personLinks("BadWolf", { exampleProspect: true }), { monikerUrl: referral, usernameUrl: referral });
  assert.equal(Model.personLinks("Montoya", { redacted: true }), null);
  for (const handle of [null, undefined, 4, "", " ", "..", "a/b", "a?b", "a#b", "https://example.com", "\ud800"]) assert.equal(Model.personLinks(handle), null);
});

test("all named demo members and recruits reference intact local dossier avatars", async () => {
  const data = globalThis.CITIZENDATA_DEMO_DATA;
  const avatars = globalThis.CITIZENDATA_PROFILE_AVATARS;
  const media = globalThis.CITIZENDATA_PROFILE_MEDIA;
  const names = new Set(data.organizations.members.filter(member => member.visibility === "public").map(member => member.handle));
  assert.equal(names.size, 19);
  assert.deepEqual(Object.keys(avatars).sort(), [...names].sort());
  for (const handle of names) {
    const reference = avatars[handle];
    const relative = media[reference.imageKey];
    assert.match(relative, /^assets\/demo\/avatars\/[a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif)$/u);
    const bytes = await readFile(path.join(docsRoot, relative));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), reference.imageKey, handle);
  }
  for (const ladder of ["current", "legacy"]) {
    const records = data.referrals[ladder].recruits;
    assert.ok(records.some(record => record.handle === "DirectorGunner"));
    assert.ok(records.every(record => names.has(record.handle) && record.handle !== "Montoya" && record.dateLabel === "purchasedOn" && typeof record.dateRaw === "string" && /^20\d{2}-\d{2}-\d{2}$/u.test(record.dateSortKey)));
    for (const record of records) assert.equal(record.images[0].imageKey, avatars[record.handle].imageKey);
  }
});

// The page's controls, their order, and what each one does are checked in the browser by validate-dashboard.mjs. What
// stays here is data the page ships and the wording the owner set for the README.
test("the example account is the owner's chosen example", () => {
  const demo = globalThis.CITIZENDATA_DEMO_DATA;
  assert.equal(demo.profile.mainOrganizationSid, "TEST");
  assert.equal(demo.profile.organizationRank, "RECRUIT");
  const titles = [...demo.pledges, ...demo.buybacks].map((record) => record.title);
  for (const title of [
    "Package - Weekend Warrior - LTI",
    "Package - AMD Never Settle Space Edition",
    "Decorations - The Lamp",
    "Add-Ons - Kastak Arms Custodian SMG - CitizenCon 2947",
    "Package - Citizen Starter Pack",
    "Standalone Ship - Aegis Eclipse LTI",
    "Standalone Ships - Argo Combo Pack - LTI"
  ]) assert.ok(titles.includes(title), title);
  assert.deepEqual(demo.profile.unlockedBadges.map((badge) => badge.title), ["Aggressor", "Clearance Level Ultra"]);
  // The Eclipse buy-back carries the first day of the ship's concept sale, and no number from any real account.
  const eclipse = demo.buybacks.find((record) => record.title === "Standalone Ship - Aegis Eclipse LTI");
  assert.deepEqual([eclipse.reclaimDateRaw, eclipse.buybackId, eclipse.recordKey], ["May 19, 2017", null, "demo-buyback-4"]);
  assert.equal(JSON.stringify(demo).includes("/pledge/buyback/"), false);
});
