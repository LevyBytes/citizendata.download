// The section each RSI request of an Account Data build belongs to, in the canonical order of
// accountBuild.sectionOrder (PARSER_HARDENING.md §4.8), with the four financial sections and the three referral
// sections each taken as one group. The run-start identify request and its canary belong to none.
const GROUPS = Object.freeze(["profile", "hangarLog", "financial", "pledges", "buybacks", "referrals", "organizations.memberships", "buybackDetails", "buybackUpgradePrices"]);
const LEDGER_PATHS = new Set(["/api/account/creditLog", "/api/account/uecLog", "/api/account/recLog"]);

function groupOf(request, handle) {
  const { path } = request;
  const operations = request.operations ?? [];
  if (path === "/api/spectrum/auth/identify") return null;
  if (path === `/en/citizens/${handle}` || operations.includes("GetAuthenticatedUser") || operations.includes("GetAccountDashboardData")) return 0;
  if (path === "/api/account/pledgeLog") return 1;
  if (path === "/account/billing" || LEDGER_PATHS.has(path)) return 2;
  if (path === "/account/pledges") return 3;
  if (path === "/api/account/buybackPledges") return 4;
  if (operations.some((operation) => operation.startsWith("GetReferral"))) return 5;
  if (path === `/en/citizens/${handle}/organizations`) return 6;
  if (/^\/(en\/)?pledge\/buyback\/[0-9]+$/u.test(path)) return 7;
  if (path === "/pledge" || path === "/api/account/v2/setAuthToken" || path.startsWith("/api/ship-upgrades/") || path.startsWith("/pledge-store/")) return 8;
  return -1;
}

// The sections in the order their requests were sent, each once, and every request whose section went back to an
// earlier one or is not known. `requests` are the synthetic account's records of one build.
export function sectionOrderOf(requests, handle) {
  const order = [];
  const outOfOrder = [];
  let highest = -1;
  for (const request of requests) {
    const group = groupOf(request, handle);
    if (group === null) continue;
    if (group < 0 || group < highest) outOfOrder.push(`${request.method} ${request.path} after ${GROUPS[highest] ?? "nothing"}`);
    if (group > highest) {
      highest = group;
      order.push(GROUPS[group]);
    }
  }
  return { order, outOfOrder };
}
