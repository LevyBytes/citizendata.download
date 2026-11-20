import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadClassicScript } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { api: Plans } = await loadClassicScript(path.join(root, "extension", "jobs", "plan-validation.js"), "CitizenDataPlanValidation");

function validate(value) {
  return Plans.validatePlan(JSON.parse(JSON.stringify(value)));
}

const validPlan = {
  selectedSections: ["profile", "referrals.current.prospects"],
  maximumRecordsBySection: { profile: 1, "referrals.current.prospects": 5000 },
  minimumInterRequestDelayMs: 5000
};

test("bounded known plan is accepted", () => {
  const result = validate(validPlan);
  assert.equal(result.ok, true);
  assert.deepEqual([...result.value.selectedSections], validPlan.selectedSections);
});

test("selected organization rosters are accepted only as a separate slow bounded plan", () => {
  const section = Plans.organizationRosterSection("TEST");
  const second = Plans.organizationRosterSection("MMHC");
  const result = validate({
    selectedSections: [section, second],
    maximumRecordsBySection: { [section]: 24652, [second]: 117 },
    minimumInterRequestDelayMs: 10000
  });
  assert.equal(result.ok, true);
  assert.equal(Plans.organizationRosterSid(section), "TEST");
  assert.deepEqual([...result.value.selectedSections], [section, second]);
});

test("organization roster SID, isolation, pace, and cap fail closed", () => {
  assert.throws(() => Plans.organizationRosterSection("../TEST"), /Organization SID/u);
  assert.equal(validate({
    selectedSections: ["organizations.members.test"],
    maximumRecordsBySection: { "organizations.members.test": 100 },
    minimumInterRequestDelayMs: 10000
  }).code, "UNKNOWN_SECTION");
  assert.equal(validate({
    selectedSections: ["profile", "organizations.members.TEST"],
    maximumRecordsBySection: { profile: 1, "organizations.members.TEST": 100 },
    minimumInterRequestDelayMs: 10000
  }).code, "ROSTER_PLAN_NOT_SEPARATE");
  assert.equal(validate({
    selectedSections: ["organizations.members.TEST"],
    maximumRecordsBySection: { "organizations.members.TEST": 100 },
    minimumInterRequestDelayMs: 5000
  }).code, "ROSTER_PACING_TOO_FAST");
  assert.equal(validate({
    selectedSections: ["organizations.members.TEST"],
    maximumRecordsBySection: { "organizations.members.TEST": 50001 },
    minimumInterRequestDelayMs: 10000
  }).code, "ROSTER_CAP_EXCEEDED");
});

test("caller request authority and faster pacing are rejected", () => {
  assert.equal(validate({ ...validPlan, url: "https://example.invalid" }).code, "UNEXPECTED_PLAN_FIELD");
  assert.equal(validate({ ...validPlan, minimumInterRequestDelayMs: 100 }).code, "INVALID_PACING");
});

test("caps must exactly match selected sections", () => {
  const result = validate({ ...validPlan, maximumRecordsBySection: { profile: 1 } });
  assert.equal(result.code, "CAP_SCOPE_MISMATCH");
});

test("duplicate sections and excessive caps are rejected", () => {
  assert.equal(validate({
    selectedSections: ["profile", "profile"],
    maximumRecordsBySection: { profile: 1 },
    minimumInterRequestDelayMs: 5000
  }).code, "DUPLICATE_SECTION");
  assert.equal(validate({
    selectedSections: ["profile"],
    maximumRecordsBySection: { profile: 100001 },
    minimumInterRequestDelayMs: 5000
  }).code, "INVALID_CAP");
});
