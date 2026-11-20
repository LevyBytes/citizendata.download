(function initializeCitizenDataStateMachine(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataStateMachine = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataStateMachine() {
  "use strict";

  const STATES = Object.freeze({
    DRAFT: "draft",
    AWAITING_AUTHORIZATION: "awaiting-authorization",
    RUNNING: "running",
    PAUSED: "paused",
    CANCELLING: "cancelling",
    CANCELLED: "cancelled",
    FAILED: "failed",
    COMPLETE: "complete"
  });
  const TRANSITIONS = Object.freeze({
    [STATES.DRAFT]: Object.freeze([STATES.AWAITING_AUTHORIZATION, STATES.CANCELLED]),
    [STATES.AWAITING_AUTHORIZATION]: Object.freeze([STATES.RUNNING, STATES.CANCELLED]),
    [STATES.RUNNING]: Object.freeze([STATES.PAUSED, STATES.CANCELLING, STATES.FAILED, STATES.COMPLETE]),
    [STATES.PAUSED]: Object.freeze([STATES.RUNNING, STATES.CANCELLING, STATES.CANCELLED]),
    [STATES.CANCELLING]: Object.freeze([STATES.CANCELLED, STATES.FAILED]),
    [STATES.CANCELLED]: Object.freeze([]),
    [STATES.FAILED]: Object.freeze([]),
    [STATES.COMPLETE]: Object.freeze([])
  });

  function transition(state, nextState, now = new Date().toISOString()) {
    if (!state || !TRANSITIONS[state.status]) return { ok: false, code: "INVALID_STATE" };
    if (!TRANSITIONS[state.status].includes(nextState)) return { ok: false, code: "INVALID_TRANSITION" };
    return { ok: true, value: { ...state, status: nextState, updatedAt: now } };
  }

  function createDraft(plan, now = new Date().toISOString()) {
    return { status: STATES.DRAFT, createdAt: now, updatedAt: now, plan, receipts: [], warnings: [] };
  }

  return Object.freeze({ STATES, TRANSITIONS, createDraft, transition });
});
