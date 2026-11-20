import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

export async function action(step) {
  const supported = ['click', 'open', 'close', 'scroll', 'change'];
  if (!supported.includes(step.type) || typeof step.selector !== 'string') throw new Error('Invalid state action');
  return evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(step.selector)});
    if (!element) return { missing: ${JSON.stringify(step.selector)} };
    const kind = ${JSON.stringify(step.type)};
    if (kind === 'click') { if (element.closest('a[href]')) throw new Error('State plans cannot follow links'); element.click(); }
    if (kind === 'open') { if (element.localName !== 'details') throw new Error('Open action is only for disclosures'); element.open = true; }
    if (kind === 'close') { if (element.localName === 'dialog') element.close(); else if (element.localName === 'details') element.open = false; }
    if (kind === 'change') { element.value = ${JSON.stringify(step.value ?? '')}; element.dispatchEvent(new Event('change', { bubbles: true })); }
    if (kind === 'scroll') element.scrollIntoView({ behavior: 'instant', block: ${JSON.stringify(step.block ?? 'start')} });
    return { completed: true };
  })()`);
}
export async function textSpacingCheck(name) {
  const inspect = `(() => {
    const clipped = [];
    for (const element of document.querySelectorAll('h1,h2,h3,h4,p,dt,dd,button,label,input,select,textarea,td,th')) {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (!element.getClientRects().length || box.width < 2 || box.height < 2 || box.bottom < 0 || box.top > innerHeight) continue;
      if ((['hidden','clip'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1) || (['hidden',
        'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1)) clipped.push((element.id ? '#' + element.id : element.localName + '.' + [...element.classList].join('.')) + ' ' + element.textContent.trim().slice(0,70));
    }
    return { pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, clipped,
      dialogs: [...document.querySelectorAll('dialog[open]')].map(dialog => { const box = dialog.getBoundingClientRect(); return { id: dialog.id,
      overflow: box.left < 0 || box.right > innerWidth + 1 || box.top < 0 || box.bottom > innerHeight + 1 || dialog.scrollWidth > dialog.clientWidth + 1 }; }) };
  })()`;
  const before = await evaluate(inspect);
  await evaluate(`(() => { window.__readabilitySheets = [...document.adoptedStyleSheets]; const sheet = new CSSStyleSheet(); sheet.replaceSync('* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { `
    + `margin-block-end: 2em !important; }'); document.adoptedStyleSheets = [...window.__readabilitySheets, sheet]; })()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const after = await evaluate(inspect);
  await evaluate('document.adoptedStyleSheets = window.__readabilitySheets; delete window.__readabilitySheets');
  const newClips = after.clipped.filter(item => !before.clipped.includes(item));
  const failures = [
    after.pageOverflow && !before.pageOverflow ? 'new page horizontal overflow' : null,
    ...after.dialogs.filter(item => item.overflow && !before.dialogs.some(previous => previous.id === item.id && previous.overflow)).map(item => 'new dialog overflow: ' + item.id),
    ...newClips.map(item => 'new clipping: ' + item)
  ].filter(Boolean);
  return {
    name, width: await evaluate('innerWidth'), status: failures.length ? 'failed' : 'passed', failures, before, after,
    limits: 'Bounded visible geometry difference only; existing truncation, complete document reflow, and all text overlap require review'
  };
}
