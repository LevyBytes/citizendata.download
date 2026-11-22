import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

test("eligible known paginated sections issue at most two concurrent requests and preserve page order", async () => {
  const page = (number) => ({ success: 1, data: { rendered: `<article data-page="${number}"></article>`, page: String(number), pagecount: "3" } });
  const fixture = harness([page(2), page(3)], {
    hangarLog: (message) => {
      const pageNumber = Number(/data-page="([0-9]+)"/u.exec(message.html)?.[1]);
      return { raw: [{ rawTimestamp: `page-${pageNumber}`, subjectId: pageNumber, subjectName: `Page ${pageNumber}`, kind: "created", rawDetail: "Created", parsed: { recognized: false } }] };
    }
  }, { answerWhenInFlight: 2 });
  const startedActivities = [];
  const result = await fixture.api.collectStep({ id: "hangarLog" }, {
    cursor: { page: 2, interactiveState: { pageCount: 3 } },
    concurrentRequestStaggerMs: 2,
    onRequestActivity: async (activity) => { startedActivities.push(activity); }
  });
  assert.equal(result.done, true);
  assert.equal(fixture.maximumInFlight(), 2);
  assert.deepEqual([...result.raw].map((record) => record.subjectId), [2, 3]);
  assert.deepEqual(fixture.calls.filter((call) => call.kind === "fetch").map((call) => JSON.parse(call.options.body).page), [2, 3]);
  assert.deepEqual([...result.requestActivities].map((activity) => activity.page), [2, 3]);
  assert.deepEqual(startedActivities.map((activity) => [activity.kind, activity.method, activity.route, activity.page]), [
    ["request-started", "POST", "/api/account/pledgeLog", 2],
    ["request-started", "POST", "/api/account/pledgeLog", 3]
  ]);
  assert.deepEqual([...result.sourceUrls], ["https://robertsspaceindustries.com/api/account/pledgeLog"]);
  assert.ok(result.requestActivities.every((activity) => !Object.keys(activity).some((key) => /token|header|body|html|cookie/iu.test(key))));
  assert.ok(startedActivities.every((activity) => !Object.keys(activity).some((key) => /token|header|body|html|cookie/iu.test(key))));
});

test("Buybacks keep the staggered two-lane cadence", async () => {
  const fixture = harness([
    { success: 1, code: "OK", data: { rendered: "<article data-page=\"2\"></article>", page: 2, pagecount: 16 } },
    { success: 1, code: "OK", data: { rendered: "<article data-page=\"3\"></article>", page: 3, pagecount: 16 } }
  ], { buybacks: (message) => {
    const pageNumber = Number(/data-page="([0-9]+)"/u.exec(message.html)?.[1]);
    return { raw: [{ buybackId: pageNumber, title: `Page ${pageNumber}` }] };
  } }, { answerWhenInFlight: 2 });
  const result = await fixture.api.collectStep({ id: "buybacks" }, { cursor: { page: 2, interactiveState: { pageCount: 16 } }, concurrentRequestStaggerMs: 2 });
  assert.equal(result.done, false);
  assert.equal(result.nextPage, 4);
  assert.equal(fixture.maximumInFlight(), 2);
  assert.deepEqual(fixture.calls.filter((call) => call.kind === "fetch").map((call) => JSON.parse(call.options.body)), [
    { page: 2, pagesize: 100 },
    { page: 3, pagesize: 100 }
  ]);
  assert.ok(fixture.calls.filter((call) => call.kind === "fetch").every((call) => call.options.method === "POST" && new URL(call.url).search === "" && call.options.headers["X-Rsi-Token"] === "transient-test-token"));
  assert.deepEqual([...result.requestActivities].map((activity) => activity.page), [2, 3]);
});
