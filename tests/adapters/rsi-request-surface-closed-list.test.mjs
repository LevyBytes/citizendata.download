// The extension's RSI requests are a closed list (extension/adapters/rsi-api.js): the POST addresses that carry the
// session token, and the page addresses it reads. Nothing outside it passes the checks a request goes through, no
// GraphQL text the extension holds is a mutation, and a full build of the synthetic RSI asks for nothing else.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { SMALL, build } from "../extension/build-history-loaded-with-fixture-builds-and-rosters.mjs";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

const { api } = harness([]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOKEN_POSTS = [
  "/api/account/buybackPledges", "/api/account/creditLog", "/api/account/pledgeLog", "/api/account/recLog", "/api/account/uecLog",
  "/api/account/v2/setAuthToken", "/api/orgs/getOrgMembers", "/api/ship-upgrades/setContextToken", "/api/spectrum/auth/identify",
  "/graphql", "/pledge-store/api/upgrade/graphql"
];
const PAGES = [
  "/en/citizens/Example_Handle", "/en/citizens/Example-Handle/organizations", "/account/pledges", "/account/pledges?page=3&product-type=upgrade",
  "/pledge/buyback/123456", "/account/billing", "/account/billing?page=2&pagesize=100"
];
// Gift, reclaim, apply, cart, checkout and account-changing addresses, and approved ones bent out of shape.
const REFUSED_PAGES = [
  "/pledge/gift/1", "/pledge/reclaim/1", "/pledge/buyback/123456/apply", "/account/pledges?action=reclaim&pledge_id=1", "/account/pledges?page=0",
  "/store/pledge/cart", "/store/pledge/checkout", "/pledge-store/checkout", "/account/settings", "/account/profile", "/account/referral-program",
  "/account/billing?pagesize=10", "/account/billing?page=1&pagesize=100&order=1", "/en/citizens/Example_Handle?tab=1", "/en/citizens/../account/settings",
  "https://example.com/account/pledges", "//example.com/account/pledges", "http://robertsspaceindustries.com/account/pledges"
];
const REFUSED_POSTS = [
  "/api/account/reclaimPledge", "/api/account/giftPledge", "/api/account/applyBuyback", "/api/store/v2/cart/add", "/api/store/cart/validate",
  "/api/account/updateNickname", "/api/account/v2/setPassword", "/api/account/pledgeLog?page=2", "/graphql/", "https://example.com/graphql",
  "http://robertsspaceindustries.com/graphql"
];

test("the token-bearing POST addresses and the page addresses are a closed list", () => {
  assert.deepEqual([...api.TOKEN_POST_PATHS], TOKEN_POSTS);
  for (const address of TOKEN_POSTS) assert.notEqual(api.approvedPostUrl(address), null, address);
  for (const address of PAGES) assert.equal(api.approvedHtmlPath(address), true, address);
  for (const address of REFUSED_POSTS) assert.equal(api.approvedPostUrl(address), null, address);
  for (const address of REFUSED_PAGES) assert.equal(api.approvedHtmlPath(address), false, address);
  // A POST address is no page address, and a page address no POST address.
  for (const address of TOKEN_POSTS) assert.equal(api.approvedHtmlPath(address), false, address);
  for (const address of PAGES) assert.equal(api.approvedPostUrl(address), null, address);
});

test("no GraphQL text in the extension's sources is a mutation", async () => {
  const files = [];
  for (const folder of ["extension", "platform"]) {
    for (const entry of await readdir(path.join(root, folder), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".js")) files.push(path.join(entry.parentPath, entry.name));
    }
  }
  assert.ok(files.some((file) => file.endsWith("rsi-api.js")));
  for (const file of files) assert.doesNotMatch(await readFile(file, "utf8"), /\bmutation\b/iu, path.relative(root, file));
});

test("a full build asks RSI only for addresses on the list", async () => {
  const extension = await createExtensionHarness({ account: SMALL });
  await build(extension, extension.openTab());
  const requests = extension.rsi.requests.filter((request) => request.origin === "https://robertsspaceindustries.com");
  assert.ok(requests.length > 20, `${requests.length} requests`);
  for (const request of requests) {
    if (request.method === "POST") assert.ok(TOKEN_POSTS.includes(request.path), request.path);
    else {
      assert.equal(request.method, "GET", request.path);
      assert.equal(request.tokenSent, false, `a page request carries no token: ${request.path}`);
      assert.equal(api.approvedHtmlPath(request.page ? `${request.path}?page=${request.page}` : request.path), true, request.path);
    }
  }
  const others = extension.rsi.requests.filter((request) => request.origin !== "https://robertsspaceindustries.com");
  assert.ok(others.every((request) => request.method === "GET" && !request.tokenSent), JSON.stringify(others));
});
