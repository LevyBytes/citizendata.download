import { QUIET_MS, pause } from "./polling-intervals.mjs";

// A scenario that acts in the middle of a build holds the stand-in's answer at a request it chooses, acts, and lets
// go. The build stands still at a known place meanwhile, so nothing is timed. With `answer` ({ status, contentType,
// body, retryAfterSeconds }) the held request is answered so when it is let go, in the account's place.
export let gate = null;

export function holdRsiWhen(matches, answer = null) {
  let arrive;
  let open;
  const held = {
    matches,
    answer,
    arrive: () => arrive(),
    reached: new Promise((resolve) => { arrive = resolve; }),
    released: new Promise((resolve) => { open = resolve; }),
    release: () => { if (gate === held) gate = null; open(); }
  };
  gate = held;
  return held;
}
export const afterRequests = (account, count) => () => account.requests.length >= count;

// A limit RSI holds for a while: from the first request that matches, each matching request for `forMs` is answered
// `status` with Retry-After, and never reaches the synthetic account. `reached` settles at the first refusal.
export let refusal = null;

export function refuseRsiWhen(matches, { status = 429, retryAfterSeconds, forMs }) {
  let arrive;
  const limit = {
    status,
    retryAfterSeconds,
    refusedAt: [],
    until: null,
    reached: new Promise((resolve) => { arrive = resolve; }),
    refuses(request) {
      if (!matches(request)) return false;
      const now = Date.now();
      if (limit.until === null) limit.until = now + forMs;
      if (now >= limit.until) return false;
      limit.refusedAt.push(now);
      arrive();
      return true;
    },
    lift: () => { if (refusal === limit) refusal = null; }
  };
  refusal = limit;
  return limit;
}
// A hold that is never reached fails with its reason instead of hanging.
export async function reach(held, description, timeoutMs = 30000) {
  let timer;
  const late = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}.`)), timeoutMs); });
  try { await Promise.race([held.reached, late]); } finally { clearTimeout(timer); }
}

// Waits until the account has been asked nothing for QUIET_MS, and returns how many requests it has had.
export async function settled(account, complaint, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const count = account.requests.length;
    await pause(QUIET_MS);
    if (account.requests.length === count) return count;
    if (Date.now() > deadline) throw new Error(complaint);
  }
}
