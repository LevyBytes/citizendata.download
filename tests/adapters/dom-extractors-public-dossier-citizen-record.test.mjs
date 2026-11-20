import assert from "node:assert/strict";
import test from "node:test";
import { textNode } from "./dom-extractors-loaded-with-fixture-nodes.mjs";

test("public dossier profile extractor preserves the numeric UEE Citizen Record", () => {
  const entry = (label, value) => ({
    querySelector(selector) {
      if (selector === ".label") return label ? textNode(label) : null;
      if (selector === ".value") return textNode(value);
      return null;
    }
  });
  const displayName = entry(null, "Verified Citizen");
  const handle = entry("Handle name", "VerifiedCitizen");
  const title = entry(null, "Pathfinder");
  const profile = {
    querySelectorAll(selector) {
      if (selector === ".info .entry") return [displayName, handle, title];
      return [];
    }
  };
  const root = {
    querySelector(selector) {
      if (selector === ".profile.left-col") return profile;
      if (selector === ".citizen-record .value") return textNode("#424242");
      return null;
    },
    querySelectorAll() { return []; }
  };
  const document = {
    querySelector(selector) { return selector === ".public-profile, #public-profile, .account-profile" ? root : null; },
    querySelectorAll() { return []; }
  };
  const extracted = globalThis.CitizenDataDomExtractors.extractProfile(document, { baseUrl: "https://robertsspaceindustries.com/en/citizens/VerifiedCitizen" });
  assert.equal(extracted.ueeCitizenRecord, 424242);
  assert.equal(extracted.handle, "VerifiedCitizen");
});

// That the extractors and the collector hold no request authority of their own is shown by behaviour, not by reading
// their source: tests/extension/service-worker.test.mjs runs a whole build with the page parser in a context that has
// a document parser and nothing else, and checks every request the build made. The source scan that remains, in
// tests/extension/manifest.test.mjs, finds `fetch(` in one module only.
