import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

// Page code the geometry probe starts with: the list of failures and the measurements its checks use.
export const geometryProbePrelude = `
    const failures = [];
    const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const within = (inner, outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const textFits = (node, name) => {
      const bounds = node.getBoundingClientRect();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (!walker.currentNode.textContent.trim() || !visible(parent) || parent.closest('.sr-only, [aria-hidden="true"]')) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) if (rect.width > 0 && !within(rect, bounds)) failures.push(name + ' text escapes its bounds: ' + walker.currentNode.textContent.trim().replace(/\\s+/gu, ' ').slice(0, 80));
      }
    };
    const checkSiblings = (container, children, name) => {
      const bounds = container.getBoundingClientRect();
      const items = children.filter(visible);
      items.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        if (!within(rect, bounds)) failures.push(name + ' child escapes its container');
        textFits(item, name);
        for (const other of items.slice(index + 1)) if (overlap(rect, other.getBoundingClientRect())) failures.push(name + ' children overlap');
      });
    };`;

export async function checkFloatingGeometry(selector, label) {
  const failures = await evaluate(`(() => {
    const failures = [];
    const panel = document.querySelector(${JSON.stringify(selector)});
    const rect = panel.getBoundingClientRect();
    if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) failures.push('panel escapes viewport');
    if (panel.scrollWidth > panel.clientWidth + 1) failures.push('panel scrolls horizontally');
    for (const node of panel.querySelectorAll('button, h2, .overlay-header, .overlay-route, .collection-activity, progress')) {
      if (!node.getClientRects().length) continue;
      const child = node.getBoundingClientRect();
      if (child.left < rect.left - 1 || child.right > rect.right + 1) failures.push('content escapes panel: ' + (node.id || node.tagName));
      if (node.scrollWidth > node.clientWidth + 1) failures.push('content overflows: ' + (node.id || node.tagName));
    }
    const close = panel.querySelector('.dialog-close');
    const title = panel.querySelector('h2');
    if (close && title) {
      const a = close.getBoundingClientRect();
      const text=document.createRange();text.selectNodeContents(title);
      if ([...text.getClientRects()].some(b=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)) failures.push('close control overlaps title text');
    }
    return [...new Set(failures)];
  })()`);
  assert(failures.length === 0, `${label}: ${failures.join("; ")}`);
}
