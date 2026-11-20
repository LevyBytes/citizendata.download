import assert from "node:assert/strict";
import test from "node:test";
import { accountFixture } from "./dashboard-model-fixture-account.mjs";
import { Model } from "./dashboard-scripts-under-test.mjs";

test("render validation preserves nullable metadata and does not mutate a document", () => {
  const document = accountFixture();
  const before = structuredClone(document);
  assert.equal(Model.validateAccountDocument(document), document);
  assert.deepEqual(document, before);
  assert.equal(Model.getBalance(document, "storeCredit"), null);
  assert.equal(Model.getMainMembership(document), null);
  assert.deepEqual(Model.sortReferralRecords(document.referrals.current.prospects), document.referrals.current.prospects);
  assert.equal(Model.membersForOrganization(document, "AFF").length, 1);
});

test("the bundled example satisfies the renderer input checks", () => {
  const document = structuredClone(globalThis.CITIZENDATA_DEMO_DATA);
  assert.equal(Model.validateAccountDocument(document), document);
  assert.equal(Model.getMainMembership(document)?.sid, "TEST");
});

test("render validation rejects malformed records before sorting or rendering", () => {
  const cases = [
    ["pledges[0]", document => { document.pledges[0] = null; }],
    ["buybacks[0]", document => { document.buybacks = [42]; }],
    ["referrals.current.prospects[0]", document => { document.referrals.current.prospects[0] = []; }],
    ["organizations.memberships[0]", document => { document.organizations.memberships[0] = null; }],
    ["organizations.members[0]", document => { document.organizations.members[0] = "member"; }],
    ["pledges[0].recordKey", document => { delete document.pledges[0].recordKey; }],
    ["pledges[0].items[0]", document => { document.pledges[0].items = [null]; }],
    ["profile.images", document => { document.profile.images = {}; }],
    ["profile.images[0].imageKey", document => { document.profile.images = [{ imageKey: {} }]; }],
    ["pledges[0].sourceLinks[0].url", document => { document.pledges[0].sourceLinks = [{ url: [] }]; }],
    ["profile.displayTitle", document => { document.profile.displayTitle = { text: "Title" }; }],
    ["account.ueeCitizenRecord", document => { document.account.ueeCitizenRecord = 9007199254740992; }],
    ["financial.balances.storeCredit", document => { document.financial.balances.storeCredit = { amount: 1.25, unit: "USD" }; }],
    ["financial.balances.storeCredit", document => { document.financial.balances.storeCredit = { amount: "unknown", unit: "USD" }; }],
    ["organizations.memberships[0].memberCount", document => { document.organizations.memberships[0].memberCount = "100"; }],
    ["organizations.memberships[0].isMain", document => { document.organizations.memberships[0].isMain = "false"; }],
    ["organizations.members[0].rankStars", document => { document.organizations.members[0].rankStars = -1; }],
    ["organizations.members[0].roles", document => { document.organizations.members[0].roles = [{}]; }],
    ["organizations.members[0].visibility", document => { document.organizations.members[0].visibility = "private"; }],
    ["sync.sectionOutcomes.profile.status", document => { document.sync.sectionOutcomes.profile = { status: [] }; }]
  ];
  for (const [label, change] of cases) {
    const document = accountFixture();
    change(document);
    assert.throws(() => Model.validateAccountDocument(document), error => error.message.includes(label), label);
  }
});

test("financial formatting preserves large and four-decimal strings exactly", () => {
  assert.equal(Model.formatExactNumber("90071992547409931234"), "90,071,992,547,409,931,234");
  assert.equal(Model.formatExactMoney("123456789012345.6789", "USD"), "$123,456,789,012,345.6789");
  assert.equal(Model.formatExactMoney("-1.5", "USD"), "-$1.50");
});
