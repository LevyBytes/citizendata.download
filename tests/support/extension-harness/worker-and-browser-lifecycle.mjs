import { copy } from "./message-copies-between-realms.mjs";
import { STATE_KEY } from "./extension-files-and-identifiers.mjs";
import { startWorker } from "./service-worker-instance.mjs";

export function addWorkerLifecycle(world, settle) {
  const { clock, harness } = world;

  harness.settle = settle;
  harness.state = () => copy(harness.local.get(STATE_KEY) ?? null);
  harness.workerRunning = () => world.worker !== null;
  // Chrome ends the worker: its timers are gone and nothing it awaited will ever continue.
  harness.stopWorker = () => {
    if (!world.worker) return;
    world.worker.alive = false;
    clock.dropOwner(world.worker);
    world.worker = null;
  };
  // The browser was closed and opened again.
  harness.restartBrowser = async () => {
    harness.stopWorker();
    harness.session.clear();
    for (const listener of startWorker(world).listeners.startup) listener();
    await settle();
  };
}
