import assert from "node:assert/strict";
import test from "node:test";
import { memberNode, textNode } from "./dom-extractors-loaded-with-fixture-nodes.mjs";

test("organization member extractor preserves public fields and redacts restricted rows", () => {
  const members = [
    memberNode({ className: "member-item js-member-item org-visibility-V org-main", displayName: "Public Pilot", handle: "PublicPilot", rank: "Captain", stars: 3, roles: ["Flight", "Flight"] }),
    memberNode({ className: "member-item js-member-item org-visibility-R" })
  ];
  const document = {
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === "#members-data .member-item, #members-data .js-member-item" ? members : []; }
  };
  const extracted = globalThis.CitizenDataDomExtractors.extractOrganizationMembers(document, { organizationSid: "TEST" });
  assert.deepEqual(extracted[0], {
    organizationSid: "TEST",
    visibility: "public",
    displayName: "Public Pilot",
    handle: "PublicPilot",
    membershipType: "main",
    rank: "Captain",
    rankStars: 3,
    roles: ["Flight"],
    images: [],
    relatedUrls: [
      "https://robertsspaceindustries.com/en/orgs/TEST/members",
      "https://robertsspaceindustries.com/en/citizens/PublicPilot",
      "https://robertsspaceindustries.com/spectrum/messages/member/PublicPilot"
    ]
  });
  assert.deepEqual(extracted[1], {
    organizationSid: "TEST",
    visibility: "restricted",
    displayName: null,
    handle: null,
    membershipType: null,
    rank: null,
    rankStars: null,
    roles: [],
    images: [],
    relatedUrls: ["https://robertsspaceindustries.com/en/orgs/TEST/members"]
  });
  assert.throws(() => globalThis.CitizenDataDomExtractors.extractOrganizationMembers(document, { organizationSid: "../TEST" }), /validated organization SID/u);
  assert.throws(
    () => globalThis.CitizenDataDomExtractors.extractOrganizationMembers(document, { organizationSid: "TEST", baseUrl: "https://example.com/en/orgs/TEST/members" }),
    /extension-owned roster route/u
  );
});

test("buyback fallback keys are stable within a page and unique across pages", () => {
  const entry = (title) => ({
    getAttribute() { return null; },
    querySelector(selector) {
      if ([".pledge-title-row h1", ".information h1", "h1"].includes(selector)) return textNode(title);
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "dd") return [textNode("May 19, 2026"), textNode("One item")];
      return [];
    }
  });
  const entries = [entry("First buyback"), entry("Second buyback")];
  const document = {
    querySelector() { return null; },
    querySelectorAll(selector) { return selector.includes("article.pledge") ? entries : []; }
  };
  const pageThree = globalThis.CitizenDataDomExtractors.extractBuybacks(document, { baseUrl: "https://robertsspaceindustries.com/en/account/buy-back-pledges?page=3&pagesize=100" });
  const repeatedPageThree = globalThis.CitizenDataDomExtractors.extractBuybacks(document, { baseUrl: "https://robertsspaceindustries.com/en/account/buy-back-pledges?page=3&pagesize=100" });
  const pageFour = globalThis.CitizenDataDomExtractors.extractBuybacks(document, { baseUrl: "https://robertsspaceindustries.com/en/account/buy-back-pledges?page=4&pagesize=100" });
  assert.deepEqual(pageThree.map((record) => record.recordKey), ["buyback-listing:3:0", "buyback-listing:3:1"]);
  assert.deepEqual(repeatedPageThree.map((record) => record.recordKey), pageThree.map((record) => record.recordKey));
  assert.equal(new Set([...pageThree, ...pageFour].map((record) => record.recordKey)).size, 4);
});
