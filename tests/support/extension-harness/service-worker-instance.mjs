import path from "node:path";
import vm from "node:vm";
import { extensionRoot, source } from "./extension-files-and-identifiers.mjs";
import { realmCopier } from "./message-copies-between-realms.mjs";
import { chromeApi } from "./chrome-api-for-a-worker.mjs";
import { workerSandbox } from "./worker-sandbox.mjs";

// Starts the shipped service worker in a new VM context, as Chrome starts a worker that was not running.
export function startWorker(world) {
  const { harness } = world;
  const instance = { alive: true, listeners: { message: [], alarm: [], installed: [], startup: [] }, local: (value) => value };
  // A stopped worker never resumes, so anything it awaits stays pending. Results arrive as objects of the worker's realm.
  const never = () => new Promise(() => {});
  const guard = (operation) => (...values) => instance.alive
    ? Promise.resolve().then(() => operation(...values)).then((result) => instance.alive ? instance.local(result) : never())
    : never();
  const chrome = chromeApi(world, instance, guard);
  const sandbox = workerSandbox(world, instance, chrome, never);
  const context = vm.createContext(sandbox);
  instance.local = realmCopier(context);
  // Node's structuredClone would return objects of Node's realm; the worker's own would return its own.
  sandbox.structuredClone = vm.runInContext(`(function structuredClone(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return Array.from(value, (item) => structuredClone(item));
    const output = {};
    for (const key of Object.keys(value)) output[key] = structuredClone(value[key]);
    return output;
  })`, context);
  sandbox.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(source(file), context, { filename: path.join(extensionRoot, file) });
      if (file === "storage/database.js") {
        const database = sandbox.CitizenDataDatabase;
        harness.repository ??= database.createMemoryRepository();
        const guarded = Object.freeze({
          ...Object.fromEntries(Object.entries(harness.repository).map(([name, method]) => [name, guard(method)])),
          // The repository hands the stored records to `decide` inside its transaction. They reach this worker
          // as objects of its own realm, as records read from IndexedDB would.
          updateRun: guard((input) => harness.repository.updateRun({ ...input, decide: (stored) => input.decide(instance.local(stored)) }))
        });
        sandbox.CitizenDataDatabase = Object.freeze({ ...database, createIndexedDbRepository: () => guarded });
      }
    }
  };
  world.worker = instance;
  harness.workerStarts += 1;
  vm.runInContext(source("service-worker.js"), context, { filename: path.join(extensionRoot, "service-worker.js") });
  if (harness.workerStarts === 1) for (const listener of instance.listeners.installed) listener({ reason: "install" });
  return instance;
}
