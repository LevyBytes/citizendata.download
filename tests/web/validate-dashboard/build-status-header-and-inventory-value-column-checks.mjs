import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

// The Build Status header wears the approval card's look: the gradient, the turning artwork on its top right corner,
// a scanning line, and embers. The motion runs only while the panel is shown, and nothing of it sits over the title
// or the window buttons.
export async function checkBuildStatusHeader() {
  await reloadDashboard();
  const read = `(()=>{
    const header=document.getElementById('overlayHeader'),art=document.getElementById('overlayHeaderArt'),canvases=[...header.querySelectorAll('canvas.overlay-embers')];
    const box=(element)=>{const rect=element.getBoundingClientRect();return {left:rect.left,top:rect.top,width:rect.width,height:rect.height}};
    const style=getComputedStyle(header),scan=getComputedStyle(header,'::after'),artStyle=getComputedStyle(art);
    const centre=(id)=>{const rect=document.getElementById(id).getBoundingClientRect();return document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.closest('button')?.id??null};
    return {
      hidden:document.getElementById('parserOverlay').hidden,motion:header.dataset.motionState,canvases:canvases.length,heroCanvases:document.querySelectorAll('#overview canvas.hero-embers').length,
      header:box(header),canvas:canvases[0]?box(canvases[0]):null,artHidden:art.getAttribute('aria-hidden'),artImage:artStyle.backgroundImage,artTransform:art.style.transform,artPointer:artStyle.pointerEvents,
      gradient:style.backgroundImage,overflow:style.overflow,scan:{height:scan.height,animation:scan.animationName,pointer:scan.pointerEvents},
      minimize:centre('minimizeOverlay'),close:centre('closeOverlay'),title:document.getElementById('overlayTitle').textContent
    };
  })()`;
  const idle = await evaluate(read);
  assert(idle.hidden && idle.motion === "paused" && idle.canvases === 1 && idle.heroCanvases === 1, `The Build Status header's motion was not mounted once and paused while the panel is hidden: ${JSON.stringify(idle)}`);
  await evaluate("document.getElementById('buildButton').click()");
  await waitFor("!document.getElementById('parserOverlay').hidden && document.getElementById('overlayHeader').dataset.motionState==='running'");
  await waitFor("/rotate\\((?!0deg)[0-9.]+deg\\)/u.test(document.getElementById('overlayHeaderArt').style.transform)");
  const shown = await evaluate(read);
  assert(
    shown.artImage.includes("assets/decor/radar.svg") && shown.artHidden === "true" && shown.artPointer === "none" && shown.gradient.startsWith("linear-gradient(110deg") && shown.overflow === "hidden",
    `The Build Status header does not carry the approval card's artwork and gradient: ${JSON.stringify(shown)}`
  );
  assert(shown.scan.height === "2px" && shown.scan.animation === "overlay-header-scan" && shown.scan.pointer === "none", `The Build Status header has no scanning line: ${JSON.stringify(shown.scan)}`);
  assert(
    shown.canvas && Math.abs(shown.canvas.width - shown.header.width) < 1 && Math.abs(shown.canvas.height - shown.header.height) < 2 && Math.abs(shown.canvas.left - shown.header.left) < 1,
    `The embers do not cover the Build Status header: ${JSON.stringify({ header: shown.header, canvas: shown.canvas })}`
  );
  assert(shown.minimize === "minimizeOverlay" && shown.close === "closeOverlay" && shown.title === "BUILD STATUS", `The header's decoration covers its buttons or changed its title: ${JSON.stringify(shown)}`);
  // The canvas covers the header inside its lower border, hence the pixel of difference in height.
  // Minimized, the header is all that is left of the panel and keeps its look; closed, the motion stops.
  await evaluate("document.getElementById('minimizeOverlay').click()");
  await waitFor("document.getElementById('parserOverlay').classList.contains('minimized')");
  const minimized = await evaluate(read);
  assert(
    minimized.motion === "running" && minimized.minimize === "minimizeOverlay" && minimized.close === "closeOverlay" && Math.abs(minimized.canvas.height - minimized.header.height) < 2,
    `The minimized Build Status header lost its look or its buttons: ${JSON.stringify(minimized)}`
  );
  await evaluate("document.getElementById('closeOverlay').click()");
  await waitFor("document.getElementById('parserOverlay').hidden && document.getElementById('overlayHeader').dataset.motionState==='paused'");
}

// The third column of the inventory table is the amount that matters for the list: what a hangar pledge melts for,
// and what a buy-back costs. Each row shows the amount the inspector shows for that record, and the record's state
// is still among the inspector's facts.
export async function checkInventoryValueColumn() {
  await reloadDashboard();
  const readList = async (factName) => {
    const count = await evaluate("document.querySelectorAll('#inventoryRows tr').length");
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      await evaluate(`document.querySelectorAll('#inventoryRows tr')[${index}].querySelector('.record-button').click()`);
      rows.push(await evaluate(`(()=>{
        const cell=document.querySelectorAll('#inventoryRows tr')[${index}].children[2];
        const facts=Object.fromEntries([...document.querySelectorAll('#inspectorFacts > div')].map((fact)=>[fact.querySelector('dt').textContent,fact.querySelector('dd').textContent]));
        return {amount:cell.querySelector('.inventory-amount')?.textContent??null,label:cell.querySelector('.cell-label')?.textContent??null,pills:cell.querySelectorAll('.state-label').length,fact:facts[${JSON.stringify(factName)}]??null,
          state:facts.State??null};
      })()`));
    }
    const headings = await evaluate("[...document.getElementById('inventoryRows').closest('table').querySelectorAll('thead th')].map((heading)=>[heading.textContent.trim(),heading.scope,heading.getAttribute('role')])");
    return { rows, headings };
  };
  const headingsFor = (name) => JSON.stringify(["Record", "Category", name, "Date", "Media"].map((text) => [text, "col", "columnheader"]));
  const amount = /^(?:\$[0-9][0-9,]*\.[0-9]{2} USD|—|Varies, check on RSI)$/u;
  const hangar = await readList("Melt Value");
  assert(JSON.stringify(hangar.headings) === headingsFor("Melt Value"), `The Hangar table's third column is not Melt Value: ${JSON.stringify(hangar.headings)}`);
  assert(
    hangar.rows.length > 0 && hangar.rows.every((row) => row.amount !== null && row.amount === row.fact && amount.test(row.amount) && row.label === "Melt Value" && row.pills === 0 && row.state) && hangar.rows.some((row) => row.amount.startsWith("$")),
    `A Hangar row does not show its melt value as the inspector does: ${JSON.stringify(hangar.rows)}`
  );
  await evaluate("document.getElementById('buybacksTab').click()");
  await waitFor("document.getElementById('inventoryValueHeading').textContent==='Price'");
  const buybacks = await readList("Buyback Price");
  assert(JSON.stringify(buybacks.headings) === headingsFor("Price"), `The Buybacks table's third column is not Price: ${JSON.stringify(buybacks.headings)}`);
  assert(
    buybacks.rows.length > 0 && buybacks.rows.every((row) => row.amount !== null && row.amount === row.fact && amount.test(row.amount) && row.label === "Price" && row.pills === 0 && row.state) && buybacks.rows.some((row) => row.amount.startsWith("$")),
    `A Buybacks row does not show its price as the inspector does: ${JSON.stringify(buybacks.rows)}`
  );
  await evaluate("document.getElementById('hangarTab').click()");
  await waitFor("document.getElementById('inventoryValueHeading').textContent==='Melt Value'");
}
