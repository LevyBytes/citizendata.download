(() => {
  "use strict";

  const Protocol = globalThis.CitizenDataProtocol;
  if (!Protocol || window !== window.top || !Protocol.isDashboardLocation(location.origin, location.pathname)) return;

  const bridgeSessionId = crypto.randomUUID();
  const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const dashboardOrigin = Protocol.canonicalDashboardOrigin(location.origin);
  const localCopy = Protocol.isLocalDashboardOrigin(location.origin);
  const seenRequestIds = new Set();
  const maximumRememberedRequests = 25000;
  let stopped = false;
  let bridgeStarted = false;
  let extensionListenerRegistered = false;

  function activeRuntime() {
    try {
      const runtime = globalThis.chrome?.runtime;
      if (!runtime || typeof runtime.getManifest !== "function") return null;
      runtime.getManifest();
      return runtime;
    } catch {
      return null;
    }
  }

  function stopInvalidatedBridge() {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("citizendata-dashboard-ready", postReady);
    window.removeEventListener("citizendata-dashboard-ready", postApprovalRequired);
    window.removeEventListener("message", handleWindowMessage);
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    const runtime = activeRuntime();
    if (runtime && extensionListenerRegistered) {
      try { runtime.onMessage.removeListener(handleExtensionMessage); } catch { /* After the extension is reloaded or removed, its old runtime throws here and there is no listener left to remove. */ }
    }
    extensionListenerRegistered = false;
  }

  function rememberRequest(requestId) {
    if (seenRequestIds.has(requestId)) return "replayed";
    if (seenRequestIds.size >= maximumRememberedRequests) return "limit";
    seenRequestIds.add(requestId);
    return "accepted";
  }

  function post(type, requestId, payload) {
    if (stopped || Protocol.containsSecretField(payload)) return;
    window.postMessage(Protocol.makeEnvelope({ type, requestId, bridgeSessionId, nonce, payload }), Protocol.postMessageTarget(location.origin));
  }

  function postReady() {
    const runtime = activeRuntime();
    if (!runtime) {
      stopInvalidatedBridge();
      return false;
    }
    post(Protocol.EVENT_TYPES.BRIDGE_READY, crypto.randomUUID(), {
      extensionVersion: runtime.getManifest().version,
      capabilities: Protocol.publicCapabilities({
        adapters: [{}],
        organizationRosterCollection: true,
        offlineMediaPackage: true
      })
    });
    return true;
  }

  // Tells an unapproved local copy only that the extension is present and waiting. It carries no session and grants nothing.
  function postApprovalRequired() {
    if (stopped || bridgeStarted) return;
    window.postMessage({ channel: Protocol.CHANNEL, protocolVersion: Protocol.VERSION, type: Protocol.EVENT_TYPES.LOCAL_APPROVAL_REQUIRED }, Protocol.postMessageTarget(location.origin));
  }

  function postExtensionUnavailable(requestId) {
    post(Protocol.EVENT_TYPES.RESPONSE, requestId, {
      ok: false,
      code: "EXTENSION_UNAVAILABLE",
      message: "The CitizenData extension is unavailable or was reloaded."
    });
    if (!activeRuntime()) stopInvalidatedBridge();
  }

  function handleWindowMessage(event) {
    if (stopped || event.source !== window || !Protocol.messageOriginMatches(event.origin, location.origin)) return;
    const checked = Protocol.validatePageEnvelope(event.data, { bridgeSessionId, nonce });
    if (!checked.ok) return;

    const request = checked.value;
    const requestState = rememberRequest(request.requestId);
    if (requestState !== "accepted") {
      post(Protocol.EVENT_TYPES.RESPONSE, request.requestId, {
        ok: false,
        code: requestState === "replayed" ? "REPLAYED_REQUEST" : "BRIDGE_REQUEST_LIMIT",
        message: requestState === "replayed"
          ? "This dashboard request ID was already used in the current bridge session."
          : "This dashboard bridge session reached its bounded request limit. Reload the dashboard before continuing."
      });
      return;
    }
    const runtime = activeRuntime();
    if (!runtime || typeof runtime.sendMessage !== "function") {
      postExtensionUnavailable(request.requestId);
      return;
    }
    let pendingResponse;
    try {
      pendingResponse = runtime.sendMessage({
        kind: "DASHBOARD_REQUEST",
        dashboardOrigin,
        dashboardPath: location.pathname,
        envelope: request
      });
    } catch {
      postExtensionUnavailable(request.requestId);
      return;
    }
    Promise.resolve(pendingResponse).then((response) => {
      if (Protocol.containsSecretField(response)) {
        post(Protocol.EVENT_TYPES.RESPONSE, request.requestId, {
          ok: false,
          code: "UNSAFE_EXTENSION_RESPONSE",
          message: "The extension rejected an unsafe internal response."
        });
        return;
      }
      post(Protocol.EVENT_TYPES.RESPONSE, request.requestId, response);
    }).catch(() => {
      postExtensionUnavailable(request.requestId);
    });
  }

  function handleExtensionMessage(message, _sender, sendResponse) {
    if (!message) return;
    // Lets the extension confirm that this tab still shows the local dashboard it is being asked to approve.
    if (message.kind === "LOCAL_DASHBOARD_PING") {
      if (localCopy) sendResponse({ dashboardPath: location.pathname });
      return;
    }
    if (message.kind === "LOCAL_DASHBOARD_APPROVED") {
      if (localCopy && !bridgeStarted) startBridge();
      return;
    }
    if (!bridgeStarted || message.kind !== "DASHBOARD_EVENT" || Protocol.containsSecretField(message.payload)) return;
    post(message.payload?.result ? Protocol.EVENT_TYPES.RESULT : Protocol.EVENT_TYPES.STATUS, crypto.randomUUID(), message.payload);
  }

  function handlePageHide() {
    stopped = true;
  }

  function handlePageShow(event) {
    if (!event.persisted) return;
    stopped = false;
    if (bridgeStarted) postReady();
    else postApprovalRequired();
  }

  function registerExtensionListener() {
    const runtime = activeRuntime();
    if (!runtime?.onMessage || typeof runtime.onMessage.addListener !== "function") {
      stopInvalidatedBridge();
      return false;
    }
    try {
      runtime.onMessage.addListener(handleExtensionMessage);
      extensionListenerRegistered = true;
      return true;
    } catch {
      stopInvalidatedBridge();
      return false;
    }
  }

  // From here on the page can send requests. The hosted dashboard starts at once; a local copy starts only after approval.
  function startBridge() {
    if (bridgeStarted || stopped) return;
    bridgeStarted = true;
    window.removeEventListener("citizendata-dashboard-ready", postApprovalRequired);
    if (!postReady()) return;
    window.addEventListener("citizendata-dashboard-ready", postReady);
    window.addEventListener("message", handleWindowMessage);
  }

  async function startLocalCopy() {
    const runtime = activeRuntime();
    if (!runtime || typeof runtime.sendMessage !== "function") return;
    let response;
    try {
      response = await runtime.sendMessage({ kind: "LOCAL_DASHBOARD_HELLO", dashboardPath: location.pathname });
    } catch {
      return;
    }
    if (response?.ok !== true) return;
    if (response.approved === true) {
      startBridge();
      return;
    }
    postApprovalRequired();
    window.addEventListener("citizendata-dashboard-ready", postApprovalRequired);
  }

  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  if (!registerExtensionListener()) return;
  if (localCopy) void startLocalCopy();
  else startBridge();
})();
