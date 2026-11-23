import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

// What the Switch Account checks read and do: a fixture of a named account, the menu's state, and a choice in it.
export const named = (handle, name) => `documentCopy.account.handle='${handle}';documentCopy.profile.handle='${handle}';documentCopy.profile.displayName='${name}';`;

export const MENU = `(()=>{const status=document.getElementById('accountMenuStatus');return {expanded:document.getElementById('switchAccountButton').getAttribute('aria-expanded'),
  open:!document.getElementById('accountPopup').hidden,focused:document.activeElement===document.body?null:document.activeElement.id||document.activeElement.textContent,status:status.hidden?null:status.textContent,
  items:[...document.querySelectorAll('#accountMenuAccounts [role="menuitemradio"]')].map(item=>[item.textContent,item.getAttribute('aria-checked'),item.getAttribute('aria-disabled')])};})()`;

export async function chooseAccount(label) {
  await evaluate("document.getElementById('switchAccountButton').click()");
  await evaluate(`[...document.querySelectorAll('#accountMenuAccounts [role="menuitemradio"]')].find(item=>item.textContent.includes(${JSON.stringify(label)})).click()`);
}
