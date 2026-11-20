import { QUIET_MS, pause } from "./polling-intervals.mjs";

// A scenario that acts in the middle of a build holds the stand-in's answer at a request it chooses, acts, and lets
// go. The build stands still at a known place meanwhile, so nothing is timed.
export let gate = null;

export function holdRsiWhen(matches) {
  let arrive;
  let open;
  const held = {
    matches,
    arrive: () => arrive(),
    reached: new Promise((resolve) => { arrive = resolve; }),
    released: new Promise((resolve) => { open = resolve; }),
    release: () => { if (gate === held) gate = null; open(); }
  };
  gate = held;
  return held;
}
export const afterRequests = (account, count) => () => account.requests.length >= count;
// A hold that is never reached fails with its reason instead of hanging.
export async function reach(held, description, timeoutMs = 30000) {
  let timer;
  const late = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}.`)), timeoutMs); });
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
