import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

test("update mode reuses Billing orders only after unchanged total and exact newest page", async () => {
  const order = { orderId: "ORDER-1", total: { amount: "10.00", currency: "USD" }, items: [], payments: [] };
  const { api } = harness([
    { kind: "html", body: "<main>billing</main>" }
  ], { "financial.orders": { raw: [order], pageCount: 1 } });
  const result = await api.collectStep({ id: "financial.orders" }, {
    mode: "update",
    cursor: null,
    previousSection: { current: true, recordCount: 1, values: { "financial.orders": [order] } },
    updateSignals: { "financial.billingTotal": "unchanged" }
  });
  assert.equal(result.reusePrevious, true);
});

test("update mode reuses a referral list only after authoritative total and exact newest page", async () => {
  const sourceRow = { id: "1", displayName: "Citizen", nickname: "Citizen", enlistedOn: "2026-11-18T00:00:00.000Z", convertedOn: null };
  const previousRow = {
    recordKey: "1", displayName: "Citizen", handle: "Citizen", displayNameRaw: "Citizen", nicknameRaw: "Citizen", dateLabel: "enlistedOn", dateRaw: sourceRow.enlistedOn,
    dateSortKey: "2026-11-18", images: [],
    observation: { relatedUrls: ["https://robertsspaceindustries.com/en/citizens/Citizen", "https://robertsspaceindustries.com/spectrum/messages/member/Citizen"] }
  };
  const { api } = harness([[
    { data: { referralRecruitsList: { data: [sourceRow], recruitsCount: 0, prospectsCount: 1 } } }
  ]]);
  const result = await api.collectStep({ id: "referrals.current.prospects", parserOptions: { ladder: "current", kind: "prospects" } }, {
    mode: "update",
    cursor: null,
    previousSection: { current: true, recordCount: 1, values: { "referrals.current.prospects": [previousRow] } }
  });
  assert.equal(result.reusePrevious, true);
});

test("update mode reads one page per unchanged Billing ledger through exact anchors", async () => {
  const ledgerRows = {
    storeCredit: [{ rawTimestamp: "credit", amount: "10.00", rawDetail: "Credit", parsed: { recognized: true }, observation: { relatedUrls: [] } }],
    uec: [{ rawTimestamp: "uec", amount: "20", rawDetail: "UEC", parsed: { recognized: true }, observation: { relatedUrls: [] } }],
    rec: [{ rawTimestamp: "rec", amount: "30", rawDetail: "REC", parsed: { recognized: true }, observation: { relatedUrls: [] } }]
  };
  const { api, calls } = harness([
    { success: 1, data: { rendered: "<div>credit</div>", page: 1, pagecount: 9 } },
    { success: 1, data: { rendered: "<div>uec</div>", page: 1, pagecount: 7 } },
    { success: 1, data: { rendered: "<div>rec</div>", page: 1, pagecount: 5 } }
  ], {
    ledger: (message) => ({ raw: ledgerRows[message.context.baseUrl.includes("creditLog") ? "storeCredit" : message.context.baseUrl.includes("uecLog") ? "uec" : "rec"] })
  });
  const previousSection = {
    current: true,
    recordCount: 3,
    values: {
      "financial.creditLedgers.storeCredit": ledgerRows.storeCredit,
      "financial.creditLedgers.uec": ledgerRows.uec,
      "financial.creditLedgers.rec": ledgerRows.rec
    }
  };
  let cursor = null;
  let result;
  for (let index = 0; index < 3; index += 1) {
    result = await api.collectStep({ id: "financial.ledgers" }, { mode: "update", cursor, previousSection });
    cursor = result.done ? null : { page: result.nextPage, raw: result.raw, interactiveState: result.interactiveState };
  }
  assert.equal(result.done, true);
  assert.equal(result.changeState, "unchanged");
  assert.equal(calls.filter((call) => call.kind === "fetch").length, 3);
});
