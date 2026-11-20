import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const help = `Usage: node verify-negative-fixture.mjs --report <readability.json>

Verifies the deliberate negative fixture's classifications and exact ratios.
Writes fixture-verification.json alongside the explicit report. Exit 0 means the
fixture behaved as expected; its four intentional contrast failures are required.
`;
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(help); process.exit(0); }
let reportPath;
try {
  const options = parseArgs({ options: { report: { type: 'string' } }, strict: true }).values;
  if (!options.report) throw new Error('--report is required');
  reportPath = path.resolve(options.report);
} catch (error) { console.error(`Fixture verification: ${error.message}\n${help}`); process.exit(2); }
const folder = path.dirname(reportPath);
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.states.length, 1, 'the fixture uses one generic entry state');
assert.equal(report.states[0].name, 'entry');
assert.deepEqual(report.states[0].counts, { passed: 4, failed: 4, manual: 7 });
assert.equal(report.notRun.length, 0);
assert.equal(report.coverageFailures.length, 0);
const samples = report.states[0].results;
assert.equal(samples.length, 15);
const byId = id => samples.find(sample => sample.selector === '#' + id);
for (const id of ['black-white', 'large-gray', 'bold-gray', 'layer']) assert.equal(byId(id)?.status, 'passed', id);
for (const id of ['low', 'normal-gray', 'alpha', 'placeholder']) assert.equal(byId(id)?.status, 'failed', id);
for (const id of ['gradient', 'opacity', 'pseudo', 'svg-overlay', 'image-overlay', 'opaque-child', 'inset']) assert.equal(byId(id)?.status, 'manual', id);
assert.equal(byId('black-white').ratio, 21);
assert.equal(byId('normal-gray').ratio, byId('large-gray').ratio);
assert.equal(byId('normal-gray').required, 4.5);
assert.equal(byId('large-gray').required, 3);
assert.ok(Math.abs(byId('alpha').ratio - 3.976653024912438) < 1e-10);
assert.ok(Math.abs(byId('layer').ratio - 5.280822809644651) < 1e-10);
assert.equal(report.states[0].skipped['inactive control'], 1);
assert.equal(report.exceptions.length, 0);
assert.equal(report.blockedRemoteRequests.length, 0);
assert.equal(report.runtimeError, null);
const receipt = {
  status: 'passed', classifications: 15, exactRatioChecks: 4, sizeThresholdPair: 'Same gray fails normal text but passes large text', expectedMeasuredFailures: 4,
  expectedManualCases: 7, expectedMeasuredPasses: 4, expectedInactiveExclusions: 1,
  note: 'These intentional failures should make the checker exit 1. This verifier checks the saved report, not the checker process exit status.'
};
await writeFile(path.join(folder, 'fixture-verification.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log('PASS browser negative fixture: 4 intentional contrast failures, 4 known passes, 7 manual cases, alpha math, placeholder, inactive exclusion, and zero runtime/network errors');
