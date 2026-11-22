(function exposeDashboardModel(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataDashboardModel = api;
})(typeof globalThis === "object" ? globalThis : this, (root) => {
  "use strict";

  const COLLECTION_SECTIONS = Object.freeze({
    profile: Object.freeze({ operation: "Reading your RSI dossier", label: "Account identity", summary: "Verifying the signed in RSI dossier and account identity." }),
    "financial.balances": Object.freeze({ operation: "Reading account balances", label: "Account balances", summary: "Reading Store Credit, UEC, and REC balances from Billing." }),
    "financial.billingTotal": Object.freeze({ operation: "Reading billing totals", label: "Billing total", summary: "Reading the account's total billed amount." }),
    "financial.ledgers": Object.freeze({ operation: "Reading financial ledgers", label: "Financial ledgers", summary: "Reading Store Credit, UEC, and REC ledger histories." }),
    "financial.orders": Object.freeze({ operation: "Reading billing orders", label: "Billing orders", summary: "Reading billing order history, including physical merchandise records." }),
    "financial.subscriptions": Object.freeze({ operation: "Reading subscription history", label: "Subscriptions", summary: "Reading subscription status and subscription billing history." }),
    hangarLog: Object.freeze({ operation: "Reading Hangar Log history", label: "Hangar Log", summary: "Reading pledge creation, upgrade, gift, reclaim, and reward history." }),
    pledges: Object.freeze({ operation: "Reading your current Hangar", label: "Current Hangar", summary: "Reading current Hangar pledges and their contained items." }),
    buybacks: Object.freeze({ operation: "Reading Buy Back Pledges", label: "Buybacks", summary: "Reading Buy Back Pledges and their contained items." }),
    buybackDetails: Object.freeze({ operation: "Reading buyback prices", label: "Buyback prices", summary: "Reading one buyback page for each item, for its price and contents." }),
    buybackUpgradePrices: Object.freeze({ operation: "Reading CCU buyback prices", label: "CCU buyback prices", summary: "Reading the price RSI asks now for each different CCU buyback." }),
    "referrals.legacy.recruits": Object.freeze({ operation: "Reading legacy referral recruits", label: "Legacy recruits", summary: "Reading recruits from the legacy referral ladder." }),
    "referrals.current.prospects": Object.freeze({ operation: "Reading current referral prospects", label: "Current prospects", summary: "Reading prospects from the current referral ladder." }),
    "referrals.current.recruits": Object.freeze({ operation: "Reading current referral recruits", label: "Current recruits", summary: "Reading recruits from the current referral ladder." }),
    "organizations.memberships": Object.freeze({ operation: "Reading organization memberships", label: "Organizations", summary: "Reading public organization memberships from the RSI dossier." })
  });

  function collectionSectionPresentation(section) {
    if (typeof section === "string" && section.startsWith("organizations.members.")) {
      const sid = section.slice("organizations.members.".length);
      return Object.freeze({ operation: `Reading the ${sid || "selected"} member roster`, label: `${sid || "Selected"} member roster`, summary: "Reading the separately authorized member roster for the selected organization." });
    }
    return COLLECTION_SECTIONS[section] ?? Object.freeze({ operation: "Building your account backup", label: "Account backup", summary: "Collecting the next authorized account data section." });
  }

  // The texts of PARSER_HARDENING.md §11.3, word for word (D17).
  const TEXTS = Object.freeze({
    limited: "Potential website issue or rate limiting. Slowing down.",
    slow: "RSI is answering slowly. Slowing down.",
    probeRefused: "Refused even without your login. Your connection or RSI's public pages may be limited.",
    probeAnswered: "Works without your login. Your account, session or RSI's account pages may be limited.",
    statusIssue: "RSI reports a problem.",
    statusNotChecked: "RSI status page not checked.",
    statusUnreadable: "RSI status page could not be read.",
    probeFailed: "Couldn't reach RSI. Your connection or RSI may be down.",
    signedOut: "Signed out of RSI. Your data is kept. Sign in, then continue.",
    accountChanged: "Another RSI account is signed in. Your data is kept. Switch back, then continue.",
    browserCheck: "RSI wants a browser check. Your data is kept. Complete it on the RSI site, then continue.",
    lifetime: "Time limit reached. Your data is kept. Continue when ready.",
    imagesLeft: "Images kept failing. Download again later for the rest.",
    startRefused: "RSI refused or didn't answer the account check.",
    statusOk: "RSI status page: no problems.",
    schemaChanged: "RSI changed a schema. Please report it on GitHub.",
    partialOperation: "Account backup saved with skipped sections",
    buildAgain: "Ready to build again"
  });
  const PROBE_TEXTS = Object.freeze({ refused: TEXTS.probeRefused, answered: TEXTS.probeAnswered, failed: TEXTS.probeFailed, "not-run": TEXTS.startRefused });

  function isPrintable(value, maximum) {
    return typeof value === "string" && value.length > 0 && value.length <= maximum && [...value].every((character) => character.codePointAt(0) >= 32 && character.codePointAt(0) !== 127);
  }

  // Sentences joined by one space; an empty one leaves no doubled space.
  function sentences(...parts) {
    return parts.filter((part) => typeof part === "string" && part.length > 0).join(" ");
  }

  // {components}: each safe entry as "name (state)", joined by ", ".
  function componentsText(components) {
    return (Array.isArray(components) ? components : []).filter((entry) => isPrintable(entry?.name, 60) && isPrintable(entry?.state, 20)).slice(0, 10).map((entry) => `${entry.name} (${entry.state})`).join(", ");
  }

  // W-5.
  function statusIssueText(components) {
    const list = componentsText(components);
    return list ? `RSI reports a problem: ${list}.` : TEXTS.statusIssue;
  }

  // The status part of a diagnosis: W-23, W-5 or one of the two W-6 variants.
  function statusText(result) {
    if (result?.status === "ok") return TEXTS.statusOk;
    if (result?.status === "issue") return statusIssueText(result.components);
    if (result?.status === "unknown") return result.reason === "no-permission" ? TEXTS.statusNotChecked : TEXTS.statusUnreadable;
    return "";
  }

  // {diagnosis} (§9.4): the text for the probe, then the text for the status; empty without a diagnosis.
  function diagnosisText(diagnosis) {
    if (!diagnosis || typeof diagnosis !== "object") return "";
    return sentences(PROBE_TEXTS[diagnosis.probe] ?? "", statusText(diagnosis));
  }

  // {time}: the time left as m:ss. A countdown is the sentence before its time, the rest after it, and the sentence
  // that replaces it once the time has passed.
  function countdownTime(untilMs, nowMs) {
    const seconds = Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function countdown(until, lead, tail, after) {
    return Number.isFinite(Date.parse(until)) ? Object.freeze({ until, lead, tail, after }) : null;
  }
  function countdownRunning(value, nowMs = Date.now()) {
    return Boolean(value) && Date.parse(value.until) > nowMs;
  }
  function countdownText(value, nowMs = Date.now()) {
    if (!value) return "";
    return countdownRunning(value, nowMs) ? `${value.lead}${countdownTime(Date.parse(value.until), nowMs)}${value.tail}` : value.after;
  }

  // W-8, W-9, W-20, W-25 and W-31, each with its countdown.
  function waitingCountdown(until) {
    return countdown(until, "RSI refused. Retrying in ", ".", "RSI refused. Retrying now.");
  }
  function continueCountdown(until, diagnosis) {
    const lead = sentences("RSI kept refusing, so the run stopped. Your data is kept.", diagnosisText(diagnosis));
    return countdown(until, `${lead} Continue in `, ".", `${lead} Continue when ready.`);
  }
  function refusedDialogCountdown(until, diagnosis) {
    const lead = diagnosisText(diagnosis);
    return countdown(until, sentences(lead, "Try again in "), ".", sentences(lead, "Try again now."));
  }
  function coolingDownCountdown(until) {
    return countdown(until, "Try again in ", ".", "Try again now.");
  }
  function buildAgainCountdown(until, refusedStart) {
    const lead = refusedStart ? "RSI refused the start." : "The last run stopped before anything was saved.";
    return countdown(until, `${lead} Build again in `, ".", `${lead} Build when ready.`);
  }

  // The repository's issues, the address the dashboard already links (#supportIssues).
  const ISSUES_ADDRESS = "https://github.com/LevyBytes/citizendata.download/issues";

  // The notices that RSI changed a page (§11.4), one per detected change, each with a stable key. An entry whose code
  // is not a code or whose section the catalog does not know is not shown. The links carry the section id, the code
  // and the HTTP status, and nothing else.
  function changeNotices(entries) {
    const notices = [];
    for (const entry of (Array.isArray(entries) ? entries : []).slice(-4)) {
      const code = typeof entry?.code === "string" && /^[A-Z0-9_]{1,80}$/u.test(entry.code) ? entry.code : null;
      const sectionId = typeof entry?.section === "string" && Object.hasOwn(COLLECTION_SECTIONS, entry.section) ? entry.section : null;
      if (!code || !sectionId) continue;
      const setAside = entry.setAside === true;
      const dependents = (Array.isArray(entry.dependents) ? entry.dependents : []).filter((section) => typeof section === "string" && Object.hasOwn(COLLECTION_SECTIONS, section)).map((section) => COLLECTION_SECTIONS[section].label);
      const sentences = ["This version can't read it.", setAside ? "Skipped; the build continues." : "The build stopped here."];
      if (dependents.length > 0) sentences.push(`Also skipped: ${dependents.join(", ")}.`);
      const httpStatus = Number.isSafeInteger(entry.httpStatus) && entry.httpStatus >= 100 && entry.httpStatus <= 599 ? entry.httpStatus : null;
      const body = [`Section: ${sectionId}`, `Code: ${code}`, `HTTP status: ${httpStatus ?? "none"}`, "Add anything else you noticed. Do not paste account data."].join("\n");
      const at = typeof entry.at === "string" && !Number.isNaN(Date.parse(entry.at)) ? entry.at : "";
      notices.push(Object.freeze({
        key: `${sectionId}|${code}|${setAside ? "set-aside" : "stopped"}|${httpStatus ?? "none"}|${at}`,
        title: `RSI CHANGED A PAGE: ${COLLECTION_SECTIONS[sectionId].label}`,
        prose: sentences.join(" "),
        technical: `Code: ${code}`,
        request: "Please confirm an existing GitHub issue, or report a new one.",
        searchLink: `${ISSUES_ADDRESS}?q=${encodeURIComponent(`is:issue ${code}`)}`,
        newIssueLink: `${ISSUES_ADDRESS}/new?title=${encodeURIComponent(`RSI page changed: ${sectionId} (${code})`)}&body=${encodeURIComponent(body)}`
      }));
    }
    return notices;
  }

  // W-26: the labels of the sections set aside, or the fallback.
  function setAsideText(sections, firstBuild) {
    const labels = (Array.isArray(sections) ? sections : []).map((section) => COLLECTION_SECTIONS[section]?.label ?? null).filter(Boolean);
    const list = labels.length ? labels.join(", ") : "one or more account sections";
    return firstBuild ? `Partial backup. Not read: ${list}.` : `Partial backup. Not read: ${list}. Your last complete backup stays in use.`;
  }

  // The warning text of an account, roster or image run: W-5, W-1 or W-2 (§11.1, rows 1 to 4).
  function warningText(warning, statusPage) {
    if ((warning === "limited" || warning === "slow") && statusPage?.status === "issue") return statusIssueText(statusPage.components);
    if (warning === "limited") return TEXTS.limited;
    if (warning === "slow") return TEXTS.slow;
    return "";
  }

  // The caution tape (§11.1): the first row that applies gives its text; with none there is no tape. mediaState is the
  // image run's { active, warning, statusPage, stoppedWithRemaining }, wired to the image run in WP11.
  function cautionPresentation(status, mediaState = null, nowMs = Date.now()) {
    const shown = (value) => Object.freeze({ active: value.length > 0, text: value });
    const job = status?.activeJob && typeof status.activeJob === "object" ? status.activeJob : null;
    if (job?.status === "running") {
      const value = warningText(job.pace?.warning, job.pace?.statusPage);
      if (value) return shown(value);
    }
    if (mediaState?.active === true && mediaState.warning) {
      const value = warningText(mediaState.warning, mediaState.statusPage);
      if (value) return shown(value);
    }
    const runningOrPaused = job?.status === "running" || job?.status === "paused";
    const coolingDown = Date.parse(status?.retryNotBefore) > nowMs;
    if (!runningOrPaused && mediaState?.active !== true && coolingDown && status?.startDiagnosis) {
      const value = diagnosisText(status.startDiagnosis);
      if (value) return shown(value);
    }
    if (!runningOrPaused && coolingDown && job?.status === "failed" && job.failure?.code === "RSI_RATE_LIMITED") return shown(TEXTS.limited);
    if (mediaState?.stoppedWithRemaining === true) return shown(TEXTS.imagesLeft);
    return shown("");
  }

  // An accepted status (§11.2, row 7): an object, a safe revision when there is one, and an active job, when there is
  // one, with a known state, a pace of a known warning and a list for its log.
  const JOB_STATES = Object.freeze(["pending", "running", "paused", "complete", "partial", "failed", "cancelled"]);
  function validateStatus(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (raw.statusRevision !== undefined && !(Number.isSafeInteger(raw.statusRevision) && raw.statusRevision >= 0)) return null;
    const job = raw.activeJob;
    if (job === null || job === undefined) return raw;
    if (typeof job !== "object" || Array.isArray(job) || !JOB_STATES.includes(job.status)) return null;
    if (job.pace !== undefined && job.pace !== null && (typeof job.pace !== "object" || ![undefined, null, "limited", "slow"].includes(job.pace.warning))) return null;
    if (job.activityLog !== undefined && !Array.isArray(job.activityLog)) return null;
    if (job.failure !== undefined && job.failure !== null && typeof job.failure !== "object") return null;
    return raw;
  }

  const RSI_CODE = /^[A-Za-z0-9_-]{1,64}$/u;
  const NOT_PLAIN = /[^\p{L}\p{N} .,;:!?'()[\]_/-]/gu;

  // A stop's technical detail (criterion 7): its code and message, then the HTTP status, RSI's code and RSI's message
  // the extension bounded, each checked again here; the panel shows the result only as text.
  function stopTechnicalDetail(failure) {
    const code = typeof failure?.code === "string" ? failure.code.slice(0, 80) : "RUN_FAILED";
    const message = typeof failure?.message === "string" ? failure.message.slice(0, 500) : "The account backup stopped.";
    const signal = failure?.detail?.signal;
    const httpStatus = Number.isSafeInteger(signal?.httpStatus) && signal.httpStatus >= 100 && signal.httpStatus <= 599 ? signal.httpStatus : null;
    const rsiCode = typeof signal?.rsiCode === "string" && RSI_CODE.test(signal.rsiCode) ? signal.rsiCode : null;
    const rsiMessage = typeof signal?.rsiMessage === "string" ? [...signal.rsiMessage.replace(NOT_PLAIN, " ").replace(/\s+/gu, " ").trim()].slice(0, 160).join("") : "";
    const parts = [code === message ? code : `${code}: ${message}`];
    if (httpStatus !== null) parts.push(`HTTP status ${httpStatus}`);
    if (rsiCode) parts.push(`RSI code ${rsiCode}`);
    if (rsiMessage) parts.push(`RSI message: ${rsiMessage}`);
    return parts.join(" | ");
  }

  function continuableFailurePresentation(activeJob, section) {
    const code = typeof activeJob?.failure?.code === "string" ? activeJob.failure.code.slice(0, 80) : "RUN_FAILED";
    const message = typeof activeJob?.failure?.message === "string" ? activeJob.failure.message.slice(0, 500) : "The account backup stopped.";
    const technicalMessage = stopTechnicalDetail(activeJob?.failure);
    const diagnostic = `${code} ${message}`;
    const pageMismatch = /RSI_BUYBACKS_PAGE_MISMATCH_REQUESTED_([0-9]+)_OBSERVED_([0-9]+)/u.exec(diagnostic);
    if (pageMismatch) {
      return Object.freeze({
        summary: `Completed data and the Buybacks page ${pageMismatch[1]} cursor are preserved. Continue when ready.`,
        historyMessage: `The previous attempt requested Buybacks page ${pageMismatch[1]}, but RSI returned page ${pageMismatch[2]}.`,
        technicalMessage
      });
    }
    return Object.freeze({
      summary: `Completed data and the saved ${section.label} cursor are preserved. Continue when ready.`,
      historyMessage: `The previous attempt stopped in ${section.label}. No completed data was discarded.`,
      technicalMessage
    });
  }

  const SESSION_STOPS = Object.freeze({ RSI_SIGNED_OUT: TEXTS.signedOut, RSI_ACCOUNT_CHANGED: TEXTS.accountChanged, ACCOUNT_CHANGED: TEXTS.accountChanged, RSI_CHECK_IN_BROWSER: TEXTS.browserCheck, RUN_LIFETIME_REACHED: TEXTS.lifetime });
  const NO_CONTROLS = Object.freeze({ pause: false, resume: false, resumeLabel: "Resume", cancel: false, rebind: false, skip: false });
  const isContractStop = (failure) => failure?.detail?.signal?.kind === "contract" || /_CONTRACT_CHANGED$/u.test(failure?.code ?? "");

  // Build Status (§11.2): the first row that matches gives one whole presentation. context holds what the dashboard
  // knows itself: { bridgeConnected, connecting, protocolMismatch, extensionVersion, media, jobKind, nowMs }. Account,
  // roster and image presentations are built apart, so no wording, progress or control crosses from one to another.
  function buildPresentation(status, context = {}) {
    const nowMs = Number.isFinite(context.nowMs) ? context.nowMs : Date.now();
    const job = status?.activeJob && typeof status.activeJob === "object" ? status.activeJob : null;
    const roster = context.jobKind === "organizationData" || job?.jobKind === "organizationData" || job?.currentSection?.startsWith?.("organizations.members.") === true;
    const jobKind = roster ? "roster" : "account";
    const section = collectionSectionPresentation(job?.currentSection);
    const make = (row, fields) => Object.freeze({
      row, jobKind, tone: "quiet", active: false, terminal: false, countdown: null, historyMessage: null, technicalMessage: null,
      controls: NO_CONTROLS, unavailableUntil: null, ...fields, key: `${row}|${fields.jobKind ?? jobKind}|${fields.badge}|${fields.operation}`
    });
    const media = context.media && typeof context.media === "object" ? context.media : null;

    if (context.protocolMismatch === true) {
      const version = typeof context.extensionVersion === "string" ? context.extensionVersion.slice(0, 32) : "unknown";
      return make(1, { jobKind: null, badge: "UPDATE REQUIRED", operation: "Extension and dashboard do not match", summary: `CitizenData extension ${version} uses a different connection version than this page. Update the extension, then reload this page.`, tone: "warning" });
    }
    if (media?.phase === "running") return make(2, { jobKind: "media", badge: "DOWNLOADING", operation: media.operation ?? "Downloading offline images", summary: media.detail ?? "", tone: "active", active: true });
    if (media?.phase === "ready") return make(3, { jobKind: "media", badge: "READY TO SAVE", operation: media.operation ?? "Offline image ZIP ready", summary: media.detail ?? "", tone: "warning" });
    if (media && ["completed", "cancelled", "failed", "idle"].includes(media.phase)) {
      return make(4, { jobKind: "media", badge: media.badge ?? "COMPLETED", operation: media.operation ?? "Offline images", summary: sentences(media.detail ?? "", media.stoppedWithRemaining === true ? TEXTS.imagesLeft : ""), tone: media.tone ?? "quiet", terminal: media.phase !== "idle" });
    }
    if (context.connecting === true) return make(5, { badge: "CONNECTING", operation: roster ? "Preparing Organization Data" : "Verifying your signed in RSI account", summary: roster ? "CitizenData is preparing the selected organization roster job." : "CitizenData is establishing the read only backup run.", tone: "warning", active: true });
    if (context.bridgeConnected !== true) return make(6, { jobKind: null, badge: "DISCONNECTED", operation: "Extension connection unavailable", summary: "The dashboard cannot currently communicate with CitizenData." });
    if (status?.requiresRebind === true) return make(8, { badge: "RECONNECT REQUIRED", operation: section.operation, summary: "The durable run is paused until this dashboard session is explicitly reconnected.", tone: "warning", active: true, controls: { ...NO_CONTROLS, rebind: true } });

    const jobStatus = job?.status ?? null;
    const running = { ...NO_CONTROLS, pause: true, cancel: true, skip: job?.currentSection === "buybackUpgradePrices" };
    if (jobStatus === "running") {
      const waitingUntil = job.pace?.waitingUntil;
      if (Date.parse(waitingUntil) > nowMs) return make(9, { badge: "COLLECTING", operation: section.operation, summary: countdownText(waitingCountdown(waitingUntil), nowMs), countdown: waitingCountdown(waitingUntil), tone: "active", active: true, controls: running });
      if (job.pace?.warning === "limited" || job.pace?.warning === "slow") return make(10, { badge: "COLLECTING", operation: section.operation, summary: section.summary, tone: "active", active: true, controls: running });
      return make(11, { badge: "COLLECTING", operation: section.operation, summary: section.summary, tone: "active", active: true, controls: running });
    }
    if (jobStatus === "paused") return make(12, { badge: "PAUSED", operation: section.operation, summary: "The durable run is preserved and is not issuing RSI requests.", tone: "warning", controls: { ...NO_CONTROLS, resume: true, cancel: true } });

    const coolingUntil = Date.parse(status?.retryNotBefore) > nowMs ? status.retryNotBefore : null;
    if (status?.hasActiveJob !== true && status?.startDiagnosis && coolingUntil) {
      const refused = buildAgainCountdown(coolingUntil, true);
      return make(13, { badge: "CONNECTED", operation: TEXTS.buildAgain, summary: countdownText(refused, nowMs), countdown: refused, tone: "warning", unavailableUntil: coolingUntil });
    }
    if (jobStatus === "partial") {
      return make(14, { badge: "COMPLETED WITH OMISSIONS", operation: TEXTS.partialOperation, summary: setAsideText(job.setAsideSections, job.mode === "baseline"), tone: "warning", terminal: true });
    }
    if (jobStatus === "complete") return make(15, { badge: "COMPLETED", operation: roster ? "Organization Data complete" : "Account backup complete", summary: roster ? "The selected rosters are ready in one Organization JSON." : "The canonical account document passed validation and is open in this dashboard.", tone: "success", terminal: true });

    const failure = job?.failure ?? null;
    const continueLabel = roster ? "Continue Organization Data" : "Continue backup";
    const continueOperation = roster ? `Continue Organization Data from ${section.label}` : `Continue backup from ${section.label}`;
    if (jobStatus === "failed" && status?.continuable === true) {
      const details = continuableFailurePresentation(job, section);
      const controls = { ...NO_CONTROLS, resume: true, resumeLabel: continueLabel };
      const base = { badge: "READY TO CONTINUE", operation: continueOperation, historyMessage: details.historyMessage, technicalMessage: details.technicalMessage, tone: "warning", terminal: true, controls };
      if (failure?.code === "RSI_RATE_LIMITED") {
        const until = Number.isFinite(Date.parse(status?.retryNotBefore)) ? status.retryNotBefore : null;
        const waiting = continueCountdown(until ?? new Date(nowMs).toISOString(), failure.detail?.diagnosis);
        return make(16, { ...base, summary: countdownText(waiting, nowMs), countdown: waiting, unavailableUntil: coolingUntil });
      }
      if (Object.hasOwn(SESSION_STOPS, failure?.code)) return make(17, { ...base, summary: SESSION_STOPS[failure.code] });
      if (isContractStop(failure)) return make(18, { ...base, summary: TEXTS.schemaChanged });
      return make(19, { ...base, summary: details.summary });
    }
    if (jobStatus === "failed" && (failure?.code === "RSI_RATE_LIMITED" || failure?.code === "RUN_LIFETIME_REACHED")) {
      const stopped = buildAgainCountdown(coolingUntil ?? new Date(nowMs).toISOString(), false);
      return make(20, { badge: "CONNECTED", operation: TEXTS.buildAgain, summary: countdownText(stopped, nowMs), countdown: stopped, tone: "warning", unavailableUntil: coolingUntil });
    }
    if (jobStatus === "failed" && isContractStop(failure)) return make(21, { badge: "FAILED", operation: roster ? "Organization Data stopped" : `Backup stopped in ${section.label}`, summary: TEXTS.schemaChanged, tone: "failure", terminal: true });
    if (jobStatus === "failed") {
      const message = typeof failure?.message === "string" ? failure.message.slice(0, 500) : "The run stopped with an explicit recoverable failure.";
      return make(22, { badge: "FAILED", operation: roster ? "Organization Data stopped" : `Backup stopped in ${section.label}`, summary: message, tone: "failure", terminal: true });
    }
    if (jobStatus === "cancelled") return make(22, { badge: "CANCELLED", operation: roster ? "Organization Data cancelled" : "Account backup cancelled", summary: roster ? "The Organization Data job was cancelled." : "The account collection was cancelled.", terminal: true });
    return make(23, { jobKind: null, badge: "CONNECTED", operation: "Ready to build your backup", summary: "CitizenData is connected and no account collection is active.", tone: "active" });
  }

  // The earlier name, for the callers that ask for the account and roster presentation.
  function collectionStatusPresentation(publicStatus, options = {}) {
    return buildPresentation(publicStatus, options);
  }

  function collectionProgress(activeJob) {
    const sectionCount = Number.isSafeInteger(activeJob?.sectionCount) && activeJob.sectionCount > 0 ? activeJob.sectionCount : 0;
    const completedSections = Math.min(sectionCount, Math.max(0, Number.isSafeInteger(activeJob?.completedSections) ? activeJob.completedSections : 0));
    const currentPosition = sectionCount ? Math.min(sectionCount, completedSections + (completedSections < sectionCount ? 1 : 0)) : 0;
    const overallPercent = sectionCount ? completedSections / sectionCount * 100 : 0;
    const currentSection = activeJob?.currentSection;
    const section = collectionSectionPresentation(currentSection);
    const rawRequestProgress = activeJob?.requestProgressBySection?.[currentSection];
    const totalKnown = rawRequestProgress?.totalKnown === true && Number.isSafeInteger(rawRequestProgress.total) && rawRequestProgress.total > 0;
    const requestTotal = totalKnown ? rawRequestProgress.total : null;
    const requestCompleted = totalKnown ? Math.min(requestTotal, Math.max(0, Number.isSafeInteger(rawRequestProgress.completed) ? rawRequestProgress.completed : 0)) : 0;
    const subphaseLabels = { storeCredit: "Store Credit", uec: "UEC", rec: "REC" };
    const requestLabel = subphaseLabels[rawRequestProgress?.subphase] ?? (typeof currentSection === "string" && currentSection.startsWith("organizations.members.") ? "Roster pages" : section.label);
    const httpRequestCount = Number.isSafeInteger(activeJob?.httpRequestCount) && activeJob.httpRequestCount >= 0 ? activeJob.httpRequestCount : 0;
    const resolvedRequestTotalsForSections = Math.min(sectionCount, Math.max(0, Number.isSafeInteger(activeJob?.resolvedRequestTotalsForSections) ? activeJob.resolvedRequestTotalsForSections : 0));
    const httpRequestsTotal = Number.isSafeInteger(activeJob?.httpRequestsTotal) && activeJob.httpRequestsTotal >= httpRequestCount ? activeJob.httpRequestsTotal : null;
    const discovering = activeJob?.status === "running" && typeof currentSection === "string" && !totalKnown;
    return Object.freeze({
      sectionCount,
      completedSections,
      currentPosition,
      overallPercent,
      overallText: sectionCount ? `${completedSections} of ${sectionCount} sections completed` : "Preparing section progress",
      httpRequestCount,
      httpRequestsTotal,
      resolvedRequestTotalsForSections,
      httpText: httpRequestsTotal === null
        ? `${httpRequestCount} RSI request${httpRequestCount === 1 ? "" : "s"} completed`
        : `${httpRequestCount} of ${httpRequestsTotal} RSI request${httpRequestsTotal === 1 ? "" : "s"} completed`,
      requestProgress: totalKnown
        ? Object.freeze({ label: requestLabel, completed: requestCompleted, total: requestTotal, percent: requestCompleted / requestTotal * 100, text: `${requestCompleted} of ${requestTotal} RSI request${requestTotal === 1 ? "" : "s"}`, indeterminate: false })
        : discovering ? Object.freeze({ label: requestLabel, completed: 0, total: null, percent: null, text: "Discovering request total...", indeterminate: true }) : null
    });
  }

  // The probe's result in W-19's words, each only where the evidence shows it: "answered", a recognised dossier; "refused",
  // an HTTP answer in the limit or transient class; "no answer", nothing came back (a network failure or a time-out,
  // which carry no HTTP status, or no request sent). Any other answer is shown as its HTTP status, such as "HTTP 404".
  function smartCheckProbeWord(outcome, httpStatus) {
    const answeredWith = Number.isSafeInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
    if (outcome === "answered") return "answered";
    if (outcome === "refused") return answeredWith === null ? "no answer" : "refused";
    if (outcome === "failed") return answeredWith === null ? "no answer" : `HTTP ${answeredWith}`;
    return null;
  }

  function safeActivityPresentation(activity) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) return null;
    const section = collectionSectionPresentation(activity.section);
    const at = typeof activity.at === "string" && !Number.isNaN(Date.parse(activity.at)) ? activity.at : null;
    if (activity.kind === "section-started") return Object.freeze({ at, tone: "normal", message: `Starting ${section.label}.` });
    const code = typeof activity.code === "string" && /^[A-Z0-9_]{1,80}$/u.test(activity.code) ? activity.code
      : typeof activity.signal?.code === "string" && /^[A-Z0-9_]{1,80}$/u.test(activity.signal.code) ? activity.signal.code : "RSI_REFUSED";
    // W-17: RSI refused, and the run waits.
    if (activity.kind === "rate-limited") {
      const seconds = Number.isSafeInteger(activity.waitMs) && activity.waitMs >= 0 ? Math.round(activity.waitMs / 1000) : 0;
      return Object.freeze({ at, tone: "warning", message: `RSI refused ${section.label} · ${code} · retry in ${seconds} s.` });
    }
    // W-18: a section set aside, and the build goes on (§10.2).
    if (activity.kind === "section-set-aside") return Object.freeze({ at, tone: "warning", message: `Skipped ${section.label} · ${code}. The build continues.` });
    // W-24: one retry before braking.
    if (activity.kind === "free-retry") return Object.freeze({ at, tone: "warning", message: `Retrying ${section.label} once · ${code}.` });
    // W-19: the smart check, worded as far as its evidence goes. A status read alone names the status only.
    if (activity.kind === "smart-check") {
      const probe = smartCheckProbeWord(activity.probe ?? (activity.check === "public-page" ? activity.outcome : null), activity.httpStatus);
      const statusOutcome = activity.status ?? (activity.check === "status-page" ? activity.outcome : null);
      const statusWord = { ok: "ok", issue: "problem", unknown: "unavailable" }[statusOutcome] ?? null;
      if (probe && statusWord) return Object.freeze({ at, tone: "warning", message: `Check · without login: ${probe} · RSI status: ${statusWord}.` });
      if (statusWord) return Object.freeze({ at, tone: "warning", message: `Check · RSI status: ${statusWord}.` });
      return null;
    }
    if (activity.kind === "section-completed") {
      const records = Number.isSafeInteger(activity.recordsTotal) && activity.recordsTotal >= 0 ? activity.recordsTotal : 0;
      const requests = Number.isSafeInteger(activity.requestsTotal) && activity.requestsTotal >= 0 ? activity.requestsTotal : 0;
      return Object.freeze({ at, tone: "normal", message: `Completed ${section.label} · ${records} records in ${requests} RSI request${requests === 1 ? "" : "s"}.` });
    }
    const method = typeof activity.method === "string" && /^(?:GET|POST)$/u.test(activity.method) ? activity.method : "REQUEST";
    const route = typeof activity.route === "string" && /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,200}$/u.test(activity.route) ? activity.route : "allowed RSI route";
    const parts = [`${method} ${route}`];
    if (Number.isSafeInteger(activity.page) && activity.page > 0) parts.push(`page ${activity.page}${Number.isSafeInteger(activity.pageCount) && activity.pageCount > 0 ? ` of ${activity.pageCount}` : ""}`);
    if (activity.kind === "request-started") return Object.freeze({ at, tone: "normal", message: `Requesting ${parts.join(" · ")}.` });
    // W-16: a request that timed out or failed on the network.
    if (activity.kind === "request-failed") {
      if (activity.error === "TIMEOUT") return Object.freeze({ at, tone: "warning", message: `Timed out: ${parts.join(" · ")}.` });
      if (activity.error === "NETWORK") return Object.freeze({ at, tone: "warning", message: `Network error: ${parts.join(" · ")}.` });
      return null;
    }
    if (activity.kind !== "request-completed") return null;
    if (Number.isSafeInteger(activity.responseStatus)) parts.push(`HTTP ${activity.responseStatus}`);
    if (Number.isSafeInteger(activity.recordsReceived) && activity.recordsReceived >= 0) parts.push(`${activity.recordsReceived} record${activity.recordsReceived === 1 ? "" : "s"}`);
    if (Number.isSafeInteger(activity.elapsedMs) && activity.elapsedMs >= 0) parts.push(`${activity.elapsedMs} ms`);
    return Object.freeze({ at, tone: "normal", message: `Received ${parts.join(" · ")}.` });
  }

  // The log's rows, oldest first, each with its key: the activity's seq, or for an older extension a bounded composite.
  // The give-up's public-page check and the status-page check that follows it are one W-19 line.
  function activityRows(log) {
    const entries = (Array.isArray(log) ? log : []).slice(-20);
    const rows = [];
    for (let index = 0; index < entries.length; index += 1) {
      let entry = entries[index];
      const next = entries[index + 1];
      if (entry?.kind === "smart-check" && entry.check === "public-page" && next?.kind === "smart-check" && next.check === "status-page" && next.at === entry.at) {
        entry = { ...entry, probe: entry.outcome, status: next.outcome };
        index += 1;
      }
      const row = safeActivityPresentation(entry);
      if (!row) continue;
      const key = Number.isSafeInteger(entry.seq) ? `seq:${entry.seq}` : `line:${String(entry.kind).slice(0, 40)}:${row.at ?? ""}:${index}:${row.message.slice(0, 80)}`;
      rows.push(Object.freeze({ ...row, key }));
    }
    return rows;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    return value;
  }

  function validateTextFields(record, fields, label) {
    for (const field of fields) if (record[field] !== null && record[field] !== undefined && typeof record[field] !== "string") throw new Error(`${label}.${field} must be text or null.`);
  }

  function validateIntegerField(record, field, label) {
    const value = record[field];
    if (value !== null && value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${label}.${field} must be a nonnegative safe integer or null.`);
  }

  function validateRecords(records, label, validateRecord) {
    if (!Array.isArray(records)) throw new Error(`${label} must be an array.`);
    records.forEach((record, index) => {
      const recordLabel = `${label}[${index}]`;
      requireObject(record, recordLabel);
      validateRecord(record, recordLabel);
    });
  }

  function validateIdentity(record, field, label) {
    if (typeof record[field] !== "string" || !record[field].trim()) throw new Error(`${label}.${field} must be nonempty text.`);
  }

  function validateMedia(record, label) {
    if (record.images !== undefined) validateRecords(record.images, `${label}.images`, (image, imageLabel) => {
      validateTextFields(image, ["imageKey", "role", "altText"], imageLabel);
    });
  }

  function validateInventoryRecord(record, label) {
    validateIdentity(record, "recordKey", label);
    validateTextFields(record, ["title", "category", "state", "createdDateRaw", "reclaimDateRaw", "containsSummary"], label);
    validateMedia(record, label);
    if (record.items !== undefined) validateRecords(record.items, `${label}.items`, (item, itemLabel) => {
      validateTextFields(item, ["name", "kind", "category", "manufacturer", "customName", "section"], itemLabel);
      validateMedia(item, itemLabel);
    });
    if (record.sourceLinks !== undefined) validateRecords(record.sourceLinks, `${label}.sourceLinks`, (link, linkLabel) => validateTextFields(link, ["url"], linkLabel));
    if (record.observation !== undefined) validateTextFields(requireObject(record.observation, `${label}.observation`), ["lastObservedAt"], `${label}.observation`);
  }

  function validateAccountDocument(document) {
    requireObject(document, "Account JSON");
    if (document.schemaVersion !== 1) throw new Error("Only account schema version 1 is supported by this source checkpoint.");
    requireObject(document.account, "account");
    requireObject(document.profile, "profile");
    // Validate the shapes consumed by the renderer before replacing a loaded file.
    // Complete schema and integrity verification remain a separate adapter concern.
    validateTextFields(document.account, ["handle"], "account");
    validateIntegerField(document.account, "ueeCitizenRecord", "account");
    validateTextFields(document.profile, ["displayName", "handle", "displayTitle", "dossierBadgeTitle", "enlistedOnRaw", "mainOrganizationSid", "organizationRank"], "profile");
    validateMedia(document.profile, "profile");
    requireObject(document.financial, "financial");
    requireObject(document.financial.balances, "financial.balances");
    for (const key of ["storeCredit", "uec", "rec"]) {
      const balance = document.financial.balances[key];
      if (balance === null || balance === undefined) continue;
      requireObject(balance, `financial.balances.${key}`);
      if (typeof balance.amount !== "string" || !decimalParts(balance.amount) || typeof balance.unit !== "string") throw new Error(`financial.balances.${key} must contain an exact decimal amount and a unit.`);
    }
    if (document.financial.billingTotal !== null) {
      const total = requireObject(document.financial.billingTotal, "financial.billingTotal");
      if (total.source !== "billingPageTotal" || typeof total.amount !== "string" || !decimalParts(total.amount) || typeof total.currency !== "string") throw new Error("financial.billingTotal must be direct Billing-page evidence or null.");
    }
    if (document.financial.subscriptions !== undefined && document.financial.subscriptions !== null) {
      const validateMoney = (money, label) => {
        requireObject(money, label);
        if (typeof money.amount !== "string" || !decimalParts(money.amount) || typeof money.currency !== "string" || !money.currency.trim()) throw new Error(`${label} must contain an exact decimal amount and currency.`);
      };
      validateRecords(document.financial.subscriptions, "financial.subscriptions", (subscription, label) => {
        validateIdentity(subscription, "subscriptionId", label);
        validateTextFields(subscription, ["plan", "state", "startDateRaw", "endDateRaw", "recurringState", "totalTimeRaw"], label);
        for (const key of ["amount", "totalPaid"]) if (subscription[key] !== null && subscription[key] !== undefined) validateMoney(subscription[key], `${label}.${key}`);
        if (subscription.payments !== undefined) validateRecords(subscription.payments, `${label}.payments`, (payment, paymentLabel) => {
          validateTextFields(payment, ["rawTimestamp", "processor", "status"], paymentLabel);
          if (payment.amount !== null && payment.amount !== undefined) validateMoney(payment.amount, `${paymentLabel}.amount`);
        });
      });
    }
    requireObject(document.referrals, "referrals");
    requireObject(document.referrals.current, "referrals.current");
    requireObject(document.referrals.legacy, "referrals.legacy");
    requireObject(document.organizations, "organizations");
    for (const key of ["pledges", "buybacks"]) {
      validateRecords(document[key], key, validateInventoryRecord);
    }
    for (const source of ["current", "legacy"]) {
      for (const kind of ["prospects", "recruits"]) {
        validateRecords(document.referrals[source][kind], `referrals.${source}.${kind}`, (record, label) => {
          validateIdentity(record, "recordKey", label);
          validateTextFields(record, ["displayName", "handle", "dateRaw", "dateSortKey"], label);
          validateMedia(record, label);
        });
      }
    }
    validateRecords(document.organizations.memberships, "organizations.memberships", (membership, label) => {
      validateIdentity(membership, "sid", label);
      validateTextFields(membership, ["name", "membershipType", "rank"], label);
      validateIntegerField(membership, "memberCount", label);
      if (membership.isMain !== undefined && typeof membership.isMain !== "boolean") throw new Error(`${label}.isMain must be a boolean.`);
      validateMedia(membership, label);
    });
    validateRecords(document.organizations.members ?? [], "organizations.members", (member, label) => {
      validateIdentity(member, "recordKey", label);
      validateIdentity(member, "organizationSid", label);
      validateTextFields(member, ["displayName", "handle", "membershipType", "rank"], label);
      if (!["public", "restricted"].includes(member.visibility)) throw new Error(`${label}.visibility must be public or restricted.`);
      validateIntegerField(member, "rankStars", label);
      validateMedia(member, label);
      if (member.roles !== undefined && (!Array.isArray(member.roles) || member.roles.some((role) => typeof role !== "string"))) throw new Error(`${label}.roles must be an array of text.`);
    });
    if (document.sync !== undefined) {
      requireObject(document.sync, "sync");
      for (const key of ["sectionOutcomes", "organizationMemberOutcomes"]) {
        if (document.sync[key] === undefined) continue;
        for (const [section, outcome] of Object.entries(requireObject(document.sync[key], `sync.${key}`))) validateTextFields(requireObject(outcome, `sync.${key}.${section}`), ["status"], `sync.${key}.${section}`);
      }
    }
    return document;
  }

  function referralTimestamp(value) {
    const dateSortKey = typeof value === "string" ? value : value?.dateSortKey;
    const dateRaw = typeof value === "object" && value ? value.dateRaw : null;
    const candidate = typeof dateSortKey === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(dateSortKey) ? dateSortKey : dateRaw;
    const match = typeof candidate === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:Z)?)?$/u.exec(candidate) : null;
    if (!match) return null;
    const [, yearText, monthText, dayText, hourText = "0", minuteText = "0", secondText = "0"] = match;
    const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
    const time = Date.UTC(year, month - 1, day, hour, minute, second);
    const date = new Date(time);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
    return time;
  }

  function sortReferralRecords(records, order = "newest") {
    const multiplier = order === "oldest" ? 1 : -1;
    return asArray(records).map((record, index) => ({ record, index, time: referralTimestamp(record) })).sort((left, right) => {
      if (left.time === null && right.time !== null) return 1;
      if (right.time === null && left.time !== null) return -1;
      if (left.time !== right.time) return (left.time - right.time) * multiplier;
      const keyOrder = String(left.record.recordKey ?? "").localeCompare(String(right.record.recordKey ?? ""));
      return keyOrder || left.index - right.index;
    }).map(({ record }) => record);
  }

  function paginate(records, page, pageSize = 25) {
    const items = asArray(records);
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const safePage = Math.min(Math.max(Number.isInteger(page) ? page : 1, 1), totalPages);
    return { items: items.slice((safePage - 1) * pageSize, safePage * pageSize), page: safePage, pageSize, total: items.length, totalPages };
  }

  // Queued, loading, and ready load states also carry a message; only a failed load is an error.
  function mediaLoadError(loadState) {
    if (loadState?.status !== "error") return null;
    return typeof loadState.message === "string" && loadState.message ? loadState.message : "This image could not be loaded.";
  }

  function getBalance(document, key) {
    return document?.financial?.balances?.[key] ?? null;
  }

  function getMainMembership(document) {
    const memberships = asArray(document?.organizations?.memberships).filter((membership) => membership && typeof membership === "object" && !Array.isArray(membership));
    const sid = document?.profile?.mainOrganizationSid;
    if (typeof sid === "string" && sid.trim()) return memberships.find((membership) => membership.sid === sid && membership.membershipType !== "affiliate") ?? null;
    return memberships.find((membership) => membership.membershipType === "main") ?? memberships.find((membership) => membership.isMain === true && membership.membershipType !== "affiliate") ?? null;
  }

  function getBillingTotal(document) {
    const total = document?.financial?.billingTotal;
    if (total?.source !== "billingPageTotal" || typeof total.amount !== "string" || typeof total.currency !== "string") return null;
    return total;
  }

  function decimalParts(value) {
    const match = /^(-?)([0-9]+)(?:\.([0-9]{1,4}))?$/u.exec(String(value ?? ""));
    if (!match) return null;
    return { sign: match[1], integer: match[2], fraction: match[3] ?? "" };
  }

  function formatExactNumber(value, minimumFractionDigits = 0) {
    const parts = decimalParts(value);
    if (!parts) return "—";
    const integer = parts.integer.replace(/\B(?=(?:[0-9]{3})+(?![0-9]))/gu, ",");
    const fraction = parts.fraction.padEnd(minimumFractionDigits, "0");
    return `${parts.sign}${integer}${fraction ? `.${fraction}` : ""}`;
  }

  function formatExactMoney(value, currencyOrUnit) {
    const parts = decimalParts(value);
    if (!parts) return "—";
    const formatted = formatExactNumber(value, currencyOrUnit === "USD" ? 2 : 0);
    if (currencyOrUnit !== "USD") return formatted;
    return parts.sign === "-" ? `-$${formatted.slice(1)}` : `$${formatted}`;
  }

  // The plan the dashboard proposes: every account section in the settings' canonical order (identity, then Hangar
  // Log), at the plan floor, which is the lowest section interval of the dashboard's settings or the extension's
  // floor when the extension names a higher one. The settings (scripts/request-pacing-settings.js) load first.
  function buildDefaultPlan(capabilities = null) {
    const pacing = root.CITIZENDATA_REQUEST_PACING;
    const ownFloorMs = Math.min(...Object.values(pacing.accountBuild.sections).map((section) => section.intervalMs));
    const extensionFloorMs = capabilities?.pacing?.accountPlanFloorMs;
    const selectedSections = [...pacing.accountBuild.sectionOrder];
    return {
      selectedSections,
      maximumRecordsBySection: {
        profile: 1,
        pledges: 10000,
        hangarLog: 50000,
        buybacks: 10000,
        "financial.balances": 3,
        "financial.billingTotal": 1,
        "financial.ledgers": 25000,
        "financial.orders": 10000,
        "financial.subscriptions": 1000,
        "referrals.current.prospects": 10000,
        "referrals.current.recruits": 10000,
        "referrals.legacy.recruits": 10000,
        "organizations.memberships": 1000,
        buybackDetails: 10000,
        buybackUpgradePrices: 10000
      },
      minimumInterRequestDelayMs: Number.isSafeInteger(extensionFloorMs) ? Math.max(ownFloorMs, extensionFloorMs) : ownFloorMs
    };
  }

  function membersForOrganization(document, sid) {
    return asArray(document?.organizations?.members).filter((member) => member.organizationSid === sid);
  }

  function initials(value) {
    const words = String(value ?? "").trim().split(/\s+/u).filter(Boolean);
    if (!words.length) return "?";
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function personLinks(handle, { redacted = false, exampleProspect = false } = {}) {
    // Conservative link eligibility; unsupported handles remain readable text.
    if (redacted || typeof handle !== "string" || !/^[A-Za-z0-9_-]+$/u.test(handle)) return null;
    if (exampleProspect) {
      const url = "https://robertsspaceindustries.com/enlist?referral=STAR-GN2F-6JLW";
      return { monikerUrl: url, usernameUrl: url };
    }
    const segment = encodeURIComponent(handle);
    return {
      monikerUrl: `https://robertsspaceindustries.com/spectrum/messages/member/${segment}`,
      usernameUrl: `https://robertsspaceindustries.com/en/citizens/${segment}`
    };
  }

  function inventorySearchText(record) {
    const values = [];
    const seen = new WeakSet();
    const visit = (value, depth) => {
      if (value === null || value === undefined || depth > 8) return;
      if (["string", "number", "boolean"].includes(typeof value)) {
        values.push(String(value));
        return;
      }
      if (typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const child of value) visit(child, depth + 1);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        values.push(key);
        visit(child, depth + 1);
      }
    };
    visit(record, 0);
    return values.join(" ").toLocaleLowerCase();
  }

  // RSI's placeholder picture, which a saved file from an earlier build may still hold, is never shown.
  function isPlaceholderImage(image) {
    return globalThis.CitizenDataAccountDocument.isPlaceholderImage(image);
  }

  function inventoryMediaEntries(record) {
    const entries = [];
    const seenImages = new Set();
    const visitedEntities = new WeakSet();
    const visit = (entity, depth, ownerLabel) => {
      if (!entity || typeof entity !== "object" || Array.isArray(entity) || depth > 6 || visitedEntities.has(entity)) return;
      visitedEntities.add(entity);
      const label = typeof entity.title === "string" && entity.title.trim()
        ? entity.title.trim()
        : typeof entity.name === "string" && entity.name.trim() ? entity.name.trim() : ownerLabel;
      for (const [index, image] of asArray(entity.images).entries()) {
        if (!image || typeof image !== "object" || Array.isArray(image) || isPlaceholderImage(image)) continue;
        const identity = [image.imageKey, image.normalizedUrl, image.sourceUrl]
          .find((value) => typeof value === "string" && value.trim());
        const key = identity ? `image:${identity}` : `path:${ownerLabel}:${depth}:${index}`;
        if (seenImages.has(key)) continue;
        seenImages.add(key);
        entries.push(Object.freeze({ reference: image, label: image.altText?.trim?.() || label || "Account record image" }));
      }
      for (const item of asArray(entity.items)) visit(item, depth + 1, label || ownerLabel);
    };
    visit(record, 0, typeof record?.title === "string" ? record.title : "Account record image");
    return entries;
  }

  // The image a record is shown by, as a position among its media entries. A CCU is shown by the ship it leads
  // to: the image read with its price, or else its last image, which is that of the item the CCU holds.
  function inventoryLeadMediaIndex(record, entries = inventoryMediaEntries(record)) {
    const destination = entries.findIndex((entry) => entry.reference?.role === "upgrade-destination");
    if (destination >= 0) return destination;
    return (record?.kind === "upgrade" || record?.category === "shipUpgrade") && entries.length > 0 ? entries.length - 1 : 0;
  }

  function referralSearchText(record) {
    return [record?.displayName, record?.handle]
      .filter((value) => typeof value === "string" && value.trim())
      .join("\n")
      .toLocaleLowerCase();
  }

  return Object.freeze({ TEXTS, activityRows, asArray, buildDefaultPlan, buildPresentation, cautionPresentation, changeNotices, collectionProgress, coolingDownCountdown, refusedDialogCountdown, collectionSectionPresentation, collectionStatusPresentation, countdownRunning, countdownText, diagnosisText, validateStatus, formatExactMoney, formatExactNumber, getBalance, getBillingTotal, getMainMembership, initials, inventoryLeadMediaIndex, inventoryMediaEntries, inventorySearchText, isPlaceholderImage, mediaLoadError, membersForOrganization, paginate, personLinks, referralSearchText, referralTimestamp, safeActivityPresentation, sortReferralRecords, stopTechnicalDetail, validateAccountDocument });
});
