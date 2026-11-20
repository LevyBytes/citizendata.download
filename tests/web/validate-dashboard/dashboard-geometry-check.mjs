import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { checkExportPlacement } from "./export-dialog-and-download.mjs";
import { geometryProbePrelude } from "./geometry-probe-prelude-and-floating-geometry-check.mjs";

export async function checkDashboardGeometry(label) {
  const failures = await evaluate(`(() => {
${geometryProbePrelude}
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) failures.push('page overflows horizontally');
    if (/observed/i.test(document.body.innerText)) failures.push('observation jargon remains in visible UI');
    for (const selector of ['.top-actions', '.rail-nav', '.summary-strip', '.balance-list', '.subscription-details', '.subscription-plan', '.health-details', '.inventory-heading', '.filter-bar', '.filter-options', '.inventory-view-tabs', '.referral-grid',
      '.ladder-actions', '.membership-list', '.collection-toolbar', '.collection-pagination', '.section-heading', '.org-content', '.export-card']) {
      for (const container of document.querySelectorAll(selector)) if (visible(container)) checkSiblings(container, [...container.children], selector);
    }
    for (const summary of document.querySelectorAll('.detail-panel > summary')) if (visible(summary)) checkSiblings(summary, [...summary.children], 'disclosure summary');
    const subscriptions=document.querySelector('#subscriptions').getBoundingClientRect();
    if (document.querySelector('#balances').getBoundingClientRect().bottom > subscriptions.top + 1
      || subscriptions.bottom > document.querySelector('#inventory').getBoundingClientRect().top + 1) failures.push('subscription section is not between balances and inventory');
    for (const selector of ['#subscriptionMetricDetail','#subscriptionNote','#subscriptionTier','#subscriptionDetailSpent']) {
      const node=document.querySelector(selector);
      if (visible(node)) textFits(node,selector);
    }
    for (const item of document.querySelectorAll('.membership-card button')) if (visible(item)) checkSiblings(item, [...item.children], 'membership card');
    for (const item of document.querySelectorAll('.inspector-item')) if (visible(item)) checkSiblings(item, [...item.children], 'contained item');
    for (const selector of ['.rail-evidence', '.collection-note', '.community-footer h2', '.community-footer p', '#inspectorTitle', '#inspectorSubtitle', '#inspectorFacts', '.inspector-note', '.source-pending', '#projectSupport', '.brand b',
      '.brand small']) {
      for (const node of document.querySelectorAll(selector)) if (visible(node)) textFits(node, selector);
    }
    const offline = document.querySelector('.offline-detail');
    const offlineText = offline.querySelector('summary > span:nth-child(2)');
    if (offline.clientWidth >= 320 && offlineText.getBoundingClientRect().width < 150) failures.push('offline summary leaves too little width for its title');
    const support = document.querySelector('#projectSupport');
    if (support && visible(support)) {
      const bounds = support.getBoundingClientRect();
      const links = [...support.querySelectorAll('a')];
      links.forEach((link,index) => {
        const rects = [...link.getClientRects()];
        for (const rect of rects) if (!within(rect,bounds)) failures.push('support link escapes its panel');
        for (const other of links.slice(index+1)) for (const rect of rects) for (const otherRect of other.getClientRects()) if (overlap(rect,otherRect)) failures.push('support links overlap');
      });
    }
    for (const [id, expectedCells] of [['referralRows', 3], ['organizationRows', 5]]) {
      const body = document.getElementById(id);
      if (!visible(body)) continue;
      const shell = body.closest('.collection-table-shell');
      if (shell.scrollWidth > shell.clientWidth + 1) failures.push(id + ' scrolls horizontally');
      for (const row of body.rows) {
        if (row.cells.length !== expectedCells && row.cells[0]?.colSpan !== expectedCells) failures.push(id + ' loses fields');
        checkSiblings(shell, [...row.cells], id);
      }
      const head = shell.querySelector('thead');
      const table = shell.querySelector('table');
      const expectedHeadings = id === 'referralRows' ? ['Moniker','Username','Date'] : ['Moniker','Username','Rank','Role','Membership'];
      const headings = [...head.querySelectorAll('th')];
      if (table.getAttribute('role') !== 'table' || head.getAttribute('role') !== 'rowgroup' || body.getAttribute('role') !== 'rowgroup'
        || getComputedStyle(head).display === 'none' || getComputedStyle(head).visibility === 'hidden'
        || headings.length !== expectedCells || headings.some((heading,
          index) => heading.getAttribute('role') !== 'columnheader' || heading.scope !== 'col' || heading.textContent.trim() !== expectedHeadings[index])) failures.push(id + ' loses semantic column headers');
      if (getComputedStyle(head).clipPath === 'none') {
        for (const heading of head.rows) if (visible(heading)) checkSiblings(shell, [...heading.children], id + ' headings');
      } else {
        for (const row of body.rows) for (const [index, cell] of [...row.cells].entries()) {
          if (cell.colSpan > 1) continue;
          const label = cell.querySelector('.collection-cell-label');
          if (index < 2) {
            if (label && visible(label) && getComputedStyle(label).clipPath === 'none') failures.push(id + ' repeats a moniker or username label');
          } else {
            const value = cell.querySelector('.collection-cell-value');
            if (!label || !visible(label) || !label.textContent.trim() || !value || !visible(value)) failures.push(id + ' reflow loses a metadata label or value');
          }
        }
      }
    }
    for (const control of document.querySelectorAll('button, .rail-nav a, .summary-strip a, #projectSupport a')) {
      if (!visible(control)) continue;
      const rect = control.getBoundingClientRect();
      if (rect.left < -1 || rect.right > innerWidth + 1) failures.push('control is outside page: ' + (control.id || control.textContent.trim().slice(0, 40)));
    }
    return [...new Set(failures)];
  })()`);
  assert(failures.length === 0, `${label}: ${failures.join("; ")}`);
  await checkExportPlacement(label);
}
