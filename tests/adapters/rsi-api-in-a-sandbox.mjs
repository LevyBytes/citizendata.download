import { readFile } from "node:fs/promises";
import vm from "node:vm";

export const source = await readFile(new URL("../../extension/adapters/rsi-api.js", import.meta.url), "utf8");
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
  const context = {
    AbortController,
    URL,
    clearTimeout,
    console,
    setTimeout,
    chrome: {
      cookies: {
        async get(input) {
          calls.push({ kind: "cookie", input });
          return { value: "transient-test-token" };
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
            return { ok: true, ...parsed };
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
      const response = responses.shift();
      const isHtml = response?.kind === "html";
      const isHttpError = response?.kind === "http-error";
      const body = isHtml || isHttpError ? response.body : response;
      const status = isHttpError ? response.status : 200;
      const result = {
        ok: status >= 200 && status < 300,
        status,
        url: isHtml ? (response.finalUrl ?? url) : url,
        headers: { get(name) { return name.toLowerCase() === "content-type" ? (isHtml ? "text/html; charset=UTF-8" : "application/json") : null; } },
        async json() { return body; },
        async text() { return String(body); }
      };
      inFlight -= 1;
      return result;
    }
  };
  context.globalThis = context;
  vm.runInNewContext(updateDeltaSource, context, { filename: "update-delta.js" });
  vm.runInNewContext(source, context, { filename: "rsi-api.js" });
  return { api: context.CitizenDataRsiApi, calls, messages, maximumInFlight: () => maximumInFlight };
}
