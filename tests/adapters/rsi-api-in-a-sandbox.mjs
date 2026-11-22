import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { answerOf } from "./rsiapistandinanswers.mjs";

export const source = await readFile(new URL("../../extension/adapters/rsi-api.js", import.meta.url), "utf8");
const pacingSettingsSource = await readFile(new URL("../../extension/shared/request-pacing-settings.js", import.meta.url), "utf8");
const answerClassificationSource = await readFile(new URL("../../extension/adapters/rsi-answer-classification.js", import.meta.url), "utf8");
const updateDeltaSource = await readFile(new URL("../../extension/adapters/update-delta.js", import.meta.url), "utf8");

export function harness(responses, parsedByType = {}, harnessOptions = {}) {
  const calls = [];
  const messages = [];
  let inFlight = 0;
  // With `answerWhenInFlight`, no request is answered before that many are on their way at once, so a test of
  // concurrent requests does not depend on how long an answer takes.
  let together;
  const requestsTogether = new Promise((resolve) => { together = resolve; });
  let maximumInFlight = 0;
  // The streamed bodies of answers given as {stream: {chunkBytes, chunks}}: how much was read and whether it was cancelled.
  const streams = [];
  const context = {
    AbortController,
    TextEncoder,
    URL,
    Uint8Array,
    crypto: globalThis.crypto,
    clearTimeout,
    console,
    setTimeout,
    // A test's own clock and timers: `Date`, `setTimeout` and `clearTimeout`.
    ...(harnessOptions.globals ?? {}),
    chrome: {
      cookies: {
        async get(input) {
          calls.push({ kind: "cookie", input });
          return harnessOptions.signedOut === true ? null : { value: "transient-test-token" };
        }
      },
      offscreen: {
        async hasDocument() { return true; },
        async createDocument() { throw new Error("unexpected offscreen creation"); }
      },
      runtime: {
        async sendMessage(message) {
          messages.push(message);
          if (Object.hasOwn(parsedByType, message.fragmentType)) {
            const parsed = typeof parsedByType[message.fragmentType] === "function" ? parsedByType[message.fragmentType](message) : parsedByType[message.fragmentType];
            // The offscreen parser recognizes the page asked for (§5.3), unless the test says otherwise.
            return { ok: true, pageRecognized: true, pageTitle: null, ...parsed };
          }
          return { ok: true, raw: [{ rawTimestamp: "now", subjectId: 42, subjectName: "Example", kind: "created", rawDetail: "Created", parsed: { recognized: false } }] };
        }
      }
    },
    async fetch(url, options) {
      calls.push({ kind: "fetch", url, options });
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      if (inFlight >= (harnessOptions.answerWhenInFlight ?? 1)) together();
      await requestsTogether;
      try {
        return answerOf(responses.shift(), url, streams);
      } finally {
        inFlight -= 1;
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(pacingSettingsSource, context, { filename: "request-pacing-settings.js" });
  vm.runInNewContext(answerClassificationSource, context, { filename: "rsi-answer-classification.js" });
  vm.runInNewContext(updateDeltaSource, context, { filename: "update-delta.js" });
  vm.runInNewContext(source, context, { filename: "rsi-api.js" });
  return { api: context.CitizenDataRsiApi, calls, messages, streams, context, maximumInFlight: () => maximumInFlight };
}
