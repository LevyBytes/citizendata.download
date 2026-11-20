import { copy } from "./message-copies-between-realms.mjs";

export function deliveryAndTime(world) {
  const { clock, harness } = world;

  // Sends one message to the worker and returns its answer. Extension time passes while the answer is awaited, as it
  // does for a real sender; an answer that needs no timer arrives without any time passing.
  function deliver(message, sender) {
    return during(post(message, sender));
  }

  function post(message, sender) {
    const instance = world.ensureWorker();
    return new Promise((resolve) => {
      let answered = false;
      let waiting = false;
      const sendResponse = (response) => {
        answered = true;
        resolve(copy(response));
      };
      for (const listener of instance.listeners.message) waiting = listener(instance.local(message), instance.local(sender), sendResponse) === true || waiting;
      if (!waiting && !answered) resolve(undefined);
    });
  }

  async function settle() {
    do {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } while (world.pendingRealWork > 0);
  }

  // Lets the extension run, firing timers and alarms in order, until `until` holds.
  harness.advance = async (until, { limitMs = 6 * 3600000 } = {}) => {
    const deadline = clock.now + limitMs;
    for (;;) {
      await settle();
      if (await until()) return;
      const timer = clock.next();
      if (!timer) throw new Error("The extension went idle before the awaited condition held.");
      if (timer.due > deadline) throw new Error(`The awaited condition did not hold within ${limitMs} ms of extension time.`);
      clock.fire(timer);
    }
  };

  // Lets exactly this much extension time pass.
  harness.advanceBy = async (milliseconds) => {
    const target = clock.now + milliseconds;
    for (;;) {
      await settle();
      const timer = clock.next();
      if (!timer || timer.due > target) break;
      clock.fire(timer);
    }
    clock.set(target);
    await settle();
  };

  async function during(promise) {
    let outcome = null;
    promise.then((value) => { outcome = { value }; }, (error) => { outcome = { error }; });
    await harness.advance(() => outcome !== null);
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }

  return { deliver, settle };
}
