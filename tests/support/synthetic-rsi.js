// A stand-in for robertsspaceindustries.com, for tests only.
//
// It answers the fixed set of read-only requests the extension makes, with invented account data of any size, so the
// collector, the page parsers, and the dashboard can run end to end without contacting RSI. Nothing here is captured
// from a real account: every name, identifier, date, and amount is generated from the counts passed in. RSI's public
// status feed is answered too, from the copy recorded on 2026-11-21 and the variants made from it.
//
// The markup follows the element structure of the real pages as far as the extractors under extension/adapters read it.
import { ban, throttle } from "./extension-harness/virtual-clock.mjs";
import { accountChanges } from "./synthetic-rsi/account-changes.mjs";
import { createFetch } from "./synthetic-rsi/fetch-stand-in.mjs";
import { createAccount } from "./synthetic-rsi/generated-account-state.mjs";
import { buildBuybackDetail, upgradePriceCents } from "./synthetic-rsi/generated-buyback-detail-and-upgrade-price.mjs";
import { BUYBACKS_PER_PAGE, ORIGIN, PLEDGES_PER_PAGE } from "./synthetic-rsi/page-sizes-and-ship-names.mjs";
import { requestRouter } from "./synthetic-rsi/request-router.mjs";
import { STATUS_FEED_VARIANTS, STATUS_ORIGIN, statusFeedRouter } from "./synthetic-rsi/status-feed-answers.mjs";

function createSyntheticRsi(options = {}) {
  const account = createAccount(options);
  const requests = [];
  const failures = [];
  const limiters = [];
  const timing = { latencyMs: options.latencyMs ?? 0 };
  // A test with its own clock supplies these so latency and request times follow that clock.
  const now = options.now ?? (() => Date.now());
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  return {
    fetch: createFetch({ route: requestRouter(account), statusRoute: statusFeedRouter(account.state), requests, failures, limiters, timing, now, wait }),
    requests,
    state: account.state,
    counts: account.counts,
    organization: account.organization,
    setLatency(milliseconds) { timing.latencyMs = milliseconds; },
    // Makes the next `times` matching requests fail: with an HTTP status, or as a network error when status is null.
    // `headers` are added to the answer; `json`, `html` or `graphqlErrors` (with optional `data`) give its body;
    // `delayMs` holds the answer back; `location` makes it a redirect.
    failNext(matches, { status = 500, times = 1, headers = {}, json, html, graphqlErrors, data, contentType, location, delayMs = 0 } = {}) {
      failures.push({ matches, status, network: status === null, remaining: times, headers, json, html, graphqlErrors, data, contentType, location, delayMs });
    },
    // Adds a limiter on the clock: `throttle({ limit, windowMs, answer, key })` or `ban({ trigger, durationMs, answer, key })`.
    throttle(settings) {
      const limiter = throttle(settings, now);
      limiters.push(limiter);
      return limiter;
    },
    ban(settings) {
      const limiter = ban(settings, now);
      limiters.push(limiter);
      return limiter;
    },
    clearLimiters() { limiters.length = 0; },
    // Which answer RSI's status feed gives: a name of STATUS_FEED_VARIANTS.
    setStatusFeed(variant) {
      if (!Object.hasOwn(STATUS_FEED_VARIANTS, variant)) throw new Error(`No status feed answer is named ${variant}.`);
      account.state.statusFeed = variant;
    },
    ...accountChanges(account)
  };
}

globalThis.CitizenDataSyntheticRsi = Object.freeze({ createSyntheticRsi, buildBuybackDetail, upgradePriceCents, PLEDGES_PER_PAGE, BUYBACKS_PER_PAGE, ORIGIN, STATUS_ORIGIN });
