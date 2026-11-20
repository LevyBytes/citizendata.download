import assert from "node:assert/strict";
import test from "node:test";
import { textNode } from "./dom-extractors-loaded-with-fixture-nodes.mjs";

test("authenticated profile settings expose the signed-in handle for account verification", () => {
  const item = (label, value) => ({
    querySelector(selector) {
      if (selector === ".settingsItemTitle__icon") return textNode(label);
      if (selector === ".settingsItemData__content") return textNode(value);
      return null;
    },
    querySelectorAll() { return []; }
  });
  const settingsItems = [
    item("Handle", "@VerifiedCitizen"),
    item("Display Name", "Verified Citizen"),
    item("Display Title", "Pathfinder"),
    item("Location", "Earth"),
    item("Spoken Languages", "English, Spanish")
  ];
  const document = {
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === ".settingsItem" ? settingsItems : []; }
  };
  const extracted = globalThis.CitizenDataDomExtractors.extractProfile(document);
  assert.equal(extracted.handle, "VerifiedCitizen");
  assert.equal(extracted.displayName, "Verified Citizen");
  assert.equal(extracted.displayTitle, "Pathfinder");
  assert.equal(extracted.ueeCitizenRecord, null);
  assert.deepEqual(extracted.languages, ["English", "Spanish"]);
  assert.deepEqual(extracted.relatedUrls, ["https://robertsspaceindustries.com/en/account/settings/profile"]);
});

test("My Hangar is the single authentication preflight and exposes the signed-in dossier handle", () => {
  const dossierLink = {
    getAttribute(name) { return name === "href" ? "https://robertsspaceindustries.com/en/citizens/VerifiedCitizen" : null; }
  };
  const signedIn = {
    title: "My Hangar - Roberts Space Industries",
    body: textNode("My Hangar"),
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === "a[href*='/citizens/']" ? [dossierLink] : []; }
  };
  assert.deepEqual(globalThis.CitizenDataDomExtractors.extractSessionIdentity(signedIn), {
    state: "authenticated",
    handle: "VerifiedCitizen"
  });

  const signedOut = {
    title: "Roberts Space Industries",
    body: textNode("Restricted Area Authorized Personnel Only You must be authenticated to reach this area."),
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  assert.deepEqual(globalThis.CitizenDataDomExtractors.extractSessionIdentity(signedOut), {
    state: "signed-out",
    handle: null
  });
});
