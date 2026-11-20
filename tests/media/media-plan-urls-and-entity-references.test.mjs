import assert from "node:assert/strict";
import { test } from "node:test";
import { load, policy } from "./media-materializer-in-a-sandbox.mjs";

test("image URL normalization is stable, public-only, and removes tracking", () => {
  const api = load();
  assert.equal(api.normalizeImageUrl("https://MEDIA.robertsspaceindustries.com/a.png?utm_source=x&b=2&a=1#x", policy.allowedImageHosts), "https://media.robertsspaceindustries.com/a.png?a=1&b=2");
  assert.throws(() => api.normalizeImageUrl("http://media.robertsspaceindustries.com/a.png", policy.allowedImageHosts), /allowed public HTTPS/u);
  assert.throws(() => api.normalizeImageUrl("https://evil.example/a.png", policy.allowedImageHosts), /allowed public HTTPS/u);
  assert.throws(() => api.normalizeImageUrl("https://sub.media.robertsspaceindustries.com/a.png", policy.allowedImageHosts), /allowed public HTTPS/u);
  assert.throws(() => api.normalizeImageUrl("https://user:pass@media.robertsspaceindustries.com/a.png", policy.allowedImageHosts), /allowed public HTTPS/u);
});

test("planner deduplicates URLs while preserving all entity references", async () => {
  const api = load();
  const firstKey = "1".repeat(64);
  const secondKey = "2".repeat(64);
  const document = {
    account: { localAccountId: "account" },
    pledges: [
      { recordKey: "p1", title: "One", images: [{ imageKey: firstKey, role: "thumbnail", url: "https://media.robertsspaceindustries.com/a.png?utm_source=one" }] },
      { recordKey: "p2", title: "Two", images: [{ imageKey: secondKey, role: "thumbnail", url: "https://media.robertsspaceindustries.com/a.png?utm_source=two#fragment" }] }
    ]
  };
  const entries = await api.plan(document, policy);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].references.length, 2);
  assert.deepEqual(Array.from(entries[0].sourceImageKeys), [firstKey, secondKey]);
  assert.equal(entries[0].imageKey.length, 64);
});

test("profile media receives a schema-valid profile entity reference", async () => {
  const api = load();
  const entries = await api.plan({
    account: { localAccountId: "account" },
    profile: { images: [{ imageKey: "3".repeat(64), role: "avatar", url: "https://media.robertsspaceindustries.com/avatar.png" }] }
  }, policy);
  assert.deepEqual(JSON.parse(JSON.stringify(entries[0].references)), [{ recordType: "profile", recordKey: "account", role: "avatar" }]);
});

test("the images of a buy-back page and of the ships it lists receive a schema-valid buy-back entity reference", async () => {
  const api = load();
  const entries = await api.plan({
    account: { localAccountId: "account" },
    buybackDetails: [{
      buybackId: 7,
      recordKey: "buyback-detail:7",
      name: "A pack",
      images: [{ imageKey: "4".repeat(64), role: "detail", url: "https://media.robertsspaceindustries.com/detail.png" }],
      ships: [{ name: "A ship", images: [{ imageKey: "5".repeat(64), role: "ship", url: "https://media.robertsspaceindustries.com/ship.png" }] }]
    }]
  }, policy);
  assert.deepEqual(JSON.parse(JSON.stringify(entries.flatMap((entry) => entry.references))).sort((left, right) => left.role.localeCompare(right.role)), [
    { recordType: "buyback", recordKey: "buyback-detail:7", role: "detail" },
    { recordType: "buyback", recordKey: "buyback-detail:7:ships:0", role: "ship" }
  ]);
});
