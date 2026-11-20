import { copy } from "./message-copies-between-realms.mjs";

export function storageArea(store, guard) {
  const read = (keys) => {
    const names = keys === null || keys === undefined ? [...store.keys()] : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const output = Array.isArray(keys) || typeof keys === "string" || keys === null || keys === undefined ? {} : copy(keys);
    for (const name of names) if (store.has(name)) output[name] = copy(store.get(name));
    return output;
  };
  return {
    get: guard(async (keys) => read(keys)),
    set: guard(async (values) => { for (const [name, value] of Object.entries(values)) store.set(name, copy(value)); }),
    remove: guard(async (keys) => { for (const name of Array.isArray(keys) ? keys : [keys]) store.delete(name); }),
    setAccessLevel: guard(async () => {})
  };
}

export function alarmSchedule(world) {
  const { clock, harness } = world;

  function scheduleAlarm(alarm) {
    alarm.timer = clock.setTimeout("alarms", () => {
      const fired = { name: alarm.name, scheduledTime: alarm.scheduledTime, ...(alarm.periodInMinutes ? { periodInMinutes: alarm.periodInMinutes } : {}) };
      if (alarm.periodInMinutes) {
        alarm.scheduledTime += alarm.periodInMinutes * 60000;
        scheduleAlarm(alarm);
      } else {
        harness.alarms.delete(alarm.name);
      }
      // An alarm starts the worker when Chrome had stopped it.
      const instance = world.ensureWorker();
      for (const listener of instance.listeners.alarm) listener(instance.local(fired));
    }, alarm.scheduledTime - clock.now);
  }

  function clearAlarm(name) {
    const alarm = harness.alarms.get(name);
    if (!alarm) return false;
    clock.clearTimeout(alarm.timer);
    harness.alarms.delete(name);
    return true;
  }

  return { scheduleAlarm, clearAlarm };
}
