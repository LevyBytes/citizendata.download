// An order's billing and shipping address are always null (schema/account-export.schema.json): a build records none,
// and the schema refuses an address object. The dashboard's exports refuse one as well (account-exports tests).
import assert from "node:assert/strict";
import test from "node:test";
import { AccountDocument, account } from "../extension/build-history-loaded-with-fixture-builds-and-rosters.mjs";
import { accountSchema } from "./account-document-contract-under-test.mjs";

const ADDRESS = { name: "A Citizen", lines: ["1 Example Street"], city: "Example", region: null, postalCode: "00000", country: "US" };

test("a build's orders hold no postal address, and the schema refuses one", async () => {
  const { first } = await account();
  assert.ok(first.financial.orders.length > 0);
  assert.ok(first.financial.orders.every((order) => order.billingAddress === null && order.shippingAddress === null));
  assert.equal(AccountDocument.validateWithSchema(first, accountSchema).valid, true);
  assert.equal(accountSchema.$defs.address, undefined, "no address definition is left");
  for (const key of ["billingAddress", "shippingAddress"]) {
    for (const value of [ADDRESS, { country: "US" }, {}, ""]) {
      const changed = structuredClone(first);
      changed.financial.orders[0][key] = value;
      const stamped = await AccountDocument.stampIntegrity(changed);
      assert.equal(AccountDocument.validateWithSchema(stamped, accountSchema).valid, false, `${key} ${JSON.stringify(value)}`);
    }
  }
});
