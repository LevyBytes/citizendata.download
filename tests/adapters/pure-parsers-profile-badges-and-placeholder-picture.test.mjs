import assert from "node:assert/strict";
import test from "node:test";
import { Parsers, context, image } from "./pure-parsers-under-test.mjs";

test("profile parser preserves raw badge rows and only supplied badge image URLs", async () => {
  const parsed = await Parsers.parseProfile({
    ueeCitizenRecord: 424242,
    displayName: "Citizen",
    handle: "Citizen",
    images: [],
    unlockedBadges: [
      { sourceIndex: 0, id: 2381, title: " Stella Fortuna 2955", images: [image] },
      { sourceIndex: 1, id: 2381, title: " Stella Fortuna 2955", images: [image] },
      { sourceIndex: 2, id: null, title: null, images: [] }
    ],
    selectedBadge: { title: " Stella Fortuna 2955", images: [image] },
    featuredBadges: [{ title: " Stella Fortuna 2955", images: [image], relatedUrls: ["https://robertsspaceindustries.com/account/dashboard"] }],
    relatedUrls: ["https://robertsspaceindustries.com/graphql", "https://robertsspaceindustries.com/account/dashboard"]
  }, context, { sourceUrls: ["https://robertsspaceindustries.com/graphql"] });
  assert.equal(parsed.value.unlockedBadges.length, 3);
  assert.equal(parsed.accountMetadata.ueeCitizenRecord, 424242);
  assert.equal("ueeCitizenRecord" in parsed.value, false);
  assert.equal(parsed.value.unlockedBadges[0].title, " Stella Fortuna 2955");
  assert.equal(parsed.value.unlockedBadges[0].images[0].url, image.url);
  assert.deepEqual(parsed.value.badgeCollection, {
    rawRows: 3,
    nonNullRows: 2,
    nullRows: 1,
    uniqueIdTitlePairs: 1,
    exactDuplicateRows: 1
  });
  assert.equal(parsed.value.selectedBadge.images[0].url, image.url);
  assert.deepEqual(parsed.value.featuredBadges[0].relatedUrls, ["https://robertsspaceindustries.com/account/dashboard"]);
  assert.deepEqual(parsed.value.observation.relatedUrls, ["https://robertsspaceindustries.com/account/dashboard", "https://robertsspaceindustries.com/graphql"]);
});

test("RSI's placeholder picture is not recorded as an image of a record", async () => {
  const N = globalThis.CitizenDataNormalization;
  const references = await N.imageReferences([{ url: "https://cdn.robertsspaceindustries.com/static/images/Temp/default-image.png" }, image], "thumbnail", "Ship");
  assert.deepEqual(references.map((reference) => reference.url), [image.url]);
  assert.deepEqual(await N.imageReferences([{ url: "https://cdn.robertsspaceindustries.com/static/images/Temp/default-image.png" }], "thumbnail", "Ship"), []);
});
