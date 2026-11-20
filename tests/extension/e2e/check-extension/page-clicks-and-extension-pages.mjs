import { chrome, extensionOrigin } from "./browser-pages-and-account-in-use.mjs";
import { dashboardPath } from "./dashboard-copy-without-image-spacing.mjs";

export function clickExpression(page, expression) {
  return page.send("Runtime.evaluate", { expression: `${expression}.click()`, userGesture: true });
}

export function click(page, id) {
  return clickExpression(page, `document.getElementById(${JSON.stringify(id)})`);
}

// The popup opened as a tab. It asks Chrome for the active tab and would find itself, so the answer is pinned to the dashboard tab.
export async function openExtensionPage(activeTabId = null) {
  const page = await chrome.newPage("about:blank");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 330, height: 600, deviceScaleFactor: 2, mobile: false });
  if (activeTabId !== null) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `if (globalThis.chrome?.tabs) chrome.tabs.query = async () => [{ id: ${activeTabId} }];` });
  await page.navigate(`${extensionOrigin}/popup/popup.html`);
  await page.waitFor(
    "document.readyState === 'complete' && document.getElementById('versionLabel').textContent.startsWith('Version') && /^(Ready|RSI|Extension)/u.test(document.getElementById('stateTitle').textContent)",
    15000, "the popup to finish loading"
  );
  return page;
}

// The identifier of the tab that shows the local dashboard now. Scenarios open a new dashboard tab as they go, so
// the identifier the popup page was given at first goes stale.
export async function localDashboardTabId() {
  const probe = await openExtensionPage();
  try {
    return await probe.evaluate(`(async () => {
      for (const tab of await chrome.tabs.query({})) {
        try {
          const reply = await chrome.tabs.sendMessage(tab.id, { kind: "LOCAL_DASHBOARD_PING" });
          if (reply?.dashboardPath === ${JSON.stringify(dashboardPath)}) return tab.id;
        } catch { /* This tab shows no local dashboard. */ }
      }
      return null;
    })()`);
  } finally {
    await probe.close();
  }
}
