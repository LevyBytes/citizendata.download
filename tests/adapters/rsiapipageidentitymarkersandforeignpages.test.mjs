// Page identity (PARSER_HARDENING.md §5.3): each page's marker on the synthetic pages, and a foreign page at each
// collector, which stops the read as row 22 and is not kept in the cache.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser } from "../support/mini-dom.mjs";
import { createSyntheticRsi } from "../support/extension-harness/extension-files-and-identifiers.mjs";
import { harness } from "./rsi-api-in-a-sandbox.mjs";
import { failure } from "./rsiapicanaryandpageidentity.mjs";

// Page identity (§5.3): each page's marker, read by the extractors the offscreen parser runs.
await import("../../extension/adapters/dom-extractors.js");
const Extractors = globalThis.CitizenDataDomExtractors;

test("each page RSI serves holds its own marker: the dossier, billing, the hangar and the organizations page", async () => {
  const rsi = createSyntheticRsi({ handle: "MarkerCitizen" });
  const read = async (path) => new DOMParser().parseFromString(await (await rsi.fetch(`https://robertsspaceindustries.com${path}`, { method: "GET", credentials: "include" })).text(), "text/html");
  const pages = {
    dossier: await read("/en/citizens/MarkerCitizen"),
    billing: await read("/account/billing?page=1&pagesize=100"),
    hangar: await read("/account/pledges?page=1&product-type="),
    organizations: await read("/en/citizens/MarkerCitizen/organizations")
  };
  // The page each fragment type is recognized on. The organizations marker is the profile wrapper, which the dossier
  // carries too; the dossier's own marker also needs its "Handle name" label.
  const expected = {
    profile: ["dossier"],
    "financial.balances": ["billing"],
    "financial.billingTotal": ["billing"],
    "financial.orders": ["billing"],
    "financial.subscriptions": ["billing"],
    pledges: ["hangar"],
    "organizations.memberships": ["dossier", "organizations"]
  };
  assert.deepEqual(Object.keys(Extractors.PAGE_MARKERS).sort(), Object.keys(expected).sort());
  for (const [fragmentType, recognizedOn] of Object.entries(expected)) {
    for (const [name, document] of Object.entries(pages)) {
      assert.equal(Extractors.pageRecognized(document, fragmentType), recognizedOn.includes(name), `${fragmentType} on the ${name} page`);
    }
  }
  assert.equal(Extractors.pageRecognized(pages.hangar, "buybackDetail"), null, "a fragment type without a marker is not checked here");
});

test("a foreign page at each collector stops the read as an unclear answer before any of its values is used, and is not kept", async () => {
  const foreign = { pageRecognized: false, pageTitle: `  Just a moment${".".repeat(200)}` };
  const collectors = [
    ["profile", "/en/citizens/VerifiedCitizen", { raw: { handle: "VerifiedCitizen" } }],
    ["financial.balances", "/account/billing", { raw: { storeCredit: { amount: "0", unit: "USD" }, uec: null, rec: null } }],
    ["financial.orders", "/account/billing", { raw: [], pageCount: 1 }],
    ["pledges", "/account/pledges", { raw: [{ pledgeId: 1, title: "Package" }], pageCount: 1 }],
    ["organizations.memberships", "/en/citizens/VerifiedCitizen/organizations", { raw: [] }]
  ];
  for (const [id, path, values] of collectors) {
    const fragmentType = id;
    let answers = 0;
    // The first answer is a foreign page; the second, the same address read again, is the page asked for.
    const { api, calls } = harness([{ kind: "html", body: "<html><title>Just a moment</title></html>" }, { kind: "html", body: "<html><title>Page</title></html>" }], {
      [fragmentType]: () => {
        answers += 1;
        return answers === 1 ? { ...values, ...foreign } : { ...values, pageRecognized: true, pageTitle: "Page" };
      }
    });
    const error = await failure(api.collectStep({ id }, { accountId: "VerifiedCitizen", cursor: null, concurrentRequestStaggerMs: 0 }));
    assert.deepEqual([error.signal.kind, error.signal.code, error.signal.method, error.signal.route], ["ambiguous", "RSI_PAGE_NOT_RECOGNIZED", "GET", path], id);
    assert.equal(error.signal.rsiMessage.length <= 160 && error.signal.rsiMessage.startsWith("Just a moment"), true, `${id}: ${error.signal.rsiMessage}`);
    // Read again, the address is asked of RSI once more: the foreign page was not kept in the cache.
    await api.collectStep({ id }, { accountId: "VerifiedCitizen", cursor: null, concurrentRequestStaggerMs: 0 }).catch(() => null);
    assert.equal(calls.filter((call) => call.kind === "fetch" && new URL(call.url).pathname === path).length, 2, `${id} read its page again`);
  }
});
