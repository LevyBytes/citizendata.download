(() => {
  "use strict";

  const RSI_ORIGIN = "https://robertsspaceindustries.com/*";
  // RSI's status page, optional and only for diagnosis (PARSER_HARDENING.md §9.3): asked for with the account host.
  const RSI_STATUS_ORIGIN = "https://status.robertsspaceindustries.com/*";
  const HOSTED_DASHBOARD = "https://citizendata.download/";
  const byId = (id) => document.getElementById(id);
  const stateTitle = byId("stateTitle");
  const stateMessage = byId("stateMessage");
  const fileAccessState = byId("fileAccessState");
  const permissionState = byId("permissionState");
  const grantRsiAccess = byId("grantRsiAccess");
  const deleteIncomplete = byId("deleteIncomplete");
  const importBackup = byId("importBackup");
  const clearAllData = byId("clearAllData");
  const notice = byId("notice");
  const approvalView = byId("approvalView");
  const popupMain = byId("popupMain");
  const localList = byId("localList");
  const BuildHistory = globalThis.CitizenDataBuildHistory;
  const historyEnabled = byId("historyEnabled");
  const historyKeep = byId("historyKeep");
  const historyList = byId("historyList");
  const historyOffQuestion = byId("historyOffQuestion");
  const manifest = chrome.runtime.getManifest();
  let activeTabId = null;
  let deletableRunId = null;
  let clearDeadline = 0;
  let clearTimer = null;

  byId("versionLabel").textContent = `Version ${manifest.version_name ?? manifest.version}`;

  function request(type, fields = {}) {
    return chrome.runtime.sendMessage({ kind: "EXTENSION_UI_REQUEST", type, ...fields });
  }

  // A file URL path reads more naturally as the path the user sees in their file manager.
  function displayPath(pathname) {
    let decoded = pathname;
    try { decoded = decodeURIComponent(pathname); } catch { /* Keep the encoded form. */ }
    return /^\/[A-Za-z]:\//u.test(decoded) ? decoded.slice(1).replaceAll("/", "\\") : decoded;
  }

  function showApproval(pending) {
    approvalView.dataset.state = "asking";
    byId("approvalEyebrow").textContent = "LOCAL DASHBOARD";
    byId("approvalTitle").textContent = "Allow this local copy?";
    byId("approvalLead").textContent = "A Star Citizen Data Downloader dashboard opened from your own disk is asking to connect.";
    byId("approvalPath").textContent = displayPath(pending.path);
    byId("approvalNote").hidden = false;
    byId("approvalActions").hidden = false;
    approvalView.hidden = false;
    popupMain.dataset.mode = "approval";
  }

  function showApproved(pathname) {
    approvalView.dataset.state = "allowed";
    byId("approvalEyebrow").textContent = "CONNECTED";
    byId("approvalTitle").textContent = "Local dashboard allowed";
    byId("approvalLead").textContent = "This copy is connected. Return to its tab and choose Build.";
    byId("approvalPath").textContent = displayPath(pathname);
    byId("approvalNote").hidden = true;
    byId("approvalActions").hidden = true;
    approvalView.hidden = false;
    delete popupMain.dataset.mode;
  }

  // The path of the local dashboard the active tab shows, as the extension's own script in that tab reports it, or
  // null when the tab shows none. Only a copy opened from disk answers.
  async function activeLocalDashboardPath() {
    if (activeTabId === null) return null;
    try {
      const reply = await chrome.tabs.sendMessage(activeTabId, { kind: "LOCAL_DASHBOARD_PING" });
      return typeof reply?.dashboardPath === "string" ? reply.dashboardPath : null;
    } catch {
      return null;
    }
  }

  // The card stays after the approval: whenever the popup is opened on a tab that shows an allowed local copy, it
  // shows that copy as connected. It goes when the tab shows something else or the approval is removed.
  async function syncAllowedCard(local) {
    if (local?.pending || approvalView.dataset.state === "asking" && !approvalView.hidden) return;
    const shownPath = await activeLocalDashboardPath();
    const allowed = shownPath !== null && Array.isArray(local?.approved) && local.approved.some((entry) => entry.path === shownPath);
    if (allowed) showApproved(shownPath);
    else if (approvalView.dataset.state === "allowed") approvalView.hidden = true;
  }

  function renderLocalDashboards(approved) {
    localList.replaceChildren();
    byId("localListLabel").textContent = approved.length
      ? `Allowed local dashboard${approved.length === 1 ? "" : "s"}:`
      : "No local dashboard is allowed.";
    for (const entry of approved) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = displayPath(entry.path);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove approval for ${displayPath(entry.path)}`);
      remove.addEventListener("click", async () => {
        const response = await request("REVOKE_LOCAL_DASHBOARD", { path: entry.path }).catch(() => null);
        notice.textContent = response?.ok ? "Approval removed. That copy can no longer use the extension." : "The approval could not be removed.";
        await syncAllowedCard(await refreshLocalDashboards());
      });
      item.append(label, remove);
      localList.append(item);
    }
  }

  async function refreshLocalDashboards() {
    const response = await request("GET_LOCAL_DASHBOARDS", { tabId: activeTabId }).catch(() => null);
    renderLocalDashboards(Array.isArray(response?.approved) ? response.approved : []);
    return response;
  }

  // 1,536 bytes reads as "1.5 KB"; sizes here are of files and of what the browser stores.
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
    if (bytes < 1024) return `${bytes} bytes`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
  }

  function formatBuildDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Undated build" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function saveFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // A button that deletes on its second click, as "Clear all local extension data" does.
  function armedDelete(button, label, confirm) {
    let armedUntil = 0;
    let timer = null;
    const disarm = () => {
      armedUntil = 0;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      button.setAttribute("aria-pressed", "false");
      button.textContent = label;
    };
    button.setAttribute("aria-pressed", "false");
    button.textContent = label;
    button.addEventListener("click", async () => {
      if (Date.now() > armedUntil) {
        armedUntil = Date.now() + 10000;
        button.setAttribute("aria-pressed", "true");
        button.textContent = "Confirm";
        timer = setTimeout(disarm, 10000);
        return;
      }
      disarm();
      button.disabled = true;
      await confirm();
      button.disabled = false;
    });
  }

  // "2 earlier builds", "the Orgs JSON", or "1 earlier build and the Orgs JSON", with whether that names several things.
  function keptPhrase(copies) {
    const builds = copies.filter((copy) => !BuildHistory.isOrganizations(copy)).length;
    const rosters = copies.length - builds;
    const parts = [];
    if (builds) parts.push(`${builds} earlier build${builds === 1 ? "" : "s"}`);
    if (rosters) parts.push(rosters === 1 ? "the Orgs JSON" : `${rosters} Orgs JSON files`);
    return { text: parts.join(" and "), several: builds + rosters > 1 };
  }

  // Whether an Orgs JSON is among what the popup last listed as kept.
  let rostersKept = false;

  function renderBuildHistory(status) {
    const copies = Array.isArray(status?.copies) ? status.copies : [];
    rostersKept = copies.some((copy) => BuildHistory.isOrganizations(copy));
    byId("historyDeleteAll").textContent = rostersKept ? "Delete what is kept" : "Delete the kept builds";
    const builds = copies.filter((copy) => !BuildHistory.isOrganizations(copy));
    const settings = status?.settings ?? BuildHistory.DEFAULT_SETTINGS;
    const several = new Set(copies.map((copy) => copy.accountId)).size > 1;
    historyEnabled.checked = settings.enabled === true;
    historyKeep.disabled = settings.enabled !== true;
    if (document.activeElement !== historyKeep) historyKeep.value = String(settings.keep);
    if (settings.enabled) historyOffQuestion.hidden = true;
    byId("historySummary").textContent = copies.length === 0
      ? settings.enabled ? "No earlier build is kept yet. One is kept the next time a build differs from the one before." : "No earlier build is kept."
      : `${keptPhrase(copies).text.replace(/^t/u, "T")} kept, ${formatBytes(status.storedBytes)} stored.${settings.enabled && builds.length > settings.keep ? ` The oldest builds beyond ${settings.keep} are removed when the next build is kept.` : ""}`;
    byId("historyRecoveryNote").hidden = copies.length === 0;
    const images = status?.images ?? { count: 0, bytes: 0 };
    byId("imagesSummary").textContent = images.count === 0
      ? settings.enabled ? "No image is kept yet. They are kept when the dashboard downloads them." : "No image is kept."
      : `${images.count.toLocaleString("en-US")} image${images.count === 1 ? "" : "s"} kept, ${formatBytes(images.bytes)}.${settings.enabled ? "" : " Build history is off, so no new image is kept."} The dashboard saves them as its Images ZIP.`;
    byId("imagesDelete").hidden = images.count === 0;
    const problems = [];
    if (status?.problem) problems.push(`The build of ${formatBuildDate(status.problem.exportedAt)} could not be kept when it was replaced. The file saved for it at the time is unaffected.`);
    if (status?.organizationsProblem) problems.push(`The Orgs JSON could not be kept after the build of ${formatBuildDate(status.organizationsProblem.exportedAt)}. The files the dashboard saved are unaffected.`);
    byId("historyProblem").hidden = problems.length === 0;
    byId("historyProblem").textContent = problems.join(" ");
    historyList.replaceChildren();
    // The Orgs JSON is listed first, then the earlier builds, newest first.
    for (const copy of [...copies.filter((kept) => BuildHistory.isOrganizations(kept)), ...builds]) {
      const item = document.createElement("li");
      const when = document.createElement("span");
      when.className = "history-when";
      const rosters = BuildHistory.isOrganizations(copy);
      const date = formatBuildDate(copy.exportedAt);
      // What the buttons and notices call this copy.
      const named = rosters ? `Orgs JSON${several && copy.handle ? ` of ${copy.handle}` : ""}` : `build of ${date}`;
      when.append(rosters ? "Orgs JSON" : date);
      const detail = document.createElement("small");
      detail.textContent = `${several && copy.handle ? `${copy.handle}, ` : ""}${rosters ? `updated ${date}, ` : ""}${formatBytes(copy.fileBytes)} file, ${formatBytes(copy.storedBytes)} stored`;
      when.append(detail);
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "Save";
      save.setAttribute("aria-label", `Save the ${named} as a file`);
      save.addEventListener("click", async () => {
        save.disabled = true;
        try {
          const response = await request("GET_BUILD_HISTORY_COPY", { historyId: copy.historyId });
          if (!response?.ok) throw new Error("The kept copy could not be read.");
          saveFile(new Blob([await BuildHistory.unpack(response.copy.gzipBase64)], { type: "application/json" }), response.copy.fileName);
          notice.textContent = `Saved ${response.copy.fileName}.`;
        } catch {
          notice.textContent = `The kept ${rosters ? "Orgs JSON" : "build"} could not be saved as a file.`;
        }
        save.disabled = false;
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.setAttribute("aria-label", `Delete the kept ${named}`);
      armedDelete(remove, "Delete", async () => {
        const response = await request("DELETE_BUILD_HISTORY_COPY", { historyId: copy.historyId }).catch(() => null);
        notice.textContent = response?.ok ? `The kept ${named} was deleted.` : `The kept ${rosters ? "Orgs JSON" : "build"} could not be deleted.`;
        await refreshBuildHistory();
      });
      item.append(when, save, remove);
      historyList.append(item);
    }
  }

  async function refreshBuildHistory() {
    const status = await request("GET_BUILD_HISTORY").catch(() => null);
    renderBuildHistory(status?.ok ? status : null);
    return status;
  }

  // States how much the extension stores. The manifest's unlimitedStorage permission exempts that storage from
  // Chrome's automatic clearing, so the line says so. navigator.storage.persisted() is not consulted: Chrome 158
  // answers false for the extension with the permission declared.
  async function refreshStorageState() {
    const storageState = byId("storageState");
    try {
      const estimate = await navigator.storage.estimate();
      const used = Number.isFinite(estimate?.usage) ? `${formatBytes(estimate.usage)} is stored in this browser. ` : "";
      storageState.textContent = `${used}Chrome does not clear it when the disk runs low. Every build is also saved as a file on your device.`;
    } catch {
      storageState.textContent = "The storage state could not be read.";
    }
  }

  async function refresh() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    activeTabId = Number.isSafeInteger(tab?.id) ? tab.id : null;
    const [response, hasRsiAccess, recovery, hasFileAccess, local] = await Promise.all([
      request("GET_STATUS"),
      chrome.permissions.contains({ origins: [RSI_ORIGIN] }),
      request("LIST_INCOMPLETE_RUNS"),
      new Promise((resolve) => chrome.extension.isAllowedFileSchemeAccess(resolve)),
      refreshLocalDashboards(),
      refreshBuildHistory(),
      refreshStorageState()
    ]);
    const ready = response?.capabilities?.accountCollection === true;
    stateTitle.textContent = !ready ? "Extension needs attention" : hasRsiAccess ? "Ready for account backup" : "RSI access is turned off";
    stateMessage.textContent = !ready
      ? response?.capabilities?.reason ?? "The collection service could not be read."
      : hasRsiAccess
        ? "Open the dashboard and choose Build. Your account data stays on this device."
        : "Allow RSI access under Recovery and permissions before building a backup.";
    permissionState.textContent = hasRsiAccess ? "RSI read access is allowed." : "RSI read access is turned off in Chrome. Star Citizen Data Downloader cannot build a backup without it.";
    grantRsiAccess.hidden = hasRsiAccess;
    fileAccessState.textContent = hasFileAccess
      ? "A copy of the dashboard downloaded to your disk can connect after you allow it here. File access is on."
      : "A copy of the dashboard downloaded to your disk needs “Allow access to file URLs” turned on in this extension's Chrome settings.";
    byId("openExtensionDetails").hidden = hasFileAccess;
    deletableRunId = recovery?.runs?.[0]?.runId ?? null;
    deleteIncomplete.disabled = !deletableRunId;
    deleteIncomplete.textContent = deletableRunId ? "Delete oldest incomplete run" : "No incomplete run to delete";
    if (local?.pending && approvalView.dataset.state !== "allowed") showApproval(local.pending);
    else await syncAllowedCard(local);
  }

  function disarmClear() {
    clearDeadline = 0;
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearTimer = null;
    clearAllData.setAttribute("aria-pressed", "false");
    clearAllData.textContent = "Clear all local extension data";
  }

  byId("openDashboard").addEventListener("click", () => {
    void chrome.tabs.create({ url: HOSTED_DASHBOARD });
  });

  byId("approveLocal").addEventListener("click", async () => {
    byId("approveLocal").disabled = true;
    const response = await request("APPROVE_LOCAL_DASHBOARD", { tabId: activeTabId }).catch(() => null);
    byId("approveLocal").disabled = false;
    if (!response?.ok) {
      approvalView.hidden = true;
      delete popupMain.dataset.mode;
      notice.textContent = "That tab no longer shows the local dashboard. Reload it and try again.";
      return;
    }
    showApproved(response.path);
    await refreshLocalDashboards();
  });

  byId("dismissLocal").addEventListener("click", () => {
    approvalView.hidden = true;
    delete popupMain.dataset.mode;
    notice.textContent = "Not allowed. The local dashboard stays disconnected.";
  });

  grantRsiAccess.addEventListener("click", async () => {
    const granted = await chrome.permissions.request({ origins: [RSI_ORIGIN, RSI_STATUS_ORIGIN] }).catch(() => false);
    notice.textContent = granted ? "RSI read access allowed." : "RSI read access was not allowed.";
    await refresh();
  });

  byId("openExtensionDetails").addEventListener("click", () => {
    void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });

  byId("exportBackup").addEventListener("click", async () => {
    const response = await request("EXPORT_BACKUP");
    if (!response?.ok) {
      notice.textContent = "The recovery backup could not be created.";
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(response.backup, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `citizendata-recovery-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice.textContent = "Recovery backup saved.";
  });

  importBackup.addEventListener("change", async () => {
    const file = importBackup.files?.[0];
    importBackup.value = "";
    if (!file || file.size > 50 * 1024 * 1024) {
      notice.textContent = "Choose a Star Citizen Data Downloader recovery JSON file no larger than 50 MB.";
      return;
    }
    try {
      const backup = JSON.parse(await file.text());
      const response = await request("IMPORT_BACKUP", { backup });
      notice.textContent = response?.ok ? "Recovery backup restored." : "The recovery backup was rejected.";
      if (response?.ok) await refresh();
    } catch {
      notice.textContent = "The selected file is not valid recovery JSON.";
    }
  });

  historyEnabled.addEventListener("change", async () => {
    const enabled = historyEnabled.checked;
    const status = await request("SET_BUILD_HISTORY", { enabled }).catch(() => null);
    if (!status?.ok) {
      notice.textContent = "The build history setting could not be saved.";
      await refreshBuildHistory();
      return;
    }
    renderBuildHistory(status);
    const kept = status.copies.length;
    const phrase = keptPhrase(status.copies);
    // Turning the history off deletes nothing; the user is asked what to do with what is already kept.
    historyOffQuestion.hidden = enabled || kept === 0;
    byId("historyOffText").textContent = `Build history is off. ${phrase.text.replace(/^t/u, "T")} ${phrase.several ? "are" : "is"} still kept. Delete ${phrase.several ? "them" : "it"}?`;
    notice.textContent = enabled ? "Build history is on." : kept === 0 ? "Build history is off. Only the latest build is kept." : "Build history is off.";
  });

  historyKeep.addEventListener("change", async () => {
    const keep = Number(historyKeep.value);
    if (!/^[0-9]+$/u.test(historyKeep.value.trim()) || !BuildHistory.isKeep(keep)) {
      notice.textContent = `Enter a whole number from ${BuildHistory.MINIMUM_KEEP} to ${BuildHistory.MAXIMUM_KEEP}.`;
      historyKeep.blur();
      await refreshBuildHistory();
      return;
    }
    const status = await request("SET_BUILD_HISTORY", { keep }).catch(() => null);
    notice.textContent = status?.ok ? `Keeping ${keep} earlier build${keep === 1 ? "" : "s"}.` : "The number to keep could not be saved.";
    historyKeep.blur();
    await refreshBuildHistory();
  });

  armedDelete(byId("imagesDelete"), "Delete the kept images", async () => {
    const status = await request("CLEAR_KEPT_IMAGES").catch(() => null);
    notice.textContent = status?.ok ? "The kept images were deleted. Your Images ZIP files are untouched." : "The kept images could not be deleted.";
    await refreshBuildHistory();
  });

  byId("historyDeleteAll").addEventListener("click", async () => {
    const status = await request("CLEAR_BUILD_HISTORY").catch(() => null);
    historyOffQuestion.hidden = true;
    const rosters = rostersKept;
    const imagesLeft = (status?.images?.count ?? 0) > 0;
    const deleted = rosters ? imagesLeft ? "Everything kept here except the images was" : "Everything kept here was" : "The kept builds were";
    notice.textContent = status?.ok ? `${deleted} deleted. The latest build is still kept.${imagesLeft ? " The kept images have their own delete button." : ""}` : `${rosters ? "What is kept" : "The kept builds"} could not be deleted.`;
    await refreshBuildHistory();
  });

  byId("historyKeepAll").addEventListener("click", () => {
    historyOffQuestion.hidden = true;
    notice.textContent = `${rostersKept ? "What is kept was" : "The kept builds were"} left in place. You can still save or delete each one.`;
  });

  deleteIncomplete.addEventListener("click", async () => {
    if (!deletableRunId) return;
    const response = await request("DELETE_INCOMPLETE_RUN", { runId: deletableRunId });
    notice.textContent = response?.ok ? "The incomplete run was deleted." : "The incomplete run was preserved.";
    await refresh();
  });

  clearAllData.addEventListener("click", async () => {
    const now = Date.now();
    if (now > clearDeadline) {
      disarmClear();
      clearDeadline = now + 10000;
      clearAllData.setAttribute("aria-pressed", "true");
      clearAllData.textContent = "Confirm clear all local data";
      notice.textContent = "Click the confirmation button again within 10 seconds to delete all Star Citizen Data Downloader jobs, snapshots, kept builds, receipts, recovery state, and local dashboard approvals.";
      clearTimer = setTimeout(() => {
        disarmClear();
        notice.textContent = "Clear cancelled; local extension data was preserved.";
      }, 10000);
      return;
    }
    clearAllData.disabled = true;
    const response = await request("CLEAR_ALL").catch(() => null);
    disarmClear();
    clearAllData.disabled = false;
    notice.textContent = response?.ok ? "All local Star Citizen Data Downloader extension data was cleared." : "Local extension data was preserved because clearing failed.";
    if (response?.ok) await refresh();
  });

  refresh().catch(() => {
    stateMessage.textContent = "The extension state could not be read.";
    permissionState.textContent = "Unavailable";
  });
})();
