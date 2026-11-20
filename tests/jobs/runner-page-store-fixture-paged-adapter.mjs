import { outcome, plain } from "./runner-page-store-loaded-with-fixture-authorization.mjs";

// A pledges adapter that keeps the contract of the shipped one: a step that does not end the section hands over its
// own rows as page text and the merged state; the last step normalizes everything. `script` says what each call does:
// a number is how many rows the step fetches, and an object overrides the step's result.
export function pagedAdapter(script, log) {
  const merge = (state, page) => ({ raw: page.snapshot ? page.raw : [...(state?.raw ?? []), ...page.raw], sourceUrls: [...new Set([...(state?.sourceUrls ?? []), ...page.sourceUrls])], anomalies: [] });
  let call = 0;
  return {
    section: "pledges",
    version: "1",
    parserVersion: "1",
    collectStep: async (input) => {
      const step = script[call];
      call += 1;
      log.push({ kind: "step", call, cursor: plain(input.cursor), sectionState: plain(input.sectionState), previousSection: plain(input.previousSection) });
      if (step && typeof step === "object" && step.fail) return { ok: false, code: "RSI_READ_FAILED", message: "The page could not be read." };
      if (step && typeof step === "object" && step.reuse !== undefined) {
        return {
          ok: true, accountId: "account-1", done: true, recordCount: Math.max(0, step.reuse - (input.sectionState?.raw?.length ?? 0)), cumulativeRecordCount: step.reuse,
          resultMode: "reuse", reusedPrevious: true, parserResults: [], changeState: "unchanged", cursor: null
        };
      }
      const rows = typeof step === "number" ? step : step.rows;
      const gathered = input.sectionState?.raw?.length ?? 0;
      const raw = Array.from({ length: rows }, (_, index) => ({ recordKey: `row-${gathered + index + 1}` }));
      const sourceUrls = [`https://robertsspaceindustries.com/account/pledges?page=${call}`];
      const done = call === script.length;
      if (done) {
        const all = [...(input.sectionState?.raw ?? []), ...raw];
        log.push({ kind: "normalize", rows: all.length });
        return {
          ok: true, accountId: "account-1", done: true, recordCount: rows, cumulativeRecordCount: all.length, resultMode: "cumulative",
          parserResults: [{ section: "pledges", value: all, outcome: outcome("complete", all.length, call) }], cursor: null
        };
      }
      const checkpoint = typeof step === "object" && step.checkpoint === true;
      const text = JSON.stringify(checkpoint
        ? { raw: [...(input.sectionState?.raw ?? []), ...raw], snapshot: true, sourceUrls: [...(input.sectionState?.sourceUrls ?? []), ...sourceUrls], anomalies: [] }
        : { raw, snapshot: false, sourceUrls, anomalies: [] });
      return {
        ok: true,
        accountId: "account-1",
        done: false,
        recordCount: rows,
        cumulativeRecordCount: gathered + rows,
        resultMode: "deferred",
        parserResults: [],
        cursor: { page: call + 1, lastStep: { pagesOrBatches: call, warnings: [], observedAt: "2026-11-17T12:00:00.000Z" } },
        page: { checkpoint, text },
        sectionState: merge(input.sectionState, JSON.parse(text))
      };
    },
    rebuildState: ({ pages }) => {
      log.push({ kind: "rebuild", pages: pages.length });
      return pages.reduce(merge, null);
    },
    partialResults: async ({ sectionState, cursor }) => {
      log.push({ kind: "partial", rows: sectionState.raw.length });
      return [{ section: "pledges", value: sectionState.raw, outcome: outcome("partial", sectionState.raw.length, cursor.lastStep.pagesOrBatches) }];
    }
  };
}
