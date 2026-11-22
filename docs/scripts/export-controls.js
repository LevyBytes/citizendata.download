(() => {
  "use strict";

  function bind({ getSnapshot, onDownloadStarted, onDownloadFailed }) {
    const byId = (id) => document.getElementById(id);
    const dialog = byId("exportDialog");
    const form = byId("exportForm");
    const opener = byId("exportButton");
    const fleetview = byId("fleetviewExportButton");
    const preset = byId("exportPreset");
    const organization = byId("exportOrganizationSid");
    const download = byId("exportDownload");
    const summary = byId("exportSummary");
    const messages = byId("exportMessages");
    const pendingUrls = new Map();

    function selection(snapshot) {
      const inventory = preset.value === "inventory";
      const referrals = preset.value === "referrals";
      return {
        preset: preset.value,
        inventoryScope: inventory ? byId("exportInventoryScope").value : "both",
        format: inventory ? byId("exportFormat").value : "native",
        referralLadder: referrals ? byId("exportReferralLadder").value : "both",
        referralKind: referrals ? byId("exportReferralKind").value : "both",
        organizationSid: organization.value,
        sections: [...form.querySelectorAll('input[name="exportSection"]:checked')].map((input) => input.value),
        example: snapshot.example === true,
        sourceFileName: snapshot.sourceFileName
      };
    }

    function renderMessages(errors = [], warnings = []) {
      messages.replaceChildren();
      for (const [items, className] of [[errors, "export-error"], [warnings, "export-warning"]]) {
        for (const message of items) {
          const line = document.createElement("p");
          line.className = className;
          line.textContent = typeof message === "string" ? message : message?.message ?? "Export could not be completed.";
          messages.append(line);
        }
      }
      messages.hidden = !messages.childElementCount;
    }

    function refresh() {
      byId("exportInventoryOptions").hidden = preset.value !== "inventory";
      byId("exportReferralOptions").hidden = preset.value !== "referrals";
      byId("exportCustomOptions").hidden = preset.value !== "custom";
      const includeOrganization = preset.value === "organization-members" || (preset.value === "custom" && form.querySelector('input[name="exportSection"][value="organization-members"]').checked);
      byId("exportOrganizationOptions").hidden = !includeOrganization;
      const snapshot = getSnapshot();
      try {
        if (includeOrganization) {
          const previous = organization.value;
          const rosters = globalThis.CitizenDataExports.listOrganizationRosters(snapshot.document);
          organization.replaceChildren();
          for (const roster of rosters) {
            const option = document.createElement("option");
            option.value = roster.sid;
            option.textContent = roster.name === roster.sid ? roster.sid : `${roster.name} (${roster.sid})`;
            organization.append(option);
          }
          organization.disabled = rosters.length === 0;
          if (!rosters.length) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No roster data in this file";
            organization.append(option);
          } else if (rosters.some(roster => roster.sid === previous)) {
            organization.value = previous;
          }
        }
        const chosen = selection(snapshot);
        const result = globalThis.CitizenDataExports.inspectExport(snapshot.document, chosen);
        const errors = result.errors ?? [];
        summary.textContent = `${result.recordCount} record${result.recordCount === 1 ? "" : "s"} · ${snapshot.sourceName}`;
        download.disabled = !result.canExport || errors.length > 0;
        renderMessages(errors, (result.warnings ?? []).filter(message => !(snapshot.example && message === "Example data")));
        return { snapshot, chosen, result };
      } catch (error) {
        summary.textContent = snapshot.sourceName;
        download.disabled = true;
        renderMessages([error.message ?? "Export tools are unavailable. Reload this page."]);
        return null;
      }
    }

    function releaseUrl(url) {
      window.clearTimeout(pendingUrls.get(url));
      pendingUrls.delete(url);
      URL.revokeObjectURL(url);
    }

    function startDownload(inspection, reportFailure = false) {
      if (!inspection?.result.canExport) {
        if (reportFailure) onDownloadFailed?.(inspection?.result.errors?.[0] ?? "The FleetView export is unavailable.");
        return;
      }
      let url;
      let anchor;
      try {
        const output = globalThis.CitizenDataExports.createExport(inspection.snapshot.document, inspection.chosen);
        const blob = new Blob([output.text], { type: output.mimeType });
        url = URL.createObjectURL(blob);
        anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = output.fileName;
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        // Keep the object alive while Chrome accepts the download, then release it.
        pendingUrls.set(url, window.setTimeout(() => releaseUrl(url), 30000));
        onDownloadStarted?.(output.fileName, output.warnings ?? []);
      } catch (error) {
        if (url) releaseUrl(url);
        const message = error.message ?? "The JSON download could not be started.";
        if (reportFailure) onDownloadFailed?.(message);
        else renderMessages([message]);
      } finally {
        anchor?.remove();
      }
    }

    function downloadJson(event) {
      event.preventDefault();
      const inspection = refresh();
      if (!inspection?.result.canExport || download.disabled) return;
      startDownload(inspection);
    }

    function downloadFleetview() {
      const snapshot = getSnapshot();
      const chosen = {
        preset: "inventory", inventoryScope: "hangar", format: "hangar-link",
        example: snapshot.example === true, sourceFileName: snapshot.sourceFileName
      };
      const result = globalThis.CitizenDataExports.inspectExport(snapshot.document, chosen);
      startDownload({ snapshot, chosen, result }, true);
    }

    opener.addEventListener("click", () => {
      refresh();
      dialog.showModal();
      preset.focus({ preventScroll: true });
    });
    fleetview.addEventListener("click", downloadFleetview);
    byId("exportClose").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => opener.focus({ preventScroll: true }));
    form.addEventListener("change", refresh);
    form.addEventListener("submit", downloadJson);
    window.addEventListener("pagehide", () => {
      for (const url of pendingUrls.keys()) releaseUrl(url);
    });
  }

  globalThis.CitizenDataExportControls = Object.freeze({ bind });
})();
