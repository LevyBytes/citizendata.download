import { MENU } from "./accountswitchmenustate.mjs";
import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { press } from "./buildstatusfocusedmodelandkeys.mjs";
import { setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

// Switch Account below the account avatar, at a wide, a tablet and a narrow width: the button starts below the
// avatar and is centred on it, the account text overlaps neither, the page does not scroll sideways, and the open
// menu is wholly in the viewport and not clipped by the account card. Escape returns focus to the button.
const WIDTHS = [[1600, 1000], [820, 1000], [390, 844]];
const PLACEMENT = `(()=>{const box=(selector)=>document.querySelector(selector).getBoundingClientRect();
  const avatar=box('#avatar'),button=box('#switchAccountButton'),copy=box('.identity-copy'),panel=box('#overview');
  const overlaps=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
  return {below:button.top>=avatar.bottom,offset:Math.abs((button.left+button.right)/2-(avatar.left+avatar.right)/2),inPanel:button.left>=panel.left&&button.right<=panel.right&&button.bottom<=panel.bottom,
    overlap:overlaps(avatar,copy)||overlaps(button,copy),scroll:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    inHeader:Boolean(document.querySelector('.top-actions #switchAccountButton'))};})()`;
// The open menu: inside the viewport, below or above its button, and the element at each of its corners is its own.
const OPENED = `(()=>{const popup=document.getElementById('accountPopup'),menu=popup.getBoundingClientRect(),button=document.getElementById('switchAccountButton').getBoundingClientRect();
  const points=[[menu.left+4,menu.top+4],[menu.right-4,menu.top+4],[menu.left+4,menu.bottom-4],[menu.right-4,menu.bottom-4],[(menu.left+menu.right)/2,(menu.top+menu.bottom)/2]];
  return {inView:menu.left>=0&&menu.top>=0&&menu.right<=document.documentElement.clientWidth&&menu.bottom<=innerHeight,width:menu.width,
    attached:menu.top>=button.bottom-1||menu.bottom<=button.top+1,own:points.every(([x,y])=>popup.contains(document.elementFromPoint(x,y))),
    topLayer:typeof popup.showPopover!=='function'||popup.matches(':popover-open')};})()`;

export async function checkSwitchAccountBelowTheAvatar() {
  await reloadDashboard();
  const size = await evaluate("({width:innerWidth,height:innerHeight})");
  const found = [];
  for (const [width, height] of WIDTHS) {
    await setViewport(width, height);
    await evaluate("document.getElementById('overview').scrollIntoView({block:'start'});true");
    const placement = await evaluate(PLACEMENT);
    await evaluate("document.getElementById('switchAccountButton').click()");
    const opened = await evaluate(`({...${OPENED},menu:${MENU}})`);
    await press("Escape", "Escape", 27);
    const closed = await evaluate(MENU);
    found.push({ width, placement, opened, closed });
    assert(placement.below && placement.offset <= 1 && placement.inPanel && !placement.overlap && placement.scroll <= 0 && !placement.inHeader,
      `At ${width} px Switch Account is not below the avatar and centred on it, inside the card and clear of the account text: ${JSON.stringify(placement)}`);
    assert(opened.inView && opened.attached && opened.own && opened.topLayer && opened.width > 0 && opened.menu.open && opened.menu.expanded === "true",
      `At ${width} px the open Switch Account menu is clipped, covered, out of the viewport or away from its button: ${JSON.stringify(opened)}`);
    assert(!closed.open && closed.expanded === "false" && closed.focused === "switchAccountButton", `At ${width} px Escape did not close the menu and return focus to Switch Account: ${JSON.stringify(closed)}`);
  }
  await setViewport(size.width, size.height);
  return found;
}
