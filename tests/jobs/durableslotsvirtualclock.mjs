// The one clock the durable request slot tests run the runner, live runtime and RSI adapter on.

// One clock for the runner and the adapter. A timer fires once nothing else is left to run, and moves the clock to its
// time; a wait in memory therefore takes exactly as long as it says.
export function testClock(startMs) {
  const clock = { now: startMs, timers: [] };
  let order = 0;
  let pumping = false;
  const pump = () => {
    if (pumping || clock.timers.length === 0) return;
    pumping = true;
    setImmediate(() => {
      pumping = false;
      clock.timers.sort((left, right) => left.due - right.due || left.order - right.order);
      const timer = clock.timers.shift();
      if (!timer) return;
      clock.now = Math.max(clock.now, timer.due);
      timer.fn();
      pump();
    });
  };
  class ClockDate extends Date {
    constructor(...values) {
      super(...(values.length > 0 ? values : [clock.now]));
    }

    static now() {
      return clock.now;
    }
  }
  clock.globals = {
    Date: ClockDate,
    setTimeout: (fn, ms = 0) => {
      const timer = { due: clock.now + Math.max(0, Number(ms) || 0), fn, order: order++ };
      clock.timers.push(timer);
      pump();
      return timer;
    },
    clearTimeout: (timer) => {
      const index = clock.timers.indexOf(timer);
      if (index >= 0) clock.timers.splice(index, 1);
    }
  };
  return clock;
}
