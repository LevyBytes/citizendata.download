// The real pure parsers and the live runtime in one realm, as in the worker, with a stand-in for the RSI
// collectors, for the malformed-row tests (PARSER_HARDENING.md §5.7).
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { root } from "./repository-root.mjs";

export const plain = (value) => JSON.parse(JSON.stringify(value));

export const SOURCE_URL = "https://robertsspaceindustries.com/en/account/pledges?page=1";

// The realm of the newest runtime, for text a restarted worker parses itself.
export let realmBuild = null;

export const liveRuntimeSource = await readFile(path.join(root, "extension", "adapters", "live-runtime.js"), "utf8");

// The live runtime over the real parsers. Each collector answer is made inside the realm by `build`: JSON data, or
// source text for the values JSON cannot carry, the way the worker receives rows from the page parser.
export async function runtime(answers) {
  const rsiApi = {
    async collectStep() {
      const answer = answers.shift();
      return { done: true, complete: true, pagesOrBatches: 1, warnings: [], requestActivities: [], requestProgress: null, sourceUrls: [SOURCE_URL], ...answer(build) };
    },
    clearTransientCaches() {}
  };
  const context = await loadClassicScripts([
    path.join(root, "extension", "shared", "account-document.js"),
    path.join(root, "extension", "adapters", "normalization.js"),
    path.join(root, "extension", "adapters", "pure-parsers.js")
  ], { crypto: globalThis.crypto, TextEncoder, Uint8Array, CitizenDataRsiApi: rsiApi });
  const build = (value) => vm.runInContext(`(${typeof value === "string" ? value : JSON.stringify(value)})`, context);
  realmBuild = build;
  vm.runInContext(liveRuntimeSource, context, { filename: "live-runtime.js" });
  return context.CitizenDataLiveRuntime.createAdapter({ id: "pledges", parser: "parsePledges", version: "0.42.1" });
}

export const pledge = (pledgeId, extra = {}) => ({ pledgeId, title: `Pledge ${pledgeId}`, items: [], ...extra });

export const rows = (raw, extra = {}) => (build) => ({ raw: build(raw), ...extra });

export const step = (adapter, maximumRecords = 100, extra = {}) => adapter.collectStep({ accountId: "Citizen", runId: "run", cursor: null, maximumRecords, ...extra });
