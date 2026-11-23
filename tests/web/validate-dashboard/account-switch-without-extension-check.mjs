import { MENU, chooseAccount, named } from "./accountswitchmenustate.mjs";
import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { press } from "./buildstatusfocusedmodelandkeys.mjs";
import { loadFixture, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

// Switch Account without the extension: an Account JSON of another account adds it to the page and shows it, one of
// the same account updates it, each account keeps its own view and Orgs JSON, an Orgs JSON of another account is
// refused without harm, the menu works from the keyboard and at 320 px, Add new account says why it opens the Account
// JSON chooser and asks no host for anything, and a reload leaves none of the accounts.
const VIEW = `({handle:document.getElementById('accountHandle').textContent,file:document.getElementById('railExported').textContent,search:document.getElementById('recordSearch').value,
  record:document.getElementById('inspectorTitle').textContent,orgs:document.getElementById('orgFileStatus').textContent})`;

async function openOrganizations(handle, fileName) {
  await evaluate(`(async()=>{
    const copy=structuredClone(window.CITIZENDATA_DEMO_DATA);copy.account.handle='${handle}';copy.profile.handle='${handle}';
    const organizations=await window.CitizenDataOrganizationDocument.fromAccountDocument({accountDocument:copy});
    const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(organizations)],'${fileName}',{type:'application/json'}));
    const input=document.getElementById('orgFileInput');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor("document.getElementById('messageDialog').open");
  const shown = await evaluate("({title:document.getElementById('dialogTitle').textContent,message:document.getElementById('dialogMessage').textContent})");
  await evaluate("document.getElementById('messageDialog').close()");
  return shown;
}

export async function checkAccountSwitchWithoutExtension() {
  await reloadDashboard();
  const startup = await evaluate(MENU);
  assert(startup.expanded === "false" && !startup.open && startup.items.length === 0, `The example was listed as an account: ${JSON.stringify(startup)}`);
  await loadFixture("alpha-account.json", named("AlphaCitizen", "Alpha Pilot"));
  await loadFixture("bravo-account.json", named("BravoCitizen", "Bravo Pilot"));
  const two = await evaluate(MENU);
  assert(JSON.stringify(two.items) === JSON.stringify([["Alpha Pilot AlphaCitizen", "false", null], ["Bravo Pilot BravoCitizen", "true", null]]), `Two accounts were not both listed with the last checked: ${JSON.stringify(two)}`);
  await loadFixture("alpha-account-later.json", named("alphacitizen", "Alpha Pilot"));
  const updated = await evaluate(MENU);
  assert(JSON.stringify(updated.items) === JSON.stringify([["Alpha Pilot alphacitizen", "true", null], ["Bravo Pilot BravoCitizen", "false", null]]), `A later file of an account listed it twice: ${JSON.stringify(updated)}`);

  // Each account keeps its own search, selected record and Orgs JSON; the other account shows none of them.
  await evaluate("document.querySelectorAll('#inventoryRows .record-button')[1].click()");
  const record = await evaluate("document.getElementById('inspectorTitle').textContent");
  await evaluate(`document.getElementById('recordSearch').value=${JSON.stringify(record)};document.getElementById('recordSearch').dispatchEvent(new Event('input',{bubbles:true}))`);
  assert((await openOrganizations("AlphaCitizen", "alpha-organizations.json")).title === "Organization data verified", "The Orgs JSON of the account shown was refused.");
  const alpha = await evaluate(VIEW);
  await chooseAccount("Bravo Pilot");
  const bravo = await evaluate(VIEW);
  assert(bravo.handle === "BravoCitizen" && bravo.file === "bravo-account.json" && bravo.search === "" && bravo.orgs !== "alpha-organizations.json", `Another account showed the first one's view or Orgs JSON: ${JSON.stringify(bravo)}`);
  const refused = await openOrganizations("AlphaCitizen", "alpha-organizations-again.json");
  assert(refused.title === "File rejected" && refused.message === "This Orgs JSON belongs to a different Account JSON." && (await evaluate(VIEW)).orgs === bravo.orgs, `An Orgs JSON of another account was not refused: ${JSON.stringify(refused)}`);
  await chooseAccount("Alpha Pilot");
  const again = await evaluate(VIEW);
  assert(JSON.stringify(again) === JSON.stringify(alpha) && alpha.orgs === "alpha-organizations.json" && alpha.search === record && alpha.record === record, `An account shown again lost its own view: ${JSON.stringify({ alpha, again })}`);

  // The keyboard: Arrow Down opens the menu on the account shown and moves on, End reaches Add new account, Escape closes it.
  await evaluate("document.getElementById('switchAccountButton').focus()");
  const steps = [];
  for (const [key, code, keyCode] of [["ArrowDown", "ArrowDown", 40], ["ArrowDown", "ArrowDown", 40], ["End", "End", 35], ["Escape", "Escape", 27]]) {
    await press(key, code, keyCode);
    steps.push(await evaluate(MENU));
  }
  assert(steps[0].open && steps[0].expanded === "true" && steps[0].focused === "Alpha Pilot alphacitizen" && steps[1].focused === "Bravo Pilot BravoCitizen" && steps[2].focused === "addAccountCommand"
    && !steps[3].open && steps[3].expanded === "false" && steps[3].focused === "switchAccountButton", `The Switch Account menu does not work from the keyboard: ${JSON.stringify(steps)}`);
  // What a screen reader is given: a menu button, a menu of checkable accounts, and the command after them.
  await press("ArrowDown", "ArrowDown", 40);
  await command("Accessibility.enable");
  const tree = (await command("Accessibility.getFullAXTree")).nodes.filter((node) => !node.ignored);
  await command("Accessibility.disable");
  const namesOf = (role) => tree.filter((node) => node.role?.value === role).map((node) => node.name?.value);
  const given = { button: namesOf("button").includes("Switch Account"), menus: namesOf("menu").length, radios: namesOf("menuitemradio"), commands: namesOf("menuitem"),
    checked: tree.filter((node) => node.role?.value === "menuitemradio").map((node) => node.properties?.find((property) => property.name === "checked")?.value?.value) };
  assert(given.button && given.menus === 1 && JSON.stringify(given.radios) === JSON.stringify(["Alpha Pilot alphacitizen", "Bravo Pilot BravoCitizen"])
    && JSON.stringify(given.checked) === JSON.stringify(["true", "false"]) && JSON.stringify(given.commands) === JSON.stringify(["Add new account"]), `The menu's roles, names or checked state are wrong: ${JSON.stringify(given)}`);
  await press("Escape", "Escape", 27);

  // At 320 px the button and its menu fit the viewport, and the page does not scroll sideways.
  const size = await evaluate("({width:innerWidth,height:innerHeight})");
  await setViewport(320, 700);
  await evaluate("document.getElementById('switchAccountButton').click()");
  const narrow = await evaluate(`(()=>{const popup=document.getElementById('accountPopup').getBoundingClientRect();const items=[...document.querySelectorAll('#accountMenu button')].filter(item=>!item.hidden).map(item=>item.getBoundingClientRect());
    return {left:popup.left,right:popup.right,width:innerWidth,scroll:document.documentElement.scrollWidth,inside:items.every(item=>item.width>0&&item.left>=popup.left-1&&item.right<=popup.right+1)};})()`);
  await press("Escape", "Escape", 27);
  await setViewport(size.width, size.height);
  assert(narrow.left >= 0 && narrow.right <= narrow.width && narrow.scroll <= narrow.width && narrow.inside, `The Switch Account menu does not fit at 320 px: ${JSON.stringify(narrow)}`);

  // Add new account without the extension: it says why, its Load JSON opens the Account JSON chooser, nothing is fetched.
  await evaluate("window.__add={chooser:0,fetches:0};const real=window.fetch;window.fetch=(...args)=>{window.__add.fetches+=1;return real(...args);};document.getElementById('jsonFileInput').click=()=>{window.__add.chooser+=1;};true");
  await evaluate("document.getElementById('switchAccountButton').click();document.getElementById('addAccountCommand').click()");
  await waitFor("document.getElementById('addAccountDialog').open");
  const explained = await evaluate("document.getElementById('addAccountDialogMessage').textContent");
  await evaluate("document.getElementById('addAccountLoadJson').click()");
  const added = await evaluate("({open:document.getElementById('addAccountDialog').open,...window.__add})");
  assert(explained === "This website cannot read your RSI login cookies, so it cannot add the account you are signed in to. Loading another Account JSON adds that account for this page session."
    && !added.open && added.chooser === 1 && added.fetches === 0, `Add new account without the extension did not explain and open the Account JSON chooser alone: ${JSON.stringify({ explained, added })}`);

  // A reload without the extension leaves the example and no account.
  await reloadDashboard();
  const reloaded = await evaluate(`({menu:${MENU},eyebrow:document.getElementById('snapshotEyebrow').textContent})`);
  assert(reloaded.menu.items.length === 0 && reloaded.eyebrow === "EXAMPLE ACCOUNT", `A reload without the extension kept an account: ${JSON.stringify(reloaded)}`);
}
