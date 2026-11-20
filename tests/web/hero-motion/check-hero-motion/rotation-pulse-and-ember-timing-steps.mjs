import { pause } from "./chrome-process-and-devtools-commands.mjs";
import { motionSnapshot, withoutPixels } from "./hero-geometry-and-motion-readings.mjs";
import { assert, evaluate, evidence, screenshot, waitFor } from "./page-evaluation-evidence-and-screenshots.mjs";

assert(await evaluate("!document.querySelector('.motion-review, #motionArtwork, #motionToggle, #motionBaseline, #motionEmbers')"), 'Preview motion controls remain in production candidate');
await waitFor("document.querySelector('#overview').dataset.motionState === 'running'");
await pause(600);
await screenshot('hero-motion-first-1440.png');
console.log('Captured first visual: hero-motion-first-1440.png');
const samples = [];
for (let index = 0; index < 23; index++) { samples.push(await motionSnapshot()); await pause(250); }
const first = samples[0], last = samples.at(-1);
const speed = ((last.angle - first.angle + 360) % 360) / ((last.time - first.time) / 1000);
assert(speed > 5.4 && speed < 6.5, `Rotation speed is ${speed} degrees/second, expected 6`);
assert(samples.every(item => {
  const expected = 1 + .075 * (.5 - .5 * Math.cos(Math.PI * 2 * (item.angle / 6) / 5));
  return Math.abs(item.scale - expected) < .00001;
}), 'Five-second pulse does not match rotation clock');
assert(Math.max(...samples.map(item => item.scale)) > 1.073 && Math.min(...samples.map(item => item.scale)) < 1.002, 'Pulse did not cover its 1–1.075 range');
assert(first.painted > 0 && first.canvasData !== last.canvasData, 'Ember canvas is blank or static');
assert(Number(first.z.canvas) < Number(first.z.content) && first.canvasPointer === 'none' && first.canvasAria === 'true', 'Ember layer is not decorative behind text');
const particlesA = samples[0].particles, particlesB = samples[1].particles;
const rightward = particlesA.filter((point, index) => particlesB[index].x > point.x).length;
assert(rightward / particlesA.length > .85, 'Ember field is not predominantly moving left to right');
evidence.timing = { speedDegreesPerSecond: speed, nominalRotationSeconds: 60, nominalPulseSeconds: 5, rightwardParticles: rightward, particleCount: particlesA.length, samples: samples.map(withoutPixels) };
