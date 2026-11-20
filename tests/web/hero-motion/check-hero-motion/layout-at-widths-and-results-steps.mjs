import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkGeometry } from "./hero-geometry-and-motion-readings.mjs";
import { browserFolder, sourceEntry } from "./options-and-evidence-folders.mjs";
import { assert, evaluate, evidence, exceptions, geometry, remote, screenshot, viewport } from "./page-evaluation-evidence-and-screenshots.mjs";

for (const scale of [1, 2]) {
  if (scale === 2) await evaluate(`(() => { const nodes = [...document.querySelectorAll('#overview h1, #overview h2, #overview p, #overview dt, #overview dd, #overview span')].filter(node => !node.classList.contains('identity-hero-art')); `
    + `window.__motionFonts = nodes.map(node => ({ node, style: node.getAttribute('style'), size: parseFloat(getComputedStyle(node).fontSize) })); for (const item of window.__motionFonts) item.node.style.fontSize = item.size * 2 + 'px'; })()`);
  for (const width of [320, 360, 768, 1440]) {
    await viewport(width, width === 360 ? 844 : 1000);
    await evaluate("document.querySelector('#overview').scrollIntoView({ block: 'start', behavior: 'instant' })");
    await checkGeometry(`${scale * 100}% text at ${width}px`);
    await screenshot(`hero-motion-layout-${scale * 100}percent-${width}.png`);
  }
}
await evaluate("for (const item of window.__motionFonts) { if (item.style === null) item.node.removeAttribute('style'); else item.node.setAttribute('style', item.style); } delete window.__motionFonts");
await viewport(1440);
await evaluate("document.querySelector('#identityHeroArt').dataset.heroArt = 'radar'; document.querySelector('#overview').scrollIntoView({ block: 'center', behavior: 'instant' })");

assert(!exceptions.length && !remote.length, 'Page exceptions or blocked remote request attempts occurred');
await writeFile(path.join(browserFolder, 'results.json'), JSON.stringify({ source: sourceEntry, checkedAt: new Date().toISOString(), ...evidence, geometry, exceptions, remote }, null, 2) + '\n');
console.log(`PASS hero motion candidate: no controls; four artworks; 60s clockwise rotation; 5s pulse; moving embers behind text; offscreen, visibility, lifecycle, resize and duplicate-loop checks; ${geometry.length} responsive/200% cases; zero remote `
  + `requests`);
