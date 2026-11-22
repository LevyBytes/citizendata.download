// The request slots of a step that stops between its phases, profile and CCU, for the durable request slot tests.

// The adapter alone, its step's pending phases handed back as the runner stores them, the clock moved to each slot.
export async function slots(fixture, clock, descriptor, input, { restart = null } = {}) {
  const phases = [];
  let journal = [];
  let api = fixture.api;
  for (let index = 0; index < 10; index += 1) {
    const result = await api.collectStep(descriptor, { ...input, requestSlots: { journal } });
    if (!result.pendingPhase) return { result, phases };
    phases.push(result.pendingPhase.phase);
    journal = JSON.parse(JSON.stringify(result.pendingPhase.journal));
    clock.now = Math.max(clock.now, result.pendingPhase.nextRequestAtMs);
    if (restart) api = restart(phases.length).api;
  }
  throw new Error("The step never finished.");
}
