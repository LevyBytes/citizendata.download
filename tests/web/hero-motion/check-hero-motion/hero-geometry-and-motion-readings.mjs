import { pause } from "./chrome-process-and-devtools-commands.mjs";
import { assert, evaluate, geometry } from "./page-evaluation-evidence-and-screenshots.mjs";

export async function checkGeometry(label) {
  const result = await evaluate(`(() => {
    const hero = document.querySelector('#overview');
    const rect = hero.getBoundingClientRect();
    const failures = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('page horizontal overflow');
    for (const node of hero.querySelectorAll('button, h1, h2, p, dl, dt, dd')) {
      if (!node.getClientRects().length) continue;
      const box = node.getBoundingClientRect();
      if (box.left < rect.left - 1 || box.right > rect.right + 1 || node.scrollWidth > node.clientWidth + 1) failures.push('content overflow: ' + (node.id || node.tagName));
    }
    const canvas = hero.querySelector('.hero-embers'), canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.left < rect.left - 1 || canvasRect.right > rect.right + 1 || canvasRect.top < rect.top - 1 || canvasRect.bottom > rect.bottom + 1) failures.push('ember canvas exceeds hero');
    return { width: innerWidth, height: innerHeight, hero: rect.toJSON(), failures: [...new Set(failures)] };
  })()`);
  geometry.push({ label, ...result });
  assert(!result.failures.length, `${label}: ${result.failures.join('; ')}`);
}
export async function motionSnapshot() {
  return evaluate(`(() => {
    const hero = document.querySelector('#overview'), art = document.querySelector('#identityHeroArt'), canvas = document.querySelector('.hero-embers');
    const heroRect = hero.getBoundingClientRect(), artRect = art.getBoundingClientRect();
    const inline = art.style.transform, match = inline.match(/rotate\\(([^)]+)deg\\) scale\\(([^)]+)\\)/);
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0; for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) painted++;
    return { time: performance.now(), state: hero.dataset.motionState, art: art.dataset.heroArt, transform: inline, angle: match ? Number(match[1]) : null, scale: match ? Number(match[2]) : null,
      center: { x: (artRect.left + artRect.right) / 2 - heroRect.left, y: (artRect.top + artRect.bottom) / 2 - heroRect.top }, heroWidth: heroRect.width, painted, particles: window.__heroParticles || [], canvasData: canvas.toDataURL(),
      frameCalls: window.__heroFrameEvents.length, z: { canvas: getComputedStyle(canvas).zIndex, content: getComputedStyle(hero.querySelector('.identity-main')).zIndex }, canvasPointer: getComputedStyle(canvas).pointerEvents,
      canvasAria: canvas.getAttribute('aria-hidden') };
  })()`);
}
export function withoutPixels(snapshot) { const { canvasData, ...rest } = snapshot; return rest; }
export async function assertStill(label) {
  const first = await motionSnapshot(); await pause(350); const second = await motionSnapshot();
  assert(first.state === 'paused' && second.state === 'paused' && first.transform === second.transform && first.canvasData === second.canvasData && first.frameCalls === second.frameCalls, `${label}: motion continued`);
  return withoutPixels(second);
}
