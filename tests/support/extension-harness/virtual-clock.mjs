export function createClock(start) {
  let now = start;
  let sequence = 0;
  const timers = new Map();
  return {
    get now() { return now; },
    setTimeout(owner, callback, delay) {
      const id = ++sequence;
      timers.set(id, { id, owner, callback, due: now + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    dropOwner(owner) {
      for (const timer of [...timers.values()]) if (timer.owner === owner) timers.delete(timer.id);
    },
    next() {
      let earliest = null;
      for (const timer of timers.values()) if (!earliest || timer.due < earliest.due || timer.due === earliest.due && timer.id < earliest.id) earliest = timer;
      return earliest;
    },
    fire(timer) {
      timers.delete(timer.id);
      now = Math.max(now, timer.due);
      timer.callback();
    },
    set(value) { now = Math.max(now, value); }
  };
}

// Date as the extension sees it: the current time is the virtual clock's.
export function virtualDateClass(clock) {
  class VirtualDate extends Date {
    constructor(...values) {
      super(...(values.length === 0 ? [clock.now] : values));
    }

    static now() { return clock.now; }
  }
  return VirtualDate;
}

// The answer a limiter gives when it refuses a request: 429 with a Retry-After of 60 seconds, unless one is given.
const REFUSAL = Object.freeze({ status: 429, contentType: "text/html", body: "Too Many Requests", headers: Object.freeze({ "retry-after": "60" }) });

// Whether a limiter keyed on `key` counts a request: "connection" counts every request to RSI, "account" only those
// that carry the account's cookies. The status host is never limited.
function counted(record, key) {
  if (record.origin && record.origin !== "https://robertsspaceindustries.com") return false;
  return key === "account" ? record.credentialsOmitted !== true : true;
}

// A limiter on the clock that refuses the requests over `limit` in any window of `windowMs`.
export function throttle({ limit, windowMs, answer = REFUSAL, key = "connection" }, now) {
  const seen = [];
  return {
    answer(record) {
      if (!counted(record, key)) return null;
      const at = now();
      while (seen.length > 0 && seen[0] <= at - windowMs) seen.shift();
      seen.push(at);
      return seen.length > limit ? { ...answer, headers: { ...answer.headers } } : null;
    }
  };
}

// A limiter on the clock that, once more than `trigger.limit` requests come in a window of `trigger.windowMs`,
// refuses every request for `durationMs`.
export function ban({ trigger, durationMs, answer = REFUSAL, key = "connection" }, now) {
  const seen = [];
  let bannedUntil = -Infinity;
  return {
    get bannedUntil() { return bannedUntil; },
    answer(record) {
      if (!counted(record, key)) return null;
      const at = now();
      if (at < bannedUntil) return { ...answer, headers: { ...answer.headers } };
      while (seen.length > 0 && seen[0] <= at - trigger.windowMs) seen.shift();
      seen.push(at);
      if (seen.length > trigger.limit) {
        bannedUntil = at + durationMs;
        seen.length = 0;
        return { ...answer, headers: { ...answer.headers } };
      }
      return null;
    }
  };
}
