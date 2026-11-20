(function initializeCitizenDataAdapterRegistry(root) {
  "use strict";

  const catalog = root.CitizenDataAdapterCatalog;
  const runtime = root.CitizenDataLiveRuntime;
  const candidateAdapters = Object.freeze([...(catalog?.adapters ?? [])]);
  const adapters = Object.freeze(candidateAdapters.map((descriptor) => runtime.createAdapter(descriptor)));
  root.CitizenDataAdapterRegistry = Object.freeze({
    adapters,
    candidateAdapters,
    offlineMediaPackage: true,
    organizationRosterCollection: true,
    parserVersions: Object.freeze(Object.fromEntries(candidateAdapters.map((adapter) => [adapter.id, adapter.version]))),
    getCandidateAdapter: (section) => catalog?.get?.(section) ?? null,
    getAdapter: (section) => {
      const fixed = adapters.find((adapter) => adapter.id === section);
      if (fixed) return fixed;
      const dynamic = catalog?.get?.(section) ?? null;
      return dynamic ? runtime.createAdapter(dynamic) : null;
    },
    reason: "Account collection is ready from the CitizenData dashboard."
  });
})(globalThis);
