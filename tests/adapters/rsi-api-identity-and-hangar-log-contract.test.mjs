import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

test("identity and Hangar Log use fixed authenticated POST contracts", async () => {
  const { api, calls, messages } = harness([
    { success: 1, data: { member: { id: 7, nickname: "VerifiedCitizen", displayname: "Verified Citizen", avatar: "/avatar.jpg" } } },
    { success: 1, data: { rendered: "<div class=\"pledge-log-entry\">row</div>", page: 1, pagecount: 2 } },
    { success: 1, data: { rendered: "<div class=\"pledge-log-entry\">row</div>", page: 2, pagecount: 2 } }
  ]);

  const identity = await api.identifyAccount();
  assert.equal(identity.accountId, "VerifiedCitizen");
  const first = await api.collectStep({ id: "hangarLog" }, { cursor: null });
  const second = await api.collectStep({ id: "hangarLog" }, { cursor: { page: 2 } });
  assert.equal(first.done, false);
  assert.equal(first.nextPage, 2);
  assert.equal(second.done, true);
  assert.equal(second.nextPage, null);
  assert.deepEqual([...first.sourceUrls], ["https://robertsspaceindustries.com/api/account/pledgeLog"]);
  assert.equal(messages.length, 2);
  assert.ok(messages.every((message) => message.kind === "CITIZENDATA_PARSE_RSI_MARKUP" && message.fragmentType === "hangarLog"));

  const fetches = calls.filter((call) => call.kind === "fetch");
  assert.deepEqual(fetches.map((call) => new URL(call.url).pathname), [
    "/api/spectrum/auth/identify",
    "/api/account/pledgeLog",
    "/api/account/pledgeLog"
  ]);
  assert.deepEqual(fetches.map((call) => JSON.parse(call.options.body)), [{}, { page: 1 }, { page: 2 }]);
  assert.ok(fetches.every((call) => call.options.method === "POST" && call.options.credentials === "include" && call.options.headers["X-Rsi-Token"] === "transient-test-token"));
});

test("Hangar Log rejects a changed page contract before parsing", async () => {
  const { api, messages } = harness([
    { success: 1, data: { rendered: "<div></div>", page: 9, pagecount: 9 } }
  ]);
  await assert.rejects(api.collectStep({ id: "hangarLog" }, { cursor: { page: 1 } }), /RSI_HANGAR_LOG_PAGE_MISMATCH_REQUESTED_1_OBSERVED_9/u);
  assert.equal(messages.length, 0);
});
