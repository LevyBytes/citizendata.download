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
      if (values.length === 0) super(clock.now);
      else super(...values);
    }

    static now() { return clock.now; }
  }
  return VirtualDate;
}
