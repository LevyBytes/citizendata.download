import { ADDED, KEPT, NEW, asked, connect } from "./accountswitchextensionstandin.mjs";
import { MENU, chooseAccount, named } from "./accountswitchmenustate.mjs";
import { assert, openBuildChooser, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";

// Switch Account with an extension that keeps accounts; a stand-in answers for the extension. The accounts it lists
// are under Switch Account and its kept build of the selected one opens; an added account without a build shows the
// empty state; Add new account takes the signed-in account alone and starts nothing; a build names the account shown;
// choosing an account whose file was opened here names it to the extension;
// nothing is switched or added while a job runs; and after Clear All a reload starts with the example.

export async function checkAccountSwitchWithExtension() {
  await reloadDashboard();
  await connect(`[${KEPT},${ADDED}]`);
  await waitFor("document.getElementById('accountHandle').textContent==='KeptCitizen'");
  const opened = await evaluate(`({menu:${MENU},builds:${asked("GET_ACCOUNT_BUILD")},latest:${asked("GET_LATEST_BUILD")}.length,eyebrow:document.getElementById('snapshotEyebrow').textContent})`);
  assert(JSON.stringify(opened.menu.items) === JSON.stringify([["Kept Pilot KeptCitizen", "true", null], ["Added Pilot AddedCitizen", "false", null]]) && JSON.stringify(opened.builds) === JSON.stringify([{ accountKey: "rsi:keptcitizen" }])
    && opened.latest === 0 && opened.eyebrow === "LOADED ACCOUNT SNAPSHOT", `The extension's accounts were not listed with its kept build open: ${JSON.stringify(opened)}`);

  // An added account without a build: its handle and the empty state, no account section, and nothing fetched for it.
  await chooseAccount("Added Pilot");
  const added = await evaluate(`({state:document.body.dataset.accountState??null,empty:document.getElementById('accountEmptyState').getClientRects().length>0,title:document.getElementById('accountEmptyStateTitle').textContent,
    handle:document.getElementById('accountHandle').textContent,eyebrow:document.getElementById('snapshotEyebrow').textContent,
    shown:['.summary-strip','#inventory','.secondary-grid','#exportData'].filter(selector=>document.querySelector(selector).getClientRects().length>0),selected:${asked("SELECT_ACCOUNT")},builds:${asked("GET_ACCOUNT_BUILD")}.length})`);
  assert(added.state === "identity-only" && added.empty && added.title === "No account backup has been built or loaded for this account." && added.handle === "AddedCitizen" && added.eyebrow === "ADDED ACCOUNT"
    && added.shown.length === 0 && JSON.stringify(added.selected) === JSON.stringify([{ accountKey: "rsi:addedcitizen" }]) && added.builds === 1, `An added account without a build was not shown as one: ${JSON.stringify(added)}`);

  // Build for it opens the Build chooser, and the build names the account shown; the stand-in declines it as another account's.
  await openBuildChooser();
  await evaluate("document.getElementById('buildAccountAction').click()");
  await waitFor("document.getElementById('messageDialog').open");
  const build = await evaluate(`({proposals:${asked("PROPOSE_BUILD")},title:document.getElementById('dialogTitle').textContent,message:document.getElementById('dialogMessage').textContent})`);
  await evaluate("document.getElementById('messageDialog').close();document.getElementById('closeOverlay').click()");
  assert(build.proposals.length === 1 && build.proposals[0].expectedAccountKey === "rsi:addedcitizen" && Array.isArray(build.proposals[0].plan?.selectedSections) && Object.keys(build.proposals[0]).length === 2
    && build.title === "Build request declined" && build.message.startsWith("The RSI account signed in now is not the account selected"), `A build did not name the account shown: ${JSON.stringify(build)}`);

  // Add new account: the signed-in account's identity alone, shown at once, never a build; the same account again is not listed twice.
  for (const [again, toast] of [[false, "NewCitizen is added."], [true, "NewCitizen is already added."]]) {
    await evaluate(`window.__bridge.discover={ok:true,added:${!again},account:${NEW}};document.getElementById('switchAccountButton').click();document.getElementById('addAccountCommand').click()`);
    await waitFor(`${asked("DISCOVER_CURRENT_ACCOUNT")}.length===${again ? 2 : 1} && document.getElementById('statusToast').textContent===${JSON.stringify(toast)}`);
  }
  const discovered = await evaluate(`({menu:${MENU},discover:${asked("DISCOVER_CURRENT_ACCOUNT")},proposals:${asked("PROPOSE_BUILD")}.length,handle:document.getElementById('accountHandle').textContent,state:document.body.dataset.accountState})`);
  assert(discovered.menu.items.length === 3 && JSON.stringify(discovered.menu.items[2]) === JSON.stringify(["NewCitizen", "true", null]) && JSON.stringify(discovered.discover) === JSON.stringify([null, null])
    && discovered.proposals === 1 && discovered.handle === "NewCitizen" && discovered.state === "identity-only", `Add new account did more than add the signed-in account: ${JSON.stringify(discovered)}`);

  // An account whose file was opened during this visit, which the extension did not list when the page connected:
  // choosing it under Switch Account names it to the extension, so it is the account shown after a refresh.
  await loadFixture("opened-account.json", named("OpenedCitizen", "Opened Pilot"));
  const selectedBefore = await evaluate(`${asked("SELECT_ACCOUNT")}.length`);
  await chooseAccount("Kept Pilot");
  await chooseAccount("Opened Pilot");
  await waitFor(`${asked("SELECT_ACCOUNT")}.length===${selectedBefore + 2}`);
  const chosen = await evaluate(`({handle:document.getElementById('accountHandle').textContent,selected:${asked("SELECT_ACCOUNT")}.slice(${selectedBefore})})`);
  assert(chosen.handle === "OpenedCitizen" && JSON.stringify(chosen.selected) === JSON.stringify([{ accountKey: "rsi:keptcitizen" }, { accountKey: "rsi:openedcitizen" }]),
    `Choosing an account opened during this visit did not name it to the extension: ${JSON.stringify(chosen)}`);
  await chooseAccount("NewCitizen");
  await waitFor(`${asked("SELECT_ACCOUNT")}.length===${selectedBefore + 3} && document.getElementById('accountHandle').textContent==='NewCitizen'`);

  // While a job runs, switching and adding wait, and the menu says why.
  await evaluate(`window.__bridge.push({status:'running',hasActiveJob:true,controlSessionBound:true,requiresRebind:false,partialAvailable:false,continuable:false,activeJob:{jobId:'job-accounts',runId:'run-accounts',status:'running',mode:'baseline',
    jobKind:'accountData',sectionIndex:1,sectionCount:14,completedSections:1,currentSection:'pledges',requestCount:3,httpRequestCount:3,httpRequestsTotal:20,activityLog:[],failure:null}})`);
  await waitFor("document.getElementById('overlaySummary').textContent==='COLLECTING'");
  await chooseAccount("Kept Pilot");
  await evaluate("document.getElementById('addAccountCommand').click()");
  await quiet();
  const busy = await evaluate(`({menu:${MENU},handle:document.getElementById('accountHandle').textContent,command:document.getElementById('addAccountCommand').getAttribute('aria-disabled'),discover:${asked("DISCOVER_CURRENT_ACCOUNT")}.length})`);
  await evaluate("document.getElementById('switchAccountButton').click()");
  assert(busy.menu.open && busy.handle === "NewCitizen" && busy.discover === 2 && busy.command === "true" && busy.menu.items.every(([, , disabled]) => disabled === "true")
    && busy.menu.status === "An Account Data job is running in Build Status. Finish or cancel it before switching or adding an account.", `An account could be switched or added while a job ran: ${JSON.stringify(busy)}`);

  // After Clear All the extension lists nothing, and the page that connects again starts with the example.
  await reloadDashboard();
  await connect("[]");
  await waitFor(`${asked("LIST_ACCOUNTS")}.length===1`);
  await quiet();
  const cleared = await evaluate(`({menu:${MENU},eyebrow:document.getElementById('snapshotEyebrow').textContent,builds:${asked("GET_ACCOUNT_BUILD")}.length})`);
  assert(cleared.menu.items.length === 0 && cleared.eyebrow === "EXAMPLE ACCOUNT" && cleared.builds === 0, `After Clear All the page did not start with the example: ${JSON.stringify(cleared)}`);
}
