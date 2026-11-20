import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

export async function checkCompactCollections(label, { density = true } = {}) {
  const failures = await evaluate(`(() => {
    const failures = [];
    const measure = document.createElement('canvas').getContext('2d');
    const firstTextRect = node => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        const rect = [...range.getClientRects()].find(item => item.width > 0 && item.height > 0);
        if (rect) return rect;
      }
      return null;
    };
    for (const id of ['organizationRows', 'referralRows']) {
      const body = document.getElementById(id);
      const shell = body.closest('.collection-table-shell');
      if (!body.getClientRects().length || getComputedStyle(shell.querySelector('thead')).clipPath === 'none') continue;
      for (const row of body.rows) {
        if (row.cells[0]?.colSpan > 1) continue;
        for (const cell of [...row.cells].slice(2)) {
          const field = cell.querySelector('.collection-cell-label');
          const value = cell.querySelector('.collection-cell-value');
          if (!field || !value) { failures.push(id + ': metadata label/value wrapper missing'); continue; }
          const a = firstTextRect(field), b = firstTextRect(value);
          const style = getComputedStyle(value);
          measure.font = style.font || style.fontSize + ' ' + style.fontFamily;
          const pairFits = a && a.width + measure.measureText(value.textContent.trim()).width + 6 <= cell.clientWidth + 1;
          if (pairFits && a && b && (b.left < a.right - 1 || Math.min(a.bottom,b.bottom) <= Math.max(a.top,b.top))) failures.push(id + ': metadata value stacks beneath its label despite sufficient room');
        }
      }
      if (${density} && innerWidth > 360) {
        const ordinary = [...body.rows].filter(row => row.cells[0]?.colSpan === 1);
        const samples = [ordinary[0], ordinary.find(row => row.cells[0].textContent.includes('Redacted Member'))].filter(Boolean);
        for (const row of samples) if (row.getBoundingClientRect().height > 110) failures.push(id + ': ordinary compact row exceeds 110px');
      }
    }
    return [...new Set(failures)];
  })()`);
  assert(failures.length === 0, `${label}: ${failures.join('; ')}`);
}

export async function scrollCollectionToBottom(bodyId) {
  assert(await evaluate(`(() => {
    const shell = document.getElementById(${JSON.stringify(bodyId)}).closest('.collection-table-shell');
    shell.scrollTop = shell.scrollHeight;
    return shell.scrollTop > 0;
  })()`), `${bodyId}: pagination fixture was not tall enough to exercise scroll restoration.`);
}

export async function assertCollectionAtTop(bodyId, label) {
  await waitFor(`document.getElementById(${JSON.stringify(bodyId)}).closest('.collection-table-shell').scrollTop <= 1`);
  assert(await evaluate(`document.getElementById(${JSON.stringify(bodyId)}).closest('.collection-table-shell').scrollTop <= 1`), `${label}: collection did not reset to its first row.`);
}
