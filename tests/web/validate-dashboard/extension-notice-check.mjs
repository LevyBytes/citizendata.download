import { assert, buildChooserState, extensionMessage, openBuildChooser } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

// Runs before any extension bridge exists in the page.
export async function checkExtensionNotice() {
  const localCopy = await evaluate("location.protocol==='file:'");
  await openBuildChooser();
  const missing = await evaluate(buildChooserState);
  assert(missing.notice && missing.title === "Star Citizen Data Downloader extension not detected" && missing.link
    && missing.href === "https://github.com/LevyBytes/citizendata.download/tree/main/extension"
    && missing.target === "_blank" && missing.rel === "noopener noreferrer" && missing.linkTitle === "Get the Star Citizen Data Downloader extension."
    && missing.linkDetail === "Google Chrome Extension Marketplace approval pending, submitted 11/22/2026. Use the GitHub-hosted extension in developer mode for now."
    && !missing.account && missing.images && missing.imagesDisabled && missing.state === "Before you can build" && missing.line === "Data needs the Star Citizen Data Downloader extension. Images need an open account "
      + "document." && missing.logHidden && missing.controlsHidden,
  `Build chooser without an extension did not replace the account choice with the install notice and link: ${JSON.stringify(missing)}`);
  assert(missing.detail.includes("cannot read an RSI account on its own") && missing.detail.includes("Allow access to file URLs") === localCopy, "The install notice must explain the local-copy steps only on a file: dashboard.");
  assert(missing.detail.includes("Once the extension is on, reload this page"), `The install notice must say to reload this page once the extension is on: ${missing.detail}`);

  if (localCopy) {
    await evaluate(extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:2,type:'LOCAL_APPROVAL_REQUIRED'}"));
    await waitFor("document.getElementById('extensionNoticeTitle').textContent==='Allow this local copy'");
    const approval = await evaluate(buildChooserState);
    assert(
      approval.notice && !approval.link && !approval.account && approval.images && approval.detail.includes("Allow this local dashboard"),
      `An installed extension awaiting approval still offered the store link or the account choice: ${JSON.stringify(approval)}`
    );
  }
  await evaluate("document.querySelector('#closeOverlay').click()");

  // An extension that speaks another bridge protocol version is reported; its release number alone is never compared.
  await evaluate(extensionMessage("{channel:'citizendata.dashboard.v1',protocolVersion:1,type:'BRIDGE_READY',requestId:crypto.randomUUID(),bridgeSessionId:crypto.randomUUID(),nonce:'b'.repeat(40),payload:{extensionVersion:'9.0.0',"
    + "capabilities:{buildJson:true}}}"));
  await waitFor("document.querySelector('#overlaySummary').textContent==='UPDATE REQUIRED' && document.querySelector('#messageDialog').open");
  assert(await evaluate("document.querySelector('#overlayState').textContent==='Extension and dashboard do not match' && "
    + "document.querySelector('#dialogTitle').textContent==='Star Citizen Data Downloader update required' && document.querySelector('#dialogMessage')"
    + ".textContent.includes('9.0.0') && !document.querySelector('#buildButton').disabled && document.querySelector('#collectionControls').hidden"), "A bridge protocol mismatch was not identified while retaining access to the Build chooser.");
  await evaluate("document.querySelector('#messageDialog').close()");
  await openBuildChooser();
  const outdated = await evaluate(buildChooserState);
  assert(
    outdated.notice && outdated.title === "Star Citizen Data Downloader extension needs an update" && outdated.link
      && outdated.href === "https://github.com/LevyBytes/citizendata.download/tree/main/extension"
      && outdated.linkTitle === "Update the Star Citizen Data Downloader extension."
      && outdated.linkDetail === "Google Chrome Extension Marketplace approval pending, submitted 11/22/2026. Use the GitHub-hosted extension in developer mode for now."
      && !outdated.account,
    `A protocol mismatch still offered an account build or omitted the update link: ${JSON.stringify(outdated)}`
  );
  await evaluate("document.querySelector('#closeOverlay').click()");
}
