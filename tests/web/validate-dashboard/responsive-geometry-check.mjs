import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

export async function checkResponsiveGeometry(label) {
  const failures = await evaluate(`(() => {
    const failures = [];
    const within = (inner, outer) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const textFits = (node, bounds, label) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim() || !visible(walker.currentNode.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) if (rect.width > 0 && !within(rect, bounds)) failures.push(label + ' text escapes its bounds');
      }
    };
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) failures.push('page overflows horizontally');
    const panel = document.querySelector('#overview');
    const panelRect = panel.getBoundingClientRect();
    const heroArt = panel.querySelector('#identityHeroArt').getBoundingClientRect();
    if (Math.abs(heroArt.left + heroArt.width / 2 - (panelRect.right - 28)) > 2 || Math.abs(heroArt.top + heroArt.height / 2 - (panelRect.top + 28)) > 2) failures.push('hero artwork is not inset 28px left/down from the top-right corner');
    if (innerWidth >= 1280) {
      const record = panel.querySelector('.uee-record');
      const label = record.children[0].getBoundingClientRect();
      const number = record.children[1].getBoundingClientRect();
      if (Math.abs(number.top - label.top) > 2 || number.left < label.right - 1) failures.push('wide UEE Citizen label and number are not inline');
    }
    const blocks = ['.identity-account-controls', '.identity-copy', '.identity-aside'].map(selector => panel.querySelector(selector));
    for (let i = 0; i < blocks.length; i++) {
      const rect = blocks[i].getBoundingClientRect();
      if (!within(rect, panelRect)) failures.push('hero block escapes panel: ' + blocks[i].className);
      for (let j = i + 1; j < blocks.length; j++) if (overlap(rect, blocks[j].getBoundingClientRect())) failures.push('hero blocks overlap');
    }
    const copy = panel.querySelector('.identity-copy');
    const children = [...copy.children].filter(visible);
    children.forEach((child, index) => {
      const rect = child.getBoundingClientRect();
      textFits(child, copy.getBoundingClientRect(), 'identity');
      for (const other of children.slice(index + 1)) if (overlap(rect, other.getBoundingClientRect())) failures.push('identity rows overlap');
    });
    textFits(panel.querySelector('.identity-aside'), panel.querySelector('.identity-aside').getBoundingClientRect(), 'data state');
    for (const field of panel.querySelectorAll('.identity-meta > div')) textFits(field, field.getBoundingClientRect(), 'identity field');
    const mainOrganizationLabels = [...panel.querySelectorAll('dt')].filter(node => node.textContent.trim().toLowerCase() === 'main organization');
    if (mainOrganizationLabels.length !== 1 || panel.querySelector('#organizationEmblemLabel')) failures.push('organization detail is duplicated');
    if (!panel.querySelector('.identity-organization #organizationEmblemImage') || !panel.querySelector('.identity-organization #mainOrganization')) failures.push('organization emblem is separated from its field');
    if (!copy.contains(panel.querySelector('#dossierBadgeImage'))) failures.push('badge is separated from the account identity');
    if (!panel.querySelector('.identity-title #dossierBadgeImage') || panel.querySelector('#dossierBadgeLabel')) failures.push('badge is not integrated into the single title slot');
    const shell = document.querySelector('.table-shell');
    const shellRect = shell.getBoundingClientRect();
    if (shell.scrollWidth > shell.clientWidth + 1) failures.push('inventory scrolls horizontally');
    const rows = [...document.querySelectorAll('#inventoryRows tr')];
    for (const row of rows) {
      const cells = [...row.children];
      if (cells.length !== 5) failures.push('inventory fields were removed');
      for (const cell of cells) {
        if (!visible(cell) || !within(cell.getBoundingClientRect(), shellRect)) failures.push('inventory field is hidden or outside the viewport');
        textFits(cell, cell.getBoundingClientRect(), 'inventory cell');
      }
      for (const badge of row.querySelectorAll('.record-warning')) {
        const bounds = badge.getBoundingClientRect();
        const walker = document.createTreeWalker(badge, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          for (const word of walker.currentNode.textContent.matchAll(/\\S+/gu)) {
            const range = document.createRange();
            range.setStart(walker.currentNode, word.index);
            range.setEnd(walker.currentNode, word.index + word[0].length);
            const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
            if (new Set(rects.map(rect => Math.round(rect.top))).size > 1) failures.push('inventory state word wraps mid-word: ' + word[0]);
            if (rects.some(rect => !within(rect, bounds))) failures.push('inventory state word escapes its badge: ' + word[0]);
          }
        }
      }
      for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) if (overlap(cells[i].getBoundingClientRect(), cells[j].getBoundingClientRect())) failures.push('inventory fields overlap');
      if (shell.clientWidth > 420 && shell.clientWidth <= 680) {
        const tops = cells.slice(1).map(cell => cell.getBoundingClientRect().top);
        if (Math.max(...tops) - Math.min(...tops) > 1) failures.push('intermediate inventory wastes a second metadata row');
      }
    }
    const artwork = document.querySelector('#inspectorImage');
    if (!artwork.hidden && getComputedStyle(artwork).objectFit !== 'contain') failures.push('inspector crops or stretches the thumbnail');
    return [...new Set(failures)];
  })()`);
  assert(failures.length === 0, `${label}: ${failures.join("; ")}`);
}
