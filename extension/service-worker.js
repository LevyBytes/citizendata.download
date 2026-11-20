"use strict";

importScripts(
  "shared/protocol.js",
  "schema/account-export.schema.js",
  "shared/account-document.js",
  "shared/organization-document.js",
  "shared/authorization.js",
  "jobs/plan-validation.js",
  "jobs/continuation-refresh.js",
  "jobs/state-machine.js",
  "storage/database.js",
  "storage/build-history.js",
  "storage/media-store.js",
  "jobs/runner.js",
  "adapters/normalization.js",
  "adapters/dom-extractors.js",
  "adapters/pure-parsers.js",
  "adapters/hangar-log-delta.js",
  "adapters/ccu-reconciliation.js",
  "adapters/update-delta.js",
  "adapters/job-outcomes.js",
  "adapters/removal-tracking.js",
  "adapters/document-assembler.js",
  "adapters/catalog.js",
  "adapters/rsi-api.js",
  "adapters/live-runtime.js",
  "adapters/registry.js",
  "jobs/organization-roster-proposal.js"
);

const Protocol = globalThis.CitizenDataProtocol;
const Authorization = globalThis.CitizenDataAuthorization;
const AccountDocument = globalThis.CitizenDataAccountDocument;
const OrganizationDocument = globalThis.CitizenDataOrganizationDocument;
const Plans = globalThis.CitizenDataPlanValidation;
const ContinuationRefresh = globalThis.CitizenDataContinuationRefresh;
const Database = globalThis.CitizenDataDatabase;
const BuildHistory = globalThis.CitizenDataBuildHistory;
const MediaStore = globalThis.CitizenDataMediaStore;
const Runner = globalThis.CitizenDataRunner;
const Adapters = globalThis.CitizenDataAdapterRegistry;
const DocumentAssembler = globalThis.CitizenDataDocumentAssembler;
const JobOutcomes = globalThis.CitizenDataJobOutcomes;
const RosterProposals = globalThis.CitizenDataOrganizationRosterProposal;
const LiveRuntime = globalThis.CitizenDataLiveRuntime;
const STORAGE_KEY = "citizendata.runtime.v2";
const LOCAL_DASHBOARDS_KEY = "citizendata.localDashboards.v1";
const LOCAL_PENDING_KEY = "citizendata.localPending.v1";
// Whether earlier builds are kept and how many, and the last build that could not be kept.
const BUILD_HISTORY_KEY = "citizendata.buildHistory.v1";
const BUILD_HISTORY_PROBLEM_KEY = "citizendata.buildHistoryProblem.v1";
const ORGANIZATIONS_PROBLEM_KEY = "citizendata.buildHistoryOrganizationsProblem.v1";
const MAXIMUM_LOCAL_DASHBOARDS = 20;
const RSI_ORIGIN = "https://robertsspaceindustries.com/*";
const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
const MAXIMUM_REQUESTS_PER_BRIDGE_SESSION = 25000;
// Chrome stops an idle worker and will not fire an alarm sooner than 30 seconds in an installed extension. Collection
// therefore runs as a loop inside the worker; this one repeating alarm only restarts a loop that Chrome stopped.
const WATCHDOG_ALARM = "citizendata.watchdog";
const WATCHDOG_PERIOD_MINUTES = 0.5;
const LEGACY_STEP_ALARM_PREFIX = "citizendata.job.";
const repository = Database.createIndexedDbRepository();
let replayQueue = Promise.resolve();
let stateQueue = Promise.resolve();

function initialState() {
  return {
    schemaVersion: 2,
    status: "idle",
    activeJobId: null,
    pendingProposalId: null,
    lastProposalAt: null,
    lastCompletedRunId: null,
    lastTerminalJobId: null,
    pendingResult: null,
    capabilityGate: Adapters.reason
  };
}

async function readState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  return value && value.schemaVersion === 2 ? value : initialState();
}

async function writeState(state) {
  const value = { ...state, schemaVersion: 2 };
  await chrome.storage.local.set({ [STORAGE_KEY]: value });
  await repository.saveRuntime(value);
  return value;
}

// Applies one change to the newest stored state. Status events arrive from the collection loop and from dashboard
// controls at the same time; queueing them keeps one from writing an older copy over the other.
function updateState(change) {
  const result = stateQueue.then(async () => writeState(await change(await readState())));
  stateQueue = result.catch(() => {});
  return result;
}

function capabilities() {
  return Protocol.publicCapabilities(Adapters);
}

async function sha256Canonical(value) {
  const bytes = new TextEncoder().encode(AccountDocument.canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function publicStatus(state, binding = null) {
  const activeJob = state.activeJobId ? await repository.getJob(state.activeJobId) : null;
  const jobs = activeJob ? [] : await repository.listJobs();
  const terminalJob = activeJob ? null : (state.lastTerminalJobId
    ? await repository.getJob(state.lastTerminalJobId)
    : [...jobs].filter((job) => ["cancelled", "failed", "complete"].includes(job.status)).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null);
  const visibleJob = activeJob ?? terminalJob;
  const authorization = visibleJob ? await repository.getAuthorization(visibleJob.authorizationId) : null;
  const controlSessionBound = Boolean(activeJob && authorization && binding
    && authorization.dashboardOrigin === binding.dashboardOrigin
    && authorization.bridgeSessionId === binding.bridgeSessionId);
  return {
    status: state.status,
    activeJob: visibleJob ? {
      jobId: visibleJob.jobId,
      runId: visibleJob.runId,
      status: visibleJob.status,
      mode: visibleJob.mode,
      jobKind: jobKindOf(visibleJob),
      selectedSections: [...visibleJob.plan.selectedSections],
      sectionIndex: visibleJob.sectionIndex,
      sectionCount: visibleJob.baselineSectionCount ?? visibleJob.plan.selectedSections.length,
      completedSections: (visibleJob.completedSectionsBeforeContinuation ?? 0) + visibleJob.sectionIndex,
      currentSection: visibleJob.plan.selectedSections[visibleJob.sectionIndex] ?? null,
      requestCount: visibleJob.requestCount,
      httpRequestCount: visibleJob.httpRequestCount ?? 0,
      httpRequestsTotal: Number.isSafeInteger(visibleJob.httpRequestsTotal) ? visibleJob.httpRequestsTotal : null,
      resolvedRequestTotalsForSections: visibleJob.resolvedRequestTotalsForSections ?? 0,
      requestsBySection: visibleJob.httpRequestsBySection ?? {},
      requestProgressBySection: visibleJob.requestProgressBySection ?? {},
      lastActivity: visibleJob.lastActivity ?? null,
      activityLog: visibleJob.activityLog ?? [],
      nextEligibleAt: visibleJob.nextEligibleAt,
      failure: visibleJob.failure
    } : null,
    hasActiveJob: Boolean(activeJob && !["cancelled", "failed", "complete"].includes(activeJob.status)),
    controlSessionBound,
    requiresRebind: Boolean(activeJob && !["cancelled", "failed", "complete"].includes(activeJob.status) && binding && !controlSessionBound),
    partialAvailable: Boolean(visibleJob?.status === "failed" && await partialRunAvailable(visibleJob)),
    continuable: Boolean(visibleJob?.status === "failed" && visibleJob.sectionIndex < visibleJob.plan.selectedSections.length && await partialRunAvailable(visibleJob)),
    pendingProposalId: state.pendingProposalId,
    hasPendingPlan: Boolean(state.pendingProposalId),
    lastProposalAt: state.lastProposalAt,
    lastCompletedRunId: state.lastCompletedRunId,
    // A finished run whose result no dashboard has confirmed saving. Only a dashboard of the origin that started it is told.
    completedResultPending: state.pendingResult && binding && state.pendingResult.dashboardOrigin === binding.dashboardOrigin
      ? { runId: state.pendingResult.runId, jobKind: state.pendingResult.jobKind }
      : null,
    capabilities: capabilities()
  };
}

function jobKindOf(job) {
  return job.plan.selectedSections.every((section) => section.startsWith("organizations.members.")) ? "organizationData" : "accountData";
}

async function partialRunAvailable(job) {
  if (!job) return false;
  const staged = await repository.getStagedRun(job.runId);
  const organizationData = job.plan?.selectedSections?.every((section) => typeof section === "string" && section.startsWith("organizations.members."));
  return organizationData
    ? Boolean(staged?.results?.some((result) => result?.section?.startsWith?.("organizations.members.") && ["complete", "partial"].includes(result?.outcome?.status)))
    : Boolean(staged?.results?.some((result) => result?.section === "profile" && ["complete", "partial"].includes(result?.outcome?.status)));
}

// The failed run a dashboard may open or continue. A later run, whether it finished or was cancelled, supersedes an
// older failed one, exactly as the status shown to the dashboard does.
async function latestFailedJob(state) {
  if (state.lastTerminalJobId) {
    const candidate = await repository.getJob(state.lastTerminalJobId);
    return candidate?.status === "failed" ? candidate : null;
  }
  return [...await repository.listJobs()]
    .filter((job) => job.status === "failed")
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
}

function isTrustedExtensionPage(sender) {
  if (sender.id !== chrome.runtime.id || typeof sender.url !== "string") return false;
  return sender.url.startsWith(chrome.runtime.getURL(""));
}

// The dashboard location is read from the tab Chrome reports for the sender, never from the message itself.
function senderDashboardLocation(sender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab?.url || sender.tab.incognito) return null;
  let tabUrl;
  try {
    tabUrl = new URL(sender.tab.url);
  } catch {
    return null;
  }
  const local = tabUrl.protocol === "file:";
  if (!local && tabUrl.protocol !== "https:") return null;
  const origin = local ? "file://" : tabUrl.origin;
  return Protocol.isDashboardLocation(origin, tabUrl.pathname) ? { origin, pathname: tabUrl.pathname, local } : null;
}

async function approvedLocalDashboards() {
  const stored = await chrome.storage.local.get(LOCAL_DASHBOARDS_KEY);
  const list = stored[LOCAL_DASHBOARDS_KEY];
  return Array.isArray(list) ? list.filter((entry) => Protocol.isLocalDashboardPath(entry?.path)) : [];
}

async function isApprovedLocalDashboard(pathname) {
  return (await approvedLocalDashboards()).some((entry) => entry.path === pathname);
}

// The hosted dashboard is trusted by its origin. A local copy is trusted only at a path the user approved in the popup.
async function isTrustedDashboardSender(message, sender) {
  const location = senderDashboardLocation(sender);
  if (!location || message.dashboardOrigin !== location.origin || message.dashboardPath !== location.pathname) return false;
  return !location.local || isApprovedLocalDashboard(location.pathname);
}

async function pendingLocalDashboards() {
  const stored = await chrome.storage.session.get(LOCAL_PENDING_KEY);
  const value = stored[LOCAL_PENDING_KEY];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function setActionAttention(tabId, attention) {
  try {
    await chrome.action.setBadgeText({ tabId, text: attention ? "!" : "" });
    if (attention) await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d9b86a" });
    await chrome.action.setTitle({ tabId, title: attention ? "CitizenData: allow this local dashboard" : "CitizenData" });
  } catch {
    // The tab closed; there is nothing left to mark.
  }
}

async function forgetPendingLocalDashboard(tabId) {
  const pending = await pendingLocalDashboards();
  if (!(tabId in pending)) return;
  delete pending[tabId];
  await chrome.storage.session.set({ [LOCAL_PENDING_KEY]: pending });
  await setActionAttention(tabId, false);
}

// A local copy announces itself here. An unapproved path is remembered for its tab so the popup can offer approval.
async function handleLocalDashboardHello(message, sender) {
  const location = senderDashboardLocation(sender);
  if (!location?.local || message.dashboardPath !== location.pathname) return { ok: false, code: "UNTRUSTED_DASHBOARD" };
  if (await isApprovedLocalDashboard(location.pathname)) return { ok: true, approved: true };
  const pending = await pendingLocalDashboards();
  pending[sender.tab.id] = { path: location.pathname, requestedAt: new Date().toISOString() };
  const newest = Object.entries(pending).sort((left, right) => Date.parse(right[1].requestedAt) - Date.parse(left[1].requestedAt)).slice(0, MAXIMUM_LOCAL_DASHBOARDS);
  await chrome.storage.session.set({ [LOCAL_PENDING_KEY]: Object.fromEntries(newest) });
  await setActionAttention(sender.tab.id, true);
  return { ok: true, approved: false };
}

// The remembered request counts only while that tab still shows the same local dashboard.
async function confirmedPendingLocalDashboard(tabId) {
  if (!Number.isSafeInteger(tabId)) return null;
  const pending = (await pendingLocalDashboards())[tabId];
  if (!pending) return null;
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { kind: "LOCAL_DASHBOARD_PING" });
    if (reply?.dashboardPath === pending.path) return pending;
  } catch {
    // The tab navigated away or closed.
  }
  await forgetPendingLocalDashboard(tabId);
  return null;
}

async function consumeReplayRequest(message) {
  const request = message.envelope;
  const sessionKey = `${message.dashboardOrigin}|${request.bridgeSessionId}`;
  const operation = replayQueue.then(async () => {
    const now = Date.now();
    let session = await repository.getReplaySession(sessionKey);
    if (session && Date.parse(session.expiresAt) <= now) return { ok: false, code: "BRIDGE_SESSION_EXPIRED" };
    if (!session) {
      session = {
        sessionKey,
        bridgeSessionId: request.bridgeSessionId,
        dashboardOrigin: message.dashboardOrigin,
        nonce: request.nonce,
        requestIds: [],
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + REPLAY_TTL_MS).toISOString()
      };
    }
    if (session.nonce !== request.nonce) return { ok: false, code: "NONCE_MISMATCH" };
    if (session.requestIds.includes(request.requestId)) return { ok: false, code: "REPLAYED_REQUEST" };
    if (session.requestIds.length >= MAXIMUM_REQUESTS_PER_BRIDGE_SESSION) return { ok: false, code: "BRIDGE_REQUEST_LIMIT" };
    await repository.saveReplaySession({ ...session, requestIds: [...session.requestIds, request.requestId] });
    return { ok: true };
  });
  replayQueue = operation.catch(() => {});
  return operation;
}

async function sendDashboardEvent(tabId, payload) {
  if (!Number.isSafeInteger(tabId) || Protocol.containsSecretField(payload)) return;
  try {
    await chrome.tabs.sendMessage(tabId, { kind: "DASHBOARD_EVENT", payload });
  } catch {
    // The durable job remains authoritative when the dashboard tab is absent.
  }
}

async function updateRuntimeFromJob(event) {
  const job = event.job;
  const terminal = ["cancelled", "failed", "complete"].includes(job.status);
  const authorization = await repository.getAuthorization(job.authorizationId);
  const next = await updateState((state) => ({
    ...state,
    status: job.status,
    activeJobId: terminal ? null : job.jobId,
    lastTerminalJobId: terminal ? job.jobId : state.lastTerminalJobId,
    lastCompletedRunId: job.status === "complete" ? job.runId : state.lastCompletedRunId,
    // Kept until a dashboard confirms it saved the file, so a tab that was closed when the run finished can still fetch it.
    pendingResult: job.status === "complete" && authorization
      ? { runId: job.runId, jobId: job.jobId, jobKind: jobKindOf(job), dashboardOrigin: authorization.dashboardOrigin, completedAt: job.completedAt }
      : state.pendingResult
  }));
  if (job.status !== "running") await chrome.alarms.clear(WATCHDOG_ALARM);
  if (terminal) await removeSupersededRuns(job);
  const dashboardPayload = {
    event: event.event,
    status: await publicStatus(next, authorization ? { dashboardOrigin: authorization.dashboardOrigin, bridgeSessionId: authorization.bridgeSessionId } : null),
    detail: event.detail?.receipt ? { receipt: event.detail.receipt, section: event.detail.section, done: event.detail.done } : {}
  };
  if (event.event === "complete" && event.detail?.document) dashboardPayload.result = event.detail.document;
  if (event.event === "failed" && await partialRunAvailable(job)) {
    try { dashboardPayload.partialResult = await assemblePartialDocument(job); } catch { /* Recovery remains available even when projection fails. */ }
  }
  await sendDashboardEvent(authorization?.dashboardTabId, dashboardPayload);
  if (event.event === "complete" && event.detail?.document) await keepOrganizations(job.accountId, event.detail.document, job.completedAt ?? job.updatedAt);
}

// Starts the collection loop for a running job if this worker is not already running it, and makes sure the watchdog exists.
async function ensureLoop(jobId) {
  if (!await chrome.alarms.get(WATCHDOG_ALARM)) await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MINUTES });
  void runner.run(jobId);
}

async function superviseActiveJob() {
  const state = await readState();
  const job = state.activeJobId ? await repository.getJob(state.activeJobId) : null;
  if (job?.status === "running") {
    if (!runner.isRunning(job.jobId)) void runner.run(job.jobId);
    return;
  }
  await chrome.alarms.clear(WATCHDOG_ALARM);
}

// What a run kept while it collected: its staged record and the stored pages of its collection.
async function removeWorkingCopy(job) {
  try {
    await repository.deletePages(job.collectionId ?? job.runId);
    await repository.deleteStagedRun(job.runId);
  } catch {
    // Nothing reads a finished run's working copy; "Clear all local extension data" removes whatever is left.
  }
}

// A run that failed or was cancelled can be opened or continued only while it is the newest run to have ended. Once a
// later run ends, an older incomplete run is out of reach, so everything it kept is removed.
async function removeSupersededRuns(current) {
  try {
    const currentCollection = current.collectionId ?? current.runId;
    for (const job of await repository.listJobs()) {
      if (job.jobId === current.jobId) continue;
      // A finished run's document is the saved backup; its staged record is not read again.
      if (job.status === "complete") await repository.deleteStagedRun(job.runId);
      if (!["cancelled", "failed"].includes(job.status)) continue;
      const collectionId = job.collectionId ?? job.runId;
      // A continuation shares its collection with the run it continued; those pages are the continuation's now.
      if (collectionId !== currentCollection) await repository.deletePages(collectionId);
      await repository.deleteIncompleteRun(job.runId);
    }
  } catch {
    // Housekeeping only; the run that just ended is unaffected.
  }
}

async function assembleAccountDocument({ job, authorization, staged, previous, endedAt, status }) {
  const profileResult = [...(staged.results ?? [])].reverse().find((result) => result.section === "profile");
  const checkpoints = { ...(previous?.sync?.checkpoints ?? {}) };
  for (const checkpoint of staged.checkpoints ?? []) checkpoints[checkpoint.checkpointKey] = checkpoint;
  const priorRuns = (previous?.sync?.runs ?? []).filter((run) => run.runId !== job.runId);
  const inheritedRuns = (staged.priorRuns ?? []).filter((run) => run?.runId && run.runId !== job.runId);
  const runReceipt = staged.runReceipt ?? {
    runId: job.runId,
    status,
    startedAt: job.createdAt,
    endedAt,
    selectedSections: [...job.plan.selectedSections],
    authorization: Authorization.runAuthorizationReceipt(authorization),
    organizationMemberAuthorization: job.organizationMemberAuthorization ?? null
  };
  const runs = [...priorRuns, ...inheritedRuns, runReceipt].filter((run, index, all) => all.findIndex((candidate) => candidate.runId === run.runId) === index);
  const assembled = await DocumentAssembler.assemble({
    account: {
      localAccountId: previous?.account?.localAccountId ?? job.localAccountId,
      ueeCitizenRecord: profileResult?.accountMetadata?.ueeCitizenRecord ?? previous?.account?.ueeCitizenRecord ?? null,
      handle: profileResult?.value?.handle ?? previous?.account?.handle ?? null
    },
    exportedAt: endedAt,
    generator: { name: "CitizenData", version: chrome.runtime.getManifest().version },
    previous,
    results: staged.results ?? [],
    reusedSections: staged.reusedSections ?? [],
    checkpoints,
    runs
  });
  return assembled.document;
}

async function assemblePartialDocument(job) {
  const staged = await repository.getStagedRun(job.runId);
  const authorization = await repository.getAuthorization(job.authorizationId);
  if (!staged || !authorization) throw new Error("The partial run is unavailable.");
  const previousSnapshot = await repository.getSnapshot(job.accountId);
  return assembleAccountDocument({
    job,
    authorization,
    staged,
    previous: previousSnapshot?.document ?? null,
    endedAt: job.updatedAt,
    status: job.status
  });
}

async function startAuthorizedRun(proposal, state, capability, continuation = null) {
  const decline = async (code, message) => {
    await repository.saveProposal({ ...proposal, status: "failed", failedAt: new Date().toISOString(), failure: { code } });
    await writeState({ ...state, status: "idle", pendingProposalId: null });
    return { ok: false, code, message };
  };
  if (capability !== true) return decline("COLLECTION_GATED", Adapters.reason);
  const permissionGranted = await chrome.permissions.contains({ origins: [RSI_ORIGIN] });
  if (!permissionGranted) {
    return decline("HOST_PERMISSION_REQUIRED", "CitizenData is not allowed to read robertsspaceindustries.com. Click the CitizenData icon in the Chrome toolbar, choose Allow RSI access, then build again.");
  }

  let accountId;
  try {
    accountId = await LiveRuntime.discoverSignedInAccount();
  } catch (error) {
    return decline("ACCOUNT_DISCOVERY_FAILED", error.message);
  }

  const runId = crypto.randomUUID();
  if (continuation?.job?.accountId && continuation.job.accountId.toLowerCase() !== accountId.toLowerCase()) {
    return decline("ACCOUNT_CHANGED", "The signed-in RSI account does not match the partial backup.");
  }
  const previousSnapshot = await repository.getSnapshot(accountId);
  const localAccountId = continuation?.job?.localAccountId ?? previousSnapshot?.document?.account?.localAccountId ?? crypto.randomUUID();
  const authorization = Authorization.createAuthorization(proposal, {
    authorizationId: crypto.randomUUID(),
    runId,
    accountId,
    localAccountId,
    planHash: await sha256Canonical(proposal.plan),
    extensionVersion: chrome.runtime.getManifest().version,
    permissionGranted
  });
  if (!authorization.ok) return decline(authorization.code, authorization.message ?? "CitizenData could not authorize this backup run.");
  const rosterSections = proposal.plan.selectedSections.filter((section) => section.startsWith("organizations.members."));
  const memberships = previousSnapshot?.document?.organizations?.memberships ?? [];
  const organizationMemberAuthorization = rosterSections.length === proposal.plan.selectedSections.length
    ? {
        authorizationId: crypto.randomUUID(),
        parentAuthorizationId: authorization.value.authorizationId,
        authorizedAt: authorization.value.issuedAt,
        organizations: rosterSections.map((section) => {
          const sid = section.slice("organizations.members.".length);
          const membership = memberships.find((item) => item?.sid === sid);
          return {
            sid,
            observedMemberCount: Number.isSafeInteger(membership?.memberCount) && membership.memberCount >= 0 ? membership.memberCount : null,
            maximumRecords: proposal.plan.maximumRecordsBySection[section]
          };
        }),
        extensionVersion: chrome.runtime.getManifest().version,
        parserVersion: [...new Set(rosterSections.map((section) => proposal.parserVersions[section]))].join(","),
        minimumInterActionDelayMs: proposal.plan.minimumInterRequestDelayMs,
        oneRunOnly: true
      }
    : null;
  let job = Runner.createJob({
    jobId: crypto.randomUUID(),
    runId,
    accountId: authorization.value.accountId,
    localAccountId: authorization.value.localAccountId,
    authorizationId: authorization.value.authorizationId,
    plan: proposal.plan,
    organizationMemberAuthorization,
    // A continuation keeps the collection of the run it continues, so that run's stored pages are its own.
    collectionId: continuation ? continuation.job.collectionId ?? continuation.job.runId : runId,
    mode: continuation ? "continuation" : previousSnapshot?.document ? "update" : "baseline"
  });
  if (continuation) {
    const preparation = continuation.preparation;
    const resumeSection = preparation?.resumeSection ?? proposal.plan.selectedSections[0];
    const resumeCursor = resumeSection ? continuation.job.cursorBySection?.[resumeSection] : null;
    // The unfinished section resumes from its stored pages. A job left by a build that kept the collected rows inside
    // the cursor has no stored pages, so its unfinished section is collected again from the first page.
    const preserveResumeCursor = preparation?.preserveResumeCursor !== false && !(resumeCursor && Object.hasOwn(resumeCursor, "raw"));
    job = {
      ...job,
      baselineSectionCount: preparation?.baselineSectionCount ?? continuation.job.baselineSectionCount ?? continuation.job.plan.selectedSections.length,
      completedSectionsBeforeContinuation: preparation?.completedSectionsBeforeContinuation ?? (continuation.job.completedSectionsBeforeContinuation ?? 0) + continuation.job.sectionIndex,
      continuationFromRunId: continuation.job.runId,
      cursorBySection: preserveResumeCursor && resumeCursor ? { [resumeSection]: resumeCursor } : {},
      storedStepsBySection: preserveResumeCursor && resumeSection && Number.isSafeInteger(continuation.job.storedStepsBySection?.[resumeSection]) ? { [resumeSection]: continuation.job.storedStepsBySection[resumeSection] } : {},
      recordsBySection: preserveResumeCursor && resumeSection && Number.isSafeInteger(continuation.job.recordsBySection?.[resumeSection]) ? { [resumeSection]: continuation.job.recordsBySection[resumeSection] } : {},
      requestsBySection: preserveResumeCursor && resumeSection && Number.isSafeInteger(continuation.job.requestsBySection?.[resumeSection]) ? { [resumeSection]: continuation.job.requestsBySection[resumeSection] } : {},
      httpRequestsBySection: preserveResumeCursor && resumeSection && Number.isSafeInteger(continuation.job.httpRequestsBySection?.[resumeSection]) ? { [resumeSection]: continuation.job.httpRequestsBySection[resumeSection] } : {},
      requestProgressBySection: preserveResumeCursor && resumeSection && continuation.job.requestProgressBySection?.[resumeSection] ? { [resumeSection]: continuation.job.requestProgressBySection[resumeSection] } : {},
      requestTotalsBySection: continuation.job.requestTotalsBySection ?? {},
      resolvedRequestTotalsForSections: continuation.job.resolvedRequestTotalsForSections ?? 0,
      httpRequestsTotal: Number.isSafeInteger(continuation.job.httpRequestsTotal) ? continuation.job.httpRequestsTotal : null,
      requestCount: continuation.job.requestCount ?? 0,
      httpRequestCount: continuation.job.httpRequestCount ?? 0,
      lastActivity: continuation.job.lastActivity ?? null,
      activityLog: continuation.job.activityLog ?? []
    };
  }
  await repository.saveAuthorization(authorization.value);
  await repository.saveProposal({ ...proposal, status: "authorized", authorizationId: authorization.value.authorizationId, authorizedAt: authorization.value.issuedAt });
  await repository.saveStagedRun({
    runId,
    accountId: job.accountId,
    status: "collecting",
    results: continuation?.staged?.results ?? [],
    // Sections the continued run already confirmed unchanged against RSI.
    reusedSections: continuation?.staged?.reusedSections ?? [],
    checkpoints: continuation?.staged?.checkpoints ?? [],
    priorRuns: continuation?.staged?.runReceipt ? [...(continuation.staged.priorRuns ?? []), continuation.staged.runReceipt] : continuation?.staged?.priorRuns ?? [],
    inheritedFromRunId: continuation?.job?.runId ?? null,
    createdAt: job.createdAt
  });
  await repository.saveJob(job);
  const next = await writeState({ ...state, status: "running", activeJobId: job.jobId, pendingProposalId: null });
  await ensureLoop(job.jobId);
  return {
    ok: true,
    code: "RUN_STARTED",
    jobId: job.jobId,
    runId,
    message: `Building a local account backup for ${accountId}.`,
    status: await publicStatus(next, { dashboardOrigin: proposal.dashboardOrigin, bridgeSessionId: proposal.bridgeSessionId })
  };
}

async function buildHistorySettings() {
  return BuildHistory.settingsFrom((await chrome.storage.local.get(BUILD_HISTORY_KEY))[BUILD_HISTORY_KEY]);
}

// The build being replaced is kept when the history is on and the account data changed. Keeping it must never stop
// the new build from being saved, so a failure here is recorded for the popup and the build goes on without it.
async function planBuildHistory({ accountId, previous, document, completedAt }) {
  try {
    const settings = await buildHistorySettings();
    if (!settings.enabled) return null;
    const planned = await BuildHistory.plan({ settings, accountId, previous, document, entries: await repository.listHistory(), archivedAt: completedAt });
    await chrome.storage.local.remove(BUILD_HISTORY_PROBLEM_KEY);
    return planned;
  } catch {
    await chrome.storage.local.set({ [BUILD_HISTORY_PROBLEM_KEY]: { at: completedAt, exportedAt: previous?.exportedAt ?? null } }).catch(() => {});
    return null;
  }
}

// While the history is on, the rosters an account's latest build carries are kept as one Orgs JSON, replaced when
// they change. The build is already saved when this runs, and a failure here is recorded for the popup.
async function keepOrganizations(accountId, document, at) {
  try {
    const settings = await buildHistorySettings();
    if (!settings.enabled || !document) return;
    const organizations = await OrganizationDocument.fromAccountDocument({ accountDocument: document, generatorVersion: chrome.runtime.getManifest().version });
    // A build that carries no roster has nothing to keep.
    if (!organizations) return;
    const planned = await BuildHistory.planOrganizations({ settings, accountId, organizations, entries: await repository.listHistory(), archivedAt: at });
    if (planned) await repository.saveHistoryCopy(planned);
    await chrome.storage.local.remove(ORGANIZATIONS_PROBLEM_KEY);
  } catch {
    await chrome.storage.local.set({ [ORGANIZATIONS_PROBLEM_KEY]: { at, exportedAt: document?.exportedAt ?? null } }).catch(() => {});
  }
}

// A dashboard hands over an account file its user opened there. The extension checks the file again by itself and
// keeps it as the account's latest build when it holds no build of that account, or an older one, so the next Build
// is an update and a page that loads is shown the account. A file that is not a complete build is never kept, a
// newer build is never replaced, and nothing is asked of RSI. The build that is replaced goes to the build history.
async function keepHandedOverBuild(document) {
  const refuse = (code, message) => ({ ok: false, code, message });
  if (!(await buildHistorySettings()).enabled) return refuse("BUILD_HISTORY_OFF", "Build history is off, so the extension keeps no build that a page hands over.");
  const state = await readState();
  if (state.activeJobId || state.pendingProposalId || state.pendingResult) return refuse("BUILD_IN_PROGRESS", "A build is in progress or waiting to be opened, so the extension took in no other build.");
  try {
    await AccountDocument.acceptAccountDocument(document, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
  } catch {
    return refuse("INVALID_BUILD", "The file did not pass the account schema and SHA-256 integrity checks.");
  }
  const handle = typeof document.account?.handle === "string" ? document.account.handle.trim() : "";
  const outcomes = document.sync?.sectionOutcomes ?? {};
  const complete = DocumentAssembler.REQUIRED_OUTCOMES.every((section) => outcomes[section]?.status === "complete") && document.sync?.runs?.at(-1)?.status === "complete";
  if (!handle || !complete) return refuse("INCOMPLETE_BUILD", "The file is not a complete build of one account, so the extension did not take it in.");
  const held = (await repository.listSnapshots()).find((snapshot) => typeof snapshot?.accountId === "string" && snapshot.accountId.toLowerCase() === handle.toLowerCase() && snapshot.document);
  // The build held can be this build with rosters added since, so the time of the build decides, not the hash.
  if (held?.document.exportedAt === document.exportedAt) return { ok: true, kept: false, reason: "SAME_BUILD" };
  if (held && !(held.document.exportedAt < document.exportedAt)) return { ok: true, kept: false, reason: "NEWER_BUILD_HELD" };
  const accountId = held?.accountId ?? handle;
  const keptAt = new Date().toISOString();
  const kept = held ? await withCarriedRosters(document, held.document) : document;
  const history = held ? await planBuildHistory({ accountId, previous: held.document, document: kept, completedAt: keptAt }) : null;
  await repository.saveSnapshot({ accountId, runId: document.sync.runs.at(-1).runId ?? null, promotedAt: keptAt, document: kept, history });
  await keepOrganizations(accountId, kept, keptAt);
  return { ok: true, kept: true, replaced: Boolean(held) };
}

// The extension's latest build carries every roster that was collected, and an account file saved by the dashboard
// holds none. The rosters of the build being replaced are carried into the build that replaces it, for the
// organizations it has no roster of its own for.
async function withCarriedRosters(document, previous) {
  const before = previous.sync?.organizationMemberOutcomes ?? {};
  const outcomes = { ...(document.sync?.organizationMemberOutcomes ?? {}) };
  const memberships = (document.organizations?.memberships ?? []).map((membership) => membership.sid);
  const carry = memberships.filter((sid) => !Object.hasOwn(outcomes, sid) && Object.hasOwn(before, sid));
  if (!carry.length) return document;
  const copy = structuredClone(document);
  const own = Array.isArray(copy.organizations.members) ? copy.organizations.members : [];
  const earlier = Array.isArray(previous.organizations?.members) ? previous.organizations.members : [];
  copy.organizations.members = memberships.flatMap((sid) => (carry.includes(sid) ? earlier : own).filter((member) => member?.organizationSid === sid));
  for (const sid of carry) outcomes[sid] = structuredClone(before[sid]);
  copy.sync.organizationMemberOutcomes = outcomes;
  try {
    return await AccountDocument.acceptAccountDocument(await AccountDocument.stampIntegrity(copy), globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
  } catch {
    return document;
  }
}

// A dashboard hands over an Orgs JSON its user opened there. Its rosters go into the account's saved build, where
// the extension keeps every roster: a roster is taken when the build holds none for that organization, or an older
// one, and the organization is one of the account's memberships. A roster taken this way records no reader
// version, so the next Organization Data run reads it in full. Nothing is asked of RSI.
async function keepHandedOverOrganizations(organizations) {
  const refuse = (code, message) => ({ ok: false, code, message });
  if (!(await buildHistorySettings()).enabled) return refuse("BUILD_HISTORY_OFF", "Build history is off, so the extension keeps no rosters that a page hands over.");
  const state = await readState();
  if (state.activeJobId || state.pendingProposalId || state.pendingResult) return refuse("BUILD_IN_PROGRESS", "A build is in progress or waiting to be opened, so the extension took in no rosters.");
  try {
    await OrganizationDocument.accept(organizations);
  } catch {
    return refuse("INVALID_ORGANIZATIONS", "The file did not pass the Orgs JSON structure and SHA-256 integrity checks.");
  }
  const held = (await repository.listSnapshots()).find((snapshot) => snapshot?.document && OrganizationDocument.sameAccount(snapshot.document.account, organizations.account));
  if (!held) return refuse("NO_BUILD_HELD", "The extension holds no build of this account for the rosters to belong to.");
  const document = structuredClone(held.document);
  const memberships = (document.organizations.memberships ?? []).map((membership) => membership.sid);
  const outcomes = { ...(document.sync.organizationMemberOutcomes ?? {}) };
  const taken = new Map();
  for (const entry of organizations.rosterIndex) {
    if (!["complete", "partial"].includes(entry.status) || entry.updatedAt === null || !memberships.includes(entry.organizationSid)) continue;
    const heldAt = outcomes[entry.organizationSid]?.endedAt ?? null;
    if (heldAt !== null && !(Date.parse(heldAt) < Date.parse(entry.updatedAt))) continue;
    taken.set(entry.organizationSid, organizations.members.slice(entry.memberStart, entry.memberStart + entry.memberCount));
    outcomes[entry.organizationSid] = { status: entry.status, parserVersion: null, startedAt: null, endedAt: new Date(entry.updatedAt).toISOString(), records: entry.memberCount, pagesOrBatches: 0, warnings: [] };
  }
  if (!taken.size) return { ok: true, kept: false, reason: "NOTHING_NEWER" };
  const carried = Array.isArray(document.organizations.members) ? document.organizations.members : [];
  document.organizations.members = memberships.flatMap((sid) => taken.get(sid) ?? carried.filter((member) => member?.organizationSid === sid));
  document.sync.organizationMemberOutcomes = outcomes;
  let stamped;
  try {
    stamped = await AccountDocument.acceptAccountDocument(await AccountDocument.stampIntegrity(document), globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
  } catch {
    return refuse("INVALID_ORGANIZATIONS", "The rosters in the file do not fit the account build the extension holds.");
  }
  const keptAt = new Date().toISOString();
  await repository.saveSnapshot({ accountId: held.accountId, runId: held.runId ?? null, promotedAt: held.promotedAt, document: stamped, history: null });
  await keepOrganizations(held.accountId, stamped, keptAt);
  return { ok: true, kept: true, rosters: taken.size };
}

async function buildHistoryStatus() {
  const [settings, entries, stored, images] = await Promise.all([buildHistorySettings(), repository.listHistory(), chrome.storage.local.get([BUILD_HISTORY_PROBLEM_KEY, ORGANIZATIONS_PROBLEM_KEY]), repository.listMedia()]);
  const copies = entries.sort(BuildHistory.newestFirst).map((entry) => ({
    historyId: entry.historyId,
    kind: BuildHistory.isOrganizations(entry) ? BuildHistory.ORGANIZATIONS_KIND : "build",
    accountId: entry.accountId,
    handle: entry.handle ?? null,
    exportedAt: entry.exportedAt,
    archivedAt: entry.archivedAt ?? null,
    fileName: entry.fileName,
    fileBytes: entry.fileBytes,
    storedBytes: entry.storedBytes
  }));
  return {
    ok: true,
    settings,
    limits: { minimum: BuildHistory.MINIMUM_KEEP, maximum: BuildHistory.MAXIMUM_KEEP },
    copies,
    storedBytes: copies.reduce((total, copy) => total + (Number.isSafeInteger(copy.storedBytes) ? copy.storedBytes : 0), 0),
    problem: stored[BUILD_HISTORY_PROBLEM_KEY] ?? null,
    organizationsProblem: stored[ORGANIZATIONS_PROBLEM_KEY] ?? null,
    images: MediaStore.summary(images)
  };
}

const runner = Runner.createSerialRunner({
  repository,
  registry: Adapters,
  resultSectionsForJob: JobOutcomes.outcomesForJob,
  planHistory: planBuildHistory,
  assembleDocument: async ({ job, authorization, staged, previous, completedAt }) => assembleAccountDocument({ job, authorization, staged, previous, endedAt: completedAt, status: "complete" }),
  schedule: (job) => ensureLoop(job.jobId),
  onStatus: updateRuntimeFromJob
});

async function handleDashboardRequest(message, sender) {
  if (!await isTrustedDashboardSender(message, sender)) {
    return { ok: false, code: "UNTRUSTED_DASHBOARD", message: "The dashboard sender did not match an approved CitizenData location." };
  }
  const checked = Protocol.validatePageEnvelope(message.envelope);
  if (!checked.ok) return { ok: false, code: checked.code, message: "The dashboard request failed protocol validation." };
  const replay = await consumeReplayRequest(message);
  if (!replay.ok) return { ok: false, code: replay.code, message: "The dashboard request was already used or its bridge session is no longer valid." };

  const request = checked.value;
  const state = await readState();
  if (request.type === Protocol.REQUEST_TYPES.GET_STATUS) {
    let currentState = state;
    const activeJob = state.activeJobId ? await repository.getJob(state.activeJobId) : null;
    const authorization = activeJob ? await repository.getAuthorization(activeJob.authorizationId) : null;
    const bindingMatches = authorization?.dashboardOrigin === message.dashboardOrigin && authorization?.bridgeSessionId === request.bridgeSessionId;
    if (activeJob?.status === "running" && !bindingMatches) {
      await runner.pause(activeJob.jobId);
      currentState = await readState();
    } else if (activeJob?.status === "running") {
      // The owning dashboard polls while a job runs, so a loop Chrome stopped restarts here without waiting for the watchdog.
      await ensureLoop(activeJob.jobId);
    }
    return { ok: true, status: await publicStatus(currentState, { dashboardOrigin: message.dashboardOrigin, bridgeSessionId: request.bridgeSessionId }), capabilities: capabilities() };
  }

  // Kept images. The dashboard downloads them; the extension stores what it is handed and gives it back. Reading
  // works whenever images are kept; new ones are kept only while the build history is on.
  if (request.type === Protocol.REQUEST_TYPES.GET_KEPT_IMAGES) {
    const [settings, images] = await Promise.all([buildHistorySettings(), repository.listMedia()]);
    return { ok: true, keeping: settings.enabled, limits: { filesPerRequest: MediaStore.LIMITS.filesPerRequest, requestText: MediaStore.LIMITS.requestText, identifiersPerRequest: MediaStore.LIMITS.identifiersPerRequest }, images: images.map(MediaStore.publicEntry) };
  }
  if (request.type === Protocol.REQUEST_TYPES.GET_KEPT_IMAGE_FILES) {
    const assetIds = request.payload?.assetIds;
    if (!MediaStore.isIdentifierList(assetIds, MediaStore.LIMITS.identifiersPerRequest)) return { ok: false, code: "INVALID_IMAGE_REQUEST", message: "The kept images were not asked for by their identifiers." };
    const files = [];
    let text = 0;
    // A response carries as many of the images asked for as fit; the dashboard asks again for the rest.
    for (const assetId of assetIds) {
      const [data] = await repository.getMediaData([assetId]);
      if (!data) continue;
      if (files.length && text + data.base64.length > MediaStore.LIMITS.responseText) break;
      files.push({ assetId: data.assetId, base64: data.base64 });
      text += data.base64.length;
    }
    const sent = new Set(files.map((file) => file.assetId));
    const kept = new Set((await repository.listMedia()).map((entry) => entry.assetId));
    return { ok: true, files, remaining: assetIds.filter((assetId) => kept.has(assetId) && !sent.has(assetId)) };
  }
  if (request.type === Protocol.REQUEST_TYPES.KEEP_IMAGES) {
    if (!(await buildHistorySettings()).enabled) return { ok: false, code: "IMAGES_NOT_KEPT", message: "Build history is off, so the extension keeps no new images." };
    const files = request.payload?.files;
    if (!Array.isArray(files) || files.length < 1 || files.length > MediaStore.LIMITS.filesPerRequest) return { ok: false, code: "INVALID_IMAGE_REQUEST", message: "The images to keep were not a list of the allowed length." };
    if (files.reduce((total, file) => total + (typeof file?.base64 === "string" ? file.base64.length : 0), 0) > MediaStore.LIMITS.requestText) return { ok: false, code: "IMAGE_REQUEST_TOO_LARGE", message: "The images to keep exceed the size of one request." };
    const storedAt = new Date().toISOString();
    const accepted = [];
    const refused = [];
    for (const file of files) {
      const checked = await MediaStore.checkFile(file, storedAt);
      if (checked.ok) accepted.push({ entry: checked.entry, data: checked.data });
      else refused.push({ assetId: typeof file?.assetId === "string" ? file.assetId.slice(0, 64) : null, code: checked.code });
    }
    const kept = await repository.listMedia();
    const known = new Set(kept.map((entry) => entry.assetId));
    const added = accepted.filter((item) => !known.has(item.entry.assetId)).length;
    if (kept.length + added > MediaStore.LIMITS.images) return { ok: false, code: "IMAGE_LIMIT", message: `The extension keeps at most ${MediaStore.LIMITS.images} images.` };
    if (accepted.length) await repository.saveMedia(accepted);
    return { ok: true, stored: accepted.map((item) => item.entry.assetId), refused };
  }

  // While the build history is on, a dashboard that has just loaded is given the latest finished build, so a
  // reload shows the account again in place of the example. With the history off the page is given nothing here.
  if (request.type === Protocol.REQUEST_TYPES.GET_LATEST_BUILD) {
    if (!(await buildHistorySettings()).enabled) return { ok: false, code: "BUILD_HISTORY_OFF", message: "Build history is off, so the extension hands over no build by itself." };
    const newest = (await repository.listSnapshots())
      .filter((snapshot) => snapshot?.document && typeof snapshot.document.exportedAt === "string")
      .sort((left, right) => left.document.exportedAt < right.document.exportedAt ? 1 : left.document.exportedAt > right.document.exportedAt ? -1 : 0)[0];
    if (!newest) return { ok: false, code: "NO_BUILD", message: "The extension holds no finished build." };
    return { ok: true, result: newest.document };
  }

  if (request.type === Protocol.REQUEST_TYPES.KEEP_BUILD) return keepHandedOverBuild(request.payload.document);
  if (request.type === Protocol.REQUEST_TYPES.KEEP_ORGANIZATIONS) return keepHandedOverOrganizations(request.payload.document);

  if (request.type === Protocol.REQUEST_TYPES.GET_COMPLETED_RESULT) {
    const pending = state.pendingResult;
    if (!pending || pending.dashboardOrigin !== message.dashboardOrigin) return { ok: false, code: "NO_COMPLETED_RESULT", message: "There is no completed result waiting for this dashboard." };
    // The finished document is the account's saved backup; it is kept once, not a second time beside the run.
    const job = await repository.getJob(pending.jobId);
    const saved = job ? await repository.getSnapshot(job.accountId) : null;
    if (!job || !saved?.document || saved.runId !== pending.runId) {
      await updateState((current) => current.pendingResult?.runId === pending.runId ? { ...current, pendingResult: null } : current);
      return { ok: false, code: "COMPLETED_RESULT_UNAVAILABLE", message: "The completed result is no longer stored in the extension." };
    }
    return {
      ok: true,
      runId: pending.runId,
      jobKind: pending.jobKind,
      selectedSections: [...job.plan.selectedSections],
      result: saved.document,
      status: await publicStatus(state, { dashboardOrigin: message.dashboardOrigin, bridgeSessionId: request.bridgeSessionId })
    };
  }

  if (request.type === Protocol.REQUEST_TYPES.ACKNOWLEDGE_RESULT) {
    const runId = request.payload?.runId;
    if (typeof runId !== "string" || state.pendingResult?.runId !== runId || state.pendingResult.dashboardOrigin !== message.dashboardOrigin) {
      return { ok: false, code: "NO_COMPLETED_RESULT", message: "That completed result is not waiting for this dashboard." };
    }
    const finishedJobId = state.pendingResult.jobId;
    const acknowledged = await updateState((current) => current.pendingResult?.runId === runId ? { ...current, pendingResult: null } : current);
    // The dashboard saved the file, so the run's working copy is no longer needed. The saved backup itself stays for
    // the next update.
    await removeWorkingCopy(await repository.getJob(finishedJobId) ?? { runId });
    return { ok: true, status: await publicStatus(acknowledged, { dashboardOrigin: message.dashboardOrigin, bridgeSessionId: request.bridgeSessionId }) };
  }

  if (request.type === Protocol.REQUEST_TYPES.GET_PARTIAL_RESULT) {
    const failedJob = await latestFailedJob(state);
    if (!failedJob || !await partialRunAvailable(failedJob)) return { ok: false, code: "NO_PARTIAL_RESULT", message: "There is no partial account backup to open." };
    const authorization = await repository.getAuthorization(failedJob.authorizationId);
    if (authorization?.dashboardOrigin !== message.dashboardOrigin) return { ok: false, code: "PARTIAL_ORIGIN_MISMATCH", message: "The partial backup belongs to a different dashboard origin." };
    return { ok: true, partialResult: await assemblePartialDocument(failedJob), status: await publicStatus(state, { dashboardOrigin: message.dashboardOrigin, bridgeSessionId: request.bridgeSessionId }) };
  }

  if (request.type === Protocol.REQUEST_TYPES.CONTINUE_PARTIAL) {
    if (state.activeJobId) return { ok: false, code: "JOB_ALREADY_ACTIVE", message: "Pause, cancel, or finish the current job first." };
    const failedJob = await latestFailedJob(state);
    const failedStaged = failedJob ? await repository.getStagedRun(failedJob.runId) : null;
    if (!failedJob || !failedStaged || !await partialRunAvailable(failedJob)) return { ok: false, code: "NO_PARTIAL_RESULT", message: "There is no partial account backup to continue." };
    const failedAuthorization = await repository.getAuthorization(failedJob.authorizationId);
    if (failedAuthorization?.dashboardOrigin !== message.dashboardOrigin) return { ok: false, code: "PARTIAL_ORIGIN_MISMATCH", message: "The partial backup belongs to a different dashboard origin." };
    const resultSectionsForSection = Object.fromEntries(failedJob.plan.selectedSections.map((section) => [section, JobOutcomes.outcomesForJob(section)]));
    const continuationPreparation = ContinuationRefresh.prepare({
      failedJob,
      stagedResults: failedStaged.results,
      reusedSections: failedStaged.reusedSections ?? [],
      currentParserVersions: Adapters.parserVersions ?? {},
      priorParserVersions: failedAuthorization?.parserVersions ?? {},
      resultSectionsForSection
    });
    const remainingSections = [...continuationPreparation.selectedSections];
    if (remainingSections.length === 0) return { ok: false, code: "NO_REMAINING_SECTIONS", message: "The partial backup has no unfinished collection section." };
    const validated = Plans.validatePlan({
      selectedSections: remainingSections,
      maximumRecordsBySection: Object.fromEntries(remainingSections.map((section) => [section, failedJob.plan.maximumRecordsBySection[section]])),
      minimumInterRequestDelayMs: 900
    });
    if (!validated.ok) return validated;
    const proposalId = crypto.randomUUID();
    const proposal = Authorization.createProposal({
      proposalId,
      plan: validated.value,
      dashboardOrigin: message.dashboardOrigin,
      dashboardPath: message.dashboardPath,
      dashboardTabId: sender.tab.id,
      bridgeSessionId: request.bridgeSessionId,
      parserVersions: Adapters.parserVersions ?? {}
    });
    await repository.saveProposal(proposal);
    const connectingState = await writeState({ ...state, status: "connecting", pendingProposalId: proposalId, lastProposalAt: proposal.createdAt });
    return startAuthorizedRun(proposal, connectingState, capabilities().accountCollection, { job: failedJob, staged: failedStaged, preparation: continuationPreparation });
  }

  if (request.type === Protocol.REQUEST_TYPES.REQUEST_REBIND) {
    const activeJob = state.activeJobId ? await repository.getJob(state.activeJobId) : null;
    if (!activeJob || ["cancelled", "failed", "complete"].includes(activeJob.status)) return { ok: false, code: "NO_ACTIVE_JOB", message: "There is no active run to reconnect." };
    const authorization = await repository.getAuthorization(activeJob.authorizationId);
    if (!authorization || authorization.dashboardOrigin !== message.dashboardOrigin) return { ok: false, code: "REBIND_ORIGIN_MISMATCH", message: "The active run belongs to a different dashboard origin." };
    if (authorization.bridgeSessionId === request.bridgeSessionId) return { ok: true, code: "ALREADY_BOUND", message: "This dashboard session already owns the active run.", status: await publicStatus(state, { dashboardOrigin: message.dashboardOrigin, bridgeSessionId: request.bridgeSessionId }) };
    if (activeJob.status === "running") await runner.pause(activeJob.jobId);
    const rebindId = crypto.randomUUID();
    let rebind;
    try {
      rebind = Authorization.createRebindRequest(authorization, {
        rebindId,
        jobId: activeJob.jobId,
        dashboardOrigin: message.dashboardOrigin,
        dashboardPath: message.dashboardPath,
        dashboardTabId: sender.tab.id,
        bridgeSessionId: request.bridgeSessionId
      });
    } catch (error) {
      return { ok: false, code: "REBIND_UNAVAILABLE", message: error.message };
    }
    const rebound = Authorization.rebindAuthorization(authorization, rebind);
    if (!rebound.ok) return rebound;
    await repository.saveAuthorization(rebound.value);
    await repository.saveProposal({ ...rebind, status: "authorized", authorizedAt: new Date().toISOString() });
    const resumed = await runner.resume(activeJob.jobId);
    const reboundState = await readState();
    return {
      ok: true,
      code: "RUN_RECONNECTED",
      rebindId,
      message: "The active run is connected to this dashboard again.",
      status: await publicStatus(reboundState, { dashboardOrigin: message.dashboardOrigin, bridgeSessionId: request.bridgeSessionId }),
      resumed: resumed.ok === true
    };
  }

  if (request.type === Protocol.REQUEST_TYPES.PROPOSE_BUILD) {
    const plan = Plans.validatePlan(request.payload);
    if (!plan.ok) return plan;
    if (state.activeJobId) return { ok: false, code: "JOB_ALREADY_ACTIVE", message: "Pause, cancel, or finish the current job first." };
    const proposalId = crypto.randomUUID();
    const proposal = Authorization.createProposal({
      proposalId,
      plan: plan.value,
      dashboardOrigin: message.dashboardOrigin,
      dashboardPath: message.dashboardPath,
      dashboardTabId: sender.tab.id,
      bridgeSessionId: request.bridgeSessionId,
      parserVersions: Adapters.parserVersions ?? {}
    });
    await repository.saveProposal(proposal);
    const connectingState = await writeState({
      ...state,
      status: "connecting",
      pendingProposalId: proposalId,
      lastProposalAt: proposal.createdAt
    });
    return startAuthorizedRun(proposal, connectingState, capabilities().accountCollection);
  }

  if (request.type === Protocol.REQUEST_TYPES.PROPOSE_ORGANIZATION_ROSTER) {
    const roster = RosterProposals.build(request.payload, Adapters);
    if (!roster.ok) return roster;
    if (state.activeJobId) return { ok: false, code: "JOB_ALREADY_ACTIVE", message: "Pause, cancel, or finish the current job first." };
    const proposalId = crypto.randomUUID();
    const proposal = Authorization.createProposal({
      proposalId,
      plan: roster.value.plan,
      dashboardOrigin: message.dashboardOrigin,
      dashboardPath: message.dashboardPath,
      dashboardTabId: sender.tab.id,
      bridgeSessionId: request.bridgeSessionId,
      parserVersions: roster.value.parserVersions
    });
    await repository.saveProposal(proposal);
    const connectingState = await writeState({
      ...state,
      status: "connecting",
      pendingProposalId: proposalId,
      lastProposalAt: proposal.createdAt
    });
    const started = await startAuthorizedRun(proposal, connectingState, capabilities().organizationRosterCollection);
    return { ...started, organizationSids: roster.value.organizationSids };
  }

  const activeJob = state.activeJobId ? await repository.getJob(state.activeJobId) : null;
  if (!activeJob) return { ok: false, code: "NO_ACTIVE_JOB", message: "There is no active CitizenData collection job.", status: await publicStatus(state) };
  const authorization = await repository.getAuthorization(activeJob.authorizationId);
  if (authorization?.bridgeSessionId !== request.bridgeSessionId || authorization?.dashboardOrigin !== message.dashboardOrigin) {
    return { ok: false, code: "JOB_BINDING_MISMATCH", message: "This dashboard session does not own the active run." };
  }
  let control;
  if (request.type === Protocol.REQUEST_TYPES.PAUSE) control = await runner.pause(activeJob.jobId);
  else if (request.type === Protocol.REQUEST_TYPES.RESUME) control = await runner.resume(activeJob.jobId);
  else if (request.type === Protocol.REQUEST_TYPES.CANCEL) control = await runner.cancel(activeJob.jobId);
  else if (request.type === Protocol.REQUEST_TYPES.SKIP_CCU_PRICES) control = await runner.skipSection(activeJob.jobId, "buybackUpgradePrices");
  else return { ok: false, code: "UNKNOWN_REQUEST" };
  if (control?.ok && [Protocol.REQUEST_TYPES.PAUSE, Protocol.REQUEST_TYPES.CANCEL].includes(request.type)) {
    await globalThis.CitizenDataLiveRuntime.closeCollectorTab();
  }
  return { ...control, status: await publicStatus(await readState()) };
}

async function handleUiRequest(message, sender) {
  if (!isTrustedExtensionPage(sender)) return { ok: false, code: "UNTRUSTED_EXTENSION_PAGE" };
  const state = await readState();
  if (message.type === Protocol.UI_REQUEST_TYPES.GET_STATUS) return { ok: true, status: await publicStatus(state), capabilities: capabilities() };

  if (message.type === Protocol.UI_REQUEST_TYPES.EXPORT_BACKUP) return { ok: true, backup: await repository.exportBackup() };
  if (message.type === Protocol.UI_REQUEST_TYPES.LIST_INCOMPLETE_RUNS) {
    const jobs = await repository.listJobs();
    return {
      ok: true,
      runs: jobs.filter((job) => ["cancelled", "failed"].includes(job.status)).map((job) => ({
        runId: job.runId,
        status: job.status,
        updatedAt: job.updatedAt,
        failure: job.failure
      }))
    };
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.IMPORT_BACKUP) {
    if (Protocol.containsSecretField(message.backup)) return { ok: false, code: "UNSAFE_BACKUP" };
    await repository.restoreBackup(message.backup);
    const restored = await repository.getRuntime() ?? initialState();
    await chrome.storage.local.set({ [STORAGE_KEY]: restored });
    return { ok: true, status: await publicStatus(restored) };
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.DELETE_INCOMPLETE_RUN) {
    const jobs = await repository.listJobs();
    const target = jobs.find((job) => job.runId === message.runId && ["cancelled", "failed"].includes(job.status));
    if (!target) return { ok: false, code: "RUN_NOT_DELETABLE" };
    const collectionId = target.collectionId ?? target.runId;
    // A run that is continuing this one is still using the collection's stored pages.
    if (!jobs.some((job) => job.jobId !== target.jobId && (job.collectionId ?? job.runId) === collectionId && ["running", "paused"].includes(job.status))) await repository.deletePages(collectionId);
    await repository.deleteIncompleteRun(message.runId);
    return { ok: true };
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.GET_BUILD_HISTORY) return buildHistoryStatus();
  if (message.type === Protocol.UI_REQUEST_TYPES.SET_BUILD_HISTORY) {
    const current = await buildHistorySettings();
    if (message.enabled !== undefined && typeof message.enabled !== "boolean") return { ok: false, code: "INVALID_BUILD_HISTORY_SETTING" };
    if (message.keep !== undefined && !BuildHistory.isKeep(message.keep)) return { ok: false, code: "INVALID_BUILD_HISTORY_SETTING" };
    // Kept builds are left as they are: turning the history off, or entering a smaller number, deletes nothing.
    await chrome.storage.local.set({ [BUILD_HISTORY_KEY]: { enabled: message.enabled ?? current.enabled, keep: message.keep ?? current.keep } });
    // Turning the history on keeps the rosters the latest builds already carry.
    if (message.enabled === true && !current.enabled) {
      const turnedOnAt = new Date().toISOString();
      for (const snapshot of await repository.listSnapshots()) await keepOrganizations(snapshot.accountId, snapshot.document, turnedOnAt);
    }
    return buildHistoryStatus();
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.GET_BUILD_HISTORY_COPY) {
    const entry = (await repository.listHistory()).find((candidate) => candidate.historyId === message.historyId);
    const data = entry ? await repository.getHistoryData(entry.historyId) : null;
    if (!entry || typeof data?.gzipBase64 !== "string") return { ok: false, code: "BUILD_HISTORY_COPY_NOT_FOUND" };
    return { ok: true, copy: { historyId: entry.historyId, fileName: entry.fileName, fileBytes: entry.fileBytes, encoding: "gzip", gzipBase64: data.gzipBase64 } };
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.DELETE_BUILD_HISTORY_COPY) {
    if (!(await repository.listHistory()).some((candidate) => candidate.historyId === message.historyId)) return { ok: false, code: "BUILD_HISTORY_COPY_NOT_FOUND" };
    await repository.deleteHistory([message.historyId]);
    return buildHistoryStatus();
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.CLEAR_BUILD_HISTORY) {
    await repository.clearHistory();
    await chrome.storage.local.remove([BUILD_HISTORY_PROBLEM_KEY, ORGANIZATIONS_PROBLEM_KEY]);
    return buildHistoryStatus();
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.CLEAR_KEPT_IMAGES) {
    await repository.clearMedia();
    return buildHistoryStatus();
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.CLEAR_ALL) {
    await repository.clearAll();
    await chrome.storage.local.remove([STORAGE_KEY, LOCAL_DASHBOARDS_KEY, BUILD_HISTORY_KEY, BUILD_HISTORY_PROBLEM_KEY, ORGANIZATIONS_PROBLEM_KEY]);
    await chrome.storage.session.remove(LOCAL_PENDING_KEY);
    await chrome.alarms.clear(WATCHDOG_ALARM);
    return { ok: true, status: await publicStatus(initialState()) };
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.GET_LOCAL_DASHBOARDS) {
    const pending = await confirmedPendingLocalDashboard(message.tabId);
    return { ok: true, pending: pending ? { path: pending.path } : null, approved: (await approvedLocalDashboards()).map((entry) => ({ path: entry.path, approvedAt: entry.approvedAt ?? null })) };
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.APPROVE_LOCAL_DASHBOARD) {
    // The path comes from what the tab itself reported and Chrome confirmed, never from the popup's message.
    const pending = await confirmedPendingLocalDashboard(message.tabId);
    if (!pending) return { ok: false, code: "NO_PENDING_LOCAL_DASHBOARD" };
    const approved = [{ path: pending.path, approvedAt: new Date().toISOString() }, ...(await approvedLocalDashboards()).filter((entry) => entry.path !== pending.path)].slice(0, MAXIMUM_LOCAL_DASHBOARDS);
    await chrome.storage.local.set({ [LOCAL_DASHBOARDS_KEY]: approved });
    await forgetPendingLocalDashboard(message.tabId);
    try {
      await chrome.tabs.sendMessage(message.tabId, { kind: "LOCAL_DASHBOARD_APPROVED" });
    } catch {
      // The approval is stored; the dashboard connects the next time it loads.
    }
    return { ok: true, path: pending.path };
  }
  if (message.type === Protocol.UI_REQUEST_TYPES.REVOKE_LOCAL_DASHBOARD) {
    const approved = await approvedLocalDashboards();
    if (!approved.some((entry) => entry.path === message.path)) return { ok: false, code: "LOCAL_DASHBOARD_NOT_APPROVED" };
    await chrome.storage.local.set({ [LOCAL_DASHBOARDS_KEY]: approved.filter((entry) => entry.path !== message.path) });
    return { ok: true };
  }
  return { ok: false, code: "UNKNOWN_UI_REQUEST" };
}

chrome.runtime.onInstalled.addListener(() => {
  void readState().then(writeState);
  // Releases before the loop design scheduled one alarm per step; none are needed now.
  void chrome.alarms.getAll().then((alarms) => Promise.all(alarms.filter((alarm) => alarm.name.startsWith(LEGACY_STEP_ALARM_PREFIX)).map((alarm) => chrome.alarms.clear(alarm.name))));
});

chrome.runtime.onStartup.addListener(() => {
  void repository.listJobs().then(async (jobs) => {
    for (const job of jobs.filter((value) => value.status === "running")) await repository.saveJob({ ...job, status: "paused", updatedAt: new Date().toISOString() });
    const state = await readState();
    if (state.activeJobId) await writeState({ ...state, status: "paused" });
    await chrome.alarms.clear(WATCHDOG_ALARM);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) void superviseActiveJob();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation;
  if (message?.kind === "DASHBOARD_REQUEST") operation = handleDashboardRequest(message, sender);
  else if (message?.kind === "LOCAL_DASHBOARD_HELLO") operation = handleLocalDashboardHello(message, sender);
  else if (message?.kind === "EXTENSION_UI_REQUEST") operation = handleUiRequest(message, sender);
  else return false;

  operation.then(sendResponse, () => sendResponse({
    ok: false,
    code: "INTERNAL_ERROR",
    message: "CitizenData could not complete the internal request."
  }));
  return true;
});

void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
