import { command, pause } from "./chrome-process-and-devtools-commands.mjs";
import { motionSnapshot, withoutPixels } from "./hero-geometry-and-motion-readings.mjs";
import { assert, evaluate, evidence, screenshot } from "./page-evaluation-evidence-and-screenshots.mjs";

evidence.artworks = [];
for (const art of ['radar', 'holo-render', 'staff-pick', 'customize']) {
  await evaluate(`document.querySelector('#identityHeroArt').dataset.heroArt = ${JSON.stringify(art)}`);
  const a = await motionSnapshot(); await pause(300); const b = await motionSnapshot();
  assert(a.art === art && b.angle > a.angle, `${art}: artwork did not switch or rotate clockwise`);
  assert(Math.abs(b.center.x - (b.heroWidth - 29)) < 1 && Math.abs(b.center.y - 29) < 1, `${art}: artwork center moved from the original inset`);
  evidence.artworks.push(withoutPixels(b));
  await screenshot(`hero-motion-${art}-1440.png`);
}
// Owner explicitly selected automatic motion with no user-facing controls or media-query gate.
await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
const mediaA = await motionSnapshot(); await pause(300); const mediaB = await motionSnapshot();
assert(mediaB.state === 'running' && mediaB.angle > mediaA.angle, 'Owner-selected always-on motion was gated by media query');
evidence.ownerSelectedAlwaysOn = true;
await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
