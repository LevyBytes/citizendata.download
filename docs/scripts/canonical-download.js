(function initializeCitizenDataCanonicalDownload(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataCanonicalDownload = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataCanonicalDownload(root) {
  "use strict";

  function safeStem(value) {
    const stem = String(value ?? "account")
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 64);
    return stem || "account";
  }

  function canonicalFileName(accountDocument) {
    const handle = accountDocument?.account?.handle ?? "account";
    const timestamp = root.CitizenDataFileTimestamp?.format?.(accountDocument?.exportedAt) ?? "undated-000000-000Z";
    return `citizendata-${safeStem(handle)}-${timestamp}.json`;
  }

  function organizationFileName(organizationDocument) {
    const handle = organizationDocument?.account?.handle ?? "account";
    const timestamp = root.CitizenDataFileTimestamp?.format?.(organizationDocument?.exportedAt) ?? "undated-000000-000Z";
    return `citizendata-organizations-${safeStem(handle)}-${timestamp}.json`;
  }

  function serialize(accountDocument) {
    return `${JSON.stringify(accountDocument, null, 2)}\n`;
  }

  function downloadDocument(value, fileName, options = {}) {
    const documentValue = options.documentValue ?? root.document;
    const urlApi = options.urlApi ?? root.URL;
    const BlobValue = options.BlobValue ?? root.Blob;
    const schedule = options.schedule ?? root.setTimeout;
    if (!documentValue?.body || typeof documentValue.createElement !== "function" || typeof urlApi?.createObjectURL !== "function" || typeof BlobValue !== "function") {
      throw new Error("The browser download APIs are unavailable.");
    }
    const text = serialize(value);
    const url = urlApi.createObjectURL(new BlobValue([text], { type: "application/json" }));
    const anchor = documentValue.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.hidden = true;
    documentValue.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      schedule(() => urlApi.revokeObjectURL(url), 30000);
    }
    return Object.freeze({ fileName, byteLength: new TextEncoder().encode(text).byteLength });
  }


  function download(accountDocument, options = {}) {
    return downloadDocument(accountDocument, canonicalFileName(accountDocument), options);
  }

  function downloadOrganizations(organizationDocument, options = {}) {
    return downloadDocument(organizationDocument, organizationFileName(organizationDocument), options);
  }

  return Object.freeze({ canonicalFileName, download, downloadOrganizations, organizationFileName, safeStem, serialize });
});
