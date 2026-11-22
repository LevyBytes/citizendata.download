import { readFileSync } from "node:fs";

// RSI's status page and its JSON feed (PARSER_HARDENING.md §9.3). The feed recorded on 2026-11-21 is the "ok"
// answer; the other answers are made from it.
export const STATUS_ORIGIN = "https://status.robertsspaceindustries.com";
export const STATUS_FEED_PATH = "/index.json";
export const RECORDED_STATUS_FEED = readFileSync(new URL("../../fixtures/rsi-status-feed/status-feed-2026-11-21.json", import.meta.url), "utf8");

function feed(change) {
  const value = JSON.parse(RECORDED_STATUS_FEED);
  change(value);
  return { status: 200, contentType: "application/json", body: JSON.stringify(value), headers: { "cache-control": "public,max-age=300" } };
}

// Each answer the status host can give, by name.
export const STATUS_FEED_VARIANTS = Object.freeze({
  // The recorded feed, byte for byte: every system operational, no unresolved issue.
  ok: () => ({ status: 200, contentType: "application/json", body: RECORDED_STATUS_FEED, headers: { "cache-control": "public,max-age=300" } }),
  // The summary is not operational, and one system says why.
  "issue-system": () => feed((value) => {
    value.summaryStatus = "disrupted";
    value.systems[0].status = "disrupted";
  }),
  // Every status operational, but one system holds an unresolved issue.
  "issue-unresolved": () => feed((value) => {
    value.systems[1].unresolvedIssues = [{ title: "Login delays", createdAt: "2026-11-21T10:00:00Z", severity: "notice" }];
  }),
  // The summary is not operational and no system explains it.
  "issue-summary-only": () => feed((value) => {
    value.summaryStatus = "down";
  }),
  // Unreadable: another status, a page in place of JSON, and a feed without its systems.
  "unreadable-status": () => ({ status: 503, contentType: "text/html", body: "Service Unavailable" }),
  "unreadable-html": () => ({ status: 200, contentType: "text/html; charset=UTF-8", body: "<!doctype html><title>RSI Status</title>" }),
  "unreadable-no-systems": () => feed((value) => {
    delete value.systems;
  })
});

// Gives the status host's router: the feed answers with the variant `state.statusFeed` names; any other address is 404.
export function statusFeedRouter(state) {
  return (url, method) => {
    if (method !== "GET" || url.pathname !== STATUS_FEED_PATH) return { status: 404, contentType: "text/html", body: "Not found" };
    const variant = STATUS_FEED_VARIANTS[state.statusFeed ?? "ok"];
    if (!variant) throw new Error(`No status feed answer is named ${state.statusFeed}.`);
    return variant();
  };
}
