import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { contrastTools } from "../contrast-ratio-calculation.mjs";
import { collectVisibleText } from "../visible-text-collection.mjs";
import { command, evaluate, pause, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { coverageFailures, notRun, palette, setPalette, spacing, states } from "./evidence-lists-and-palette.mjs";
import { out, plan, source } from "./options-and-evidence-folders.mjs";
import { action, textSpacingCheck } from "./state-actions-and-text-spacing-check.mjs";

for (const viewport of plan.viewports) {
  if (!Number.isInteger(viewport.width) || !Number.isInteger(viewport.height) || viewport.width < 200 || viewport.height < 200) throw new Error('Invalid viewport');
  await command('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: pathToFileURL(source).href });
  await waitFor("document.readyState === 'complete'"); await evaluate('document.fonts.ready.then(() => true)'); await pause(100);
  if (!palette.length && plan.palette?.length) {
    const colors = await evaluate(`(() => { const style = getComputedStyle(document.documentElement); return ${JSON.stringify(plan.palette)}.map(pair => ({ ...pair, foregroundValue: pair.foreground.startsWith('--') ? `
      + `style.getPropertyValue(pair.foreground).trim() : pair.foreground, backgroundValue: pair.background.startsWith('--') ? style.getPropertyValue(pair.background).trim() : pair.background, overValue: pair.over?.startsWith('--') ? `
      + `style.getPropertyValue(pair.over).trim() : pair.over })); })()`);
    const tools = contrastTools();
    setPalette(colors.map(pair => {
      const foreground = tools.parseColor(pair.foregroundValue), base = tools.parseColor(pair.backgroundValue), over = pair.overValue ? tools.parseColor(pair.overValue) : null;
      if (!foreground || !base || (base.a < 1 && over?.a !== 1)) return { ...pair, status: 'manual', reason: 'unsupported/missing palette value or no explicit opaque backdrop', scope: 'explicit solid-only contract' };
      const background = base.a === 1 ? base : tools.composite(base, over), ratio = tools.ratio(foreground, background);
      return { ...pair, ratio, status: ratio >= (pair.minimum || 4.5) ? 'passed' : 'failed', scope: 'explicit solid-only contract; does not pass rendered complex backgrounds' };
    }));
  }
  for (const state of plan.states) {
    let missing;
    for (const step of state.actions || []) { const result = await action(step); if (result.missing) { missing = result.missing; break; } }
    if (missing) { notRun.push({ state: state.name, viewport, reason: `Missing selector: ${missing}` }); continue; }
    if (state.expectVisible !== undefined) {
      if (typeof state.expectVisible !== 'string' || !state.expectVisible.trim()) throw new Error('expectVisible must be a nonempty selector');
      try {
        await waitFor(`(() => { const element = document.querySelector(${JSON.stringify(state.expectVisible)}); if (!element) return false; const box = element.getBoundingClientRect(), style = getComputedStyle(element); return element.getClientRects()`
          + `.length > 0 && box.width > 0 && box.height > 0 && style.visibility === 'visible' && Number(style.opacity) > 0; })()`);
      } catch (error) { notRun.push({ state: state.name, viewport, reason: `Expected visible state was not reached: ${state.expectVisible}; ${error.message}` }); continue; }
    }
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await pause(100);
    const result = await evaluate(`(${collectVisibleText}) ((${contrastTools})())`);
    states.push({ name: state.name, ...result });
    const minimumSeen = state.minSeen ?? plan.minSeen ?? 1;
    if (result.seen < minimumSeen) coverageFailures.push({ state: state.name, viewport, reason: `Only ${result.seen} visible text samples; expected at least ${minimumSeen}` });
    if (state.capture) { const capture = await command(
      'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }
    ); const name = `${state.name}-${viewport.width}.png`.replace(/[^A-Za-z0-9_.-]/gu, '-'); await writeFile(path.join(out, name), Buffer.from(capture.data, 'base64')); }
    console.log(`${state.name} ${viewport.width}px: ${result.seen} seen; ${result.counts.passed} passed, ${result.counts.failed} failed, ${result.counts.manual} manual`);
    if (state.textSpacing) spacing.push(await textSpacingCheck(state.name));
  }
}
