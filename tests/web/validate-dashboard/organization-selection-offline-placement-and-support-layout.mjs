import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { checkDashboardGeometry } from "./dashboard-geometry-check.mjs";
import { captureScreenshots, testDirectory } from "./run-options-and-work-folders.mjs";

export async function selectOrganization(sid) {
  await evaluate(`(() => {
    const selector = document.querySelector('#organizationSelector');
    selector.open = true;
    selector.querySelector('[data-organization-sid=${JSON.stringify(sid)}]').click();
  })()`);
}

export async function checkOfflinePlacement(width) {
  await setViewport(width);
  assert(await evaluate(`(() => {
    const grid = document.querySelector('.secondary-grid').getBoundingClientRect();
    const offline = document.querySelector('#offlineImages').getBoundingClientRect();
    const referrals = document.querySelector('#referrals').getBoundingClientRect();
    const organizations = document.querySelector('#organizations').getBoundingClientRect();
    const support = document.querySelector('#projectSupport').getBoundingClientRect();
    return Math.abs(offline.left-grid.left)<=1 && Math.abs(offline.right-grid.right)<=1
      && offline.bottom<=referrals.top+1 && organizations.bottom<=support.top+1
      && document.documentElement.scrollWidth<=innerWidth+1;
  })()`), `Section order or full width placement failed at ${width}px.`);
}

export async function checkSupportPanelLayout() {
  const results = [];
  for (const width of [1780,1280,1000,980,640,390,320]) {
    await checkOfflinePlacement(width);
    const result = await evaluate(`(() => {
      const support=document.querySelector('#projectSupport').getBoundingClientRect();
      const exportCard=document.querySelector('#exportData').getBoundingClientRect();
      const overlap=Math.min(support.right,exportCard.right)>Math.max(support.left,exportCard.left)+1
        && Math.min(support.bottom,exportCard.bottom)>Math.max(support.top,exportCard.top)+1;
      return {width:innerWidth,overlap,pageOverflow:document.documentElement.scrollWidth>innerWidth+1};
    })()`);
    assert(!result.overlap&&!result.pageOverflow,`Support and Export layout failed at ${width}px: ${JSON.stringify(result)}`);
    results.push(result);
    await evaluate("document.querySelector('#offlineImages').open=true");
    await checkDashboardGeometry(`expanded Offline Images at ${width}px`);
    await evaluate("document.querySelector('#offlineImages').open=false");
  }
  if (captureScreenshots) await writeFile(path.join(testDirectory,'work-temp-support-layout-results.json'),JSON.stringify({results,checks:'section order,full width disclosures,support export nonoverlap'},null,2)+'\\n');
}
