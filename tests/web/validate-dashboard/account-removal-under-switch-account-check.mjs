import { ADDED, KEPT, asked, connect } from "./accountswitchextensionstandin.mjs";
import { MENU } from "./accountswitchmenustate.mjs";
import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";

// Remove this account, under Switch Account, with an extension that keeps accounts; a stand-in answers for it. The
// command asks first, and Keep account changes nothing. Removing the account shown names it to the extension and shows
// the account the extension selected in its place; removing the last one shows the example, where the command is not
// offered. A refusal leaves the account where it was and says why.
const STATE = `({menu:${MENU},remove:(()=>{const command=document.getElementById('removeAccountCommand');return command.hidden?null:command.textContent;})(),
  dialog:document.getElementById('removeAccountDialog').open,title:document.getElementById('removeAccountDialogTitle').textContent,message:document.getElementById('removeAccountDialogMessage').textContent,
  handle:document.getElementById('accountHandle').textContent,eyebrow:document.getElementById('snapshotEyebrow').textContent,removed:${asked("REMOVE_ACCOUNT")}})`;
const askToRemove = () => evaluate("document.getElementById('switchAccountButton').click();document.getElementById('removeAccountCommand').click()");

export async function checkAccountRemovalUnderSwitchAccount() {
  await reloadDashboard();
  await connect(`[${KEPT},${ADDED}]`);
  await waitFor("document.getElementById('accountHandle').textContent==='KeptCitizen'");
  await evaluate("document.getElementById('switchAccountButton').click()");
  const offered = await evaluate(STATE);
  await evaluate("document.getElementById('switchAccountButton').click()");
  assert(offered.remove === "Remove this account" && offered.menu.items.length === 2, `Remove this account was not offered under Switch Account: ${JSON.stringify(offered)}`);

  // It asks first; Keep account changes nothing.
  await askToRemove();
  await waitFor("document.getElementById('removeAccountDialog').open");
  const asking = await evaluate(STATE);
  assert(asking.title === "Remove Kept Pilot?" && asking.message === "The extension forgets Kept Pilot and deletes the builds and Orgs JSON it keeps of it. Images it keeps stay until you delete them in the extension popup. Files you saved are not touched."
    && !asking.menu.open && asking.removed.length === 0, `Remove this account did not ask first: ${JSON.stringify(asking)}`);
  await evaluate("document.querySelector('#removeAccountDialog .dialog-actions button[value=\"cancel\"]').click()");
  await quiet();
  const kept = await evaluate(STATE);
  assert(!kept.dialog && kept.removed.length === 0 && kept.handle === "KeptCitizen" && kept.menu.items.length === 2, `Keep account changed something: ${JSON.stringify(kept)}`);

  // Removed: the extension is told, and the account it selected is shown in its place.
  await evaluate("window.__bridge.removeSelects='rsi:addedcitizen'");
  await askToRemove();
  await waitFor("document.getElementById('removeAccountDialog').open");
  await evaluate("document.getElementById('removeAccountConfirm').click()");
  await waitFor("document.getElementById('statusToast').textContent==='Kept Pilot is removed.'");
  const removed = await evaluate(STATE);
  assert(JSON.stringify(removed.removed) === JSON.stringify([{ accountKey: "rsi:keptcitizen" }]) && removed.handle === "AddedCitizen"
    && JSON.stringify(removed.menu.items.map(([label]) => label)) === JSON.stringify(["Added Pilot AddedCitizen"]), `The removed account was not closed, or the selected one not shown: ${JSON.stringify(removed)}`);

  // A refusal leaves the account and says why.
  await evaluate("window.__bridge.removeAnswer={ok:false,code:'JOB_ALREADY_ACTIVE',message:'A job is running or starting. Remove the account when it has finished.'}");
  await askToRemove();
  await waitFor("document.getElementById('removeAccountDialog').open");
  await evaluate("document.getElementById('removeAccountConfirm').click()");
  await waitFor("document.getElementById('messageDialog').open");
  const refused = await evaluate(`({...${STATE},said:document.getElementById('dialogMessage').textContent})`);
  await evaluate("document.getElementById('messageDialog').close()");
  assert(refused.said === "A job is running or starting. Remove the account when it has finished." && refused.handle === "AddedCitizen" && refused.menu.items.length === 1,
    `A refused removal changed the page or did not say why: ${JSON.stringify(refused)}`);

  // The last account: the example is shown, and Remove this account is not offered for it.
  await evaluate("window.__bridge.removeAnswer=null;window.__bridge.removeSelects=null");
  await askToRemove();
  await waitFor("document.getElementById('removeAccountDialog').open");
  await evaluate("document.getElementById('removeAccountConfirm').click()");
  await waitFor("document.getElementById('statusToast').textContent==='Added Pilot is removed.'");
  await evaluate("document.getElementById('switchAccountButton').click()");
  const last = await evaluate(STATE);
  await evaluate("document.getElementById('switchAccountButton').click()");
  assert(last.eyebrow === "EXAMPLE ACCOUNT" && last.menu.items.length === 0 && last.remove === null && last.removed.length === 3,
    `Removing the last account did not show the example: ${JSON.stringify(last)}`);
}
