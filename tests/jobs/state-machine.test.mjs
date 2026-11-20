import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadClassicScript } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { api: Machine } = await loadClassicScript(path.join(root, "extension", "jobs", "state-machine.js"), "CitizenDataStateMachine");

test("job lifecycle allows explicit authorization and pause", () => {
  const draft = Machine.createDraft({ selectedSections: ["profile"] }, "2026-11-17T00:00:00.000Z");
  const awaiting = Machine.transition(draft, Machine.STATES.AWAITING_AUTHORIZATION, "2026-11-17T00:00:01.000Z");
  const running = Machine.transition(awaiting.value, Machine.STATES.RUNNING, "2026-11-17T00:00:02.000Z");
  const paused = Machine.transition(running.value, Machine.STATES.PAUSED, "2026-11-17T00:00:03.000Z");
  assert.equal(paused.ok, true);
  assert.equal(paused.value.status, "paused");
});

test("terminal and out-of-order transitions are rejected", () => {
  const draft = Machine.createDraft({});
  assert.equal(Machine.transition(draft, Machine.STATES.RUNNING).code, "INVALID_TRANSITION");
  const cancelled = Machine.transition(draft, Machine.STATES.CANCELLED).value;
  assert.equal(Machine.transition(cancelled, Machine.STATES.RUNNING).code, "INVALID_TRANSITION");
});
