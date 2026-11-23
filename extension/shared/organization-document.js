(function initializeCitizenDataOrganizationDocument(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataOrganizationDocument = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataOrganizationDocument(root) {
  "use strict";

  const SID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/u;
  const ROSTER_STATUSES = new Set(["notDownloaded", "complete", "partial", "failed", "cancelled"]);

  function requireApi(name, value) {
    if (!value) throw new Error(`${name} is unavailable.`);
    return value;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function accountBinding(accountDocument) {
    const account = accountDocument?.account;
    if (!account || typeof account.localAccountId !== "string" || typeof account.handle !== "string" || !account.handle) {
      throw new TypeError("A canonical account identity is required.");
    }
    return { localAccountId: account.localAccountId, handle: account.handle };
  }

  // Whether two files are of the same RSI account. The handle decides when both files name one. The local identifier
  // is drawn at random by the extension when it holds no earlier build of the account, so a build made after the
  // extension's data was cleared, or by another installation, carries a new one for the same account; it decides
  // only when a file names no handle.
  function sameAccount(left, right) {
    const [leftHandle, rightHandle] = [left, right].map((account) => typeof account?.handle === "string" ? account.handle.trim().toLowerCase() : "");
    if (leftHandle && rightHandle) return leftHandle === rightHandle;
    return typeof left?.localAccountId === "string" && left.localAccountId.length > 0 && left.localAccountId === right?.localAccountId;
  }

  function validateOrganizationArrays(memberships, members) {
    const api = requireApi("Account document tooling", root.CitizenDataAccountDocument);
    const schema = requireApi("Account schema", root.CITIZENDATA_ACCOUNT_SCHEMA);
    const organizationSchema = schema?.$defs?.organizations;
    if (!organizationSchema) throw new Error("The account organization schema is unavailable.");
    const checked = api.validateWithSchema({ memberships, members }, organizationSchema, { rootSchema: schema });
    if (!checked.valid) {
      const summary = checked.errors.slice(0, 8).map((entry) => `${entry.path}: ${entry.message}`).join("\n");
      throw new Error(`Organization records do not satisfy the account schema:\n${summary}`);
    }
  }

  function validate(document) {
    if (!document || typeof document !== "object" || Array.isArray(document) || document.schemaVersion !== 1 || document.documentType !== "CitizenDataOrganizations") {
      throw new TypeError("Organization JSON must be a CitizenDataOrganizations schema version 1 document.");
    }
    if (!document.generator || typeof document.generator.name !== "string" || typeof document.generator.version !== "string") throw new TypeError("Organization JSON generator metadata is invalid.");
    if (typeof document.exportedAt !== "string" || Number.isNaN(Date.parse(document.exportedAt))) throw new TypeError("Organization JSON exportedAt is invalid.");
    accountBinding({ account: document.account });
    if (!Array.isArray(document.memberships) || !Array.isArray(document.members) || !Array.isArray(document.rosterIndex)) throw new TypeError("Organization JSON arrays are missing.");
    validateOrganizationArrays(document.memberships, document.members);
    if (!document.sync || typeof document.sync !== "object" || Array.isArray(document.sync) || !Array.isArray(document.sync.runs)) throw new TypeError("Organization JSON sync history is invalid.");
    const seen = new Set();
    let expectedStart = 0;
    for (const [index, entry] of document.rosterIndex.entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || !SID_PATTERN.test(entry.organizationSid) || seen.has(entry.organizationSid)) throw new TypeError(`rosterIndex[${index}] has an invalid or duplicate organization SID.`);
      seen.add(entry.organizationSid);
      if (!Number.isSafeInteger(entry.memberStart) || entry.memberStart !== expectedStart || !Number.isSafeInteger(entry.memberCount) || entry.memberCount < 0) throw new TypeError(`rosterIndex[${index}] has a noncontiguous member range.`);
      if (!ROSTER_STATUSES.has(entry.status)) throw new TypeError(`rosterIndex[${index}] has an invalid status.`);
      if (!(entry.updatedAt === null || typeof entry.updatedAt === "string" && !Number.isNaN(Date.parse(entry.updatedAt)))) throw new TypeError(`rosterIndex[${index}] has an invalid updatedAt value.`);
      const end = entry.memberStart + entry.memberCount;
      if (end > document.members.length || document.members.slice(entry.memberStart, end).some((member) => member.organizationSid !== entry.organizationSid)) throw new TypeError(`rosterIndex[${index}] does not match its member slice.`);
      expectedStart = end;
    }
    if (expectedStart !== document.members.length) throw new TypeError("Organization JSON contains members outside its roster index.");
    if (document.memberships.some((membership) => !seen.has(membership.sid))) throw new TypeError("Every membership must have one roster index entry.");
    return document;
  }

  async function accept(document) {
    const api = requireApi("Account document tooling", root.CitizenDataAccountDocument);
    validate(document);
    if (!await api.verifyIntegrity(document)) throw new Error("Organization JSON integrity verification failed.");
    return document;
  }

  async function merge({ accountDocument, previous = null, resultDocument = null, selectedSids = [], exportedAt = new Date().toISOString(), generatorVersion = "0.42.2", terminalStatus = "complete" }) {
    const api = requireApi("Account document tooling", root.CitizenDataAccountDocument);
    const account = accountBinding(accountDocument);
    if (previous) {
      await accept(previous);
      if (!sameAccount(previous.account, account)) throw new Error("The loaded Organization JSON belongs to a different account.");
    }
    if (resultDocument && !sameAccount(resultDocument.account, account)) throw new Error("The organization result belongs to a different account.");
    const memberships = clone(accountDocument.organizations?.memberships ?? []);
    const selected = new Set(selectedSids);
    const previousMembers = new Map();
    for (const entry of previous?.rosterIndex ?? []) previousMembers.set(entry.organizationSid, clone(previous.members.slice(entry.memberStart, entry.memberStart + entry.memberCount)));
    const resultMembers = new Map();
    for (const sid of selected) resultMembers.set(sid, clone((resultDocument?.organizations?.members ?? []).filter((member) => member.organizationSid === sid)));
    const previousIndex = new Map((previous?.rosterIndex ?? []).map((entry) => [entry.organizationSid, entry]));
    const members = [];
    const rosterIndex = [];
    for (const membership of memberships) {
      const sid = membership.sid;
      const rows = selected.has(sid) ? resultMembers.get(sid) ?? [] : previousMembers.get(sid) ?? [];
      const prior = previousIndex.get(sid);
      const status = selected.has(sid) ? terminalStatus : prior?.status ?? "notDownloaded";
      const updatedAt = selected.has(sid) ? exportedAt : prior?.updatedAt ?? null;
      rosterIndex.push({ organizationSid: sid, memberStart: members.length, memberCount: rows.length, status, updatedAt });
      members.push(...rows);
    }
    validateOrganizationArrays(memberships, members);
    const previousRuns = previous?.sync?.runs ?? [];
    const resultRuns = (resultDocument?.sync?.runs ?? []).filter((run) => Array.isArray(run?.selectedSections) && run.selectedSections.every((section) => typeof section === "string" && section.startsWith("organizations.members.")));
    const runs = [...previousRuns, ...resultRuns].filter((run, index, all) => run?.runId && all.findIndex((candidate) => candidate?.runId === run.runId) === index);
    const document = {
      schemaVersion: 1,
      documentType: "CitizenDataOrganizations",
      generator: { name: "CitizenData", version: generatorVersion },
      exportedAt,
      account,
      memberships,
      rosterIndex,
      members,
      sync: { runs },
      integrity: { algorithm: "SHA-256", contentHash: "0".repeat(64) }
    };
    const stamped = await api.stampIntegrity(document);
    validate(stamped);
    if (!await api.verifyIntegrity(stamped)) throw new Error("Organization JSON integrity stamping failed.");
    return stamped;
  }

  // The Organization JSON for the rosters an account build carries inside it, each with the state and time of its own
  // last collection. The extension carries every collected roster forward in its latest build, so this needs no
  // earlier Organization JSON. Null when the build carries no roster.
  async function fromAccountDocument({ accountDocument, generatorVersion = "0.42.2" }) {
    const api = requireApi("Account document tooling", root.CitizenDataAccountDocument);
    const account = accountBinding(accountDocument);
    const carried = Array.isArray(accountDocument.organizations?.members) ? accountDocument.organizations.members : [];
    const outcomes = accountDocument.sync?.organizationMemberOutcomes ?? {};
    if (!carried.length && !Object.keys(outcomes).length) return null;
    const memberships = clone(accountDocument.organizations?.memberships ?? []);
    const members = [];
    const rosterIndex = [];
    for (const membership of memberships) {
      const sid = membership.sid;
      const rows = clone(carried.filter((member) => member?.organizationSid === sid));
      const outcome = Object.hasOwn(outcomes, sid) ? outcomes[sid] : null;
      const status = ["complete", "partial", "failed"].includes(outcome?.status) ? outcome.status : rows.length ? "partial" : "notDownloaded";
      const updatedAt = typeof outcome?.endedAt === "string" && !Number.isNaN(Date.parse(outcome.endedAt)) ? outcome.endedAt : null;
      rosterIndex.push({ organizationSid: sid, memberStart: members.length, memberCount: rows.length, status, updatedAt });
      members.push(...rows);
    }
    validateOrganizationArrays(memberships, members);
    const runs = (accountDocument.sync?.runs ?? [])
      .filter((run) => run?.runId && Array.isArray(run.selectedSections) && run.selectedSections.length > 0 && run.selectedSections.every((section) => typeof section === "string" && section.startsWith("organizations.members.")))
      .filter((run, index, all) => all.findIndex((candidate) => candidate.runId === run.runId) === index);
    const stamped = await api.stampIntegrity({
      schemaVersion: 1,
      documentType: "CitizenDataOrganizations",
      generator: { name: "CitizenData", version: generatorVersion },
      exportedAt: accountDocument.exportedAt,
      account,
      memberships,
      rosterIndex,
      members,
      sync: { runs: clone(runs) },
      integrity: { algorithm: "SHA-256", contentHash: "0".repeat(64) }
    });
    validate(stamped);
    return stamped;
  }

  function membersFor(document, organizationSid) {
    const entry = document?.rosterIndex?.find((candidate) => candidate.organizationSid === organizationSid);
    return entry ? document.members.slice(entry.memberStart, entry.memberStart + entry.memberCount) : [];
  }

  return Object.freeze({ accept, fromAccountDocument, merge, membersFor, sameAccount, validate });
});
