import assert from "node:assert/strict";
import { createSyntheticRsi, dashboard, setRsi } from "./browser-pages-and-account-in-use.mjs";
import { changeRsiAnswers } from "./answers-to-browser-requests.mjs";
import { freshDashboard, startBuild, waitForSavedDialog } from "./dashboard-pages-and-builds.mjs";
import { refuseRsiWhen } from "./held-rsi-requests.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { waitForExportedFile } from "./stored-state-alarms-and-saved-files.mjs";

const COUNTS = { pledges: 6, buybacks: 4, orders: 2, storeCredit: 3, uec: 2, rec: 2, prospects: 5 };
// A prospect row RSI could send after a change on its side: its fields are not the kinds the parser reads.
const MALFORMED = Object.freeze({ id: "prospect-malformed", displayName: 42, nickname: null, enlistedOn: "not a date", convertedOn: null, avatar: null });

const referralList = (request) => request.method === "POST" && new URL(request.url).pathname === "/graphql" && String(request.postData ?? "").includes("GetReferralRecruitsList");

// Puts the malformed row first in the first page of prospects, as RSI would send it.
function withMalformedProspect(request, text) {
  if (!referralList(request)) return text;
  const asked = JSON.parse(request.postData);
  const variables = (Array.isArray(asked) ? asked[0] : asked)?.variables ?? {};
  if (variables.converted === true || (variables.page ?? 1) !== 1) return text;
  const answer = JSON.parse(text);
  answer[0].data.referralRecruitsList.data.unshift({ ...MALFORMED });
  return JSON.stringify(answer);
}

// What the two builds must share: the normalized prospects and the evidence of the rejected row, without the times
// they were observed and the addresses, which differ between two accounts and two runs.
function prospectsAndEvidence(document, handle) {
  const scrub = (value) => JSON.parse(JSON.stringify(value).replaceAll(handle, "{handle}"));
  const evidence = (document.dataQuality?.anomalies ?? []).filter((anomaly) => String(anomaly.section ?? "").startsWith("referrals"))
    .map((anomaly) => {
      const kept = { ...anomaly };
      delete kept.observedAt;
      delete kept.sourceUrls;
      return scrub(kept);
    });
  const prospects = document.referrals.current.prospects.map((prospect) => scrub({ ...prospect, observation: { ...prospect.observation, firstObservedAt: null, lastObservedAt: null } }));
  return { prospects, evidence };
}

// The first prospect or evidence row that differs, both ways, for the failure message.
function firstDifference(actual, expected) {
  for (const part of ["prospects", "evidence"]) {
    const index = expected[part].findIndex((row, at) => JSON.stringify(row) !== JSON.stringify(actual[part][at]));
    if (index >= 0 || actual[part].length !== expected[part].length) return { part, index, throttled: actual[part][index] ?? null, calm: expected[part][index] ?? null };
  }
  return null;
}

async function buildWithMalformedRow(handle, throttled) {
  await freshDashboard();
  const account = createSyntheticRsi({ handle, counts: COUNTS });
  setRsi(account);
  // RSI holding a limit on referral reads only: a second referral request within 3 seconds is refused.
  const seen = [];
  const limit = throttled ? refuseRsiWhen((request) => {
    if (!referralList(request)) return false;
    const now = Date.now();
    while (seen.length > 0 && seen[0] <= now - 3000) seen.shift();
    seen.push(now);
    return seen.length > 1;
  }, { status: 429, retryAfterSeconds: 1, forMs: Number.POSITIVE_INFINITY }) : null;
  changeRsiAnswers(withMalformedProspect);
  try {
    await startBuild(dashboard);
    await waitForSavedDialog(dashboard, 180000);
  } finally {
    changeRsiAnswers(null);
    limit?.lift();
  }
  return { document: JSON.parse((await waitForExportedFile(handle)).text), refused: limit?.refusedAt.length ?? 0 };
}

// A throttled section containing malformed rows (PARSER_HARDENING.md §5.7, §15.5) completes with the same normalized
// values and the same anomaly evidence as the unthrottled section.
export async function throttledMalformedRows() {
  const calm = await buildWithMalformedRow("CalmReferralCitizen", false);
  const throttled = await buildWithMalformedRow("ThrottledReferralCitizen", true);
  assertStep(throttled.refused > 0, "The referral reads were never refused, so the section was not throttled.");
  const expected = prospectsAndEvidence(calm.document, "CalmReferralCitizen");
  const actual = prospectsAndEvidence(throttled.document, "ThrottledReferralCitizen");
  assertStep(expected.evidence.length > 0, `The malformed prospect left no evidence: ${JSON.stringify(calm.document.dataQuality?.anomalies ?? []).slice(0, 400)}`);
  assertStep(JSON.stringify(actual) === JSON.stringify(expected), `The throttled section's prospects or evidence differ from the unthrottled section's: ${JSON.stringify(firstDifference(actual, expected))}`);
  for (const document of [calm.document, throttled.document]) {
    assert.deepEqual([...new Set(Object.values(document.sync.sectionOutcomes).map((outcome) => outcome.status))], ["complete"], "A section with a malformed row must still complete.");
  }
  return { refused: throttled.refused, prospects: expected.prospects.length, evidence: expected.evidence.length };
}
