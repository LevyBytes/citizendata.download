// The image run's clock and image host (PARSER_HARDENING.md §15.1): a virtual clock whose earliest timer fires once
// every promise in flight has settled, and an image host on that clock with the synthetic RSI's throttle and ban.
import { createClock } from "../support/extension-harness/virtual-clock.mjs";

// A virtual clock for the image run (§15.1): sleep registers a timer, and the earliest timer fires once the real event
// loop has had a turn, so every promise in flight settles first and four workers waiting at once see one shared time.
export function virtualTime(start = 1_000_000) {
  const clock = createClock(start);
  let pumping = false;
  function pump() {
    if (pumping) return;
    pumping = true;
    setTimeout(function step() {
      const next = clock.next();
      if (!next) {
        pumping = false;
        return;
      }
      clock.fire(next);
      setTimeout(step, 1);
    }, 1);
  }
  return {
    clock,
    nowMs: () => clock.now,
    now: () => new Date(clock.now).toISOString(),
    sleep: (milliseconds) => new Promise((resolve) => {
      clock.setTimeout("images", resolve, milliseconds);
      pump();
    })
  };
}

// An image host on that clock. `images` maps each address to its bytes; an address not in it is a missing image.
// `limiters` are the throttle and ban of the synthetic RSI. With `corsHidden`, as RSI's image hosts are, an error answer
// carries no cross-site header, so fetch rejects with a TypeError and the page sees no status.
export function imageHost({ time, images, limiters = [], corsHidden = true, latencyMs = 40 }) {
  const requests = [];
  const fetcher = async (url, options = {}) => {
    const record = { url, at: time.nowMs(), cache: options.cache ?? null, credentialsOmitted: options.credentials === "omit" };
    requests.push(record);
    await time.sleep(latencyMs);
    const refusal = limiters.map((limiter) => limiter.answer(record)).find(Boolean) ?? null;
    const bytes = images.get(url) ?? null;
    const status = refusal ? refusal.status : bytes ? 200 : 404;
    record.status = status;
    if (status !== 200 && corsHidden) throw new TypeError("Failed to fetch");
    return { status, url, headers: { get: (name) => name.toLowerCase() === "content-type" && status === 200 ? "image/png" : null }, arrayBuffer: async () => (bytes ?? new Uint8Array(0)).buffer.slice(0) };
  };
  return { fetcher, requests };
}
