(() => {
  "use strict";

  const { DEFAULT_LIMITS: JSON_LIMITS, parseBoundedJson } = globalThis.CitizenDataSafeJson;
  const Model = globalThis.CitizenDataDashboardModel;
  const PAGE_SIZE = 25;
  const INVENTORY_PAGE_SIZE = 100;
  const BRIDGE_CHANNEL = "citizendata.dashboard.v1";
  // The extension's Protocol.VERSION; 2 since terminal `partial` and the bounded status fields.
  const PROTOCOL_VERSION = 2;
  // Stamped into the documents this page itself assembles. Extension compatibility is decided by PROTOCOL_VERSION.
  const DASHBOARD_VERSION = "0.42.2";
  // Canonical consumer install and update page in the Chrome Web Store.
  // The extension's source is composed before it can be loaded unpacked, so the link is to the README's steps.
  const EXTENSION_INSTALL_URL = "https://chromewebstore.google.com/detail/citizen-data-downloader/ehklbfcpnadaeodflibpihhgimmmhjpd";
  const HERO_NAMES = Object.freeze(["radar", "holo-render", "staff-pick", "customize"]);
  const state = {
    savedOrganizationHashes: new Set(),
    bridge: null,
    bridgeReachable: false,
    bridgeSeen: false,
    extensionUpdateRequired: false,
    extensionUpdateNotified: false,
    localApprovalRequired: false,
    connecting: false,
    publicStatus: null,
    bridgePending: new Map(),
    savedBuildContentHashes: new Set(),
    openedPartialRunIds: new Set(),
    requestedPartialRunIds: new Set(),
    requestedCompletedRunIds: new Set(),
    acknowledgedRunIds: new Set(),
    partialFailureNotifiedRunIds: new Set(),
    dismissedCompletedRunIds: new Set(),
    overlayDismissed: false,
    buildStatusOpener: null,
    skipRequestedRunId: null,
    pendingOrganizationSids: [],
    latestBuildRequested: false,
    // The bridge session whose accounts were listed, and whether Add new account waits for the extension.
    accountsListedFor: null,
    accountRequestPending: false,
    handOverQueue: Promise.resolve(),
    mediaController: null,
    // The controller of the image run whose Cancel was chosen, and the wait the run is in, as the log shows it.
    mediaCancelRequested: null,
    mediaWait: null,
    mediaOverlayActive: false,
    mediaCompleted: 0,
    mediaActiveRequests: 0,
    mediaActivity: [],
    // The image run's warning for the caution tape (§14), the status feed's last answer for it, and when it was asked.
    mediaTapeState: null,
    mediaStatusPage: null,
    mediaStatusCheckedAt: null,
    continuePartial: false,
    statusPollTimer: null,
    // The ordered renderer's view (§11.2).
    view: { revision: -1, pollSequence: 0, appliedPoll: 0, announcementKey: null, presentation: null, mediaLogSequence: 0, noticeRunId: null, noticeKeys: new Set() }
  };

  // Switch Account: each account open in this page is a session that holds its own document, Orgs JSON, images and
  // view. These fields of `state` read and write the session shown. The example is a session of its own: it is never
  // listed under Switch Account or offered to the extension.
  const AccountSessions = globalThis.CitizenDataAccountSessions;
  const sameAccount = (left, right) => globalThis.CitizenDataOrganizationDocument.sameAccount(left, right);
  const SESSION_FIELDS = Object.freeze([
    "document", "source", "fileName",
    "activeInventory", "activeGroup", "activeRecordKey", "inventoryPage", "inventorySortKey", "inventorySortDirection", "inventorySearch",
    "referralPath", "referralOrder", "referralPage", "referralSearch",
    "organizationSid", "organizationPage", "organizationSearch", "organizationDocument", "organizationFileName",
    "mediaPlan", "mediaPlanGeneration", "mediaPlanAccount", "mediaPlanDocument", "pendingMediaPackage", "loadedMediaPackage", "loadedMediaFileName",
    "mediaObjectUrls", "mediaLoadPromises", "mediaLoadStates", "mediaTexts", "buildOffer", "organizationOffer"
  ]);

  // `identityOnly`: an account the extension added, of which no document is open; it shows the example's document
  // nowhere, only its handle and the empty state.
  function newSession(key, identity) {
    return {
      key, identity, displayName: null, identityOnly: false,
      document: globalThis.CITIZENDATA_DEMO_DATA, source: "demo", fileName: "example.json",
      activeInventory: "hangar", activeGroup: "all", activeRecordKey: null, inventoryPage: 1, inventorySortKey: null, inventorySortDirection: "ascending", inventorySearch: "",
      referralPath: "current.prospects", referralOrder: "newest", referralPage: 1, referralSearch: "",
      organizationSid: "TEST", organizationPage: 1, organizationSearch: "", organizationDocument: null, organizationFileName: null,
      mediaPlan: [], mediaPlanGeneration: 0, mediaPlanAccount: null, mediaPlanDocument: null, pendingMediaPackage: null, loadedMediaPackage: null, loadedMediaFileName: null,
      mediaObjectUrls: new Map(), mediaLoadPromises: new Map(), mediaLoadStates: new Map(), mediaTexts: null, buildOffer: null, organizationOffer: null
    };
  }

  const exampleSession = newSession("example", { handle: null, localAccountId: null });
  const accounts = AccountSessions.createRegistry({ sameAccount });
  let activeAccountKey = null;
  const activeSession = () => accounts.get(activeAccountKey) ?? exampleSession;
  for (const field of SESSION_FIELDS) {
    Object.defineProperty(state, field, { enumerable: true, get: () => activeSession()[field], set: (value) => { activeSession()[field] = value; } });
  }

  const byId = (id) => document.getElementById(id);
  const refs = {
    fileInput: byId("jsonFileInput"),
    loadButton: byId("loadButton"),
    buildButton: byId("buildButton"),
    switchAccountButton: byId("switchAccountButton"),
    accountPopup: byId("accountPopup"),
    accountMenu: byId("accountMenu"),
    accountMenuAccounts: byId("accountMenuAccounts"),
    accountMenuSeparator: byId("accountMenuSeparator"),
    accountMenuStatus: byId("accountMenuStatus"),
    addAccountCommand: byId("addAccountCommand"),
    addAccountDialog: byId("addAccountDialog"),
    addAccountLoadJson: byId("addAccountLoadJson"),
    removeAccountCommand: byId("removeAccountCommand"),
    removeAccountDialog: byId("removeAccountDialog"),
    removeAccountDialogTitle: byId("removeAccountDialogTitle"),
    removeAccountDialogMessage: byId("removeAccountDialogMessage"),
    accountEmptyState: byId("accountEmptyState"),
    cautionTape: byId("cautionTape"),
    cautionTapeText: byId("cautionTapeText"),
    buildStatusAnnouncement: byId("buildStatusAnnouncement"),
    coolDownExplanation: byId("coolDownExplanation"),
    parserChangeNotice: byId("parserChangeNotice"),
    messageDialog: byId("messageDialog"),
    dialogEyebrow: byId("dialogEyebrow"),
    dialogTitle: byId("dialogTitle"),
    dialogMessage: byId("dialogMessage"),
    toast: byId("statusToast"),
    rows: byId("inventoryRows"),
    emptyState: byId("emptyState"),
    resultCount: byId("resultCount"),
    caption: byId("inventoryCaption"),
    search: byId("recordSearch"),
    filterPanel: byId("filterPanel"),
    filterButton: byId("filterButton"),
    filterCount: byId("filterCount"),
    tableShell: document.querySelector(".table-shell"),
    inventoryPagination: byId("inventoryPagination"),
    inventoryPageStatus: byId("inventoryPageStatus"),
    inventoryPrevious: byId("inventoryPrevious"),
    inventoryNext: byId("inventoryNext"),
    inspectorAnnouncement: byId("inspectorAnnouncement"),
    extensionNotice: byId("extensionNotice"),
    installExtensionAction: byId("installExtensionAction"),
    installExtensionTitle: byId("installExtensionTitle"),
    installExtensionDetail: byId("installExtensionDetail"),
    overlay: byId("parserOverlay"),
    overlayOperation: byId("overlayOperation"),
    identityHero: byId("identityHeroArt"),
    avatarImage: byId("avatarImage"),
    avatarInitials: byId("avatarInitials"),
    dossierBadgeImage: byId("dossierBadgeImage"),
    dossierBadgeFallback: byId("dossierBadgeFallback"),
    organizationEmblemImage: byId("organizationEmblemImage"),
    organizationEmblemFallback: byId("organizationEmblemFallback"),
    collectionActivity: byId("collectionActivity"),
    collectionActivityLink: byId("collectionActivityLink"),
    collectionActivityImage: byId("collectionActivityImage"),
    collectionActivityProgress: byId("collectionActivityProgress"),
    requestProgress: byId("requestProgress"),
    requestProgressLabel: byId("requestProgressLabel"),
    collectionRequestProgress: byId("collectionRequestProgress"),
    requestProgressText: byId("requestProgressText"),
    eventLog: byId("eventLog"),
    collectionControls: byId("collectionControls"),
    rebindCollection: byId("rebindCollection"),
    pauseCollection: byId("pauseCollection"),
    resumeCollection: byId("resumeCollection"),
    cancelCollection: byId("cancelCollection"),
    skipCollection: byId("skipCollection"),
    organizationSearch: byId("organizationSearch"),
    organizationSearchCount: byId("organizationSearchCount"),
    referralSearch: byId("referralSearch"),
    referralSearchLabel: byId("referralSearchLabel"),
    referralSearchCount: byId("referralSearchCount"),
    orgFileInput: byId("orgFileInput"),
    loadOrgButton: byId("loadOrgButton"),
    buildOrgButton: byId("buildOrgButton"),
    orgFileStatus: byId("orgFileStatus"),
    orgBuildDialog: byId("orgBuildDialog"),
    orgBuildForm: byId("orgBuildForm"),
    orgRosterChecklist: byId("orgRosterChecklist"),
    orgBuildAvailability: byId("orgBuildAvailability"),
    orgBuildStart: byId("orgBuildStart"),
    buildChoices: byId("buildChoices"),
    buildAccountAction: byId("buildAccountAction"),
    buildImagesAction: byId("buildImagesAction"),
    mediaControls: byId("mediaControls"),
    mediaCancelOverlay: byId("mediaCancelOverlay"),
    mediaBusy: byId("mediaBusy"),
    mediaBusyStatus: byId("mediaBusyStatus"),
    mediaSaveOverlay: byId("mediaSaveOverlay"),
    mediaStatus: byId("mediaStatus"),
    mediaZipInput: byId("mediaZipInput"),
    mediaZipLoadedState: byId("mediaZipLoadedState"),
    loadMediaZipButton: byId("loadMediaZipButton"),
    mediaGalleryDialog: byId("mediaGalleryDialog"),
    mediaGalleryTitle: byId("mediaGalleryTitle"),
    mediaGalleryStatus: byId("mediaGalleryStatus"),
    mediaGalleryFull: byId("mediaGalleryFull"),
    mediaGalleryImage: byId("mediaGalleryImage"),
    mediaGalleryPlaceholder: byId("mediaGalleryPlaceholder"),
    mediaGalleryThumbnails: byId("mediaGalleryThumbnails")
  };

  const inspector = {
    panel: byId("recordInspector"),
    icon: byId("inspectorIcon"),
    image: byId("inspectorImage"),
    galleryOpen: byId("inspectorGalleryOpen"),
    galleryThumbnails: byId("inspectorGalleryThumbnails"),
    media: byId("inspectorMedia"),
    group: byId("inspectorGroup"),
    title: byId("inspectorTitle"),
    ccu: byId("inspectorCcu"),
    subtitle: byId("inspectorSubtitle"),
    wiki: byId("inspectorWiki"),
    facts: byId("inspectorFacts"),
    items: byId("inspectorItems"),
    itemList: byId("inspectorItemList"),
    itemRemainder: byId("inspectorItemRemainder"),
    note: byId("inspectorNote"),
    source: byId("inspectorSource"),
    sourcePending: byId("inspectorSourcePending")
  };
  let inspectorMediaIndex = 0;
  let mediaGalleryRecord = null;
  let mediaGalleryIndex = 0;
  let mediaGalleryOpener = null;
  let mediaLoadGeneration = 0;
  let mediaLoadSequence = 0;
  let mediaLoadActive = 0;
  let mediaLoadRefreshScheduled = false;
  const mediaLoadQueue = [];
  const mediaLoadTasks = new Map();

  function text(id, value) {
    const node = byId(id);
    const next = value ?? "—";
    if (node.textContent !== next) node.textContent = next;
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  // Patching (PARSER_HARDENING.md §11.2): each writes only when the value differs, so a status that changes nothing
  // leaves the panel's nodes, focus and scroll positions as they are.
  function patchText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function patchHidden(node, hidden) {
    if (!node || node.hidden === hidden) return;
    // A control hidden while it holds focus first hands focus to the panel's minimize button.
    if (hidden && node.contains(document.activeElement)) byId("minimizeOverlay")?.focus();
    node.hidden = hidden;
  }

  function patchClass(node, name, on) {
    if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on);
  }

  function patchAttr(node, name, value) {
    if (!node) return;
    if (value === null) {
      if (node.hasAttribute(name)) node.removeAttribute(name);
    } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  function patchProgress(node, value) {
    if (node && (!node.hasAttribute("value") || node.value !== value)) node.value = value;
  }

  // Countdowns: each node that shows one, with its countdown. One timer a second changes only the time. Once the time
  // has passed, the sentence becomes its after text once, and the controls and tape the time held back are refreshed.
  const countdowns = new Map();
  let countdownTimer = null;

  function countdownTimeText(value) {
    const full = Model.countdownText(value);
    return full.slice(value.lead.length, full.length - value.tail.length);
  }

  function showCountdown(node, value) {
    if (!node) return;
    if (!value || !Model.countdownRunning(value)) {
      countdowns.delete(node);
      patchText(node, value ? value.after : "");
      return;
    }
    const current = countdowns.get(node);
    const clock = node.querySelector(":scope > time.countdown");
    if (!current || !clock || current.until !== value.until || current.lead !== value.lead || current.tail !== value.tail) {
      const time = element("time", "countdown", countdownTimeText(value));
      time.dateTime = value.until;
      node.replaceChildren(document.createTextNode(value.lead), time, document.createTextNode(value.tail));
    }
    countdowns.set(node, value);
    if (countdownTimer === null) countdownTimer = window.setInterval(tickCountdowns, 1000);
  }

  function forgetCountdown(node) {
    countdowns.delete(node);
  }

  function tickCountdowns() {
    let ended = false;
    for (const [node, value] of countdowns) {
      if (Model.countdownRunning(value)) {
        patchText(node.querySelector(":scope > time.countdown"), countdownTimeText(value));
        continue;
      }
      countdowns.delete(node);
      node.textContent = value.after;
      ended = true;
    }
    if (countdowns.size === 0) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (ended) {
      updateUnavailableControls();
      renderCautionTape();
    }
  }

  // The cool-down (§8.4, §12.2): while it lasts, Build, Update, Continue, roster Start and Org Build look unavailable,
  // stay focusable, point to their explanation, and show W-25 when used.
  function coolDownUntil() {
    const until = state.publicStatus?.retryNotBefore;
    return Date.parse(until) > Date.now() ? until : null;
  }

  function applyUnavailable(control, until) {
    patchAttr(control, "aria-disabled", until ? "true" : null);
    patchAttr(control, "aria-describedby", until ? "coolDownExplanation" : null);
  }

  function updateUnavailableControls() {
    const until = coolDownUntil();
    for (const control of [refs.buildButton, refs.buildAccountAction, refs.buildOrgButton, refs.orgBuildStart]) applyUnavailable(control, until);
    applyUnavailable(refs.resumeCollection, state.continuePartial ? until : null);
    if (until) showCountdown(refs.coolDownExplanation, Model.coolingDownCountdown(until));
    else {
      forgetCountdown(refs.coolDownExplanation);
      patchText(refs.coolDownExplanation, "");
    }
  }

  function showCountdownDialog(eyebrow, title, value) {
    showDialog(eyebrow, title, "");
    showCountdown(refs.dialogMessage, value);
  }

  // W-25 for a start or Continue used during the cool-down. Returns whether it was shown.
  function showCoolingDown() {
    const until = coolDownUntil();
    if (!until) return false;
    showCountdownDialog("RSI", "Cooling down", Model.coolingDownCountdown(until));
    return true;
  }

  // W-20 for a start RSI refused, W-25 for one the cool-down held back. Returns whether either was shown.
  function showStartDeclined(response) {
    if (!Number.isFinite(Date.parse(response?.retryNotBefore))) return false;
    if (response.code === "RSI_RATE_LIMITED") {
      showCountdownDialog("RSI", "RSI is refusing", Model.refusedDialogCountdown(response.retryNotBefore, response.diagnosis ?? null));
      return true;
    }
    if (response.code === "RSI_COOLING_DOWN") {
      showCountdownDialog("RSI", "Cooling down", Model.coolingDownCountdown(response.retryNotBefore));
      return true;
    }
    return false;
  }

  function formatInteger(value) {
    return Model.formatExactNumber(value);
  }

  function formatMoney(balance) {
    return Model.formatExactMoney(balance?.amount, balance?.unit ?? balance?.currency);
  }

  function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { refs.toast.hidden = true; }, 3600);
  }

  function showDialog(eyebrow, title, message) {
    forgetCountdown(refs.dialogMessage);
    refs.dialogEyebrow.textContent = eyebrow;
    refs.dialogTitle.textContent = title;
    refs.dialogMessage.textContent = message;
    if (typeof refs.messageDialog.showModal === "function") refs.messageDialog.showModal();
    else showToast(`${title}: ${message}`);
  }

  // A buy-back's own page is preferred to the list page it was found on.
  function safeRsiLink(record) {
    const links = Model.asArray(record?.sourceLinks).filter((link) => typeof link?.url === "string");
    const candidate = (links.find((link) => link.kind === "detail") ?? links[0])?.url;
    if (!candidate) return null;
    try {
      const url = new URL(candidate);
      return url.protocol === "https:" && url.hostname === "robertsspaceindustries.com" ? url.href : null;
    } catch {
      return null;
    }
  }

  function renderWikiLink(record) {
    inspector.wiki.replaceChildren();
    inspector.wiki.hidden = !record;
    if (!record) return;
    const article = state.source === "demo" ? globalThis.CITIZENDATA_DEMO_WIKI_ARTICLES?.[record.recordKey] : null;
    const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Star Citizen";
    const url = new URL("https://starcitizen.tools/Special:Search");
    url.searchParams.set("search", title);
    const link = element("a", "", article ? `About ${article.name}` : `Search wiki: ${title}`);
    link.href = article ? `https://starcitizen.tools/${encodeURIComponent(article.title)}` : url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    inspector.wiki.append(link);
  }

  function imageReference(entity, roles) {
    return Model.asArray(entity?.images).find((candidate) => roles.includes(candidate?.role) && !Model.isPlaceholderImage(candidate)) ?? null;
  }

  function badgeTitleKey(value) {
    return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[’‘]/gu, "'").replace(/\s+/gu, " ");
  }

  function badgeCatalogueEntry(title) {
    const key = badgeTitleKey(title);
    return Model.asArray(globalThis.CITIZENDATA_BADGE_CATALOG).find((entry) => badgeTitleKey(entry?.title) === key) ?? null;
  }

  function badgeWikiUrl(title) {
    const pageTitle = globalThis.CITIZENDATA_BADGE_WIKI_PAGES?.[title];
    if (typeof pageTitle !== "string" || !pageTitle.trim()) return "https://starcitizen.tools/Titles";
    return `https://starcitizen.tools/${pageTitle.trim().split(" ").map(encodeURIComponent).join("_")}`;
  }

  function localMediaPath(reference) {
    if (!reference?.imageKey) return null;
    const runtimeUrl = state.mediaObjectUrls.get(reference.imageKey);
    if (typeof runtimeUrl === "string" && runtimeUrl.startsWith("blob:")) return runtimeUrl;
    const map = state.source === "demo" ? globalThis.CITIZENDATA_DEMO_MEDIA : globalThis.CITIZENDATA_OFFLINE_MEDIA;
    const entry = map?.[reference.imageKey];
    const relativePath = typeof entry === "string" ? entry : entry?.relativePath;
    if (typeof relativePath !== "string" || relativePath.length > 260 || relativePath.startsWith("/") || relativePath.startsWith("\\") || relativePath.includes("\\") || relativePath.includes(":")) return null;
    const segments = relativePath.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
    return relativePath;
  }

  function scheduleMediaViewRefresh() {
    if (mediaLoadRefreshScheduled) return;
    mediaLoadRefreshScheduled = true;
    queueMicrotask(() => {
      mediaLoadRefreshScheduled = false;
      renderIdentity();
      renderBadges();
      renderInventory();
      renderMemberships();
      renderMediaGallery();
    });
  }

  // Where the open images come from, in words: an Images ZIP the user chose, or the images the extension keeps.
  function imageSourcePhrase() {
    return state.loadedMediaPackage?.fromExtension ? "the extension" : "the selected Images ZIP";
  }

  function mediaAssetForReference(reference) {
    if (!state.loadedMediaPackage || !reference?.imageKey) return null;
    return state.loadedMediaPackage.manifest.assets.find((candidate) => ["downloaded", "reused"].includes(candidate.status)
      && candidate.relativePath
      && (candidate.assetId === reference.imageKey
        || Model.asArray(candidate.sourceImageKeys).includes(reference.imageKey)
        || (typeof reference.url === "string" && candidate.sourceUrl === reference.url))) ?? null;
  }

  function mediaLoadProgress(entries) {
    let ready = 0;
    let loading = 0;
    let unavailable = 0;
    for (const entry of entries) {
      if (localMediaPath(entry.reference)) {
        ready += 1;
        continue;
      }
      const status = state.mediaLoadStates.get(entry.reference?.imageKey)?.status;
      if (status === "queued" || status === "loading") loading += 1;
      else if (status === "error") unavailable += 1;
    }
    return { ready, loading, unavailable, total: entries.length };
  }

  function mediaErrorMessage(reference) {
    return Model.mediaLoadError(state.mediaLoadStates.get(reference?.imageKey));
  }

  function sortMediaLoadQueue() {
    mediaLoadQueue.sort((left, right) => right.priority - left.priority || right.sequence - left.sequence);
  }

  function pumpMediaLoadQueue() {
    while (mediaLoadActive < 4 && mediaLoadQueue.length) {
      const task = mediaLoadQueue.shift();
      if (task.generation !== mediaLoadGeneration || mediaLoadTasks.get(task.imageKey) !== task) {
        task.resolve(false);
        continue;
      }
      mediaLoadActive += 1;
      task.started = true;
      state.mediaLoadStates.set(task.imageKey, { status: "loading", message: `Loading from ${imageSourcePhrase()}.` });
      if (!task.quiet) scheduleMediaViewRefresh();
      void (async () => {
        const blob = await task.package.fileBlob(task.asset.relativePath, task.asset.mediaType);
        if (task.generation !== mediaLoadGeneration) return false;
        const knownKeys = new Set([task.imageKey, task.asset.assetId, ...Model.asArray(task.asset.sourceImageKeys)]);
        const existingObjectUrl = [...knownKeys].map((key) => state.mediaObjectUrls.get(key)).find((value) => typeof value === "string" && value.startsWith("blob:"));
        const objectUrl = existingObjectUrl ?? URL.createObjectURL(blob);
        for (const key of knownKeys) state.mediaObjectUrls.set(key, objectUrl);
        state.mediaLoadStates.set(task.imageKey, { status: "ready", message: "Image ready." });
        return true;
      })().catch((error) => {
        if (task.generation !== mediaLoadGeneration) return false;
        const message = `Image validation failed: ${error.message}`;
        state.mediaLoadStates.set(task.imageKey, { status: "error", code: "ZIP_IMAGE_INVALID", message });
        refs.mediaStatus.textContent = message;
        return false;
      }).then(task.resolve).finally(() => {
        mediaLoadActive -= 1;
        if (mediaLoadTasks.get(task.imageKey) === task) mediaLoadTasks.delete(task.imageKey);
        if (task.session.mediaLoadPromises.get(task.imageKey) === task.promise) task.session.mediaLoadPromises.delete(task.imageKey);
        if (!task.quiet) scheduleMediaViewRefresh();
        pumpMediaLoadQueue();
      });
    }
  }

  // `quiet` is for a caller that places the loaded image itself: the whole view is not rendered again for it. A load
  // that any other caller also waits for is not quiet.
  function loadMediaReference(reference, priority = 10, quiet = false) {
    const imageKey = reference?.imageKey;
    if (!imageKey || !state.loadedMediaPackage) return Promise.resolve(false);
    if (state.mediaObjectUrls.has(imageKey)) return Promise.resolve(true);
    if (state.mediaLoadStates.get(imageKey)?.status === "error") return Promise.resolve(false);
    const existing = mediaLoadTasks.get(imageKey);
    if (existing) {
      if (!quiet) existing.quiet = false;
      if (!existing.started && priority > existing.priority) {
        existing.priority = priority;
        sortMediaLoadQueue();
      }
      return existing.promise;
    }
    const asset = mediaAssetForReference(reference);
    if (!asset) {
      const message = state.loadedMediaPackage.fromExtension ? "The extension does not keep this image yet. Build Images to add it." : "This image is not in the selected Images ZIP. Build Images to add it.";
      state.mediaLoadStates.set(imageKey, { status: "error", code: "NOT_IN_ZIP", message });
      if (!quiet) scheduleMediaViewRefresh();
      return Promise.resolve(false);
    }
    let resolve;
    const promise = new Promise((complete) => { resolve = complete; });
    mediaLoadSequence += 1;
    const task = { imageKey, asset, package: state.loadedMediaPackage, session: activeSession(), priority, quiet, sequence: mediaLoadSequence, generation: mediaLoadGeneration, promise, resolve, started: false };
    mediaLoadTasks.set(imageKey, task);
    state.mediaLoadPromises.set(imageKey, promise);
    state.mediaLoadStates.set(imageKey, { status: "queued", message: `Queued from ${imageSourcePhrase()}.` });
    mediaLoadQueue.push(task);
    sortMediaLoadQueue();
    pumpMediaLoadQueue();
    return promise;
  }

  function prioritizeMediaEntries(entries, priority) {
    for (const [index, entry] of entries.entries()) void loadMediaReference(entry.reference, priority - index / 1000);
  }

  function renderLocalImage(image, fallback, reference, fallbackAlt, options = {}) {
    image.hidden = true;
    image.removeAttribute("src");
    image.alt = "";
    if (fallback) fallback.hidden = false;
    const path = localMediaPath(reference);
    if (!path) {
      const priority = options.priority === null ? null : Number.isFinite(options.priority) ? options.priority : 10;
      if (priority !== null && reference?.imageKey && state.loadedMediaPackage) void loadMediaReference(reference, priority);
      return false;
    }
    image.src = path;
    image.alt = reference?.altText ?? fallbackAlt;
    image.onerror = () => {
      image.hidden = true;
      if (fallback) fallback.hidden = false;
      if (reference?.imageKey) {
        state.mediaObjectUrls.delete(reference.imageKey);
        state.mediaLoadStates.set(reference.imageKey, { status: "error", code: "IMAGE_DECODE_FAILED", message: "The browser could not decode this image from the selected ZIP." });
      }
      refs.mediaStatus.textContent = "The browser could not decode an image from the selected ZIP.";
      scheduleMediaViewRefresh();
    };
    image.hidden = false;
    if (fallback) fallback.hidden = true;
    return true;
  }

  // The image loads of the session shown stop; any other session's were stopped when it was left.
  function stopMediaLoads() {
    mediaLoadGeneration += 1;
    for (const task of mediaLoadQueue.splice(0)) task.resolve(false);
    mediaLoadTasks.clear();
  }

  function clearLoadedMediaPackage(session = activeSession()) {
    if (session === activeSession()) stopMediaLoads();
    for (const objectUrl of new Set(session.mediaObjectUrls.values())) URL.revokeObjectURL(objectUrl);
    session.mediaObjectUrls.clear();
    session.mediaLoadPromises.clear();
    session.mediaLoadStates.clear();
    session.loadedMediaPackage = null;
    session.loadedMediaFileName = null;
  }

  // A session that is left keeps the images it has shown; the loads still waiting or running are dropped and are
  // asked for again when it is shown again.
  function suspendMediaLoads(session) {
    stopMediaLoads();
    for (const [imageKey, value] of session.mediaLoadStates) if (value?.status === "queued" || value?.status === "loading") session.mediaLoadStates.delete(imageKey);
    session.mediaLoadPromises.clear();
  }

  function rotateHero() {
    const key = "citizendata.hero-rotation.v2";
    let index;
    try {
      const previous = Number.parseInt(sessionStorage.getItem(key) ?? "-1", 10);
      index = Number.isInteger(previous) ? (previous + 1) % HERO_NAMES.length : 0;
      sessionStorage.setItem(key, String(index));
    } catch {
      index = Math.floor(Math.random() * HERO_NAMES.length);
    }
    refs.identityHero.dataset.heroArt = HERO_NAMES[index];
  }

  function mainMembership() {
    return Model.getMainMembership(state.document);
  }

  // An account the extension added, of which no backup is open: its handle, its initials, and the empty state.
  function renderAddedAccountIdentity() {
    const session = activeSession();
    const handle = session.identity.handle ?? "Unknown account";
    text("accountHandle", handle);
    text("avatarInitials", Model.initials(session.displayName ?? handle));
    refs.avatarImage.hidden = true;
    refs.avatarImage.removeAttribute("src");
    refs.avatarInitials.hidden = false;
    byId("avatar").setAttribute("aria-label", `${handle} initials`);
    text("snapshotEyebrow", "ADDED ACCOUNT");
    text("railAccount", handle);
    text("railExported", null);
    text("documentStatusTitle", "NO BACKUP LOADED");
    text("documentStatusDetail", "No private account data · no upload");
  }

  function renderIdentity() {
    if (activeSession().identityOnly) {
      renderAddedAccountIdentity();
      return;
    }
    const data = state.document;
    const handle = data.account?.handle ?? data.profile?.handle ?? "Unknown account";
    const anomalyCount = Array.isArray(data.dataQuality?.anomalies) ? data.dataQuality.anomalies.length : 0;
    const anomalySummary = `${formatInteger(anomalyCount)} raw data warning${anomalyCount === 1 ? "" : "s"}`;
    const membership = mainMembership();
    text("accountHandle", handle);
    text("avatarInitials", Model.initials(data.profile?.displayName ?? handle));
    const avatarVisible = renderLocalImage(refs.avatarImage, refs.avatarInitials, imageReference(data.profile, ["avatar", "profileAvatar"]), `${handle} account avatar`);
    byId("avatar").setAttribute("aria-label", avatarVisible ? `${handle} account avatar` : `${handle} initials`);
    text("citizenRecordNumber", data.account?.ueeCitizenRecord === null || data.account?.ueeCitizenRecord === undefined ? "record unavailable" : `#${data.account.ueeCitizenRecord}`);
    text("enlistedOn", data.profile?.enlistedOnRaw ?? "Unavailable");
    text("mainOrganization", membership?.name ?? data.profile?.mainOrganizationSid ?? "No main organization");
    text("organizationRank", data.profile?.organizationRank ?? membership?.rank ?? "Unavailable");
    const badgeTitle = data.profile?.dossierBadgeTitle ?? data.profile?.displayTitle ?? "Dossier badge unavailable";
    text("displayTitle", badgeTitle);
    let badgeVisible = renderLocalImage(refs.dossierBadgeImage, refs.dossierBadgeFallback, imageReference(data.profile, ["dossierBadge", "badge"]), badgeTitle);
    const catalogueBadge = badgeCatalogueEntry(badgeTitle);
    const cataloguePath = catalogueBadge?.images?.[0]?.assetPath;
    if (!badgeVisible && typeof cataloguePath === "string" && /^assets\/badges\/[a-z0-9-]+\.(?:png|jpg|gif|webp)$/u.test(cataloguePath)) {
      refs.dossierBadgeImage.src = cataloguePath;
      refs.dossierBadgeImage.alt = badgeTitle;
      refs.dossierBadgeImage.hidden = false;
      refs.dossierBadgeFallback.hidden = true;
      badgeVisible = true;
    }
    refs.dossierBadgeImage.parentElement.hidden = !badgeVisible;
    const organizationLabel = membership?.name ?? data.profile?.mainOrganizationSid ?? "No main organization";
    renderLocalImage(refs.organizationEmblemImage, refs.organizationEmblemFallback, imageReference(membership, ["emblem", "organizationEmblem"]), `${organizationLabel} organization emblem`);
    text("railAccount", handle);
    text("railExported", state.fileName);
    const hangarLinkFile = state.source !== "demo" && globalThis.CitizenDataHangarLinkImport.isHangarLinkImport(state.document);
    text("snapshotEyebrow", state.source === "demo" ? "EXAMPLE ACCOUNT" : hangarLinkFile ? "INCOMPLETE BUILD · HANGAR LINK JSON" : "LOADED ACCOUNT SNAPSHOT");
    text("dataStateTitle", state.source === "demo" ? "Example preview loaded" : "Local account document loaded");
    text("dataStateDetail", state.source === "demo" ? "Load an account JSON to review your data" : anomalyCount ? `Your file is open on this device · ${anomalySummary}` : "Your file is open on this device");
    text("documentStatusTitle", state.source === "demo" ? "EXAMPLE DATA" : hangarLinkFile ? "HANGAR LINK JSON LOADED" : "LOCAL JSON LOADED");
    text("documentStatusDetail", state.source === "demo" ? "No private account data · no upload" : anomalyCount ? `Browser memory only · ${anomalySummary}` : "Browser memory only · no upload");
    renderFileStatus(anomalyCount);
  }

  // The example account's images are bundled with the dashboard. Its image figures read as those of an account whose
  // Images ZIP is loaded: one image for each image key the example document names and the bundle holds.
  const EXAMPLE_IMAGES_FILE = "example-images.zip";
  function exampleImageCount() {
    const bundled = globalThis.CITIZENDATA_DEMO_MEDIA ?? {};
    const keys = new Set();
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (typeof value.imageKey === "string" && Object.hasOwn(bundled, value.imageKey)) keys.add(value.imageKey);
      for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
    };
    visit(state.document);
    return keys.size;
  }

  function renderFileStatus(anomalyCount) {
    const outcomes = Object.values(state.document.sync?.sectionOutcomes ?? {}).filter((outcome) => outcome && typeof outcome === "object");
    const completed = outcomes.filter((outcome) => outcome.status === "complete").length;
    const imported = state.source !== "demo" && globalThis.CitizenDataHangarLinkImport.isHangarLinkImport(state.document);
    const sections = outcomes.length ? `${formatInteger(completed)} of ${formatInteger(outcomes.length)} sections complete` : state.source === "demo" ? "Example records" : "No collection receipt in this file";
    const collection = imported ? `Incomplete build · ${sections}` : sections;
    text("healthSummaryTitle", state.source === "demo" ? "Example account" : state.fileName);
    text("healthSummaryDetail", state.source === "demo" ? "Bundled sample data" : `${collection} · ${formatInteger(anomalyCount)} warning${anomalyCount === 1 ? "" : "s"}`);
    text("healthSource", state.source === "demo" ? "Bundled example" : imported ? "Hangar Link JSON opened in this browser" : "Local JSON opened in this browser");
    text("healthCompleteness", collection);
    text("healthWarnings", anomalyCount ? `${formatInteger(anomalyCount)} retained for review` : "None");
    text("healthAccountFile", state.source === "demo" ? "example.json" : state.fileName);
    text("orgFileStatus", state.source === "demo" ? "Example roster data" : state.organizationFileName ?? "No Orgs JSON loaded");
    const exampleImages = state.source === "demo" && !state.loadedMediaPackage && !state.pendingMediaPackage && !state.mediaController;
    text("imageFileStatus", state.loadedMediaFileName ?? state.pendingMediaPackage?.fileName ?? (exampleImages ? EXAMPLE_IMAGES_FILE : "No Images ZIP loaded"));
    refs.mediaZipLoadedState.hidden = !state.loadedMediaPackage && !exampleImages;
    const packagedImages = state.loadedMediaPackage?.manifest?.summary;
    text("healthMedia", exampleImages
      ? `${formatInteger(exampleImageCount())} packaged images loaded`
      : state.mediaController
      ? "Image download in progress"
      : packagedImages
        ? `${formatInteger((packagedImages.downloaded ?? 0) + (packagedImages.reused ?? 0))} packaged images loaded${packagedImages.failed ? ` · ${formatInteger(packagedImages.failed)} failed` : ""}`
        : state.pendingMediaPackage
          ? "ZIP ready to save"
          : state.document.materializationReceipt?.promoted === true ? "Included in this offline package" : "Available as an optional download");
  }

  function renderSummary() {
    const data = state.document;
    const storeCredit = Model.getBalance(data, "storeCredit");
    const uec = Model.getBalance(data, "uec");
    const rec = Model.getBalance(data, "rec");
    const billingTotal = Model.getBillingTotal(data);
    // The counts are what the account holds; a record RSI no longer lists is shown in its list but not counted here.
    const heldPledges = heldRecords(data.pledges).length;
    const heldBuybacks = heldRecords(data.buybacks).length;
    text("hangarTotal", formatInteger(heldPledges));
    text("buybackTotal", formatInteger(heldBuybacks));
    text("hangarTabCount", formatInteger(heldPledges));
    text("buybacksTabCount", formatInteger(heldBuybacks));
    text("railHangarCount", `${formatInteger(heldPledges)} records`);
    text("railBuybackCount", `${formatInteger(heldBuybacks)} records`);
    text("storeCredit", formatMoney(storeCredit));
    text("uecBalance", formatMoney(uec));
    text("detailStoreCredit", `${formatMoney(storeCredit)} ${storeCredit?.unit === "USD" ? "USD" : ""}`.trim());
    text("detailUec", formatMoney(uec));
    text("detailRec", formatMoney(rec));
    text("billingTotal", billingTotal ? formatMoney({ amount: billingTotal.amount, unit: billingTotal.currency }) : "—");
    text("billingCurrency", billingTotal ? `${billingTotal.currency} total spent` : "Not included in this file");
    renderSubscriptions();
  }

  function renderSubscriptions() {
    const summary = globalThis.CitizenDataSubscriptions.summarize(state.document);
    const tier = summary.tier === "imperator" ? "Imperator" : summary.tier === "centurion" ? "Centurion" : "";
    for (const id of ["subscriptionSummary", "subscriptions"]) byId(id).dataset.tier = summary.tier ?? "";
    for (const id of ["subscriptionSummaryIcon", "subscriptionStatusIcon"]) byId(id).hidden = !summary.tier;
    text("subscriptionTier", tier);
    for (const id of ["subscriptionSpent", "subscriptionDetailSpent"]) {
      const target = byId(id);
      target.replaceChildren();
      for (const total of summary.totals) {
        const suffix = id === "subscriptionDetailSpent" || summary.totals.length > 1 ? ` ${total.currency}` : "";
        target.append(element("span", "subscription-amount", `${Model.formatExactMoney(total.amount, total.currency)}${suffix}`));
      }
    }
    text("subscriptionMetricDetail", [tier, summary.totals.length === 1 ? `${summary.totals[0].currency} spent` : summary.totals.length > 1 ? "Total spent" : "", summary.note ? "Partial data" : ""].filter(Boolean).join(" · "));
    text("subscriptionNote", summary.note);
    byId("subscriptionNote").hidden = !summary.note;
  }

  // One entry of a list: `child` inside an <li> of class `className`.
  function listItem(child, className) {
    const item = element("li", className);
    item.append(child);
    return item;
  }

  function renderBadgeCard(badge, unlockable = false) {
    const card = element("a", "badge-card");
    card.href = badgeWikiUrl(badge.title);
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.setAttribute("aria-label", `${badge.title}. Open Star Citizen Wiki in a new tab.`);
    const image = element("img");
    // Badge grids sit inside closed disclosure panels; lazy loading defers their artwork until a panel is opened.
    image.loading = "lazy";
    image.decoding = "async";
    if (Number.isSafeInteger(badge.id)) {
      const badgeId = String(badge.id);
      card.dataset.badgeId = badgeId;
      image.dataset.badgeId = badgeId;
    }
    if (unlockable && typeof badge.section === "string" && badge.section.trim()) {
      card.dataset.badgeSection = badge.section.trim();
      image.dataset.badgeSection = badge.section.trim();
    }
    const fallback = element("span", "rsi-icon icon-citizen");
    const reference = imageReference(badge, ["badge", "badge-favorite", "badge-featured"]);
    const assetPath = badge.assetPath ?? badgeCatalogueEntry(badge.title)?.images?.[0]?.assetPath;
    let visible = !unlockable && renderLocalImage(image, fallback, reference, badge.title);
    if (!visible && typeof assetPath === "string" && /^assets\/badges\/[a-z0-9-]+\.(?:png|jpg|gif|webp)$/u.test(assetPath)) {
      image.src = assetPath;
      image.alt = badge.title;
      image.hidden = false;
      fallback.hidden = true;
      visible = true;
    }
    if (!visible) image.hidden = true;
    const copy = element("span");
    copy.append(element("b", "", badge.title));
    card.append(image, fallback, copy);
    return card;
  }

  function renderBadges() {
    const unique = new Map();
    for (const badge of Model.asArray(state.document.profile?.unlockedBadges)) {
      if (!Number.isSafeInteger(badge?.id) || typeof badge?.title !== "string" || !badge.title.trim()) continue;
      unique.set(`${badge.id}|${badge.title}`, badge);
    }
    const unlocked = [...unique.values()].sort((left, right) => left.title.localeCompare(right.title, "en", { sensitivity: "base" }) || left.id - right.id);
    const unlockedGrid = byId("unlockedBadgeGrid");
    unlockedGrid.replaceChildren(...unlocked.map((badge) => listItem(renderBadgeCard(badge), "badge-item")));
    byId("unlockedBadgeEmpty").hidden = unlocked.length > 0;
    const collection = state.document.profile?.badgeCollection;
    const populatedCount = Number.isSafeInteger(collection?.nonNullRows) ? collection.nonNullRows : unlocked.length;
    const duplicateCount = Number.isSafeInteger(collection?.exactDuplicateRows) ? collection.exactDuplicateRows : Math.max(0, populatedCount - unlocked.length);
    text("badgeSummaryCount", `${formatInteger(unlocked.length)} account badges`);
    const unlockedNote = byId("unlockedBadgeNote");
    unlockedNote.hidden = populatedCount === unlocked.length && duplicateCount === 0;
    unlockedNote.textContent = unlockedNote.hidden
      ? ""
      : `RSI returned ${formatInteger(populatedCount)} populated account badge rows. ${formatInteger(unlocked.length)} unique badges are shown; ${formatInteger(duplicateCount)} exact duplicate ${duplicateCount === 1 ? "row was" : "rows were"} excluded.`;

    const catalogue = Model.asArray(globalThis.CITIZENDATA_UNLOCKABLE_BADGES);
    const unlockedTitles = new Set(unlocked.map((badge) => badgeTitleKey(badge.title)));
    const unlockable = catalogue.filter((badge) => typeof badge?.title === "string" && !unlockedTitles.has(badgeTitleKey(badge.title)))
      .map((badge) => ({ title: badge.title, id: null, section: badge.section, assetPath: badge.images?.[0]?.assetPath ?? null }));
    const unlockableGrid = byId("unlockableBadgeGrid");
    unlockableGrid.replaceChildren(...unlockable.map((badge) => listItem(renderBadgeCard(badge, true), "badge-item")));
    byId("unlockableBadgeEmpty").hidden = unlockable.length > 0;
    text("unlockableBadgeCount", catalogue.length ? `${formatInteger(unlockable.length)} available` : "Catalogue unavailable");
  }

  // A record RSI no longer lists, with no Hangar Log entry that accounts for it, stays in the backup with the state
  // "not-reconcilable". Its row has its own wording and colour; the wording carries the meaning, so colour is never
  // the only signal.
  const REMOVED_LABEL = "POTENTIAL GHOST REMOVAL";

  function isRemoved(record) {
    return record?.state === "not-reconcilable";
  }

  function stateLabel(record) {
    return isRemoved(record) ? REMOVED_LABEL : record?.state ?? "Unknown";
  }

  // The third column of the inventory table: what a hangar pledge melts for, or what a buy-back costs.
  function inventoryValueHeading() {
    return state.activeInventory === "buybacks" ? "Price" : "Melt Value";
  }

  // The amount shown in that column, worded as the inspector words it.
  function inventoryValueText(record) {
    const details = pledgeDetails(record);
    if (state.activeInventory !== "buybacks") return priceText(details.meltValue);
    return record.kind === "upgrade" && !details.buybackPrice ? "Varies, check on RSI" : priceText(details.buybackPrice);
  }

  // The records the account holds now: those RSI lists.
  function heldRecords(records) {
    return Model.asArray(records).filter((record) => !isRemoved(record));
  }

  // Removed records are shown first, so they are not left on the last page of a long list. The order is worked out
  // once for each list of a loaded document.
  const inventoryOrders = new WeakMap();
  function inventoryRecords() {
    const records = state.activeInventory === "hangar" ? state.document.pledges : state.document.buybacks;
    if (!Array.isArray(records)) return [];
    let ordered = inventoryOrders.get(records);
    if (!ordered) {
      ordered = records.some((record) => isRemoved(record)) ? [...records.filter((record) => isRemoved(record)), ...heldRecords(records)] : records;
      inventoryOrders.set(records, ordered);
    }
    return ordered;
  }

  function recordDate(record) {
    return record.createdDateRaw ?? record.reclaimDateRaw ?? "Unavailable";
  }

  function categoryLabel(category) {
    const labels = { gamePackage: "Game package", standaloneShip: "Standalone ship", shipUpgrade: "Ship upgrade", reward: "Reward", hangarItem: "Hangar item", armor: "Armor", weapon: "Weapon", other: "Other", unknown: "Unknown" };
    return Object.hasOwn(labels, category) ? labels[category] : "Unclassified";
  }

  function decimalParts(value) {
    const match = String(value ?? "").match(/^(-?)(\d+)(?:\.(\d+))?$/u);
    if (!match) return null;
    return { negative: match[1] === "-", integer: match[2].replace(/^0+(?=\d)/u, ""), fraction: (match[3] ?? "").replace(/0+$/u, "") };
  }

  function compareDecimalStrings(left, right) {
    const a = decimalParts(left);
    const b = decimalParts(right);
    if (!a || !b) return String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "base" });
    if (a.negative !== b.negative) return a.negative ? -1 : 1;
    const sign = a.negative ? -1 : 1;
    if (a.integer.length !== b.integer.length) return (a.integer.length - b.integer.length) * sign;
    const integer = a.integer.localeCompare(b.integer, "en");
    if (integer) return integer * sign;
    const width = Math.max(a.fraction.length, b.fraction.length);
    return a.fraction.padEnd(width, "0").localeCompare(b.fraction.padEnd(width, "0"), "en") * sign;
  }

  function inventorySortValue(record, key) {
    if (key === "record") return record.title ?? "Untitled record";
    if (key === "category") return categoryLabel(record.category);
    if (key === "media") return Model.inventoryMediaEntries(record).length;
    if (key === "date") {
      const time = Date.parse(recordDate(record));
      return Number.isFinite(time) ? time : null;
    }
    const details = pledgeDetails(record);
    const money = state.activeInventory === "buybacks" ? details.buybackPrice : details.meltValue;
    return money?.amount === null || money?.amount === undefined || !money?.currency ? null : money;
  }

  function compareInventoryValues(left, right, key) {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (key === "value") {
      const currency = left.currency.localeCompare(right.currency, "en", { sensitivity: "base" });
      return currency || compareDecimalStrings(left.amount, right.amount);
    }
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "base" });
  }

  function compareInventoryRecordsFor(left, right, key, direction) {
    if (isRemoved(left) !== isRemoved(right)) return isRemoved(left) ? -1 : 1;
    if (!key) return 0;
    const leftValue = inventorySortValue(left, key);
    const rightValue = inventorySortValue(right, key);
    const comparison = compareInventoryValues(leftValue, rightValue, key);
    if (!comparison || leftValue === null || rightValue === null) return comparison;
    return direction === "descending" ? -comparison : comparison;
  }

  function compareInventoryRecords(left, right) {
    return compareInventoryRecordsFor(left, right, state.inventorySortKey, state.inventorySortDirection);
  }

  function initialInventorySortDirection(key) {
    const current = visibleInventory();
    const ascending = [...current].sort((left, right) => compareInventoryRecordsFor(left, right, key, "ascending"));
    return current.every((record, index) => record === ascending[index]) ? "descending" : "ascending";
  }

  function updateInventorySortHeaders() {
    for (const button of document.querySelectorAll("[data-inventory-sort]")) {
      const active = button.dataset.inventorySort === state.inventorySortKey;
      const direction = active ? state.inventorySortDirection : "none";
      button.closest("th").setAttribute("aria-sort", direction);
      button.classList.toggle("active", active);
      button.classList.toggle("ascending", active && direction === "ascending");
      const label = button.querySelector("span").textContent;
      button.setAttribute("aria-label", active ? `Sort by ${label}, ${direction === "ascending" ? "descending" : "ascending"}` : `Sort by ${label}`);
    }
  }

  function visibleInventory() {
    const query = refs.search.value.trim().toLocaleLowerCase();
    return inventoryRecords().filter((record) => {
      const groupMatch = state.activeGroup === "all" || record.category === state.activeGroup;
      const queryMatch = !query || Model.inventorySearchText(record).includes(query) || stateLabel(record).toLocaleLowerCase().includes(query);
      return groupMatch && queryMatch;
    }).sort(compareInventoryRecords);
  }

  function makeFact(label, value) {
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", value));
    return row;
  }

  function renderInspectorItems(record, expanded = false) {
    const items = Model.asArray(record?.items);
    inspector.itemList.replaceChildren();
    inspector.items.hidden = items.length === 0;
    inspector.itemRemainder.textContent = "";
    let toggle = byId("inspectorItemsToggle");
    if (!toggle) {
      toggle = element("button", "text-button");
      toggle.id = "inspectorItemsToggle";
      toggle.type = "button";
      toggle.setAttribute("aria-controls", "inspectorItemList");
      inspector.itemRemainder.after(toggle);
    }
    toggle.hidden = items.length <= 4;
    toggle.textContent = expanded ? "Show fewer items" : `Show all ${formatInteger(items.length)} items`;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.onclick = () => renderInspectorItems(record, !expanded);
    for (const item of expanded ? items : items.slice(0, 4)) {
      const card = element("div", "inspector-item");
      const media = element("span", "inspector-item-media");
      const image = element("img");
      image.hidden = true;
      const icon = element("span", `rsi-icon ${item.category === "gamePackage" ? "icon-game-package" : "icon-ship"}`);
      icon.setAttribute("aria-hidden", "true");
      renderLocalImage(image, icon, imageReference(item, ["thumbnail", "hero", "primary"]), item.name ?? "Contained item image");
      media.append(image, icon);
      const labels = element("span");
      labels.append(element("b", "", item.customName ? `${item.name} - ${item.customName}` : item.name ?? "Unnamed contained item"), element("small", "", item.kind ?? categoryLabel(item.category)));
      card.append(media, labels);
      inspector.itemList.append(card);
    }
  }

  // Example presentation fixtures remain isolated; loaded files use only accepted record fields.
  function pledgeDetails(record) {
    if (state.source === "demo") return globalThis.CITIZENDATA_DEMO_PLEDGE_DETAILS?.[record?.recordKey] ?? {};
    if (!record || typeof record !== "object") return {};
    return {
      meltValue: record.meltValue ?? null,
      buybackPrice: record.buybackPrice ?? null,
      baseValue: record.baseValue ?? null,
      ccuHistory: Model.asArray(record.ccuHistory)
    };
  }

  // What each buy-back's own page showed, by buy-back number. The index is built once for a loaded document.
  const buybackDetailIndexes = new WeakMap();
  function buybackDetailFor(record) {
    const loaded = state.document;
    if (!loaded || typeof loaded !== "object" || !Number.isSafeInteger(record?.buybackId)) return null;
    let index = buybackDetailIndexes.get(loaded);
    if (!index) {
      index = new Map(Model.asArray(loaded.buybackDetails).map((detail) => [detail?.buybackId, detail]));
      buybackDetailIndexes.set(loaded, index);
    }
    return index.get(record.buybackId) ?? null;
  }

  // A buy-back as the inspector shows it: the list row, with the images, ships, and contents its own page showed.
  // The buy-back list itself names no contents.
  function withBuybackDetail(record) {
    const detail = state.activeInventory === "buybacks" ? buybackDetailFor(record) : null;
    if (!detail) return record;
    const items = Model.asArray(record.items).length ? record.items : [
      ...Model.asArray(detail.ships).map((ship) => ({ name: ship.name, kind: [ship.manufacturer, ship.focus].filter(Boolean).join(" · ") || "Ship", category: "standaloneShip", images: Model.asArray(ship.images) })),
      ...Model.asArray(detail.alsoContains).map((name) => ({ name, kind: "Also contains", category: "other", images: [] }))
    ];
    return { ...record, images: [...Model.asArray(record.images), ...Model.asArray(detail.images)], items };
  }

  // What a new backup found missing since the earlier one, for the message shown when it is saved.
  function removalSummary(saved) {
    const tracking = saved?.sync?.removalTracking;
    const found = (key) => ["pledges", "buybacks"].reduce((total, list) => total + (Number.isSafeInteger(tracking?.[list]?.[key]) ? tracking[list][key] : 0), 0);
    const parts = [];
    if (found("notReconcilable")) parts.push(`${formatInteger(found("notReconcilable"))} potential ghost removal${found("notReconcilable") === 1 ? "" : "s"}`);
    return parts.length ? ` It found ${parts.join(" and ")}, shown first in the Hangar and Buybacks lists.` : "";
  }

  function capturedDateText(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "Unavailable";
  }

  function priceText(value) {
    if (value?.amount === null || value?.amount === undefined || !value?.currency) return "—";
    const amount = formatMoney(value);
    return amount === "—" ? amount : `${amount} ${value.currency}`;
  }

  let ccuOpener = null;
  const ccuDialog = byId("ccuDialog");
  ccuDialog.addEventListener("close", () => {
    if (ccuOpener?.isConnected && !ccuOpener.hidden) ccuOpener.focus({ preventScroll: true });
    ccuOpener = null;
  });

  function showCcuHistory(record, opener) {
    const details = pledgeDetails(record);
    const steps = Model.asArray(details.ccuHistory);
    if (!steps.length) return;
    text("ccuPledgeName", record.title ?? "Untitled pledge");
    text("ccuBaseValue", priceText(details.baseValue));
    const list = byId("ccuSteps");
    list.replaceChildren();
    for (const [index, step] of steps.entries()) {
      const row = element("li", "ccu-step");
      row.setAttribute("aria-label", `Upgrade ${index + 1}`);
      for (const [className, label, value] of [
        ["ccu-from", "From", step.fromShip ?? "—"],
        ["ccu-to", "To", step.toShip ?? "—"],
        ["ccu-applied", "Applied", typeof step.appliedDateRaw === "string" && step.appliedDateRaw.trim() ? step.appliedDateRaw.trim() : "—"],
        ["ccu-cost", "CCU cost", priceText(step.cost)],
        ["ccu-total", "Running total", priceText(step.cumulativeValue)]
      ]) {
        const cell = element("div", className);
        cell.append(element("span", "ccu-label", label), element("b", "ccu-value", value));
        row.append(cell);
      }
      list.append(row);
    }
    ccuOpener = opener;
    ccuDialog.showModal();
  }

  function makeCcuButton(record) {
    const button = element("button", "ccu-history-button");
    button.type = "button";
    button.setAttribute("aria-label", `View CCU history for ${record.title}`);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "ccuDialog");
    button.title = "CCU history";
    const icon = element("span", "rsi-icon icon-computer");
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    button.addEventListener("click", () => showCcuHistory(record, button));
    return button;
  }

  function mediaCountLabel(count) {
    return `${count} image${count === 1 ? "" : "s"}`;
  }

  function mediaThumbnail(entry, index, active, onSelect) {
    const button = element("button", "media-thumbnail");
    button.type = "button";
    button.classList.toggle("active", active);
    button.setAttribute("aria-label", `View image ${index + 1}: ${entry.label}`);
    button.setAttribute("aria-pressed", String(active));
    const path = localMediaPath(entry.reference);
    const error = mediaErrorMessage(entry.reference);
    button.classList.toggle("error", Boolean(error));
    if (error) button.title = error;
    if (path) {
      const image = element("img");
      image.src = path;
      image.alt = "";
      button.append(image);
    } else {
      button.append(element("span", "rsi-icon icon-media-pending"), element("small", "", error ? "!" : String(index + 1)));
    }
    button.addEventListener("click", onSelect);
    return button;
  }

  function renderInspectorMedia(record) {
    const entries = Model.inventoryMediaEntries(record);
    inspector.image.hidden = true;
    inspector.image.removeAttribute("src");
    inspector.galleryOpen.hidden = true;
    inspector.galleryOpen.onclick = null;
    inspector.galleryThumbnails.replaceChildren();
    inspector.galleryThumbnails.hidden = entries.length === 0;
    inspector.icon.hidden = entries.length > 0;
    if (!entries.length) {
      inspector.media.textContent = "NO IMAGES";
      return;
    }
    inspectorMediaIndex = Math.min(inspectorMediaIndex, entries.length - 1);
    const active = entries[inspectorMediaIndex];
    if (state.loadedMediaPackage) {
      void loadMediaReference(active.reference, 1000);
      prioritizeMediaEntries(entries.filter((entry) => entry !== active), 900);
    }
    const localImageVisible = renderLocalImage(inspector.image, null, active.reference, active.label, { priority: 1000 });
    const progress = mediaLoadProgress(entries);
    const activeError = mediaErrorMessage(active.reference);
    inspector.galleryOpen.hidden = !localImageVisible;
    inspector.galleryOpen.setAttribute("aria-label", `Open all ${mediaCountLabel(entries.length)} for ${record.title ?? "this record"}`);
    inspector.galleryOpen.onclick = () => openMediaGallery(record, inspector.galleryOpen, inspectorMediaIndex);
    inspector.media.textContent = !state.loadedMediaPackage
      ? `${mediaCountLabel(entries.length).toUpperCase()} AVAILABLE`
      : activeError
        ? `${progress.ready} OF ${progress.total} READY${progress.unavailable ? ` · ${progress.unavailable} UNAVAILABLE` : ""}`
        : localImageVisible && progress.loading === 0
          ? `${progress.ready} OF ${progress.total} READY`
          : `${progress.ready} OF ${progress.total} READY · ${progress.loading} LOADING`;
    inspector.media.title = activeError ?? "";
    inspector.galleryThumbnails.replaceChildren(...entries.map((entry, index) => listItem(mediaThumbnail(entry, index, index === inspectorMediaIndex, () => {
      inspectorMediaIndex = index;
      renderInspectorMedia(record);
    }), "media-thumbnail-item")));
  }

  function renderMediaGallery() {
    if (!mediaGalleryRecord || !refs.mediaGalleryDialog.open) return;
    const entries = Model.inventoryMediaEntries(mediaGalleryRecord);
    mediaGalleryIndex = Math.min(mediaGalleryIndex, Math.max(0, entries.length - 1));
    const active = entries[mediaGalleryIndex];
    if (state.loadedMediaPackage && active) {
      void loadMediaReference(active.reference, 2000);
      prioritizeMediaEntries(entries.filter((entry) => entry !== active), 1900);
    }
    const progress = mediaLoadProgress(entries);
    refs.mediaGalleryTitle.textContent = mediaGalleryRecord.title ?? "Record images";
    refs.mediaGalleryStatus.textContent = !entries.length
      ? "No images are recorded for this item."
      : !state.loadedMediaPackage
        ? `${mediaCountLabel(entries.length)} related to this record and its contained items. Load the Images ZIP to view them.`
        : `${progress.ready} of ${progress.total} ready${progress.loading ? ` · ${progress.loading} loading` : ""}${progress.unavailable ? ` · ${progress.unavailable} unavailable` : ""}.`;
    refs.mediaGalleryThumbnails.replaceChildren(...entries.map((entry, index) => listItem(mediaThumbnail(entry, index, index === mediaGalleryIndex, () => {
      mediaGalleryIndex = index;
      renderMediaGallery();
    }), "media-thumbnail-item")));
    const path = active ? localMediaPath(active.reference) : null;
    refs.mediaGalleryFull.hidden = !path;
    refs.mediaGalleryImage.hidden = !path;
    refs.mediaGalleryPlaceholder.hidden = Boolean(path);
    if (path) {
      refs.mediaGalleryFull.href = path;
      refs.mediaGalleryFull.setAttribute("aria-label", `Open ${active.label} full size in a new tab`);
      refs.mediaGalleryImage.src = path;
      refs.mediaGalleryImage.alt = active.label;
    } else {
      refs.mediaGalleryFull.removeAttribute("href");
      refs.mediaGalleryImage.removeAttribute("src");
      refs.mediaGalleryImage.alt = "";
      const error = active ? mediaErrorMessage(active.reference) : null;
      refs.mediaGalleryPlaceholder.textContent = active
        ? error ?? (state.loadedMediaPackage ? "Loading this image from the selected ZIP." : "Load the offline image ZIP to view this image.")
        : "No images are recorded for this item.";
    }
  }

  function openMediaGallery(record, opener, startIndex = 0) {
    mediaGalleryRecord = record;
    mediaGalleryIndex = Math.max(0, startIndex);
    mediaGalleryOpener = opener;
    if (!refs.mediaGalleryDialog.open) refs.mediaGalleryDialog.showModal();
    renderMediaGallery();
  }

  function selectRecord(record, focusInspector = false, announce = false) {
    if (state.activeRecordKey !== (record?.recordKey ?? null)) inspectorMediaIndex = record ? Model.inventoryLeadMediaIndex(record) : 0;
    state.activeRecordKey = record?.recordKey ?? null;
    // One short line replaces a live region over the whole inspector, which re-read every field on each selection.
    if (announce && record) refs.inspectorAnnouncement.textContent = `Showing details for ${record.title ?? "untitled record"}.`;
    renderWikiLink(record);
    for (const row of refs.rows.querySelectorAll("tr")) row.classList.toggle("selected", row.dataset.recordKey === state.activeRecordKey);
    inspector.ccu.hidden = !Model.asArray(pledgeDetails(record).ccuHistory).length;
    inspector.ccu.onclick = record ? () => showCcuHistory(record, inspector.ccu) : null;
    inspector.ccu.setAttribute("aria-label", `View CCU history for ${record?.title ?? "pledge"}`);
    if (!record) {
      inspector.title.textContent = "No visible record selected";
      inspector.subtitle.textContent = "Adjust the filters to restore records.";
      inspector.group.textContent = "NO SELECTION";
      inspector.facts.replaceChildren();
      renderInspectorItems(null);
      renderInspectorMedia(null);
      inspector.source.hidden = true;
      inspector.sourcePending.hidden = false;
      return;
    }
    inspector.group.textContent = categoryLabel(record.category).toUpperCase();
    inspector.title.textContent = record.title ?? "Untitled record";
    inspector.subtitle.textContent = record.containsSummary ?? "No contained-item summary in the loaded document.";
    const shown = withBuybackDetail(record);
    const mediaEntries = Model.inventoryMediaEntries(shown);
    renderInspectorMedia(shown);
    inspector.facts.replaceChildren(
      makeFact("State", stateLabel(record)),
      makeFact("Date", recordDate(record)),
      makeFact("Media", mediaEntries.length ? mediaCountLabel(mediaEntries.length) : "No images")
    );
    const details = pledgeDetails(record);
    const isBuyback = state.activeInventory === "buybacks";
    // A record that went missing shows when it was last listed, when it was first found missing, and what the
    // Hangar Log says about it. One that is listed again keeps those facts.
    const removal = record.removal && typeof record.removal === "object" ? record.removal : null;
    if (removal) {
      if (removal.lastSeenAt) inspector.facts.append(makeFact("Last Seen", capturedDateText(removal.lastSeenAt)));
      if (removal.firstMissingAt) inspector.facts.append(makeFact("First Missing", capturedDateText(removal.firstMissingAt)));
      if (removal.returnedAt) inspector.facts.append(makeFact("Listed Again", capturedDateText(removal.returnedAt)));
      if (!removal.returnedAt) inspector.facts.append(makeFact("Hangar Log", `No entry names this ${isBuyback ? "buy-back" : "pledge"}`));
    }
    if (isBuyback) {
      // A buy-back's price is the one its own page showed on the day it was read. An upgrade's price is not recorded.
      const detail = buybackDetailFor(record);
      if (detail?.price && detail.capturedAt) inspector.facts.append(makeFact("Price Read", capturedDateText(detail.capturedAt)));
      if (detail?.originalPrice) inspector.facts.append(makeFact("Before Discount", priceText(detail.originalPrice)));
      if (detail?.discountText) inspector.facts.append(makeFact("Discount", detail.discountText));
      inspector.facts.append(makeFact("Buyback Price", inventoryValueText(record)));
    } else inspector.facts.append(makeFact("Melt Value", priceText(details.meltValue)));
    renderInspectorItems(shown);
    inspector.note.textContent = state.source === "demo"
      ? "An example record for exploring the dashboard."
      : isRemoved(record)
        ? "Your earlier backup listed this record. RSI no longer lists it, and no Hangar Log entry accounts for it. Keep your earlier backup files."
        : "Details from your account file.";
    const link = safeRsiLink(record);
    inspector.source.hidden = !link;
    inspector.sourcePending.hidden = Boolean(link);
    if (link) {
      inspector.source.href = link;
      inspector.source.target = "_blank";
      inspector.source.rel = "noreferrer noopener";
    }
    if (focusInspector) inspector.panel.focus({ preventScroll: true });
  }

  // Search and category filters run over the whole dataset first; only the matching records are paged.
  function renderInventory() {
    text("inventoryValueHeading", inventoryValueHeading());
    updateInventorySortHeaders();
    const visible = visibleInventory();
    const page = Model.paginate(visible, state.inventoryPage, INVENTORY_PAGE_SIZE);
    state.inventoryPage = page.page;
    refs.rows.replaceChildren();
    for (const [rowIndex, record] of page.items.entries()) {
      const row = element("tr");
      row.dataset.recordKey = record.recordKey;
      const removed = isRemoved(record);
      if (removed) row.classList.add("record-ghost");
      const recordCell = element("td");
      const button = element("button", "record-button");
      button.type = "button";
      const icon = element("span", "row-icon");
      const iconGlyph = element("span", `rsi-icon ${record.category === "gamePackage" ? "icon-game-package" : "icon-ship"}`);
      iconGlyph.setAttribute("aria-hidden", "true");
      const thumbnail = element("img", "row-thumbnail");
      thumbnail.hidden = true;
      // A CCU shows the ship it leads to.
      const leadIndex = Model.inventoryLeadMediaIndex(record);
      const thumbnailReference = leadIndex > 0 ? Model.inventoryMediaEntries(record)[leadIndex].reference : imageReference(record, ["upgrade-destination"]) ?? imageReference(record, ["thumbnail", "hero", "primary"]);
      const thumbnailAlt = record.title ?? "Account record image";
      const localThumbnailVisible = renderLocalImage(thumbnail, iconGlyph, thumbnailReference, thumbnailAlt, { priority: null });
      icon.append(thumbnail, iconGlyph);
      if (localThumbnailVisible) icon.classList.add("has-image");
      // The thumbnails of the page shown are loaded from the open images, top row first and behind the selected
      // record's own images. Each one is put into its row when it is ready.
      else if (state.loadedMediaPackage && thumbnailReference?.imageKey) {
        void loadMediaReference(thumbnailReference, 5 - rowIndex / 1000, true).then((ready) => {
          if (ready && thumbnail.isConnected && renderLocalImage(thumbnail, iconGlyph, thumbnailReference, thumbnailAlt, { priority: null })) icon.classList.add("has-image");
        });
      }
      const labels = element("span");
      labels.append(element("b", "", record.title ?? "Untitled record"), element("small", "", record.containsSummary ?? categoryLabel(record.category)));
      button.append(icon, labels);
      button.addEventListener("click", () => selectRecord(record, matchMedia("(max-width: 980px)").matches, true));
      const entry = element("div", "record-entry");
      entry.append(button);
      if (Model.asArray(pledgeDetails(record).ccuHistory).length) entry.append(makeCcuButton(record));
      if (removed) recordCell.append(element("div", "record-warning", stateLabel(record)));
      recordCell.append(entry);
      const categoryCell = element("td", "", categoryLabel(record.category));
      const valueCell = element("td", "inventory-value");
      valueCell.append(element("span", "inventory-amount", inventoryValueText(record)));
      const dateCell = element("td", "", recordDate(record));
      const mediaCell = element("td");
      const mediaEntries = Model.inventoryMediaEntries(record);
      if (mediaEntries.length) {
        const mediaButton = element("button", "media-label media-gallery-trigger", mediaCountLabel(mediaEntries.length));
        mediaButton.type = "button";
        mediaButton.setAttribute("aria-haspopup", "dialog");
        mediaButton.setAttribute("aria-controls", "mediaGalleryDialog");
        mediaButton.setAttribute("aria-label", `Open ${mediaCountLabel(mediaEntries.length)} for ${record.title ?? "this record"}`);
        mediaButton.addEventListener("click", () => openMediaGallery(record, mediaButton, Model.inventoryLeadMediaIndex(record)));
        mediaCell.append(mediaButton);
      } else {
        mediaCell.append(element("span", "media-label", "No images"));
      }
      row.append(recordCell, categoryCell, valueCell, dateCell, mediaCell);
      row.setAttribute("role", "row");
      for (const [index, cell] of [...row.children].entries()) {
        cell.setAttribute("role", "cell");
        if (index > 0) {
          const label = element("span", "cell-label", ["Record", "Category", inventoryValueHeading(), "Date", "Media"][index]);
          label.setAttribute("aria-hidden", "true");
          cell.prepend(label);
        }
      }
      refs.rows.append(row);
    }
    refs.emptyState.hidden = visible.length !== 0;
    const total = inventoryRecords().length;
    const paged = page.totalPages > 1;
    const firstShown = (page.page - 1) * INVENTORY_PAGE_SIZE + 1;
    refs.resultCount.textContent = paged
      ? `${formatInteger(firstShown)} to ${formatInteger(firstShown + page.items.length - 1)} of ${formatInteger(visible.length)}${visible.length === total ? "" : ` matching, ${formatInteger(total)} total`}`
      : `${formatInteger(visible.length)} shown of ${formatInteger(total)}`;
    refs.caption.textContent = `${state.activeInventory === "hangar" ? "Current Hangar" : "Buyback"} records from the ${state.source === "demo" ? "example data" : "loaded local document"}.${paged ? ` Page ${page.page} of ${page.totalPages}.` : ""}`;
    refs.inventoryPagination.hidden = !paged;
    refs.inventoryPageStatus.textContent = `${formatInteger(visible.length)} ${visible.length === total ? "records" : `match${visible.length === 1 ? "" : "es"}`} · page ${page.page} of ${page.totalPages}`;
    refs.inventoryPrevious.disabled = page.page <= 1;
    refs.inventoryNext.disabled = page.page >= page.totalPages;
    const selected = page.items.find((record) => record.recordKey === state.activeRecordKey) ?? page.items[0] ?? null;
    selectRecord(selected);
  }

  function setInventoryPage(pageNumber) {
    state.inventoryPage = pageNumber;
    state.activeRecordKey = null;
    renderInventory();
    refs.tableShell.scrollTop = 0;
  }

  function setInventoryView(view, focus = false) {
    state.activeInventory = view;
    state.activeRecordKey = null;
    state.inventoryPage = 1;
    refs.search.value = "";
    state.activeGroup = "all";
    refs.filterCount.textContent = "0";
    for (const button of document.querySelectorAll("[data-view]")) {
      const selected = button.dataset.view === view;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (focus && selected) button.focus();
    }
    for (const chip of document.querySelectorAll(".filter-chip")) {
      const selected = chip.dataset.group === "all";
      chip.classList.toggle("active", selected);
      chip.setAttribute("aria-pressed", String(selected));
    }
    renderInventory();
  }

  // The session's own inventory tab, filter, search, sort, page and selected record, as they were left.
  function showInventoryView() {
    for (const button of document.querySelectorAll("[data-view]")) {
      const selected = button.dataset.view === state.activeInventory;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    refs.search.value = state.inventorySearch;
    syncFilterChips();
    renderInventory();
  }

  function referralRecords() {
    const [source, kind] = state.referralPath.split(".");
    return Model.asArray(state.document.referrals?.[source]?.[kind]);
  }

  function renderReferralCards() {
    const container = byId("referralCards");
    container.replaceChildren();
    for (const source of ["current", "legacy"]) {
      const card = element("section", "ladder-card");
      card.append(element("h3", "", `${source === "current" ? "Current" : "Legacy"} ladder`));
      const actions = element("div", "ladder-actions");
      for (const kind of ["prospects", "recruits"]) {
        const path = `${source}.${kind}`;
        const button = element("button", path === state.referralPath ? "active" : "");
        button.type = "button";
        button.dataset.referralPath = path;
        button.setAttribute("aria-pressed", String(path === state.referralPath));
        button.append(element("span", "", kind === "prospects" ? "Prospects" : "Recruits"), element("b", "", formatInteger(state.document.referrals[source][kind].length)));
        button.addEventListener("click", () => {
          state.referralPath = path;
          state.referralPage = 1;
          renderReferrals();
          [...container.querySelectorAll("button")].find((item) => item.dataset.referralPath === path)?.focus({ preventScroll: true });
        });
        actions.append(button);
      }
      card.append(actions);
      container.append(card);
    }
  }

  function labelCollectionRow(row, labels) {
    row.setAttribute("role", "row");
    [...row.cells].forEach((cell, index) => {
      cell.setAttribute("role", "cell");
      const label = element("span", "collection-cell-label", labels[index]);
      label.setAttribute("aria-hidden", "true");
      if (index >= 2) {
        const value = element("span", "collection-cell-value");
        value.append(...cell.childNodes);
        cell.replaceChildren(value);
      }
      cell.prepend(label);
    });
  }

  function personLabel(label, url, action) {
    if (!url) return element("span", "", label);
    const link = element("a", "person-link", label);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${label}: ${action} (opens in a new tab)`);
    return link;
  }

  function personCell(record, redacted = false, links = Model.personLinks(record.handle, { redacted }), exampleProspect = false) {
    const cell = element("td");
    const person = element("div", "person-identity");
    if (!redacted) {
      const avatar = element("img", "person-avatar");
      renderLocalImage(avatar, null, imageReference(record, ["avatar", "portrait", "thumbnail"]), `${record.displayName ?? record.handle ?? "Member"} avatar`);
      person.append(avatar);
    }
    person.append(personLabel(redacted ? "Redacted Member" : record.displayName ?? "Unavailable", links?.monikerUrl, exampleProspect ? "Star Citizen signup, example link" : "message on Spectrum"));
    cell.append(person);
    return cell;
  }

  function usernameCell(record, redacted = false, links = Model.personLinks(record.handle, { redacted }), exampleProspect = false) {
    const cell = element("td", "handle-cell");
    cell.append(personLabel(!redacted && record.handle ? `@${record.handle}` : "—", links?.usernameUrl, exampleProspect ? "Star Citizen signup, example link" : "RSI dossier"));
    return cell;
  }

  function renderReferrals() {
    renderReferralCards();
    const [source, kind] = state.referralPath.split(".");
    const query = state.referralSearch.trim().toLocaleLowerCase();
    const allRecords = referralRecords();
    const filtered = allRecords.filter((record) => !query || Model.referralSearchText(record).includes(query));
    const sorted = Model.sortReferralRecords(filtered, state.referralOrder);
    const page = Model.paginate(sorted, state.referralPage, PAGE_SIZE);
    state.referralPage = page.page;
    const sourceLabel = source === "current" ? "Current" : "Legacy";
    const kindLabel = kind === "prospects" ? "prospects" : "recruits";
    text("referralListTitle", `${sourceLabel} ${kindLabel}`);
    refs.referralSearchLabel.textContent = `Search ${sourceLabel.toLocaleLowerCase()} ${kindLabel} by moniker or username`;
    refs.referralSearch.setAttribute("aria-label", refs.referralSearchLabel.textContent);
    refs.referralSearchCount.textContent = query ? `${formatInteger(filtered.length)} match${filtered.length === 1 ? "" : "es"}` : "";
    const section = `referrals.${source}.${kind}`;
    const anomalyCount = state.source === "demo" ? 0 : Model.asArray(state.document.dataQuality?.anomalies).filter((entry) => entry?.section === section).length;
    const baseOutcome = state.source === "demo" ? "Example data" : state.document.sync?.sectionOutcomes?.[section]?.status ?? "Status unavailable";
    const referralOutcome = anomalyCount ? `${baseOutcome} · ${formatInteger(anomalyCount)} raw data warning${anomalyCount === 1 ? "" : "s"}` : baseOutcome;
    text("referralOutcome", referralOutcome);
    text("referralCaption", `${sourceLabel} ${kindLabel}, ${state.referralOrder} first.${query ? " Search filter applied." : ""} Collection outcome: ${referralOutcome}.`);
    const rows = byId("referralRows");
    rows.replaceChildren();
    for (const record of page.items) {
      const row = element("tr");
      const exampleProspect = state.source === "demo" && kind === "prospects";
      const links = Model.personLinks(record.handle, { exampleProspect });
      row.append(personCell(record, false, links, exampleProspect), usernameCell(record, false, links, exampleProspect), element("td", "", record.dateRaw ?? "Unavailable"));
      labelCollectionRow(row, ["Moniker", "Username", "Date"]);
      rows.append(row);
    }
    if (!page.items.length) {
      const row = element("tr");
      const cell = element("td", "empty-table-cell", query ? "No referral matches this moniker or username." : "No records were loaded for this list.");
      cell.colSpan = 3;
      row.append(cell);
      rows.append(row);
    }
    text("referralPageStatus", `${formatInteger(page.total)} ${query ? `match${page.total === 1 ? "" : "es"}` : "records"} · page ${page.page} of ${page.totalPages}`);
    byId("referralPrevious").disabled = page.page <= 1;
    byId("referralNext").disabled = page.page >= page.totalPages;
    const sortButton = byId("referralSortButton");
    sortButton.dataset.order = state.referralOrder;
    sortButton.lastChild.textContent = state.referralOrder === "newest" ? "Newest first" : "Oldest first";
    sortButton.classList.toggle("ascending", state.referralOrder === "oldest");
    rows.closest(".collection-table-shell").scrollTop = 0;
  }

  function renderMemberships() {
    const memberships = Model.asArray(state.document.organizations?.memberships);
    if (!memberships.some((item) => item.sid === state.organizationSid)) state.organizationSid = mainMembership()?.sid ?? memberships[0]?.sid ?? "";
    const container = byId("membershipList");
    container.replaceChildren();
    for (const membership of memberships) {
      const selected = membership.sid === state.organizationSid;
      const button = element("button", selected ? "active" : "");
      button.type = "button";
      button.setAttribute("aria-pressed", String(selected));
      button.dataset.organizationSid = membership.sid;
      const emblem = element("img", "membership-emblem");
      renderLocalImage(emblem, null, imageReference(membership, ["emblem", "organizationEmblem"]), `${membership.name ?? membership.sid} emblem`);
      const copy = element("span", "membership-copy");
      const count = membership.memberCount === null || membership.memberCount === undefined ? "Member count unavailable" : `${formatInteger(membership.memberCount)} members`;
      copy.append(element("b", "", membership.name ?? membership.sid), element("span", "", `${membership.sid} · ${membership.membershipType ?? "membership"} · ${count}`));
      button.append(emblem, copy);
      button.addEventListener("click", () => {
        state.organizationSid = membership.sid;
        state.organizationPage = 1;
        renderOrganizations();
        const selector = byId("organizationSelector");
        selector.open = false;
        selector.querySelector(":scope > summary")?.focus({ preventScroll: true });
      });
      container.append(listItem(button, "membership-card"));
    }
  }

  function renderOrganizations() {
    renderMemberships();
    const memberships = Model.asArray(state.document.organizations?.memberships);
    const membership = memberships.find((item) => item.sid === state.organizationSid) ?? memberships[0] ?? null;
    const allMembers = state.source === "demo"
      ? Model.membersForOrganization(state.document, state.organizationSid)
      : globalThis.CitizenDataOrganizationDocument.membersFor(state.organizationDocument, state.organizationSid);
    const query = state.organizationSearch.trim().toLocaleLowerCase();
    const members = allMembers.filter((member) => !query || `${member.displayName ?? ""}\n${member.handle ?? ""}`.toLocaleLowerCase().includes(query));
    const page = Model.paginate(members, state.organizationPage, PAGE_SIZE);
    state.organizationPage = page.page;
    text("organizationSummaryName", mainMembership()?.name ?? "No organization membership");
    text("organizationSummaryCount", `${formatInteger(memberships.length)} organization${memberships.length === 1 ? "" : "s"}`);
    text("organizationListTitle", membership?.name ?? "No selected organization");
    const rosterIndex = state.organizationDocument?.rosterIndex?.find((entry) => entry.organizationSid === state.organizationSid);
    const organizationOutcome = state.source === "demo" ? "Example data" : rosterIndex?.status ?? "Not downloaded";
    text("organizationCaption", `${membership?.name ?? "Organization"} members. Status: ${organizationOutcome}.`);
    const rows = byId("organizationRows");
    rows.replaceChildren();
    for (const member of page.items) {
      const row = element("tr");
      const redacted = member.visibility === "restricted";
      const roles = Model.asArray(member.roles).join(", ") || "—";
      const rank = member.rank ? `${member.rank}${Number.isInteger(member.rankStars) ? ` · ${member.rankStars} star${member.rankStars === 1 ? "" : "s"}` : ""}` : "—";
      row.append(
        personCell(member, redacted),
        usernameCell(member, redacted),
        element("td", "", rank),
        element("td", "", roles),
        element("td", "", member.membershipType === "main" ? "Main" : member.membershipType === "affiliate" ? "Affiliate" : member.membershipType ?? "—")
      );
      labelCollectionRow(row, ["Moniker", "Username", "Rank", "Role", "Membership"]);
      rows.append(row);
    }
    if (!page.items.length) {
      const row = element("tr");
      const cell = element("td", "empty-table-cell", query ? "No member matches this moniker or username." : "No members in the loaded Orgs JSON. Organization downloads are optional.");
      cell.colSpan = 5;
      row.append(cell);
      rows.append(row);
    }
    const total = Number.isInteger(membership?.memberCount) ? ` of ${formatInteger(membership.memberCount)}` : "";
    text("organizationPageStatus", `${formatInteger(page.total)}${total} members in this file · page ${page.page} of ${page.totalPages}`);
    text("organizationSearchCount", query ? `${formatInteger(page.total)} matches` : "");
    renderFileStatus(Array.isArray(state.document.dataQuality?.anomalies) ? state.document.dataQuality.anomalies.length : 0);
    updateOrganizationActionAvailability();
    rows.closest(".collection-table-shell").scrollTop = 0;
    byId("organizationPrevious").disabled = page.page <= 1;
    byId("organizationNext").disabled = page.page >= page.totalPages;
  }

  // The page shows the empty state, and none of the account sections, while the account shown has no document.
  function renderAccountState() {
    const identityOnly = activeSession().identityOnly;
    if (identityOnly) document.body.dataset.accountState = "identity-only";
    else delete document.body.dataset.accountState;
    patchHidden(refs.accountEmptyState, !identityOnly);
    renderAccountMenu();
  }

  // `keepView`: a session shown again keeps its inventory view; a document just opened starts it again.
  function renderAll({ keepView = false } = {}) {
    renderAccountState();
    renderIdentity();
    renderSummary();
    renderBadges();
    if (keepView) showInventoryView();
    else setInventoryView(state.activeInventory);
    renderReferrals();
    renderOrganizations();
  }

  function documentForSelectedExports() {
    if (!state.organizationDocument || state.source === "demo") return state.document;
    const combined = structuredClone(state.document);
    combined.organizations.members = structuredClone(state.organizationDocument.members);
    return combined;
  }

  function updateBuildAction() {
    text("buildButtonLabel", "Build");
    refs.buildButton.disabled = false;
    refreshAccountMenuAvailability();
  }

  function accountOperationActive() {
    const jobStatus = state.publicStatus?.activeJob?.status;
    return state.connecting || state.publicStatus?.hasActiveJob === true || state.publicStatus?.requiresRebind === true || state.continuePartial || ["running", "paused"].includes(jobStatus);
  }

  function activeOperationNotice() {
    if (state.mediaController) return "An Images job is running in Build Status. Finish or cancel it before starting Organization Data.";
    if (accountOperationActive()) {
      return state.publicStatus?.activeJob?.jobKind === "organizationData"
        ? "An Organization Data job is already running in Build Status. Finish or cancel it before starting another job."
        : "An Account Data job is running in Build Status. Finish or cancel it before starting Organization Data.";
    }
    return "";
  }

  function updateOrganizationActionAvailability() {
    const notice = activeOperationNotice()
      || (state.extensionUpdateRequired ? "Update the Star Citizen Data Downloader extension, then reload this page, before starting Organization Data." : "")
      || (!state.bridge ? "Connect the Star Citizen Data Downloader extension before starting Organization Data." : "");
    const hasMemberships = Model.asArray(state.document.organizations?.memberships).length > 0;
    refs.buildOrgButton.disabled = !hasMemberships || state.source === "demo" || !state.bridge || state.extensionUpdateRequired;
    refs.orgBuildAvailability.textContent = notice;
    refs.orgBuildAvailability.hidden = !notice;
    const selected = refs.orgRosterChecklist.querySelectorAll('input[type="checkbox"]:checked').length;
    refs.orgBuildStart.disabled = Boolean(notice) || selected === 0;
  }

  // Shown in place of the account card while no extension can be reached, so the Build panel always offers a next step.
  function refreshExtensionNotice(accountActive) {
    const needsExtension = !accountActive && !state.bridge;
    const localCopy = location.protocol === "file:";
    refs.extensionNotice.hidden = !needsExtension;
    refs.buildAccountAction.hidden = needsExtension;
    // An installed extension that only awaits approval needs no store link.
    refs.installExtensionAction.hidden = !needsExtension || (state.localApprovalRequired && !state.extensionUpdateRequired);
    if (!needsExtension) return;
    refs.installExtensionAction.href = EXTENSION_INSTALL_URL;
    if (state.extensionUpdateRequired) {
      text("extensionNoticeTitle", "Star Citizen Data Downloader extension needs an update");
      text("extensionNoticeDetail", "The installed extension and this page use different connection versions. Update the extension, then reload this page.");
      text("installExtensionTitle", "Update the Star Citizen Data Downloader extension.");
      text("installExtensionDetail", "Update from the Chrome Web Store.");
      return;
    }
    if (state.localApprovalRequired) {
      text("extensionNoticeTitle", "Allow this local copy");
      text("extensionNoticeDetail", "The Star Citizen Data Downloader extension is installed and is waiting for your approval. Click the Star Citizen Data Downloader icon in the Chrome toolbar, then choose Allow this local dashboard.");
      return;
    }
    text("extensionNoticeTitle", "Star Citizen Data Downloader extension not detected");
    text("extensionNoticeDetail", localCopy
      ? "This page cannot read an RSI account on its own. For a downloaded copy: install the extension and turn on \u201cAllow access to file URLs\u201d in its Chrome details page. Once the extension is on, reload this page, then approve this copy from the Star Citizen Data Downloader toolbar icon."
      : "This page cannot read an RSI account on its own. The extension does that in your browser. Install the extension. Once the extension is on, reload this page.");
    text("installExtensionTitle", "Get the Star Citizen Data Downloader extension.");
    text("installExtensionDetail", "Install from the Chrome Web Store.");
  }

  function refreshBuildChoices() {
    const accountActive = accountOperationActive();
    const mediaActive = Boolean(state.mediaController);
    const mediaReady = Boolean(state.pendingMediaPackage || state.loadedMediaPackage);
    refreshExtensionNotice(accountActive);
    text("buildAccountActionTitle", accountActive ? "View account backup" : state.source === "demo" ? "Build account backup" : "Update account backup");
    text("buildAccountActionDetail", accountActive ? "Return to the active account collection status." : state.bridge ? "Read your RSI account and update the open document." : "Connect the Star Citizen Data Downloader extension to build account data.");
    refs.buildAccountAction.disabled = mediaActive || (!accountActive && (!state.bridge || state.extensionUpdateRequired));
    text("buildImagesActionTitle", mediaActive ? "View image download" : state.pendingMediaPackage ? "Review offline image ZIP" : state.loadedMediaPackage ? "Update offline images" : "Download offline images");
    text("buildImagesActionDetail", mediaActive ? "Return to image progress and controls." : state.pendingMediaPackage ? "Return to the completed image package or save it again." : state.loadedMediaPackage ? `${state.loadedMediaFileName ?? "The loaded Images ZIP"} is open. Download only the current image delta.` : state.mediaPlan.length ? `Download ${formatInteger(state.mediaPlan.length)} unique images from the open account document.` : "Load an account document and wait for its image plan.");
    refs.buildImagesAction.disabled = (!mediaActive && accountActive) || (!mediaActive && !mediaReady && (state.source === "demo" || state.mediaPlan.length === 0));
    if (!refs.buildChoices.hidden && !accountActive && !mediaActive) describeBuildChoices();
  }

  // The line above the choices says what can be chosen now. A choice that cannot be made is not offered in it; it
  // says what that choice needs instead.
  function describeBuildChoices() {
    const dataOffered = !refs.buildAccountAction.hidden && !refs.buildAccountAction.disabled;
    const imagesOffered = !refs.buildImagesAction.disabled;
    const dataNeeds = state.extensionUpdateRequired
      ? "Data needs an update of the Star Citizen Data Downloader extension."
      : state.localApprovalRequired
        ? "Data needs your approval of this copy in the Star Citizen Data Downloader extension."
        : "Data needs the Star Citizen Data Downloader extension.";
    const imagesNeed = state.source === "demo" ? "Images need an open account document." : "Images are not ready for this document yet.";
    if (dataOffered && imagesOffered) setBridgeStatus("READY", "Choose what to build", "Nothing starts until you choose Data or Images.", "active", false);
    else if (dataOffered) setBridgeStatus("READY", "Choose what to build", `Nothing starts until you choose Data. ${imagesNeed}`, "active", false);
    else if (imagesOffered) setBridgeStatus("READY", "Choose what to build", `Nothing starts until you choose Images. ${dataNeeds}`, "active", false);
    else setBridgeStatus("READY", "Before you can build", `${dataNeeds} ${imagesNeed}`, "active", false);
  }

  function openBuildChooser() {
    if (state.mediaController) {
      reopenMediaOverlay();
      return;
    }
    if (showCoolingDown()) return;
    if (accountOperationActive()) {
      state.mediaOverlayActive = false;
      showOverlayExpanded();
      renderCollectionStatus(state.publicStatus);
      return;
    }
    state.mediaOverlayActive = false;
    showOverlayExpanded();
    refs.buildChoices.hidden = false;
    refreshBuildChoices();
    refs.overlayOperation.textContent = "BUILD";
    refs.collectionActivity.hidden = true;
    refs.collectionControls.hidden = true;
    refs.mediaControls.hidden = true;
    refs.eventLog.hidden = true;
    setCollectionActivityImage(false);
  }

  function reopenMediaOverlay() {
    showOverlayExpanded();
    if (state.mediaController && state.mediaCancelRequested === state.mediaController) {
      renderMediaOverlay({ badge: "CANCELLING", operation: "Cancelling image download", detail: "Stopping active requests and waits.", tone: "warning", active: true });
    } else if (state.mediaController) {
      renderMediaOverlay(downloadingPresentation(state.mediaPlan.length));
    } else if (state.pendingMediaPackage) {
      renderMediaOverlay({ badge: "COMPLETED", operation: "Offline image ZIP ready", detail: refs.mediaStatus.textContent, tone: "success", active: false, completed: state.mediaPlan.length, total: state.mediaPlan.length });
    } else {
      renderMediaOverlay({ badge: "READY", operation: "Offline images ready", detail: "Choose Download offline images from Build to start.", active: false, completed: 0, total: state.mediaPlan.length });
    }
  }

  // The sentence under "Downloading offline images". Its structure never changes; only its numbers do.
  function mediaDownloadDetail(total) {
    return `${formatInteger(state.mediaCompleted)} of ${formatInteger(total)} images finished. ${formatInteger(state.mediaActiveRequests)} of ${formatInteger(globalThis.CITIZENDATA_MEDIA_POLICY.maximumConcurrency)} requests active.`;
  }

  // The running download as the panel shows it. While it waits, the line counts down to the wait's end, and only the
  // time in it changes each second.
  function downloadingPresentation(total) {
    const detail = mediaDownloadDetail(total);
    const wait = state.mediaWait;
    const lead = wait?.reason === "rate-limit" ? "Image requests were refused. Trying again in " : "Next image request in ";
    const countdown = wait ? Object.freeze({ until: wait.waitingUntil, lead: `${detail} ${lead}`, tail: ".", after: `${detail} The wait ended. Resuming image requests.` }) : null;
    return { badge: "DOWNLOADING", operation: "Downloading offline images", detail, countdown, active: true, completed: state.mediaCompleted, total };
  }

  function waitSeconds(milliseconds) {
    const seconds = milliseconds / 1000;
    const shown = seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10;
    return `${shown.toLocaleString("en-US")} ${shown === 1 ? "second" : "seconds"}`;
  }

  // The image run's waits in the log: one line when a wait after refused requests, a retry's wait, or a gap long enough
  // to look like a stop begins or is set again, and one when such a wait ends. No line is added while a wait lasts.
  const LOGGED_GAP_MS = 2000;
  function noteMediaWait(wait, total) {
    if (wait.reason === "retry") {
      if (wait.phase === "waiting") addMediaActivity(`Retrying image ${formatInteger(wait.imageIndex + 1)} in ${waitSeconds(wait.waitMs)}.`, "warning");
      return;
    }
    if (wait.reason === "request-spacing" && wait.waitMs < LOGGED_GAP_MS) return;
    if (wait.phase === "waiting") {
      const previous = state.mediaWait;
      state.mediaWait = wait;
      const refusedWait = wait.reason === "rate-limit";
      if (!previous || previous.reason !== wait.reason || previous.waitingUntil !== wait.waitingUntil) {
        addMediaActivity(refusedWait ? `Image requests were refused. Waiting ${waitSeconds(wait.waitMs)} before trying again.` : `Waiting ${waitSeconds(wait.waitMs)} before the next image request.`, refusedWait ? "warning" : "normal");
      }
    } else {
      if (!state.mediaWait) return;
      state.mediaWait = null;
      addMediaActivity("The wait ended. Resuming image requests.");
    }
    renderMediaOverlay(downloadingPresentation(total));
  }

  // Cancel of an image run: the panel says so at once, and the run stops in whatever wait or request it is in. A second
  // click changes nothing; the run's own end shows CANCELLED.
  function requestMediaCancel() {
    const controller = state.mediaController;
    if (!controller || state.mediaCancelRequested === controller) return;
    state.mediaCancelRequested = controller;
    addMediaActivity("Cancellation requested. Stopping active requests and waits.", "warning");
    renderMediaOverlay({ badge: "CANCELLING", operation: "Cancelling image download", detail: "Stopping active requests and waits.", tone: "warning", active: true });
    controller.abort();
  }

  function chooseAccountBuild() {
    if (showCoolingDown()) return;
    refs.buildChoices.hidden = true;
    refs.eventLog.hidden = false;
    if (accountOperationActive()) {
      state.mediaOverlayActive = false;
      showOverlayExpanded();
      renderCollectionStatus(state.publicStatus);
      return;
    }
    void proposeBuild();
  }

  function chooseImageBuild() {
    refs.buildChoices.hidden = true;
    refs.eventLog.hidden = false;
    const planIsCurrent = state.mediaPlanDocument === state.document;
    if (state.mediaController || state.pendingMediaPackage && planIsCurrent) {
      reopenMediaOverlay();
      return;
    }
    // A plan made for another document than the one open is made again first.
    if (!planIsCurrent) {
      void prepareMediaPlan().then(() => { if (state.mediaPlanDocument === state.document) void runMediaDownload(); });
      return;
    }
    void runMediaDownload();
  }

  function activateRail(link) {
    for (const candidate of document.querySelectorAll(".rail-nav a")) {
      const selected = candidate === link;
      candidate.classList.toggle("active", selected);
      if (selected) candidate.setAttribute("aria-current", "page");
      else candidate.removeAttribute("aria-current");
    }
  }

  // Switching or adding an account waits while a job runs, so no result or image run is put under the wrong account.
  function accountSwitchBlocker() {
    const finish = "Finish or cancel it before switching or adding an account.";
    if (state.mediaController) return `An Images job is running in Build Status. ${finish}`;
    if (accountOperationActive()) {
      return state.publicStatus?.activeJob?.jobKind === "organizationData"
        ? `An Organization Data job is running in Build Status. ${finish}`
        : `An Account Data job is running in Build Status. ${finish}`;
    }
    if (state.accountRequestPending) return "The extension is finding the account signed in to RSI.";
    return "";
  }

  function accountMenuItems() {
    return [...refs.accountMenu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].filter((item) => !item.closest("[hidden]"));
  }

  // Every item, shown or not, so the menu is right the moment it opens.
  function refreshAccountMenuAvailability() {
    const blocker = accountSwitchBlocker();
    for (const item of [...refs.accountMenuAccounts.children, refs.addAccountCommand, refs.removeAccountCommand]) patchAttr(item, "aria-disabled", blocker ? "true" : null);
    patchText(refs.accountMenuStatus, blocker);
    patchHidden(refs.accountMenuStatus, !blocker);
  }

  // One menu item for each account open in this page, in the order they were opened; the account shown is checked.
  function renderAccountMenu() {
    const entries = accounts.entries(activeAccountKey);
    const focusedKey = refs.accountMenuAccounts.contains(document.activeElement) ? document.activeElement.dataset.accountKey : null;
    refs.accountMenuAccounts.replaceChildren(...entries.map((entry) => {
      const item = element("button", "account-menu-item");
      item.type = "button";
      item.tabIndex = -1;
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(entry.current));
      item.dataset.accountKey = entry.key;
      item.append(element("span", "account-menu-label", entry.label));
      // The space keeps the name and the handle apart in the item's accessible name; the grid does not show it.
      if (entry.detail) item.append(" ", element("small", "account-menu-detail", entry.detail));
      return item;
    }));
    refs.accountMenuAccounts.hidden = entries.length === 0;
    refs.accountMenuSeparator.hidden = entries.length === 0;
    // Remove this account is offered for an account shown with an extension that keeps accounts.
    patchHidden(refs.removeAccountCommand, !(activeSession() !== exampleSession && state.bridge?.capabilities?.accounts === true && !state.extensionUpdateRequired));
    refreshAccountMenuAvailability();
    if (focusedKey) [...refs.accountMenuAccounts.children].find((item) => item.dataset.accountKey === focusedKey)?.focus();
  }

  // The menu is a popover in the top layer where the browser has popovers, and otherwise sits at the end of the page;
  // either way the account card cannot clip it.
  const ACCOUNT_POPOVER = typeof window.HTMLElement.prototype.showPopover === "function";
  const ACCOUNT_POPUP_MARGIN = 12;
  const ACCOUNT_POPUP_GAP = 6;

  function inAccountSwitcher(node) {
    return node instanceof window.Node && (refs.switchAccountButton.contains(node) || refs.accountPopup.contains(node));
  }

  // Below the button and centred on it, held inside the viewport; above it when the room below is too short.
  function placeAccountPopup() {
    if (refs.accountPopup.hidden) return;
    const button = refs.switchAccountButton.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(320, viewportWidth - 2 * ACCOUNT_POPUP_MARGIN);
    const left = Math.min(Math.max(button.left + button.width / 2 - width / 2, ACCOUNT_POPUP_MARGIN), viewportWidth - ACCOUNT_POPUP_MARGIN - width);
    const below = window.innerHeight - button.bottom - ACCOUNT_POPUP_GAP - ACCOUNT_POPUP_MARGIN;
    const above = button.top - ACCOUNT_POPUP_GAP - ACCOUNT_POPUP_MARGIN;
    const upward = below < 160 && above > below;
    Object.assign(refs.accountPopup.style, {
      left: `${Math.round(left)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.round(Math.max(Math.min(420, upward ? above : below), 120))}px`,
      top: upward ? "auto" : `${Math.round(button.bottom + ACCOUNT_POPUP_GAP)}px`,
      bottom: upward ? `${Math.round(window.innerHeight - button.top + ACCOUNT_POPUP_GAP)}px` : "auto"
    });
  }

  function openAccountMenu(focusLast = false) {
    renderAccountMenu();
    refs.accountPopup.hidden = false;
    if (ACCOUNT_POPOVER && !refs.accountPopup.matches(":popover-open")) refs.accountPopup.showPopover();
    placeAccountPopup();
    refs.switchAccountButton.setAttribute("aria-expanded", "true");
    const items = accountMenuItems();
    (focusLast ? items.at(-1) : items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
  }

  function closeAccountMenu(returnFocus) {
    if (refs.accountPopup.hidden) return;
    if (ACCOUNT_POPOVER && refs.accountPopup.matches(":popover-open")) refs.accountPopup.hidePopover();
    refs.accountPopup.hidden = true;
    refs.switchAccountButton.setAttribute("aria-expanded", "false");
    if (returnFocus) refs.switchAccountButton.focus();
  }

  function accountMenuKeydown(event) {
    const items = accountMenuItems();
    const index = items.indexOf(document.activeElement);
    const focusAt = (position) => items[(position + items.length) % items.length]?.focus();
    if (event.key === "ArrowDown") focusAt(index + 1);
    else if (event.key === "ArrowUp") focusAt(index < 0 ? items.length - 1 : index - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(items.length - 1);
    else if (event.key === "Escape") closeAccountMenu(true);
    else {
      if (event.key === "Tab") closeAccountMenu(false);
      return;
    }
    event.preventDefault();
  }

  function syncFilterChips() {
    for (const chip of document.querySelectorAll(".filter-chip")) {
      const selected = chip.dataset.group === state.activeGroup;
      chip.classList.toggle("active", selected);
      chip.setAttribute("aria-pressed", String(selected));
    }
    refs.filterCount.textContent = state.activeGroup === "all" ? "0" : "1";
  }

  // The extension keeps which account was chosen last, for the next time this page connects. Every account shown
  // here is named, the ones whose file was opened or build finished during this visit too; the extension refuses one
  // it does not list, and that answer changes nothing here. The example has no key and is never named.
  function selectInExtension(session) {
    const accountKey = AccountSessions.extensionKey(session.identity);
    if (!accountKey || state.bridge?.capabilities?.accounts !== true || state.extensionUpdateRequired) return;
    void requestBridge("SELECT_ACCOUNT", { accountKey }).catch(() => {});
  }

  // Shows another session from what this page already holds. Nothing is asked of RSI. The session left keeps its
  // document, files, images, search, filter, sort, page and selected record for when it is shown again.
  function activateSession(session) {
    const outgoing = activeSession();
    if (session === outgoing) return;
    outgoing.inventorySearch = refs.search.value;
    outgoing.mediaTexts = { status: refs.mediaStatus.textContent, assetCount: byId("mediaAssetCount").textContent, summary: byId("mediaSummary").textContent };
    suspendMediaLoads(outgoing);
    for (const dialog of [ccuDialog, refs.mediaGalleryDialog, refs.orgBuildDialog]) if (dialog.open) dialog.close();
    // A finished image run is shown for the account it ran for only.
    if (state.mediaOverlayActive && !state.mediaController) {
      state.mediaOverlayActive = false;
      renderCollectionStatus(state.publicStatus);
    }
    activeAccountKey = session === exampleSession ? null : session.key;
    refs.referralSearch.value = state.referralSearch;
    refs.organizationSearch.value = state.organizationSearch;
    updateBuildAction();
    renderAll({ keepView: true });
    if (state.mediaPlanDocument !== state.document || !state.mediaTexts) void prepareMediaPlan();
    else {
      refs.mediaStatus.textContent = state.mediaTexts.status;
      text("mediaAssetCount", state.mediaTexts.assetCount);
      text("mediaSummary", state.mediaTexts.summary);
    }
    if (!refs.buildChoices.hidden) refreshBuildChoices();
  }

  // The user's choice under Switch Account; the extension is told of it, so it is the account shown next time.
  function chooseAccount(key) {
    const session = accounts.get(key);
    if (!session || accountSwitchBlocker()) return;
    closeAccountMenu(true);
    activateSession(session);
    selectInExtension(session);
  }

  // The session of an account the extension lists: the one open for it, or a new session that holds the account's
  // summary alone until a build of it is open. Null when the account matches more than one session or none fits.
  function listedSession(entry) {
    const account = { handle: entry.handle, localAccountId: null };
    const found = accounts.match(account);
    if (found.conflict) return null;
    let session = found.session;
    if (!session) {
      if (accounts.size >= AccountSessions.MAXIMUM_SESSIONS) return null;
      const identity = AccountSessions.identityOf(account);
      session = newSession(accounts.availableKey(identity), identity);
      session.identityOnly = true;
      session.fileName = null;
      accounts.add(session);
    }
    session.displayName = AccountSessions.boundedLabel(entry.displayName ?? "") ?? session.displayName;
    return session;
  }

  function validListedEntry(entry) {
    return Boolean(entry) && typeof entry === "object" && typeof entry.handle === "string" && AccountSessions.HANDLE_PATTERN.test(entry.handle)
      && entry.key === `rsi:${entry.handle.toLowerCase()}` && typeof entry.hasRetainedBuild === "boolean";
  }

  // With an extension that keeps accounts, every account it lists is put under Switch Account, and each build it
  // keeps is opened into its account's session. A document already open in this page is never replaced. While the
  // example is shown, the account the extension had selected is shown, or else the newest kept build.
  async function loadExtensionAccounts() {
    const bridge = state.bridge;
    if (!bridge || state.extensionUpdateRequired || bridge.capabilities?.accounts !== true || state.accountsListedFor === bridge.bridgeSessionId) return;
    state.accountsListedFor = bridge.bridgeSessionId;
    let listed;
    try {
      listed = await requestBridge("LIST_ACCOUNTS", null);
    } catch {
      return;
    }
    if (state.bridge !== bridge || !listed?.ok || !Array.isArray(listed.accounts)) return;
    const entries = listed.accounts.filter(validListedEntry).slice(0, AccountSessions.MAXIMUM_SESSIONS);
    // An account the extension no longer lists, of which this page holds its summary alone, is removed.
    for (const session of accounts.values()) {
      if (!session.identityOnly || entries.some((entry) => sameAccount(session.identity, { handle: entry.handle }))) continue;
      if (session === activeSession()) activateSession(accounts.values().find((other) => other !== session) ?? exampleSession);
      accounts.remove(session.key);
    }
    const sessions = new Map(entries.map((entry) => [entry, listedSession(entry)]));
    const newest = entries.filter((entry) => entry.hasRetainedBuild).sort((left, right) => globalThis.CitizenDataAccountDocument.compareExportedAt(right.retainedExportedAt, left.retainedExportedAt))[0];
    const preferred = activeSession() === exampleSession ? entries.find((entry) => entry.key === listed.selectedKey) ?? newest ?? null : null;
    renderAccountMenu();
    for (const entry of [preferred, ...entries.filter((candidate) => candidate !== preferred)]) {
      const session = sessions.get(entry);
      if (!entry?.hasRetainedBuild || !session?.identityOnly) continue;
      let response;
      try {
        response = await requestBridge("GET_ACCOUNT_BUILD", { accountKey: entry.key });
      } catch {
        continue;
      }
      if (state.bridge !== bridge || !response?.ok || !response.result || !session.identityOnly) continue;
      const opening = entry === preferred && activeSession() === exampleSession;
      try {
        await acceptAccountDocument(response.result, { source: "extension", fileName: globalThis.CitizenDataCanonicalDownload.canonicalFileName(response.result) }, { activate: opening });
        if (opening) showToast("Your latest build, kept in the extension, is open.");
      } catch (error) {
        showToast(`A build kept in the extension could not be opened: ${error?.message ?? "unknown error"}`);
      }
    }
    const preferredSession = preferred ? sessions.get(preferred) : null;
    if (preferredSession && accounts.get(preferredSession.key) && activeSession() === exampleSession) activateSession(preferredSession);
  }

  // Remove this account, under Switch Account: the user confirms first, then the extension forgets the account shown
  // (REMOVE_ACCOUNT) and this page closes it. The page shows the account the extension selected in its place, if this
  // page holds it, or else the example.
  function confirmRemoveAccount() {
    const session = activeSession();
    if (session === exampleSession || accountSwitchBlocker()) return;
    closeAccountMenu(true);
    const { label } = AccountSessions.menuLabel(session);
    refs.removeAccountDialogTitle.textContent = `Remove ${label}?`;
    refs.removeAccountDialogMessage.textContent = `The extension forgets ${label} and deletes the builds and Orgs JSON it keeps of it. Images it keeps stay until you delete them in the extension popup. Files you saved are not touched.`;
    refs.removeAccountDialog.dataset.sessionKey = session.key;
    refs.removeAccountDialog.returnValue = "";
    if (typeof refs.removeAccountDialog.showModal === "function") refs.removeAccountDialog.showModal();
  }

  async function removeAccount(sessionKey) {
    const session = accounts.get(sessionKey);
    if (!session || session === exampleSession || accountSwitchBlocker()) return;
    const accountKey = AccountSessions.extensionKey(session.identity);
    let response = null;
    if (accountKey && state.bridge?.capabilities?.accounts === true && !state.extensionUpdateRequired) {
      try {
        response = await requestBridge("REMOVE_ACCOUNT", { accountKey });
      } catch (error) {
        showDialog("REMOVE ACCOUNT", "Extension request failed", error.message);
        return;
      }
      // An account the extension holds nothing of is closed in this page all the same.
      if (!response?.ok && response?.code !== "UNKNOWN_ACCOUNT") {
        showDialog("REMOVE ACCOUNT", "Account not removed", response?.message ?? "The account was not removed.");
        return;
      }
    }
    if (!accounts.get(sessionKey)) return;
    const { label } = AccountSessions.menuLabel(session);
    if (session === activeSession()) {
      const selected = response?.ok ? accounts.values().find((other) => other !== session && AccountSessions.extensionKey(other.identity) === response.selectedKey) : null;
      activateSession(selected ?? exampleSession);
    }
    accounts.remove(session.key);
    renderAccountMenu();
    showToast(`${label} is removed.`);
  }

  // Add new account. Without the extension, this page cannot find an account and opens an Account JSON instead.
  // With it, the extension finds the account signed in to RSI by its identity alone; nothing else is read and no
  // build starts.
  async function addNewAccount() {
    if (accountSwitchBlocker()) return;
    closeAccountMenu(true);
    if (!state.bridge || state.extensionUpdateRequired || state.bridge.capabilities?.accounts !== true) {
      if (typeof refs.addAccountDialog.showModal === "function") refs.addAccountDialog.showModal();
      else refs.fileInput.click();
      return;
    }
    if (showCoolingDown()) return;
    state.accountRequestPending = true;
    refreshAccountMenuAvailability();
    let response;
    try {
      response = await requestBridge("DISCOVER_CURRENT_ACCOUNT", null);
    } catch (error) {
      showDialog("ADD NEW ACCOUNT", "Extension request failed", error.message);
      return;
    } finally {
      state.accountRequestPending = false;
      refreshAccountMenuAvailability();
    }
    if (!response?.ok || !response.account || !validListedEntry(response.account)) {
      if (!showStartDeclined(response)) showDialog("ADD NEW ACCOUNT", "Account not added", response?.message ?? "No account was added.");
      return;
    }
    const session = listedSession(response.account);
    if (!session) {
      showDialog("ADD NEW ACCOUNT", "Account not added", `This page holds ${formatInteger(AccountSessions.MAXIMUM_SESSIONS)} accounts, the most it can, or this account matches more than one account open in it.`);
      return;
    }
    activateSession(session);
    renderAccountMenu();
    const { label } = AccountSessions.menuLabel(session);
    showToast(response.added ? `${label} is added.` : `${label} is already added.`);
  }

  // The session a document of this account belongs to: the one open for it, or a new one, added once the document
  // is accepted.
  function sessionForAccount(account) {
    const found = accounts.match(account);
    if (found.conflict) throw new Error("This account matches more than one account open in this page, so it was not opened.");
    if (found.session) return { session: found.session, created: false };
    const identity = AccountSessions.identityOf(account);
    return { session: newSession(accounts.availableKey(identity), identity), created: true };
  }

  // Puts an accepted document into its session and starts that session's view again. Its Orgs JSON and images stay
  // while they are of the same account. Returns whether open images stay.
  function assignAccountDocument(target, accepted, { source, fileName }) {
    Model.validateAccountDocument(accepted);
    const shown = target === activeSession();
    const imagesRunning = shown && Boolean(state.mediaController);
    // A file that waited to be offered to the extension belongs to the document this one replaces.
    target.buildOffer = null;
    if (!target.organizationDocument || !sameAccount(target.organizationDocument.account, accepted.account)) target.organizationOffer = null;
    const sameMediaAccount = Boolean(target.mediaPlanAccount && sameAccount(target.mediaPlanAccount, accepted.account));
    if (imagesRunning && !sameMediaAccount) throw new Error("Cancel the active image download before opening a different account document.");
    if (target.loadedMediaPackage?.fromExtension && !imagesRunning && !target.pendingMediaPackage) clearLoadedMediaPackage(target);
    const preserveMedia = sameMediaAccount && Boolean(imagesRunning || target.pendingMediaPackage || target.loadedMediaPackage);
    if (!sameMediaAccount && target.loadedMediaPackage) clearLoadedMediaPackage(target);
    if (target.organizationDocument && !sameAccount(target.organizationDocument.account, accepted.account)) {
      target.organizationDocument = null;
      target.organizationFileName = null;
    }
    if (shown && ccuDialog.open) ccuDialog.close();
    // A waiting Organization Data result is retried once the Account JSON it belongs to has been loaded.
    if (source === "file") state.requestedCompletedRunIds.clear();
    target.document = accepted;
    target.source = source;
    target.fileName = fileName;
    target.identityOnly = false;
    if (target !== exampleSession) {
      target.identity = AccountSessions.mergedIdentity(target.identity, accepted.account);
      target.displayName = AccountSessions.boundedLabel(accepted.profile?.displayName ?? "") ?? target.displayName;
    }
    target.activeInventory = "hangar";
    target.activeRecordKey = null;
    target.inventoryPage = 1;
    target.inventorySearch = "";
    target.activeGroup = "all";
    target.referralPath = "current.prospects";
    target.referralOrder = "newest";
    target.referralPage = 1;
    target.referralSearch = "";
    target.organizationSid = accepted.profile?.mainOrganizationSid ?? accepted.organizations.memberships[0]?.sid ?? "";
    target.organizationPage = 1;
    target.organizationSearch = "";
    return preserveMedia;
  }

  // Shows the document just put into the session shown.
  function showAccountDocument(preserveMedia) {
    refs.organizationSearch.value = "";
    refs.referralSearch.value = "";
    updateBuildAction();
    renderAll();
    if (preserveMedia) {
      refs.mediaStatus.textContent = state.mediaController
        ? "Image download continues in Build Status."
        : state.pendingMediaPackage
          ? "The prepared image ZIP remains available in Build Status."
          : `${state.loadedMediaFileName ?? "The loaded Images ZIP"} remains open for this dashboard.`;
      text("healthMedia", state.mediaController ? "Image download in progress" : state.pendingMediaPackage ? "ZIP ready to save" : "Packaged images loaded");
      // The open ZIP stays; the plan is made again for the document now open. A download that is running keeps its
      // own plan until it ends.
      if (!state.mediaController) void prepareMediaPlan();
    } else {
      void prepareMediaPlan();
    }
  }

  // Every document passes the schema and integrity checks first, and then goes into the session of its account. A
  // file the user opens is shown (`activate`); a result of the extension is shown when it is of the account shown,
  // or in place of the example, and is otherwise put under its account without switching to it.
  async function acceptAccountDocument(parsed, metadata, { activate = true } = {}) {
    const accepted = await globalThis.CitizenDataAccountDocument.acceptAccountDocument(parsed, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
    const { session: target, created } = metadata.source === "demo" ? { session: exampleSession, created: false } : sessionForAccount(accepted.account);
    if (metadata.source === "file" && target !== activeSession() && accountSwitchBlocker()) throw new Error(accountSwitchBlocker());
    if (created) accounts.add(target);
    try {
      const rosterSids = [...new Set(Model.asArray(accepted.organizations?.members).map((member) => member?.organizationSid).filter(Boolean))];
      if (rosterSids.length && metadata.source !== "demo") {
        const previousOrganizations = target.organizationDocument && sameAccount(target.organizationDocument.account, accepted.account) ? target.organizationDocument : null;
        target.organizationDocument = await globalThis.CitizenDataOrganizationDocument.merge({
          accountDocument: accepted,
          previous: previousOrganizations,
          resultDocument: accepted,
          selectedSids: rosterSids,
          exportedAt: accepted.exportedAt,
          generatorVersion: DASHBOARD_VERSION
        });
        target.organizationFileName ??= "Extracted from Account JSON";
      }
      let accountOnly = accepted;
      if (metadata.source !== "demo" && Model.asArray(accepted.organizations?.members).length) {
        const copy = structuredClone(accepted);
        delete copy.organizations.members;
        copy.sync.organizationMemberOutcomes = {};
        accountOnly = await globalThis.CitizenDataAccountDocument.stampIntegrity(copy);
        await globalThis.CitizenDataAccountDocument.acceptAccountDocument(accountOnly, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
      }
      const preserveMedia = assignAccountDocument(target, accountOnly, metadata);
      if (target === activeSession()) showAccountDocument(preserveMedia);
      else if (activate) activateSession(target);
      else renderAccountMenu();
      return accountOnly;
    } catch (error) {
      if (created) accounts.remove(target.key);
      throw error;
    }
  }

  // A result of the extension is shown when nothing but the example is shown.
  function resultOpensShown() {
    return activeSession() === exampleSession;
  }

  // The session that holds a document of this account, or null.
  function documentSession(account) {
    const found = accounts.match(account);
    return found.session && !found.session.identityOnly ? found.session : null;
  }

  async function loadJsonFile(file) {
    if (!file) return;
    if (file.size > JSON_LIMITS.maxBytes) throw new Error(`Choose a JSON file no larger than ${JSON_LIMITS.maxBytes / (1024 * 1024)} MiB.`);
    const parsed = parseBoundedJson(await file.text());
    if (globalThis.CitizenDataHangarLinkImport.isHangarLinkFile(parsed)) {
      await loadHangarLinkFile(parsed, file.name);
      return;
    }
    if (isRecoveryBackup(parsed)) {
      await loadRecoveryBackup(parsed, file.name);
      return;
    }
    await acceptAccountDocument(parsed, { source: "file", fileName: file.name });
    const verified = "Your file passed the canonical schema and SHA-256 integrity checks. It is open on this device; nothing was uploaded or saved by the website.";
    showDialog("LOCAL JSON", "Account file verified", verified);
    tellHandOver(handOverBuild(parsed, "this file"), verified, (sentence) => `${verified} ${sentence}`);
  }

  // The file is confirmed at once; the extension's answer follows. It is added to the message that confirmed the
  // file while that message is still shown, and is a short notice when the message was closed first.
  function tellHandOver(answer, shown, withAnswer) {
    void answer.then((sentence) => {
      if (!sentence) return;
      if (refs.messageDialog.open && refs.dialogMessage.textContent === shown) refs.dialogMessage.textContent = withAnswer(sentence);
      else showToast(sentence);
    });
  }

  // What the extension answered when it was offered a build the user opened here, as one sentence.
  function handOverSentence(response, what) {
    if (response?.ok && response.kept && Number.isSafeInteger(response.rosters)) return "The extension now keeps these rosters with your latest build.";
    if (response?.ok && response.kept) return response.replaced ? `The extension now keeps ${what} as your latest build, in place of the older build it held.` : `The extension now keeps ${what} as your latest build.`;
    if (response?.ok && response.reason === "SAME_BUILD") return "The extension already keeps this build.";
    if (response?.ok && response.reason === "NEWER_BUILD_HELD") return `The extension keeps a newer build of this account, so it did not take ${what} in.`;
    if (response?.ok && response.reason === "ACCOUNT_SUMMARY_KEPT") return "Account added to Switch Account. Build history is off, so the file was not kept.";
    if (response?.ok && response.reason === "NOTHING_NEWER") return "The extension already keeps these rosters.";
    const because = {
      BUILD_HISTORY_OFF: "Build history is off in the extension popup",
      BUILD_IN_PROGRESS: "a build is in progress. Open the file again when that build has finished",
      FUTURE_BUILD: "it is dated in the future",
      INCOMPLETE_BUILD: "it is not a complete build",
      INVALID_BUILD: "it did not pass the extension's own checks",
      INVALID_ORGANIZATIONS: "they did not pass the extension's own checks",
      NO_BUILD_HELD: "it holds no build of this account. Open the account JSON first"
    }[response?.code];
    return because ? `The extension did not take ${what} in, because ${because}.` : `The extension did not take ${what} in.`;
  }

  // Offers a waiting file to the extension, once. The answer is a sentence for the user, or nothing when the
  // extension is not connected, in which case the offer waits for it. Offers go one after the other, so the rosters
  // of an Orgs JSON reach the extension after the account build they belong to. Each account's offers are its own.
  function offerToExtension(slot, type, session) {
    const result = state.handOverQueue.then(async () => {
      const offer = session[slot];
      if (!offer || offer.sent || !state.bridge || state.extensionUpdateRequired) return null;
      offer.sent = true;
      let sentence;
      try {
        sentence = handOverSentence(await requestBridge(type, { document: offer.document }), offer.what);
      } catch (error) {
        sentence = `The extension did not take ${offer.what} in: ${error?.message ?? "unknown error"}`;
      }
      if (session[slot] === offer) session[slot] = null;
      return sentence;
    });
    state.handOverQueue = result.catch(() => {});
    return result;
  }

  function offerBuildToExtension(session = activeSession()) {
    return offerToExtension("buildOffer", "KEEP_BUILD", session);
  }

  // An Orgs JSON the user opened, and this page verified, is handed to the extension in the same way: its rosters
  // go into the account build the extension keeps.
  function offerOrganizationsToExtension(session = activeSession()) {
    return offerToExtension("organizationOffer", "KEEP_ORGANIZATIONS", session);
  }

  // A complete account file the user opened, and this page verified, is handed to the extension by itself, so an
  // extension that holds no build of the account has one without a step in its popup. The extension checks the file
  // again and decides what it keeps. The example, a Hangar Link file, and a build the extension handed to this page
  // are never offered.
  async function handOverBuild(document, what) {
    state.buildOffer = { document, what, sent: false };
    return offerBuildToExtension();
  }

  // The extension's recovery backup, saved from its popup: its working records, among them the latest finished
  // build of each account. It is not an account file, but the builds inside it are.
  function isRecoveryBackup(parsed) {
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed) && parsed.schemaVersion === undefined
      && Number.isSafeInteger(parsed.databaseVersion) && Boolean(parsed.stores) && typeof parsed.stores === "object" && Array.isArray(parsed.stores.snapshots);
  }

  // Opens the newest finished build inside a recovery backup, after the same schema and integrity checks as any
  // account file, and offers that build to the extension. Its other records are put back by importing the file in
  // the extension popup.
  async function loadRecoveryBackup(parsed, fileName) {
    const restore = "To put the extension's records back, import this file in the extension popup under Recovery and permissions.";
    const otherRecords = "The other records in this file are put back by importing it in the extension popup under Recovery and permissions.";
    const builds = parsed.stores.snapshots
      .map((snapshot) => snapshot?.document)
      .filter((candidate) => candidate && typeof candidate === "object" && typeof candidate.exportedAt === "string")
      .sort((left, right) => globalThis.CitizenDataAccountDocument.compareExportedAt(right.exportedAt, left.exportedAt));
    if (!builds.length) throw new Error(`This is an extension recovery backup, and it holds no finished build to open. ${restore}`);
    await acceptAccountDocument(builds[0], { source: "file", fileName });
    const opened = `${fileName} is an extension recovery backup. ${builds.length === 1 ? "The finished build" : `The newest of the ${formatInteger(builds.length)} finished builds`} inside it passed the canonical schema and SHA-256 integrity checks and is open on this device; nothing was uploaded or saved by the website.`;
    showDialog("RECOVERY BACKUP", "Latest build opened", `${opened} ${restore}`);
    tellHandOver(handOverBuild(builds[0], "that build"), `${opened} ${restore}`, (sentence) => `${opened} ${sentence} ${otherRecords}`);
  }

  // A Hangar Link file is opened as an incomplete build: its hangar and buy-backs, and nothing else. Build reads the
  // whole account from RSI. The file itself is never handed to the extension.
  async function loadHangarLinkFile(parsed, fileName) {
    const { document: converted, counts } = globalThis.CitizenDataHangarLinkImport.toAccountDocument(parsed, {
      importedAt: new Date().toISOString(),
      localAccountId: crypto.randomUUID(),
      generatorVersion: DASHBOARD_VERSION
    });
    await acceptAccountDocument(await globalThis.CitizenDataAccountDocument.stampIntegrity(converted), { source: "file", fileName });
    const plural = (number, singular, many) => `${formatInteger(number)} ${number === 1 ? singular : many}`;
    const notes = [];
    if (counts.repeated) notes.push(` ${plural(counts.repeated, "record appears", "records appear")} in the file more than once and ${counts.repeated === 1 ? "is" : "are"} shown once.`);
    if (counts.leftOut) notes.push(` ${plural(counts.leftOut, "record", "records")} without a pledge number, name, date, or account could not be read and ${counts.leftOut === 1 ? "is" : "are"} left out.`);
    showDialog("HANGAR LINK JSON", "Incomplete build opened", `${fileName} is open with ${plural(counts.hangar, "hangar pledge", "hangar pledges")} and ${plural(counts.buybacks, "buy-back", "buy-backs")}.${notes.join("")} A Hangar Link file holds no Hangar Log, billing, referrals, organizations, or images. Choose Build to read the whole account from RSI with the extension. Nothing was uploaded or saved by the website.`);
  }

  async function loadOrganizationFile(file) {
    if (!file) return;
    const maximumBytes = 512 * 1024 * 1024;
    if (file.size > maximumBytes) throw new Error("Choose an Orgs JSON file no larger than 512 MiB.");
    // The file belongs to the account shown when it was chosen, even if another account is shown by the time it is read.
    const session = activeSession();
    if (session.source === "demo") throw new Error("Load the matching Account JSON before loading an Orgs JSON.");
    const parsed = parseBoundedJson(await file.text(), { maxBytes: maximumBytes, maxNodes: 8000000, maxArrayItems: 4000000 });
    const accepted = await globalThis.CitizenDataOrganizationDocument.accept(parsed);
    if (!sameAccount(accepted.account, session.document.account)) throw new Error("This Orgs JSON belongs to a different Account JSON.");
    session.organizationDocument = accepted;
    session.organizationFileName = file.name;
    session.organizationPage = 1;
    if (session === activeSession()) renderOrganizations();
    const verified = `${file.name} passed integrity and account identity checks. It is open on this device; nothing was uploaded.`;
    showDialog("LOCAL ORGS JSON", "Organization data verified", verified);
    session.organizationOffer = { document: accepted, what: "these rosters", sent: false };
    tellHandOver(offerOrganizationsToExtension(session), verified, (sentence) => `${verified} ${sentence}`);
  }

  async function loadMediaPackageFile(file) {
    if (!file) return;
    const session = activeSession();
    if (session.source === "demo") throw new Error("Load the matching Account JSON before loading an Images ZIP.");
    const loaded = await globalThis.CitizenDataMediaPackageReader.open(file, { maximumBytes: globalThis.CITIZENDATA_MEDIA_POLICY.maximumBytes });
    if (!sameAccount(loaded.manifest.account, session.document.account)) throw new Error("This Images ZIP belongs to a different Account JSON.");
    clearLoadedMediaPackage(session);
    session.loadedMediaPackage = loaded;
    session.loadedMediaFileName = file.name;
    session.pendingMediaPackage = null;
    // Another account is shown now: the images are shown, and the plan made again, when this one is shown again.
    if (session !== activeSession()) {
      session.mediaTexts = null;
      return;
    }
    const reusable = loaded.manifest.assets.filter((asset) => ["downloaded", "reused"].includes(asset.status)).length;
    refs.mediaStatus.textContent = `${file.name} is open with ${formatInteger(reusable)} reusable images. Images validate lazily when displayed.`;
    text("healthMedia", `${formatInteger(reusable)} packaged images loaded`);
    renderAll();
    await prepareMediaPlan();
    showDialog("IMAGES ZIP", "Image package verified", `${file.name} passed manifest, account, and package structure checks. Individual image hashes are checked when first displayed or reused.`);
    void keepPackageImages(loaded).then((note) => {
      if (note && state.loadedMediaPackage === loaded) refs.mediaStatus.textContent += note;
    });
  }

  // With the extension's build history on, the extension keeps the images of an opened Images ZIP that it does not
  // keep yet. Returns a sentence for the image status, or nothing when the extension is absent or keeps no images.
  // `onKeeping` is called once the extension is known to keep images; a cancel through `signal` is thrown on.
  async function keepPackageImages(opened, { signal = null, onKeeping = () => {} } = {}) {
    if (!state.bridge || state.extensionUpdateRequired) return "";
    try {
      const kept = await globalThis.CitizenDataExtensionMedia.index(requestBridge);
      if (!kept?.keeping) return "";
      onKeeping();
      const outcome = await globalThis.CitizenDataExtensionMedia.keep({
        assets: opened.manifest.assets,
        readFile: async (asset) => new Uint8Array(await (await opened.fileBlob(asset.relativePath, asset.mediaType)).arrayBuffer()),
        kept,
        request: requestBridge,
        signal
      });
      if (!outcome.stored && !outcome.refused) return outcome.already ? " The extension already keeps these images." : "";
      return ` ${formatInteger(outcome.stored)} ${outcome.stored === 1 ? "image is" : "images are"} now kept in the extension${outcome.refused ? `; it refused ${formatInteger(outcome.refused)}` : ""}.`;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      return ` The extension could not keep the images: ${error?.message ?? "unknown error"}`;
    }
  }

  // The images the extension keeps are opened like an Images ZIP, unless the user has one open.
  async function attachKeptImages() {
    const session = activeSession();
    const usable = () => session === activeSession() && state.bridge && !state.extensionUpdateRequired && state.source !== "demo" && !state.mediaController && !state.pendingMediaPackage && state.mediaPlan.length > 0 && (!state.loadedMediaPackage || state.loadedMediaPackage.fromExtension);
    if (!usable()) return;
    const generation = state.mediaPlanGeneration;
    const plan = state.mediaPlan;
    const kept = await globalThis.CitizenDataExtensionMedia.index(requestBridge);
    if (!kept || generation !== state.mediaPlanGeneration || !usable()) return;
    const opened = globalThis.CitizenDataExtensionMedia.createPackage({ plan, kept, accountDocument: state.document, request: requestBridge });
    if (!opened) return;
    clearLoadedMediaPackage();
    state.loadedMediaPackage = opened;
    state.loadedMediaFileName = globalThis.CitizenDataExtensionMedia.SOURCE_NAME;
    renderAll();
    const held = opened.manifest.assets.length;
    refs.mediaStatus.textContent = `${formatInteger(held)} of ${formatInteger(plan.length)} images are kept in the extension and shown from it.${held < plan.length ? " Use Build to download the rest." : ""}`;
    if (!refs.buildChoices.hidden) refreshBuildChoices();
  }

  function validEnvelope(value) {
    return value && typeof value === "object" && value.channel === BRIDGE_CHANNEL && value.protocolVersion === PROTOCOL_VERSION && typeof value.type === "string" && typeof value.requestId === "string" && typeof value.bridgeSessionId === "string" && typeof value.nonce === "string";
  }

  function bridgePostTarget() {
    return location.protocol === "file:" ? "*" : location.origin;
  }

  function bridgeMessageOriginMatches(origin) {
    return location.protocol === "file:" ? origin === "null" : origin === location.origin;
  }

  function setBridgeStatus(summary, stateText, detail, tone = "quiet", active = false, countdownValue = null, prose = null) {
    text("overlaySummary", summary);
    text("overlayState", stateText);
    if (countdownValue) showCountdown(byId("overlayDetail"), countdownValue);
    else {
      forgetCountdown(byId("overlayDetail"));
      text("overlayDetail", detail);
    }
    patchAttr(byId("overlayDetail"), "data-prose", prose);
    patchAttr(refs.overlay, "data-tone", tone);
    const pulse = document.querySelector(".parser-overlay .pulse");
    patchClass(pulse, "idle", !active);
    patchClass(pulse, "warning", tone === "warning");
    patchClass(pulse, "failure", tone === "failure");
  }

  // The title of the minimized panel, recomputed from every accepted presentation.
  function refreshOverlayTitle() {
    const minimized = refs.overlay.classList.contains("minimized");
    const activeJob = state.publicStatus?.activeJob;
    const badge = byId("overlaySummary").textContent;
    const section = Model.collectionSectionPresentation(activeJob?.currentSection);
    const progress = Model.collectionProgress(activeJob);
    const minimizedTitle = state.mediaOverlayActive
      ? `${badge} · Offline images · ${formatInteger(state.mediaCompleted)}/${formatInteger(state.mediaPlan.length)}`
      : activeJob ? `${badge} · ${section.label} · ${progress.currentPosition}/${progress.sectionCount}` : badge;
    patchText(byId("overlayTitle"), minimized ? minimizedTitle : "BUILD STATUS");
  }

  function setOverlayMinimized(minimized) {
    patchClass(refs.overlay, "minimized", minimized);
    refreshOverlayTitle();
    patchText(byId("overlayToggleSymbol"), minimized ? "+" : "−");
    patchAttr(byId("minimizeOverlay"), "aria-expanded", String(!minimized));
    patchAttr(byId("minimizeOverlay"), "aria-label", minimized ? "Expand build status" : "Minimize build status");
  }

  // The caution tape (§11.1), derived from every accepted status. Its nodes are never replaced; only its class and text
  // change, and only when they differ. The image run's own state joins it in WP11.
  function renderCautionTape() {
    const tape = Model.cautionPresentation(state.publicStatus, state.mediaTapeState ?? null);
    patchClass(refs.cautionTape, "is-active", tape.active);
    patchClass(refs.overlay, "caution-active", tape.active);
    patchText(refs.cautionTapeText, tape.text);
  }

  // One announcement for each logical state (§11.2). Repeated polls, countdown ticks and log growth announce nothing.
  function announcePresentation(presentation) {
    if (state.view.announcementKey === presentation.key) return;
    state.view.announcementKey = presentation.key;
    patchText(refs.buildStatusAnnouncement, `Build status: ${presentation.badge}. ${presentation.operation}.`);
  }

  // The log (§11.2): each row keyed by its activity's seq. An existing row keeps its node, a new row is inserted in its
  // place, and a log scrolled away from its top keeps its first visible row where it was.
  const logNodes = new Map();

  function logLine(row) {
    const line = element("p", row.tone === "failure" ? "failure" : row.tone === "warning" ? "waiting" : "");
    line.dataset.logKey = row.key;
    const displayedTime = activityTime(row.at);
    if (displayedTime) {
      const time = element("time", "", displayedTime);
      time.dateTime = row.at;
      line.append(time, document.createTextNode(row.message));
    } else {
      line.textContent = row.message;
    }
    return line;
  }

  function patchLog(rows) {
    const log = refs.eventLog;
    const top = log.getBoundingClientRect().top;
    const anchor = log.scrollTop > 0 ? [...log.children].find((child) => child.getBoundingClientRect().bottom > top) ?? null : null;
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - top : 0;
    const wanted = new Set(rows.map((row) => row.key));
    for (const [key, node] of logNodes) {
      if (wanted.has(key)) continue;
      node.remove();
      logNodes.delete(key);
    }
    for (const child of [...log.children]) if (!child.dataset.logKey) child.remove();
    let cursor = log.firstElementChild;
    for (const row of rows) {
      let node = logNodes.get(row.key);
      if (!node) {
        node = logLine(row);
        logNodes.set(row.key, node);
      }
      if (node === cursor) cursor = cursor.nextElementSibling;
      else log.insertBefore(node, cursor);
    }
    if (anchor?.isConnected) {
      const moved = anchor.getBoundingClientRect().top - log.getBoundingClientRect().top - anchorOffset;
      if (moved !== 0) log.scrollTop += moved;
    }
  }

  function renderEventLog(publicStatus, presentation) {
    const activeJob = publicStatus?.activeJob;
    const continuable = presentation.row >= 16 && presentation.row <= 19;
    const runKey = typeof activeJob?.runId === "string" ? activeJob.runId.slice(0, 80) : "run";
    const rows = [];
    if (activeJob?.status === "failed" && activeJob.failure) {
      if (continuable) {
        const history = presentation.historyMessage ?? "The previous attempt stopped. Completed data remains available.";
        const technical = `Technical detail: ${presentation.technicalMessage ?? "RUN_FAILED"}`;
        rows.push({ key: `history:${runKey}:${history}`, at: null, tone: "warning", message: history }, { key: `technical:${runKey}:${technical}`, at: null, tone: "diagnostic", message: technical });
      } else {
        const detail = Model.stopTechnicalDetail(activeJob.failure);
        rows.push({ key: `failure:${runKey}:${detail}`, at: null, tone: "failure", message: detail });
      }
    }
    rows.push(...Model.activityRows(activeJob?.activityLog).reverse());
    const shown = rows.length ? rows : [{ key: `empty:${activeJob ? "started" : "none"}`, at: null, tone: "normal", message: activeJob ? "Data collection has started." : "No account collection has started." }];
    patchLog(continuable ? [{ key: `header:${runKey}`, at: null, tone: "warning", message: "Previous attempt history" }, ...shown] : shown);
  }

  // The control that explicitly opened Build Status, to which Close returns focus (final criterion 31): Build,
  // Continue, a roster action or another opener outside the panel. A control inside the panel, such as a chooser
  // choice, keeps the opener it was reached from. A control inside a dialog that has just closed hands over to the
  // control the dialog gave focus back to, such as the roster action that opened Build Orgs JSON.
  let activatedControl = null;
  let activatedTimer = 0;
  // The control that opened each dialog, kept because a mouse click does not focus a button in every browser, so the
  // dialog cannot always give focus back to it.
  const dialogOpeners = new WeakMap();

  function rememberActivatedControl(event) {
    const target = typeof event.target?.closest === "function" ? event.target.closest("button, a[href], summary, [role='button'], input") : null;
    activatedControl = target;
    window.clearTimeout(activatedTimer);
    // An opener counts within the task of its own activation, its default action included; never a later one.
    activatedTimer = window.setTimeout(() => { activatedControl = null; }, 0);
  }

  function explicitOpener() {
    let control = activatedControl;
    const dialog = control?.closest("dialog");
    if (dialog && !dialog.open) control = dialogOpeners.get(dialog) ?? (typeof document.activeElement?.closest === "function" ? document.activeElement : null);
    if (!control || control === document.body || refs.overlay.contains(control)) return null;
    return control;
  }

  // Whether a control can take focus now: still in the page, shown, not disabled, and outside a closed dialog.
  function canTakeFocus(control) {
    if (typeof control?.focus !== "function" || typeof control.closest !== "function" || !control.isConnected || control.disabled) return false;
    if (control.closest("[hidden], [inert]") || (control.closest("dialog") && !control.closest("dialog").open)) return false;
    return control.getClientRects().length > 0;
  }

  function returnFocusFromBuildStatus() {
    const opener = state.buildStatusOpener;
    state.buildStatusOpener = null;
    if (canTakeFocus(opener)) {
      opener.focus();
      if (document.activeElement === opener) return;
    }
    refs.buildButton.focus();
  }

  function showOverlayExpanded() {
    const opener = explicitOpener();
    if (opener) state.buildStatusOpener = opener;
    else if (refs.overlay.hidden) state.buildStatusOpener = null;
    state.overlayDismissed = false;
    refs.overlay.hidden = false;
    setOverlayMinimized(false);
  }

  function setCollectionActivityImage(show) {
    const shown = !refs.collectionActivityLink.hidden && !refs.collectionActivityImage.hidden && refs.collectionActivityImage.hasAttribute("src");
    if (show === shown) return;
    refs.collectionActivity.classList.toggle("has-activity-image", show);
    if (show) {
      refs.collectionActivityImage.src = "assets/activity/dancing-ben.gif";
      refs.collectionActivityImage.hidden = false;
      refs.collectionActivityLink.hidden = false;
      return;
    }
    refs.collectionActivityLink.hidden = true;
    refs.collectionActivityImage.hidden = true;
    refs.collectionActivityImage.removeAttribute("src");
  }

  function normalizedPublicStatus(value) {
    if (value?.status && typeof value.status === "object" && !Array.isArray(value.status)) return value.status;
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function completedRunId(publicStatus = state.publicStatus) {
    const activeJob = publicStatus?.activeJob;
    return (activeJob?.status === "complete" || activeJob?.status === "partial") && typeof activeJob.runId === "string" ? activeJob.runId : null;
  }

  function activityTime(value) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // The image run's pace as Build Status takes it (§14): a page-local value, checked first; anything else is null.
  function validMediaPace(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return {
      warning: ["limited", "slow"].includes(value.warning) ? value.warning : null,
      waitingUntil: typeof value.waitingUntil === "string" && Number.isFinite(Date.parse(value.waitingUntil)) ? value.waitingUntil : null,
      factor: Number.isFinite(value.factor) && value.factor >= 1 ? value.factor : null
    };
  }

  const MEDIA_STATUS_EVERY_MS = 300000;
  const unreadableStatus = () => ({ status: "unknown", reason: "unreadable", components: [], checkedAt: new Date().toISOString() });

  // RSI's status feed for the image run, through the extension (§14): when a warning first shows, every 5 minutes
  // while it shows, and at the stop. The page never asks the feed itself.
  async function refreshMediaStatusPage(force = false) {
    const nowMs = Date.now();
    if (!force && state.mediaStatusCheckedAt !== null && nowMs - state.mediaStatusCheckedAt < MEDIA_STATUS_EVERY_MS) return;
    state.mediaStatusCheckedAt = nowMs;
    let statusPage = unreadableStatus();
    if (state.bridge) {
      try {
        const answer = await requestBridge("CHECK_RSI_STATUS", null);
        if (answer?.ok === true && ["ok", "issue", "unknown"].includes(answer.status)) statusPage = { status: answer.status, reason: answer.reason ?? null, components: Array.isArray(answer.components) ? answer.components.slice(0, 10) : [], checkedAt: answer.checkedAt ?? null };
      } catch {
        // An extension that does not answer leaves the status unread.
      }
    }
    state.mediaStatusPage = statusPage;
    if (state.mediaTapeState) state.mediaTapeState = { ...state.mediaTapeState, statusPage };
    renderCautionTape();
  }

  // While a warning shows, a page-local timer asks again at each cache period, even when no image answers between;
  // it is cancelled when the warning clears or the image run ends, cancelled or not (§14).
  let mediaStatusTimer = null;
  function scheduleMediaStatusRefresh(warning) {
    globalThis.clearTimeout(mediaStatusTimer);
    mediaStatusTimer = null;
    if (!warning) return;
    const dueInMs = Math.max(0, (state.mediaStatusCheckedAt ?? Date.now()) + MEDIA_STATUS_EVERY_MS - Date.now());
    mediaStatusTimer = globalThis.setTimeout(() => {
      mediaStatusTimer = null;
      if (!state.mediaTapeState?.active || !state.mediaTapeState.warning) return;
      void refreshMediaStatusPage().then(() => scheduleMediaStatusRefresh(Boolean(state.mediaTapeState?.active && state.mediaTapeState.warning)));
    }, dueInMs);
  }

  // The image hosts' earlier runs for the next image run (§14, criterion 20): the extension's image history when it is
  // connected, then the loaded Images ZIP's receipt. The materializer uses the first that passes its checks.
  async function imagePaceHistorySources() {
    const sources = [];
    if (state.bridge) {
      try {
        const answer = await requestBridge("GET_IMAGE_PACE_HISTORY", null);
        if (answer?.ok === true && answer.history) sources.push({ source: "extension", record: answer.history });
      } catch {
        // An extension that does not answer gives no history.
      }
    }
    const fromPackage = globalThis.CitizenDataPaceHistory.imageHistoryFromReceipt(state.loadedMediaPackage?.manifest?.materializationReceipt ?? null, globalThis.CITIZENDATA_REQUEST_PACING);
    if (fromPackage) sources.push({ source: "package", record: fromPackage });
    return sources;
  }

  // The finished image run joins the extension's image history, when the extension is connected.
  async function keepImagePaceRun(run) {
    if (!run || !state.bridge) return;
    try {
      await requestBridge("ADD_IMAGE_PACE_RUN", { run });
    } catch {
      // The package's receipt still carries the history.
    }
  }

  // One progress value's pace: the tape's row 4 while a warning shows, and the status asked when it first shows.
  function noteMediaPace(value) {
    const pace = validMediaPace(value);
    if (!pace) return;
    const firstWarning = Boolean(pace.warning) && !state.mediaTapeState?.warning;
    state.mediaTapeState = { active: true, warning: pace.warning, waitingUntil: pace.waitingUntil, factor: pace.factor, statusPage: state.mediaStatusPage };
    if (pace.warning) void refreshMediaStatusPage(firstWarning);
    scheduleMediaStatusRefresh(Boolean(pace.warning));
  }

  function addMediaActivity(message, tone = "normal") {
    state.view.mediaLogSequence += 1;
    state.mediaActivity.push({ key: `media:${state.view.mediaLogSequence}`, at: new Date().toISOString(), message, tone });
    state.mediaActivity = state.mediaActivity.slice(-20);
  }

  function renderMediaEventLog() {
    const rows = [...state.mediaActivity].reverse();
    patchLog(rows.length ? rows : [{ key: "media:empty", at: null, tone: "normal", message: "No image download has started." }]);
  }

  // What the busy indicator beside Cancel tells assistive technology, once for each phase.
  function mediaBusyText() {
    if (state.mediaCancelRequested && state.mediaCancelRequested === state.mediaController) return "Cancelling image download";
    return state.mediaWait?.reason === "rate-limit" ? "Image download waiting before retry" : "Image download running";
  }

  function renderMediaOverlay({ badge, operation, detail, tone = "active", active = false, completed = state.mediaCompleted, total = state.mediaPlan.length, refreshLog = true, countdown = null }) {
    state.mediaOverlayActive = true;
    setBridgeStatus(badge, operation, detail, tone, active, countdown);
    refs.overlayOperation.textContent = "OFFLINE IMAGES";
    refs.buildChoices.hidden = true;
    refs.eventLog.hidden = false;
    refs.collectionControls.hidden = true;
    refs.mediaControls.hidden = false;
    refs.mediaCancelOverlay.hidden = !state.mediaController;
    const running = active && Boolean(state.mediaController);
    patchAttr(refs.mediaCancelOverlay, "aria-disabled", running && state.mediaCancelRequested === state.mediaController ? "true" : null);
    patchHidden(refs.mediaBusy, !running);
    patchText(refs.mediaBusyStatus, running ? mediaBusyText() : "");
    refs.mediaSaveOverlay.hidden = !state.pendingMediaPackage;
    refs.collectionActivity.hidden = false;
    refs.requestProgress.hidden = true;
    text("collectionActivityLabel", "Offline images");
    const boundedTotal = Math.max(1, total);
    refs.collectionActivityProgress.value = Math.max(0, Math.min(100, completed / boundedTotal * 100));
    text("collectionActivityText", `${formatInteger(completed)} of ${formatInteger(total)} images finished`);
    refs.collectionActivityImage.alt = "Offline image download activity";
    setCollectionActivityImage(active && !matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (refreshLog) renderMediaEventLog();
    updateBuildAction();
    updateOrganizationActionAvailability();
    renderCautionTape();
  }

  // The rows whose summary is a text of §11.3, shown at the warning prose size.
  const WARNING_PROSE_ROWS = new Set([9, 13, 14, 16, 17, 18, 20, 21]);

  // Build Status from an accepted status (§11.2): one presentation, patched into the panel's stable nodes. A status
  // never shows, expands, minimizes or focuses the panel; only the user's own actions do.
  // The notice that RSI changed a page (§11.4): one block per detected change, built with DOM calls and textContent,
  // appended once by its key. It stays until the next run starts. It never opens, reopens, minimizes, expands, focuses
  // or scrolls the panel; the alert region announces only an entry appended while the panel is shown.
  function renderChangeNotice(publicStatus) {
    const container = refs.parserChangeNotice;
    if (!container) return;
    const job = publicStatus?.activeJob ?? null;
    const runId = typeof job?.runId === "string" ? job.runId : null;
    if (runId && runId !== state.view.noticeRunId) {
      if (state.view.noticeKeys.size > 0) container.replaceChildren();
      state.view.noticeKeys.clear();
      state.view.noticeRunId = runId;
    }
    for (const notice of Model.changeNotices(job?.detectedChanges)) {
      if (state.view.noticeKeys.has(notice.key)) continue;
      state.view.noticeKeys.add(notice.key);
      const entry = document.createElement("section");
      entry.className = "parser-change-entry";
      const title = document.createElement("b");
      title.textContent = notice.title;
      const prose = document.createElement("p");
      prose.textContent = notice.prose;
      const technical = document.createElement("p");
      technical.className = "parser-change-technical";
      technical.textContent = notice.technical;
      const request = document.createElement("p");
      request.textContent = notice.request;
      const links = document.createElement("p");
      for (const [label, href] of [["Existing issues", notice.searchLink], ["New issue", notice.newIssueLink]]) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = label;
        if (links.childNodes.length > 0) links.append(" ");
        links.append(link);
      }
      entry.append(title, prose, technical, request, links);
      container.append(entry);
    }
    patchHidden(container, state.view.noticeKeys.size === 0);
  }

  function renderCollectionStatus(value, options = {}) {
    const publicStatus = normalizedPublicStatus(value) ?? state.publicStatus;
    if (publicStatus) state.publicStatus = publicStatus;
    renderCautionTape();
    renderChangeNotice(publicStatus);
    if (state.mediaOverlayActive) {
      updateBuildAction();
      updateUnavailableControls();
      return;
    }
    const panelTop = refs.overlay.scrollTop;
    const activeJob = publicStatus?.activeJob ?? null;
    patchHidden(refs.buildChoices, true);
    patchHidden(refs.eventLog, false);
    const presentation = Model.buildPresentation(publicStatus, {
      bridgeConnected: state.bridgeReachable,
      connecting: options.connecting === true || state.connecting,
      jobKind: options.jobKind
    });
    state.view.presentation = presentation;
    setBridgeStatus(presentation.badge, presentation.operation, presentation.summary, presentation.tone, presentation.active, presentation.countdown, WARNING_PROSE_ROWS.has(presentation.row) ? "warning" : null);

    const requiresRebind = publicStatus?.requiresRebind === true;
    const controls = presentation.controls;
    const continuable = presentation.row >= 16 && presentation.row <= 19;
    state.continuePartial = continuable;
    patchText(refs.overlayOperation, presentation.jobKind === "roster" ? "ORGANIZATION DATA" : continuable ? "CONTINUE BACKUP" : "ACCOUNT DATA");
    updateBuildAction();
    updateOrganizationActionAvailability();
    patchHidden(refs.mediaControls, true);
    const connected = state.bridgeReachable;
    patchHidden(refs.collectionControls, !connected || !(controls.pause || controls.resume || controls.cancel || controls.rebind));
    patchHidden(refs.rebindCollection, !connected || !controls.rebind);
    patchHidden(refs.pauseCollection, !connected || !controls.pause);
    patchHidden(refs.resumeCollection, !connected || !controls.resume);
    patchText(refs.resumeCollection, controls.resumeLabel);
    patchHidden(refs.cancelCollection, !connected || !controls.cancel);
    // Skip is offered for one stage only, the reading of CCU buyback prices, and once for a run.
    patchHidden(refs.skipCollection, !connected || !controls.skip || state.skipRequestedRunId === activeJob?.runId);

    const showActivity = Boolean(activeJob) || requiresRebind;
    patchHidden(refs.collectionActivity, !showActivity);
    if (showActivity) {
      const section = Model.collectionSectionPresentation(activeJob?.currentSection);
      const progress = Model.collectionProgress(activeJob);
      text("collectionActivityLabel", section.label);
      text("collectionActivityText", `${progress.overallText} · ${progress.httpText}`);
      patchProgress(refs.collectionActivityProgress, Math.max(0, Math.min(100, progress.overallPercent)));
      patchHidden(refs.requestProgress, !progress.requestProgress);
      if (progress.requestProgress) {
        patchText(refs.requestProgressLabel, progress.requestProgress.label);
        if (!progress.requestProgress.indeterminate) patchProgress(refs.collectionRequestProgress, Math.max(0, Math.min(100, progress.requestProgress.percent)));
        else if (refs.collectionRequestProgress.hasAttribute("value")) refs.collectionRequestProgress.removeAttribute("value");
        patchText(refs.requestProgressText, progress.requestProgress.text);
      }
      setCollectionActivityImage(activeJob?.status === "running" && !requiresRebind && !matchMedia("(prefers-reduced-motion: reduce)").matches);
    } else {
      patchHidden(refs.requestProgress, true);
      setCollectionActivityImage(false);
    }
    renderEventLog(publicStatus, presentation);
    refreshOverlayTitle();
    announcePresentation(presentation);
    updateUnavailableControls();
    if (refs.overlay.scrollTop !== panelTop) refs.overlay.scrollTop = panelTop;
  }

  function clearStatusPoll() {
    window.clearTimeout(state.statusPollTimer);
    state.statusPollTimer = null;
  }

  function statusPollDelay() {
    const jobStatus = state.publicStatus?.activeJob?.status;
    return state.publicStatus?.hasActiveJob === true || ["running", "paused"].includes(jobStatus) ? 5000 : 15000;
  }

  function scheduleStatusPoll() {
    clearStatusPoll();
    if (!state.bridge || document.hidden) return;
    state.statusPollTimer = window.setTimeout(() => { void pollStatus(); }, statusPollDelay());
  }

  function markBridgeDisconnected() {
    state.bridgeReachable = false;
    state.connecting = false;
    renderCollectionStatus(state.publicStatus);
  }

  async function openPartialDocument(documentValue, publicStatus) {
    const runId = publicStatus?.activeJob?.runId;
    if (!runId || state.openedPartialRunIds.has(runId)) return;
    const handle = typeof documentValue?.account?.handle === "string" ? documentValue.account.handle.replace(/[^A-Za-z0-9_-]+/gu, "-").slice(0, 64) : "account";
    const timestamp = globalThis.CitizenDataFileTimestamp.format(new Date().toISOString());
    await acceptAccountDocument(documentValue, { source: "extension-partial", fileName: `citizendata-${handle || "account"}-partial-${timestamp}.json` }, { activate: resultOpensShown() });
    state.openedPartialRunIds.add(runId);
    showToast("Partial backup open. Completed sections are available locally; this partial document was not downloaded as a completed backup.");
  }

  async function openPartialOrganizationDocument(documentValue, publicStatus) {
    const acceptedResult = await globalThis.CitizenDataAccountDocument.acceptAccountDocument(documentValue, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
    const selectedSids = Model.asArray(publicStatus?.activeJob?.selectedSections)
      .filter((section) => {
        if (typeof section !== "string" || !section.startsWith("organizations.members.")) return false;
        const sid = section.slice("organizations.members.".length);
        return ["complete", "partial"].includes(acceptedResult.sync?.organizationMemberOutcomes?.[sid]?.status);
      })
      .map((section) => section.slice("organizations.members.".length));
    // The rosters go into the session of their account; with no document of it open, there is nothing to add them to.
    const session = documentSession(acceptedResult.account);
    if (!selectedSids.length || !session) return;
    session.organizationDocument = await globalThis.CitizenDataOrganizationDocument.merge({
      accountDocument: acceptedResult,
      previous: session.organizationDocument,
      resultDocument: acceptedResult,
      selectedSids,
      exportedAt: acceptedResult.exportedAt ?? new Date().toISOString(),
      generatorVersion: DASHBOARD_VERSION,
      terminalStatus: "partial"
    });
    session.organizationFileName = "Unsaved partial Organization Data";
    if (session === activeSession()) renderOrganizations();
    showToast("Completed organization rosters from the partial job are open locally. Continue the job before saving the final Orgs JSON.");
  }

  async function requestPartialDocument(publicStatus) {
    const runId = publicStatus?.activeJob?.runId;
    if (!state.bridge || !publicStatus?.partialAvailable || !runId || state.openedPartialRunIds.has(runId) || state.requestedPartialRunIds.has(runId)) return;
    state.requestedPartialRunIds.add(runId);
    let receivedPartial = false;
    try {
      const response = await requestBridge("GET_PARTIAL_RESULT", null);
      state.bridgeReachable = true;
      if (response.status) renderCollectionStatus(response.status);
      if (!response.ok || !response.partialResult) throw new Error(response.message ?? response.code ?? "The partial backup was unavailable.");
      receivedPartial = true;
      await openPartialDocument(response.partialResult, normalizedPublicStatus(response.status) ?? publicStatus);
    } catch (error) {
      if (!receivedPartial) state.requestedPartialRunIds.delete(runId);
      if (!state.partialFailureNotifiedRunIds.has(runId)) {
        state.partialFailureNotifiedRunIds.add(runId);
        showDialog("PARTIAL BACKUP", "Partial backup could not be opened", error.message);
      }
    }
  }

  // Returns true once the backup file has been handed to the browser, which is what lets the extension stop offering it.
  async function openCompletedDocument(documentValue, { recovered = false, partial = false } = {}) {
    const timestamp = globalThis.CitizenDataFileTimestamp.format(new Date().toISOString());
    const accepted = await acceptAccountDocument(documentValue, { source: "extension", fileName: `citizendata-${timestamp}.json` }, { activate: resultOpensShown() });
    // A result of another account than the one shown is put under that account, and the user is told where it is.
    const shown = state.document === accepted;
    const session = shown ? activeSession() : accounts.values().find((candidate) => candidate.document === accepted) ?? null;
    const where = shown ? "is now open in this dashboard" : "is open under Switch Account";
    const contentHash = accepted.integrity.contentHash;
    if (state.savedBuildContentHashes.has(contentHash)) return true;
    try {
      const saved = globalThis.CitizenDataCanonicalDownload.download(accepted);
      state.savedBuildContentHashes.add(contentHash);
      if (session) session.fileName = saved.fileName;
      if (shown) text("railExported", saved.fileName);
      if (partial) {
        // W-29: {fileName} bounded to 200 printable characters, or "The saved file".
        const shown = typeof saved.fileName === "string" && saved.fileName.length > 0 && saved.fileName.length <= 200 && [...saved.fileName].every((character) => character.codePointAt(0) >= 32 && character.codePointAt(0) !== 127) ? saved.fileName : "The saved file";
        showDialog("BUILD JSON", "Partial backup saved", `${shown} leaves out the skipped sections. Any earlier complete backup is unchanged.`);
        return true;
      }
      showDialog("BUILD JSON", "Account backup saved", `${recovered ? "This backup finished while the dashboard was not connected. " : ""}${saved.fileName} passed the canonical schema and SHA-256 integrity checks, was saved to your device, and ${where}.${removalSummary(accepted)} Keep your earlier backup files as well: a record RSI stops listing can only be shown by comparing two backups.`);
      return true;
    } catch (error) {
      showDialog("BUILD JSON", "Account backup open; download failed", `The canonical account backup ${shown ? "is open in this dashboard" : "is open under Switch Account"}, but the browser did not save it: ${error.message}`);
      return false;
    }
  }

  async function openCompletedOrganizationDocument(documentValue, publicStatus) {
    const acceptedResult = await globalThis.CitizenDataAccountDocument.acceptAccountDocument(documentValue, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
    const session = documentSession(acceptedResult.account);
    if (!session) throw new Error("The Organization Data result belongs to a different Account JSON.");
    const selectedSids = Model.asArray(publicStatus?.activeJob?.selectedSections)
      .filter((section) => typeof section === "string" && section.startsWith("organizations.members."))
      .map((section) => section.slice("organizations.members.".length));
    if (!selectedSids.length) throw new Error("The completed Organization Data job did not identify its selected organizations.");
    const exportedAt = acceptedResult.exportedAt ?? new Date().toISOString();
    const organizationDocument = await globalThis.CitizenDataOrganizationDocument.merge({
      accountDocument: acceptedResult,
      previous: session.organizationDocument,
      resultDocument: acceptedResult,
      selectedSids,
      exportedAt,
      generatorVersion: DASHBOARD_VERSION,
      terminalStatus: "complete"
    });
    session.organizationDocument = organizationDocument;
    const contentHash = organizationDocument.integrity.contentHash;
    if (session === activeSession()) renderOrganizations();
    if (state.savedOrganizationHashes.has(contentHash)) return true;
    const saved = globalThis.CitizenDataCanonicalDownload.downloadOrganizations(organizationDocument);
    state.savedOrganizationHashes.add(contentHash);
    session.organizationFileName = saved.fileName;
    if (session === activeSession()) refs.orgFileStatus.textContent = saved.fileName;
    showDialog("ORGANIZATION DATA", "Organization data saved", `${saved.fileName} contains the selected member rosters in one account-bound Organization JSON.`);
    return true;
  }

  async function acknowledgeCompletedResult(runId) {
    if (typeof runId !== "string" || state.acknowledgedRunIds.has(runId)) return;
    state.acknowledgedRunIds.add(runId);
    try {
      const response = await requestBridge("ACKNOWLEDGE_RESULT", { runId });
      if (!response.ok) state.acknowledgedRunIds.delete(runId);
    } catch {
      // The extension keeps offering the result; its content hash prevents the same file from being saved twice in this page.
      state.acknowledgedRunIds.delete(runId);
    }
  }

  // While the extension's build history is on, the dashboard opens the latest finished build by itself when it
  // loads, in place of the example. It asks once for a page load. A file the user opened, or a result that arrived
  // first, is never replaced, and nothing is saved again: the build was saved as a file when it finished.
  async function openLatestBuild() {
    if (state.latestBuildRequested || !state.bridge || state.extensionUpdateRequired || !resultOpensShown()) return;
    state.latestBuildRequested = true;
    let response;
    try {
      response = await requestBridge("GET_LATEST_BUILD", null);
    } catch {
      return;
    }
    if (!response?.ok || !response.result || !resultOpensShown()) return;
    try {
      const fileName = globalThis.CitizenDataCanonicalDownload.canonicalFileName(response.result);
      await acceptAccountDocument(response.result, { source: "extension", fileName });
      state.fileName = fileName;
      text("railExported", fileName);
      showToast("Your latest build, kept in the extension, is open.");
    } catch (error) {
      showToast(`The latest build kept in the extension could not be opened: ${error?.message ?? "unknown error"}`);
    }
  }

  // A finished run is pushed to the dashboard once. If no dashboard was open to receive it, the result waits in the extension and is fetched here.
  async function requestCompletedResult(publicStatus) {
    const pending = publicStatus?.completedResultPending;
    const runId = pending?.runId;
    if (!state.bridge || typeof runId !== "string" || state.requestedCompletedRunIds.has(runId) || state.acknowledgedRunIds.has(runId)) return;
    const organizationData = pending.jobKind === "organizationData";
    // An Organization Data result can only be merged into the Account JSON it belongs to.
    if (organizationData && !accounts.values().some((session) => !session.identityOnly)) return;
    state.requestedCompletedRunIds.add(runId);
    try {
      const response = await requestBridge("GET_COMPLETED_RESULT", null);
      if (!response.ok || !response.result || response.runId !== runId) throw new Error(response.message ?? response.code ?? "The completed result was unavailable.");
      const saved = organizationData
        ? await openCompletedOrganizationDocument(response.result, { activeJob: { jobKind: "organizationData", selectedSections: Model.asArray(response.selectedSections) } })
        : await openCompletedDocument(response.result, { recovered: true, partial: pending.status === "partial" });
      if (saved) await acknowledgeCompletedResult(runId);
    } catch (error) {
      showDialog("BUILD JSON", "Completed result could not be opened", `${error.message} The result stays in the extension; reload this page to try again.`);
    }
  }

  // One way in for every status (§11.2), pushed STATUS and polled GET_STATUS alike. A lower revision is ignored; a
  // poll answer without one is ignored when a later poll was applied already; a pushed status without one keeps
  // arrival order, as an older extension sends it. A status that fails validation keeps the last valid presentation.
  function acceptStatus(value, { pollSequence = null } = {}) {
    const status = Model.validateStatus(normalizedPublicStatus(value));
    if (!status) return null;
    if (Number.isSafeInteger(status.statusRevision)) {
      if (status.statusRevision < state.view.revision) return null;
      state.view.revision = status.statusRevision;
    } else if (pollSequence !== null && pollSequence < state.view.appliedPoll) return null;
    if (pollSequence !== null) state.view.appliedPoll = Math.max(state.view.appliedPoll, pollSequence);
    return status;
  }

  async function applyDashboardPayload(payload, options = {}) {
    const accepted = acceptStatus(payload, options);
    const publicStatus = accepted ?? state.publicStatus;
    state.bridgeReachable = true;
    state.connecting = false;
    // A stale status changes nothing, except that a panel left connecting or disconnected shows the last valid one.
    if (accepted || [5, 6].includes(state.view.presentation?.row)) renderCollectionStatus(publicStatus);
    if (payload?.partialResult) {
      if (publicStatus?.activeJob?.jobKind === "organizationData") await openPartialOrganizationDocument(payload.partialResult, publicStatus);
      else await openPartialDocument(payload.partialResult, publicStatus);
    }
    else await requestPartialDocument(publicStatus);
    if (payload?.result) {
      const saved = publicStatus?.activeJob?.jobKind === "organizationData"
        ? await openCompletedOrganizationDocument(payload.result, publicStatus)
        : await openCompletedDocument(payload.result, { partial: publicStatus?.activeJob?.status === "partial" });
      if (saved) await acknowledgeCompletedResult(completedRunId(publicStatus));
    }
    else await requestCompletedResult(publicStatus);
    scheduleStatusPoll();
  }

  async function pollStatus() {
    if (!state.bridge || document.hidden) {
      scheduleStatusPoll();
      return;
    }
    try {
      state.view.pollSequence += 1;
      const pollSequence = state.view.pollSequence;
      const response = await requestBridge("GET_STATUS", null);
      if (!response.ok || !response.status) throw new Error(response.message ?? response.code ?? "Star Citizen Data Downloader status is unavailable.");
      await applyDashboardPayload({ status: response.status }, { pollSequence });
    } catch {
      markBridgeDisconnected();
      scheduleStatusPoll();
    }
  }

  function requestBridge(type, payload) {
    if (state.extensionUpdateRequired) return Promise.reject(new Error("Update the Star Citizen Data Downloader extension, then reload this page."));
    if (!state.bridge) return Promise.reject(new Error("The Star Citizen Data Downloader extension bridge is not connected."));
    const requestId = crypto.randomUUID();
    const envelope = { channel: BRIDGE_CHANNEL, protocolVersion: PROTOCOL_VERSION, type, requestId, bridgeSessionId: state.bridge.bridgeSessionId, nonce: state.bridge.nonce, payload };
    return new Promise((resolve, reject) => {
      const timeoutMs = ["PROPOSE_BUILD", "PROPOSE_ORGANIZATION_ROSTER", "CONTINUE_PARTIAL", "GET_KEPT_IMAGES", "GET_KEPT_IMAGE_FILES", "KEEP_IMAGES", "GET_LATEST_BUILD", "KEEP_BUILD", "KEEP_ORGANIZATIONS", "LIST_ACCOUNTS", "GET_ACCOUNT_BUILD", "DISCOVER_CURRENT_ACCOUNT"].includes(type) ? 60000 : 8000;
      const timer = window.setTimeout(() => {
        state.bridgePending.delete(requestId);
        reject(new Error("The extension did not respond before the request timed out."));
      }, timeoutMs);
      state.bridgePending.set(requestId, { resolve, reject, timer });
      window.postMessage(envelope, bridgePostTarget());
    });
  }

  // Any extension release that speaks this bridge protocol version is compatible; its own version number is not compared.
  function noteBridgeProtocolMismatch(payload) {
    const extensionVersion = typeof payload?.extensionVersion === "string" ? payload.extensionVersion.slice(0, 32) : "unknown";
    state.bridge = null;
    state.extensionUpdateRequired = true;
    state.bridgeReachable = false;
    state.bridgeSeen = true;
    state.connecting = false;
    state.continuePartial = false;
    clearStatusPoll();
    refs.buildButton.classList.add("bridge-gated");
    refs.overlay.hidden = false;
    refs.buildChoices.hidden = true;
    refs.collectionControls.hidden = true;
    refs.collectionActivity.hidden = true;
    setBridgeStatus("UPDATE REQUIRED", "Extension and dashboard do not match", `Star Citizen Data Downloader extension ${extensionVersion} uses a different connection version than this page. Update the extension, then reload this page.`, "warning", false);
    setOverlayMinimized(false);
    updateBuildAction();
    updateOrganizationActionAvailability();
    if (!state.extensionUpdateNotified) {
      state.extensionUpdateNotified = true;
      showDialog("EXTENSION STATUS", "Star Citizen Data Downloader update required", `The installed Star Citizen Data Downloader extension (${extensionVersion}) and this dashboard use different connection versions. Update the extension, then reload this page. If the extension is already current, reloading this page loads the current dashboard.`);
    }
  }

  function bridgeMessage(event) {
    if (event.source !== window || !bridgeMessageOriginMatches(event.origin)) return;
    const candidate = event.data;
    if (candidate && typeof candidate === "object" && candidate.channel === BRIDGE_CHANNEL && candidate.type === "BRIDGE_READY"
      && Number.isSafeInteger(candidate.protocolVersion) && candidate.protocolVersion !== PROTOCOL_VERSION) {
      noteBridgeProtocolMismatch(candidate.payload);
      return;
    }
    // A downloaded copy stays disconnected until the user approves it in the extension popup.
    if (candidate && typeof candidate === "object" && candidate.channel === BRIDGE_CHANNEL && candidate.type === "LOCAL_APPROVAL_REQUIRED"
      && location.protocol === "file:" && !state.bridge) {
      state.localApprovalRequired = true;
      if (!refs.buildChoices.hidden) refreshBuildChoices();
      return;
    }
    if (!validEnvelope(candidate)) return;
    const message = candidate;
    if (message.type === "BRIDGE_READY") {
      const extensionVersion = typeof message.payload?.extensionVersion === "string" ? message.payload.extensionVersion : "unknown";
      state.bridge = { bridgeSessionId: message.bridgeSessionId, nonce: message.nonce, extensionVersion, capabilities: message.payload?.capabilities ?? {} };
      state.extensionUpdateRequired = false;
      state.extensionUpdateNotified = false;
      state.localApprovalRequired = false;
      state.bridgeReachable = true;
      state.bridgeSeen = true;
      state.connecting = false;
      // A new bridge session may follow cleared extension data, whose revisions start again.
      state.view.revision = -1;
      state.view.appliedPoll = 0;
      const enabled = state.bridge.capabilities.buildJson === true;
      refs.buildButton.classList.toggle("bridge-gated", !enabled);
      renderCollectionStatus(state.publicStatus ?? { status: "idle", activeJob: null });
      if (!enabled) setBridgeStatus("CONNECTED", "Account adapters are gated", state.bridge.capabilities.reason ?? "This source checkpoint performs no authenticated RSI requests.", "warning", false);
      void pollStatus();
      void attachKeptImages();
      // An extension that keeps accounts lists them; an earlier one hands over its latest build alone.
      if (state.bridge.capabilities.accounts === true) void loadExtensionAccounts();
      else void openLatestBuild();
      // A file the user opened before the extension connected is offered to it now, for every account open here.
      for (const session of accounts.values()) {
        void offerBuildToExtension(session).then((sentence) => { if (sentence) showToast(sentence); });
        void offerOrganizationsToExtension(session).then((sentence) => { if (sentence) showToast(sentence); });
      }
      return;
    }
    if (message.bridgeSessionId !== state.bridge?.bridgeSessionId || message.nonce !== state.bridge?.nonce) return;
    if (message.type === "STATUS" || message.type === "RESULT") {
      void applyDashboardPayload(message.payload).catch((error) => showDialog("BUILD JSON", "Extension result rejected", error.message));
      return;
    }
    if (message.type !== "RESPONSE") return;
    const pending = state.bridgePending.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    state.bridgePending.delete(message.requestId);
    state.bridgeReachable = true;
    pending.resolve(message.payload ?? {});
  }

  // A build or roster run for an account shown here names it, so the extension starts it only while RSI is signed in
  // as that account. The example names none. An extension that keeps no accounts is sent the plan alone.
  function boundAccountKey() {
    if (state.bridge?.capabilities?.accounts !== true || activeSession() === exampleSession) return null;
    return AccountSessions.extensionKey(activeSession().identity);
  }

  async function proposeBuild() {
    if (state.mediaController) {
      reopenMediaOverlay();
      return;
    }
    if (!state.bridge) {
      openBuildChooser();
      return;
    }
    state.mediaOverlayActive = false;
    refs.mediaControls.hidden = true;
    refs.buildButton.disabled = true;
    clearStatusPoll();
    const priorCompletedRunId = completedRunId();
    if (priorCompletedRunId) state.dismissedCompletedRunIds.delete(priorCompletedRunId);
    showOverlayExpanded();
    // Settings that fail their own validation propose nothing; the panel says why.
    const pacingProblem = globalThis.CitizenDataRequestPacing?.validationMessage ?? null;
    if (pacingProblem !== null) {
      setBridgeStatus("SETTINGS", "Build cannot start", `The request pacing settings are not valid: ${pacingProblem}`, "failure", false);
      updateBuildAction();
      return;
    }
    state.connecting = true;
    renderCollectionStatus(state.publicStatus, { connecting: true });
    try {
      const plan = Model.buildDefaultPlan(state.bridge.capabilities);
      const expectedAccountKey = boundAccountKey();
      const response = await requestBridge("PROPOSE_BUILD", expectedAccountKey ? { plan, expectedAccountKey } : plan);
      state.connecting = false;
      if (response.status) await applyDashboardPayload({ status: response.status });
      else renderCollectionStatus(state.publicStatus);
      if (response.ok) {
        showToast(response.message ?? "Account backup started.");
      }
      else if (!showStartDeclined(response)) showDialog("BUILD JSON", response.code === "COLLECTION_GATED" ? "Account adapters are gated" : "Build request declined", response.message ?? "No account collection started.");
    } catch (error) {
      markBridgeDisconnected();
      scheduleStatusPoll();
      showDialog("BUILD JSON", "Extension request failed", error.message);
    } finally {
      state.connecting = false;
      updateBuildAction();
      scheduleStatusPoll();
    }
  }

  function populateOrganizationChecklist(preferredSid = null) {
    const memberships = Model.asArray(state.document.organizations?.memberships);
    refs.orgRosterChecklist.replaceChildren();
    for (const membership of memberships) {
      const index = state.organizationDocument?.rosterIndex?.find((entry) => entry.organizationSid === membership.sid);
      const input = element("input");
      input.type = "checkbox";
      input.name = "organizationSid";
      input.value = membership.sid;
      input.checked = preferredSid ? membership.sid === preferredSid : index?.status !== "complete";
      input.addEventListener("change", updateOrganizationActionAvailability);
      const copy = element("span");
      copy.append(element("b", "", membership.name ?? membership.sid), element("small", "", `${membership.sid} · ${formatInteger(membership.memberCount ?? 0)} reported members · ${index?.status ?? "not downloaded"}`));
      const label = element("label");
      label.append(input, copy);
      refs.orgRosterChecklist.append(label);
    }
    updateOrganizationActionAvailability();
  }

  function openOrganizationBuildDialog(preferredSid = null) {
    if (state.source === "demo") {
      showDialog("ORGANIZATION DATA", "Load Account JSON first", "Build Orgs JSON uses the organization memberships from the loaded Account JSON.");
      return;
    }
    populateOrganizationChecklist(preferredSid);
    if (activatedControl && !refs.orgBuildDialog.contains(activatedControl)) dialogOpeners.set(refs.orgBuildDialog, activatedControl);
    if (typeof refs.orgBuildDialog.showModal === "function") refs.orgBuildDialog.showModal();
  }

  async function proposeOrganizationRosters(organizationSids) {
    if (showCoolingDown()) return;
    const sids = [...new Set(Model.asArray(organizationSids))];
    const memberships = Model.asArray(state.document.organizations?.memberships);
    if (!sids.length || sids.some((sid) => !memberships.some((membership) => membership?.sid === sid)) || !state.bridge) {
      showDialog("ORGANIZATION DATA", "Organization plan expired", "Choose the organizations again before starting the job.");
      return;
    }
    const blocker = activeOperationNotice();
    if (blocker) {
      showDialog("ORGANIZATION DATA", "Another job is active", blocker);
      return;
    }
    showOverlayExpanded();
    state.connecting = true;
    renderCollectionStatus(state.publicStatus, { connecting: true, jobKind: "organizationData" });
    try {
      const expectedAccountKey = boundAccountKey();
      const response = await requestBridge("PROPOSE_ORGANIZATION_ROSTER", expectedAccountKey ? { roster: { organizationSids: sids }, expectedAccountKey } : { organizationSids: sids });
      state.connecting = false;
      if (response.status) await applyDashboardPayload({ status: response.status });
      if (response.ok) {
        showToast(response.message ?? "Organization Data job started.");
      } else if (!showStartDeclined(response)) showDialog("ORGANIZATION DATA", "Organization job declined", response.message ?? "No Organization Data job started.");
    } catch (error) {
      state.connecting = false;
      showDialog("ORGANIZATION DATA", "Extension request failed", error.message);
    }
  }

  async function controlCollection(type) {
    const continuing = type === "CONTINUE_PARTIAL";
    if (continuing && showCoolingDown()) return false;
    if (continuing) {
      clearStatusPoll();
      showOverlayExpanded();
      state.connecting = true;
      renderCollectionStatus(state.publicStatus, { connecting: true });
    }
    try {
      const response = await requestBridge(type, null);
      state.connecting = false;
      if (response.status) await applyDashboardPayload({ status: response.status });
      else renderCollectionStatus(state.publicStatus);
      scheduleStatusPoll();
      if (response.ok && continuing) showToast(response.message ?? "Partial backup continuation started.");
      if (!response.ok && !(continuing && showStartDeclined(response))) showDialog("ACCOUNT COLLECTION", continuing ? "Continuation declined" : "Control request declined", response.message ?? response.code ?? "The collection state did not change.");
      return response.ok === true;
    } catch (error) {
      state.connecting = false;
      markBridgeDisconnected();
      scheduleStatusPoll();
      showDialog("ACCOUNT COLLECTION", "Extension request failed", error.message);
      return false;
    }
  }

  async function prepareMediaPlan() {
    if (state.mediaController) return;
    // The plan is made for the session shown now; one finished after another session is shown is left out.
    const session = activeSession();
    const generation = session.mediaPlanGeneration + 1;
    session.mediaPlanGeneration = generation;
    session.mediaPlan = [];
    session.mediaPlanAccount = null;
    session.mediaPlanDocument = null;
    session.pendingMediaPackage = null;
    text("mediaAssetCount", "Preparing");
    text("mediaSummary", "Preparing plan");
    refs.mediaStatus.textContent = "Preparing image plan.";
    // An added account without a document has no images.
    if (session.identityOnly) return;
    if (state.source === "demo") {
      const images = exampleImageCount();
      text("mediaAssetCount", formatInteger(images));
      text("mediaSummary", `${formatInteger(images)} unique images`);
      refs.mediaStatus.textContent = `${EXAMPLE_IMAGES_FILE} is open with ${formatInteger(images)} images. Every image in this example is shown from it.`;
      return;
    }
    try {
      const plan = await globalThis.CitizenDataMediaMaterializer.plan(session.document, globalThis.CITIZENDATA_MEDIA_POLICY);
      if (session !== activeSession() || generation !== session.mediaPlanGeneration) return;
      state.mediaPlan = plan;
      state.mediaPlanAccount = state.document.account ? { localAccountId: state.document.account.localAccountId ?? null, handle: state.document.account.handle ?? null } : null;
      state.mediaPlanDocument = state.document;
      text("mediaAssetCount", formatInteger(plan.length));
      text("mediaSummary", `${formatInteger(plan.length)} unique images`);
      refs.mediaStatus.textContent = plan.length ? "Use Build to start the image download." : "No RSI image links were found in this account file.";
      if (!refs.buildChoices.hidden) refreshBuildChoices();
      void attachKeptImages();
    } catch (error) {
      if (session !== activeSession() || generation !== session.mediaPlanGeneration) return;
      text("mediaAssetCount", "Plan unavailable");
      text("mediaSummary", "Plan unavailable");
      refs.mediaStatus.textContent = `Image plan could not be prepared: ${error.message}`;
    }
  }

  async function runMediaDownload() {
    if (!state.mediaPlan.length || state.mediaController) return;
    const controller = new AbortController();
    const plan = state.mediaPlan;
    const accountDocument = state.mediaPlanDocument;
    if (!accountDocument) throw new Error("The image plan is not bound to an account document.");
    state.mediaController = controller;
    state.mediaCancelRequested = null;
    state.mediaWait = null;
    state.pendingMediaPackage = null;
    state.mediaCompleted = 0;
    state.mediaActiveRequests = 0;
    state.mediaActivity = [];
    // A callback of this run after it was cancelled, or after it ended, changes nothing on the page.
    const live = () => state.mediaController === controller && state.mediaCancelRequested !== controller;
    const stopIfCancelled = () => {
      if (controller.signal.aborted) throw new DOMException("Image download cancelled.", "AbortError");
    };
    // A new image run starts without the last run's warning (§14).
    state.mediaTapeState = { active: true, warning: null, statusPage: null };
    state.mediaStatusPage = null;
    state.mediaStatusCheckedAt = null;
    addMediaActivity(`Started ${formatInteger(plan.length)} image downloads.`);
    refs.mediaStatus.textContent = "Image download is running in Build Status.";
    showOverlayExpanded();
    renderMediaOverlay({ badge: "DOWNLOADING", operation: "Downloading offline images", detail: `Downloading ${formatInteger(plan.length)} public images.`, active: true, completed: 0, total: plan.length });
    const startedAt = new Date().toISOString();
    let finalPresentation = null;
    try {
      const fromExtension = state.loadedMediaPackage?.fromExtension === true;
      if (fromExtension) {
        addMediaActivity("Reading the images kept in the extension.");
        await state.loadedMediaPackage.preload();
      }
      const delta = await globalThis.CitizenDataMediaPackageReader.prepareDelta(plan, state.loadedMediaPackage);
      state.mediaCompleted = delta.reused.assets.length;
      if (delta.reused.assets.length) addMediaActivity(`Reusing ${formatInteger(delta.reused.assets.length)} validated images from ${fromExtension ? "the extension" : "the loaded ZIP"}. ${formatInteger(delta.pending.length)} images remain to download.`);
      const history = await imagePaceHistorySources();
      const downloaded = await globalThis.CitizenDataMediaMaterializer.materialize(delta.pending, globalThis.CITIZENDATA_MEDIA_POLICY, {
        fetcher: (url, options) => fetch(url, { ...options, mode: "cors", cache: "no-store" }),
        runId: globalThis.crypto.randomUUID(),
        history,
        signal: controller.signal,
        statusPage: () => state.mediaStatusPage,
        onRequestStart: ({ index, total, attempt, activeRequests, maximumConcurrency }) => {
          if (!live()) return;
          state.mediaActiveRequests = activeRequests;
          addMediaActivity(`Started image ${formatInteger(index + 1)} of ${formatInteger(total)}. ${formatInteger(activeRequests)} of ${formatInteger(maximumConcurrency)} requests active${attempt > 1 ? `. Attempt ${formatInteger(attempt)}.` : "."}`);
          renderMediaOverlay(downloadingPresentation(plan.length));
        },
        onProgress: ({ completed, total, receipt, activeRequests, pace }) => {
          if (!live()) return;
          noteMediaPace(pace);
          state.mediaCompleted = delta.reused.assets.length + completed;
          if (Number.isSafeInteger(activeRequests)) state.mediaActiveRequests = activeRequests;
          // A refusal reports the pace alone, with no finished image.
          if (receipt) addMediaActivity(`Finished delta image ${formatInteger(completed)} of ${formatInteger(total)}. Result: ${receipt.status}.`, receipt.status === "failed" ? "warning" : "normal");
          renderMediaOverlay(downloadingPresentation(plan.length));
        },
        onWait: (wait) => {
          if (live()) noteMediaWait(wait, plan.length);
        }
      });
      // Cancelled as the last image finished: no record of a finished run, no ZIP and no download.
      stopIfCancelled();
      // Images left after RSI kept refusing (W-21): the status once more, and row 7 until the next image run or a reload.
      const stoppedWithRemaining = downloaded.stoppedWithRemaining === true;
      await keepImagePaceRun(downloaded.imageRun);
      if (stoppedWithRemaining) await refreshMediaStatusPage(true);
      state.mediaTapeState = { active: false, warning: null, stoppedWithRemaining, statusPage: state.mediaStatusPage };
      const assetsByUrl = new Map([...delta.reused.assets, ...downloaded.assets].map((asset) => [asset.sourceUrl, asset]));
      const filesByPath = new Map([...delta.reused.files, ...downloaded.files].map((file) => [file.name, file]));
      const materialized = {
        assets: plan.map((entry) => assetsByUrl.get(entry.normalizedUrl)).filter(Boolean),
        files: [...filesByPath.values()].sort((left, right) => left.name.localeCompare(right.name, "en")),
        totalBytes: [...filesByPath.values()].reduce((total, file) => total + file.bytes.byteLength, 0),
        downloadedBytes: downloaded.downloadedBytes,
        refusedAttempts: downloaded.refusedAttempts,
        pacing: downloaded.pacing,
        paceHistory: downloaded.paceHistory
      };
      stopIfCancelled();
      const result = await globalThis.CitizenDataMediaPackage.buildArchive({
        accountDocument,
        materialized,
        policy: globalThis.CITIZENDATA_MEDIA_POLICY,
        startedAt,
        endedAt: new Date().toISOString(),
        version: accountDocument.generator?.version ?? DASHBOARD_VERSION,
        requestCount: delta.pending.length,
        priorPackage: state.loadedMediaPackage && !fromExtension ? { packageId: state.loadedMediaPackage.manifest.packageId, manifestHash: state.loadedMediaPackage.manifest.integrity.contentHash } : null
      });
      stopIfCancelled();
      const openedResult = await globalThis.CitizenDataMediaPackageReader.open(new Blob([result.archive], { type: "application/zip" }), { maximumBytes: globalThis.CITIZENDATA_MEDIA_POLICY.maximumBytes });
      stopIfCancelled();
      // The automatic download is the run's completion point. The images go to the extension before it, and a cancel
      // until then ends the run with no ZIP. Nothing below the download awaits, so the run is complete with it.
      const keptNote = await keepPackageImages(openedResult, {
        signal: controller.signal,
        onKeeping: () => {
          if (!live()) return;
          addMediaActivity("Handing the images to the extension.");
          renderMediaOverlay({ badge: "FINALIZING", operation: "Keeping images in the extension", detail: "Handing the images to the extension.", active: true, completed: plan.length, total: plan.length });
        }
      });
      stopIfCancelled();
      state.pendingMediaPackage = result;
      clearLoadedMediaPackage();
      state.loadedMediaPackage = openedResult;
      state.loadedMediaFileName = result.fileName;
      let automaticDownloadError = null;
      try {
        globalThis.CitizenDataMediaPackage.download(result);
      } catch (error) {
        automaticDownloadError = error;
      }
      renderAll();
      const failed = result.manifest.summary.failed;
      const size = (result.archive.byteLength / (1024 * 1024)).toLocaleString("en-US", { maximumFractionDigits: 1 });
      const packageDetail = failed ? `${formatInteger(failed)} ${failed === 1 ? "image failed and is" : "images failed and are"} recorded in the manifest.` : "All images completed.";
      if (keptNote) addMediaActivity(keptNote.trim(), keptNote.includes("could not") || keptNote.includes("refused") ? "warning" : "normal");
      refs.mediaStatus.textContent = (automaticDownloadError
        ? `${result.fileName} is open for this dashboard, but automatic download failed: ${automaticDownloadError.message}`
        : `${result.fileName} was sent to the browser download manager and is open for this dashboard. Size: ${size} MiB. ${packageDetail}`) + keptNote;
      text("healthMedia", `${formatInteger(result.manifest.summary.downloaded + result.manifest.summary.reused)} packaged images loaded${failed ? ` · ${formatInteger(failed)} failed` : ""}`);
      refs.mediaSaveOverlay.textContent = automaticDownloadError ? "Save image ZIP" : "Save image ZIP again";
      addMediaActivity(automaticDownloadError ? `Automatic ZIP download failed: ${automaticDownloadError.message}` : "Image ZIP downloaded and opened for this dashboard.", automaticDownloadError || failed ? "warning" : "normal");
      finalPresentation = { badge: automaticDownloadError ? "READY TO SAVE" : "COMPLETED", operation: automaticDownloadError ? "Offline image ZIP ready" : "Offline image ZIP downloaded", detail: stoppedWithRemaining ? `${refs.mediaStatus.textContent} ${Model.TEXTS.imagesLeft}` : refs.mediaStatus.textContent, tone: automaticDownloadError ? "warning" : "success", active: false, completed: plan.length, total: plan.length };
    } catch (error) {
      state.mediaTapeState = { active: false, warning: null, stoppedWithRemaining: false, statusPage: null };
      state.mediaActiveRequests = 0;
      state.mediaWait = null;
      const keptBeforeCancel = error?.name === "AbortError" && error.kept > 0 ? ` The extension keeps the ${formatInteger(error.kept)} ${error.kept === 1 ? "image" : "images"} it took before the cancel.` : "";
      refs.mediaStatus.textContent = error?.name === "AbortError" ? `Image download cancelled. No partial ZIP was created.${keptBeforeCancel}` : `Image download failed: ${error?.message ?? "Unknown error"}`;
      addMediaActivity(refs.mediaStatus.textContent, error?.name === "AbortError" ? "warning" : "failure");
      finalPresentation = { badge: error?.name === "AbortError" ? "CANCELLED" : "FAILED", operation: error?.name === "AbortError" ? "Image download cancelled" : "Image download failed", detail: refs.mediaStatus.textContent, tone: error?.name === "AbortError" ? "warning" : "failure", active: false, completed: state.mediaCompleted, total: plan.length };
    } finally {
      scheduleMediaStatusRefresh(false);
      // This run's controller and cancellation only; a later run's are its own.
      if (state.mediaController === controller) {
        state.mediaController = null;
        state.mediaWait = null;
      }
      if (state.mediaCancelRequested === controller) state.mediaCancelRequested = null;
      if (finalPresentation && !state.mediaController) renderMediaOverlay(finalPresentation);
    }
  }

  async function saveMediaPackage() {
    if (!state.pendingMediaPackage) return;
    try {
      const mode = await globalThis.CitizenDataMediaPackage.save(state.pendingMediaPackage);
      refs.mediaStatus.textContent = mode === "picker" ? `${state.pendingMediaPackage.fileName} was saved to the selected location.` : `${state.pendingMediaPackage.fileName} was sent to the browser download manager.`;
      text("healthMedia", "Offline image ZIP saved");
      addMediaActivity(refs.mediaStatus.textContent);
      renderMediaOverlay({ badge: "COMPLETED", operation: "Offline image ZIP saved", detail: refs.mediaStatus.textContent, tone: "success", active: false, completed: state.mediaPlan.length, total: state.mediaPlan.length });
    } catch (error) {
      refs.mediaStatus.textContent = error?.name === "AbortError" ? "Save cancelled. The prepared ZIP remains available." : `ZIP could not be saved: ${error?.message ?? "Unknown error"}`;
      addMediaActivity(refs.mediaStatus.textContent, "warning");
      renderMediaOverlay({ badge: "READY TO SAVE", operation: "Offline image ZIP ready", detail: refs.mediaStatus.textContent, tone: "warning", active: false, completed: state.mediaPlan.length, total: state.mediaPlan.length });
    }
  }

  function bindEvents() {
    refs.loadButton.addEventListener("click", () => refs.fileInput.click());
    refs.fileInput.addEventListener("change", () => loadJsonFile(refs.fileInput.files?.[0]).catch((error) => showDialog("LOAD JSON", "File rejected", error.message)).finally(() => { refs.fileInput.value = ""; }));
    refs.loadOrgButton.addEventListener("click", (event) => { event.stopPropagation(); refs.orgFileInput.click(); });
    refs.orgFileInput.addEventListener("change", () => loadOrganizationFile(refs.orgFileInput.files?.[0]).catch((error) => showDialog("LOAD ORGS JSON", "File rejected", error.message)).finally(() => { refs.orgFileInput.value = ""; }));
    refs.buildOrgButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (showCoolingDown()) return;
      openOrganizationBuildDialog();
    });
    refs.loadMediaZipButton.addEventListener("click", () => refs.mediaZipInput.click());
    refs.mediaZipInput.addEventListener("change", () => loadMediaPackageFile(refs.mediaZipInput.files?.[0]).catch((error) => showDialog("LOAD IMAGES ZIP", "Package rejected", error.message)).finally(() => { refs.mediaZipInput.value = ""; }));
    document.addEventListener("click", rememberActivatedControl, true);
    refs.buildButton.addEventListener("click", openBuildChooser);
    refs.buildAccountAction.addEventListener("click", chooseAccountBuild);
    refs.buildImagesAction.addEventListener("click", chooseImageBuild);
    refs.rebindCollection.addEventListener("click", async () => {
      refs.rebindCollection.disabled = true;
      try {
        const response = await requestBridge("REQUEST_REBIND", null);
        if (response.status) await applyDashboardPayload({ status: response.status });
        if (response.ok) showToast(response.message ?? "The active run is connected again.");
        else showDialog("RECONNECT RUN", "Run could not be reconnected", response.message ?? response.code ?? "The active run could not be reconnected.");
      } catch (error) {
        showDialog("RECONNECT RUN", "Extension request failed", error.message);
      } finally {
        refs.rebindCollection.disabled = false;
      }
    });
    refs.pauseCollection.addEventListener("click", () => controlCollection("PAUSE"));
    refs.resumeCollection.addEventListener("click", () => controlCollection(state.continuePartial ? "CONTINUE_PARTIAL" : "RESUME"));
    refs.cancelCollection.addEventListener("click", () => controlCollection("CANCEL"));
    refs.skipCollection.addEventListener("click", async () => {
      const runId = state.publicStatus?.activeJob?.runId ?? null;
      state.skipRequestedRunId = runId;
      refs.skipCollection.hidden = true;
      // A request the extension declines leaves the button to be used again.
      if (!await controlCollection("SKIP_CCU_PRICES") && state.skipRequestedRunId === runId) state.skipRequestedRunId = null;
    });
    refs.mediaCancelOverlay.addEventListener("click", requestMediaCancel);
    refs.switchAccountButton.addEventListener("click", () => {
      if (refs.accountPopup.hidden) openAccountMenu();
      else closeAccountMenu(false);
    });
    refs.switchAccountButton.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      openAccountMenu(event.key === "ArrowUp");
    });
    refs.accountMenu.addEventListener("keydown", accountMenuKeydown);
    refs.accountMenu.addEventListener("click", (event) => {
      const item = event.target.closest('[role="menuitemradio"], [role="menuitem"]');
      if (!item || item.getAttribute("aria-disabled") === "true") return;
      if (item === refs.addAccountCommand) void addNewAccount();
      else if (item === refs.removeAccountCommand) confirmRemoveAccount();
      else chooseAccount(item.dataset.accountKey);
    });
    // The menu closes when focus or a pointer leaves it, and follows its button while the page scrolls or resizes.
    if (!ACCOUNT_POPOVER) document.body.append(refs.accountPopup);
    document.addEventListener("pointerdown", (event) => {
      if (!refs.accountPopup.hidden && !inAccountSwitcher(event.target)) closeAccountMenu(false);
    });
    refs.accountPopup.addEventListener("focusout", (event) => {
      if (!refs.accountPopup.hidden && event.relatedTarget && !inAccountSwitcher(event.relatedTarget)) closeAccountMenu(false);
    });
    window.addEventListener("resize", placeAccountPopup);
    document.addEventListener("scroll", placeAccountPopup, { capture: true, passive: true });
    refs.removeAccountDialog.addEventListener("close", () => {
      if (refs.removeAccountDialog.returnValue === "remove") void removeAccount(refs.removeAccountDialog.dataset.sessionKey);
    });
    refs.addAccountLoadJson.addEventListener("click", () => {
      refs.addAccountDialog.close();
      refs.fileInput.click();
    });
    refs.mediaSaveOverlay.addEventListener("click", () => { void saveMediaPackage(); });
    byId("loadReceiptButton").addEventListener("click", () => {
      const anomalyCount = Model.asArray(state.document.dataQuality?.anomalies).length;
      const detail = state.source === "demo"
        ? "You are viewing bundled example records and images. Load your own JSON to review your account."
        : anomalyCount
          ? `Your JSON is open on this device. ${formatInteger(anomalyCount)} raw source record warning${anomalyCount === 1 ? " was" : "s were"} retained for review. Nothing was uploaded or saved by the website.`
          : "Your JSON is open on this device. Nothing was uploaded or saved by the website.";
      showDialog("FILE DETAILS", state.source === "demo" ? "Example data" : "Local file", detail);
    });
    byId("minimizeOverlay").addEventListener("click", () => setOverlayMinimized(!refs.overlay.classList.contains("minimized")));
    byId("closeOverlay").addEventListener("click", () => {
      state.overlayDismissed = true;
      refs.overlay.hidden = true;
      returnFocusFromBuildStatus();
      if (state.mediaOverlayActive && !state.mediaController) state.mediaOverlayActive = false;
    });
    const closeOrganizationBuild = () => {
      state.pendingOrganizationSids = [];
      if (refs.orgBuildDialog.open) refs.orgBuildDialog.close();
    };
    byId("orgBuildClose").addEventListener("click", closeOrganizationBuild);
    byId("orgBuildCancel").addEventListener("click", closeOrganizationBuild);
    refs.orgBuildForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (showCoolingDown()) return;
      updateOrganizationActionAvailability();
      if (refs.orgBuildStart.disabled) return;
      const selectedSids = [...refs.orgRosterChecklist.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
      if (refs.orgBuildDialog.open) refs.orgBuildDialog.close();
      void proposeOrganizationRosters(selectedSids);
    });
    for (const button of document.querySelectorAll("[data-view]")) {
      button.addEventListener("click", () => setInventoryView(button.dataset.view));
      button.addEventListener("keydown", (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        setInventoryView(button.dataset.view === "hangar" ? "buybacks" : "hangar", true);
      });
    }
    for (const trigger of document.querySelectorAll("[data-open-view]")) trigger.addEventListener("click", () => setInventoryView(trigger.dataset.openView));
    refs.search.addEventListener("input", () => {
      state.inventoryPage = 1;
      renderInventory();
    });
    refs.inventoryPrevious.addEventListener("click", () => setInventoryPage(state.inventoryPage - 1));
    refs.inventoryNext.addEventListener("click", () => setInventoryPage(state.inventoryPage + 1));
    for (const button of document.querySelectorAll("[data-inventory-sort]")) button.addEventListener("click", () => {
      const key = button.dataset.inventorySort;
      if (state.inventorySortKey === key) state.inventorySortDirection = state.inventorySortDirection === "ascending" ? "descending" : "ascending";
      else {
        state.inventorySortDirection = initialInventorySortDirection(key);
        state.inventorySortKey = key;
      }
      state.inventoryPage = 1;
      state.activeRecordKey = null;
      renderInventory();
      refs.tableShell.scrollTop = 0;
    });
    refs.filterButton.addEventListener("click", () => {
      refs.filterPanel.hidden = !refs.filterPanel.hidden;
      refs.filterButton.setAttribute("aria-expanded", String(!refs.filterPanel.hidden));
    });
    refs.mediaGalleryDialog.addEventListener("close", () => {
      const opener = mediaGalleryOpener;
      mediaGalleryRecord = null;
      mediaGalleryOpener = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    for (const chip of document.querySelectorAll(".filter-chip")) chip.addEventListener("click", () => {
      state.activeGroup = chip.dataset.group;
      state.inventoryPage = 1;
      for (const candidate of document.querySelectorAll(".filter-chip")) {
        const selected = candidate === chip;
        candidate.classList.toggle("active", selected);
        candidate.setAttribute("aria-pressed", String(selected));
      }
      refs.filterCount.textContent = state.activeGroup === "all" ? "0" : "1";
      renderInventory();
    });
    byId("clearFilters").addEventListener("click", () => {
      refs.search.value = "";
      state.activeGroup = "all";
      state.inventoryPage = 1;
      refs.filterCount.textContent = "0";
      for (const chip of document.querySelectorAll(".filter-chip")) {
        const selected = chip.dataset.group === "all";
        chip.classList.toggle("active", selected);
        chip.setAttribute("aria-pressed", String(selected));
      }
      renderInventory();
    });
    byId("referralSortButton").addEventListener("click", () => {
      state.referralOrder = state.referralOrder === "newest" ? "oldest" : "newest";
      state.referralPage = 1;
      renderReferrals();
    });
    refs.referralSearch.addEventListener("input", () => {
      state.referralSearch = refs.referralSearch.value;
      state.referralPage = 1;
      renderReferrals();
    });
    byId("referralPrevious").addEventListener("click", () => { state.referralPage -= 1; renderReferrals(); });
    byId("referralNext").addEventListener("click", () => { state.referralPage += 1; renderReferrals(); });
    byId("organizationPrevious").addEventListener("click", () => { state.organizationPage -= 1; renderOrganizations(); });
    byId("organizationNext").addEventListener("click", () => { state.organizationPage += 1; renderOrganizations(); });
    refs.organizationSearch.addEventListener("input", () => {
      state.organizationSearch = refs.organizationSearch.value;
      state.organizationPage = 1;
      renderOrganizations();
    });
    for (const link of document.querySelectorAll(".rail-nav a")) link.addEventListener("click", () => activateRail(link));
    window.addEventListener("message", bridgeMessage);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearStatusPoll();
      else void pollStatus();
    });
    window.addEventListener("pagehide", clearStatusPoll);
  }

  async function initializeDashboard() {
    rotateHero();
    bindEvents();
    globalThis.CitizenDataExportControls.bind({
          getSnapshot: () => ({ document: documentForSelectedExports(), sourceName: state.source === "demo" ? "Example data" : state.fileName, sourceFileName: state.source === "demo" ? "example.json" : state.fileName, example: state.source === "demo" }),
      onDownloadStarted: (fileName, warnings = []) => showToast(`Download started: ${fileName}${warnings.length ? ` · ${formatInteger(warnings.length)} export warning${warnings.length === 1 ? "" : "s"}. Use Choose Export to review.` : ""}`),
      onDownloadFailed: (message) => showToast(`Export could not start: ${message}`)
    });
    renderAll();
    void prepareMediaPlan();
    renderCollectionStatus({ status: "idle", activeJob: null });
    window.dispatchEvent(new CustomEvent("citizendata-dashboard-ready"));
  }

  initializeDashboard().catch((error) => {
    activeAccountKey = null;
    state.document = globalThis.CITIZENDATA_DEMO_DATA;
    state.source = "demo";
    state.fileName = "example.json";
    renderAll();
    showDialog("DASHBOARD", "Account data could not be opened", error.message);
    window.dispatchEvent(new CustomEvent("citizendata-dashboard-ready"));
  });
})();
