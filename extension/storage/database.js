(function initializeCitizenDataDatabase(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataDatabase = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataDatabase() {
  "use strict";

  const DATABASE_NAME = "citizendata.jobs.v1";
  // Version 2 added the `pages` store, version 3 the two build history stores, version 4 the two stores for kept
  // images, and version 5 the pace history store. Opening an older database creates the missing stores and keeps
  // everything else.
  const DATABASE_VERSION = 6;
  const STORE_DEFINITIONS = Object.freeze({
    runtime: "id",
    proposals: "proposalId",
    authorizations: "authorizationId",
    jobs: "jobId",
    stagedRuns: "runId",
    snapshots: "accountId",
    checkpoints: "checkpointKey",
    receipts: "receiptId",
    replaySessions: "sessionKey",
    // One record per collection step of an unfinished section: the rows that step fetched, written once.
    pages: "pageKey",
    // What earlier runs' requests met (shared/pace-history.js): one aggregate for the connection, one for each account,
    // and the detailed records of the newest runs. It survives a browser restart and goes into a recovery backup.
    paceHistory: "historyKey",
    // RSI's status feed as last read (extension/adapters/rsi-status-page.js): one record, kept across restarts.
    statusFeedCache: "id"
  });
  // Earlier finished builds, kept when the user turns the build history on: one small record describing each kept
  // build, and its compressed file text apart from it so that listing the builds does not read them. These two stores
  // are not part of a recovery backup; each kept build is saved as its own file from the popup.
  const HISTORY_DEFINITIONS = Object.freeze({
    history: "historyId",
    historyData: "historyId"
  });
  const HISTORY_STORES = Object.freeze(Object.keys(HISTORY_DEFINITIONS));
  // Images the dashboard downloaded, kept while the build history is on: one small record describing each image, and
  // its bytes as base64 apart from it so that listing the images does not read them. Not part of a recovery backup;
  // the dashboard saves them as its Images ZIP.
  const MEDIA_DEFINITIONS = Object.freeze({
    media: "assetId",
    mediaData: "assetId"
  });
  const MEDIA_STORES = Object.freeze(Object.keys(MEDIA_DEFINITIONS));
  // The stores a recovery backup of each database version holds.
  const STORES_BY_VERSION = Object.freeze({
    1: Object.freeze(Object.keys(STORE_DEFINITIONS).filter((name) => !["pages", "paceHistory", "statusFeedCache"].includes(name))),
    2: Object.freeze(Object.keys(STORE_DEFINITIONS).filter((name) => !["paceHistory", "statusFeedCache"].includes(name))),
    3: Object.freeze(Object.keys(STORE_DEFINITIONS).filter((name) => !["paceHistory", "statusFeedCache"].includes(name))),
    4: Object.freeze(Object.keys(STORE_DEFINITIONS).filter((name) => !["paceHistory", "statusFeedCache"].includes(name))),
    5: Object.freeze(Object.keys(STORE_DEFINITIONS).filter((name) => name !== "statusFeedCache")),
    6: Object.freeze(Object.keys(STORE_DEFINITIONS))
  });
  // A step commit and a promotion wait until the data is on disk. Chrome's default since version 121 does not.
  const DURABLE = Object.freeze({ durability: "strict" });
  const RUN_STORES = Object.freeze(["jobs", "authorizations", "stagedRuns", "receipts", "pages", "paceHistory", "statusFeedCache"]);
  const STATUS_FEED_ID = "statusFeed";
  // The pending read of the status feed (§9.3): one caller's reservation, beside the cache record.
  const STATUS_FEED_LEASE_ID = "statusFeedLease";

  // Decides a status-feed reservation from the stored record and lease, in the caller's one transaction. A record still
  // valid is used. A lease still running, and never longer than `leaseMs` from now, is observed. Otherwise the caller
  // takes the lease for `leaseMs`, one cache period: a worker ended after taking it causes no second request within that
  // period, and its lease lapses after it, so a lost worker cannot hold the feed back for longer.
  function statusFeedReservation(cached, lease, { nowMs, leaseMs, leaseId }) {
    if (cached && Date.parse(cached.expiresAt) > nowMs) return { outcome: { action: "cached", record: cached } };
    const leaseEnds = Date.parse(lease?.expiresAt);
    if (Number.isFinite(leaseEnds) && leaseEnds > nowMs && leaseEnds - nowMs <= leaseMs) return { outcome: { action: "pending", record: cached ?? null } };
    const taken = { id: STATUS_FEED_LEASE_ID, leaseId, acquiredAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + leaseMs).toISOString() };
    return { lease: taken, outcome: { action: "fetch", record: cached ?? null } };
  }

  // Whether a status-feed record may replace the stored one: only a later check does, and never one whose read was
  // reserved (`requestedAt`) before the stored record's, however late it finished.
  function newerStatusFeed(candidate, stored) {
    const at = Date.parse(candidate?.checkedAt);
    if (Date.parse(stored?.requestedAt) > Date.parse(candidate?.requestedAt)) return false;
    return Number.isFinite(at) && !(Date.parse(stored?.checkedAt) >= at);
  }
  const OPEN_STAGED_STATUSES = Object.freeze(["collecting", "ready"]);

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  // Pages of one section sort in step order under one key prefix. A continuation keeps the collection identifier of
  // the run it continues, so the pages of its unfinished section carry over without being copied.
  function pagePrefix(collectionId, section = null) {
    if (typeof collectionId !== "string" || !collectionId || collectionId.includes("|")) throw new TypeError("A collection identifier is required.");
    if (section === null) return `${collectionId}|`;
    if (typeof section !== "string" || !section || section.includes("|")) throw new TypeError("A section name is required.");
    return `${collectionId}|${section}|`;
  }

  // The one pending phase of a section's step in durable request slots (§6.3). It sorts under the collection, so it
  // goes with the collection's pages, but not under the section's step pages, so rebuilding a section never reads it.
  function pendingPageKey(collectionId, section) {
    if (typeof section !== "string" || !section || section.includes("|") || section.includes("#")) throw new TypeError("A section name is required.");
    return `${pagePrefix(collectionId)}${section}#pending`;
  }

  function pageKey(collectionId, section, step) {
    if (!Number.isSafeInteger(step) || step < 1 || step > 999999) throw new TypeError("A page step must be a positive integer.");
    return `${pagePrefix(collectionId, section)}${String(step).padStart(6, "0")}`;
  }

  function validateBackup(backup) {
    const expected = STORES_BY_VERSION[backup?.databaseVersion];
    if (!backup || !expected || !backup.stores || typeof backup.stores !== "object") throw new Error("Unsupported Star Citizen Data Downloader recovery backup.");
    const actual = Object.keys(backup.stores).sort();
    const sorted = [...expected].sort();
    if (sorted.length !== actual.length || sorted.some((name, index) => name !== actual[index])) throw new Error("Recovery backup store set is invalid.");
    for (const name of expected) {
      const keyPath = STORE_DEFINITIONS[name];
      if (!Array.isArray(backup.stores[name])) throw new Error(`Recovery store ${name} is invalid.`);
      for (const record of backup.stores[name]) {
        if (!record || typeof record !== "object" || !(keyPath in record)) throw new Error(`Recovery store ${name} contains an invalid record.`);
      }
    }
    const checked = clone(backup);
    // A recovery file written before the `pages`, `paceHistory` or `statusFeedCache` store existed restores with that
    // store empty.
    for (const name of Object.keys(STORE_DEFINITIONS)) checked.stores[name] ??= [];
    return checked;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    });
  }

  function openDatabase(factory = globalThis.indexedDB) {
    if (!factory) return Promise.reject(new Error("IndexedDB is unavailable."));
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const [name, keyPath] of Object.entries({ ...STORE_DEFINITIONS, ...HISTORY_DEFINITIONS, ...MEDIA_DEFINITIONS })) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath });
      }
    };
    return requestResult(request);
  }

  function mediaWrites(items) {
    if (!Array.isArray(items)) throw new TypeError("Kept images are written as a list.");
    for (const item of items) {
      if (typeof item?.entry?.assetId !== "string" || !item.entry.assetId || item.data?.assetId !== item.entry.assetId || typeof item.data.base64 !== "string") throw new TypeError("A kept image needs one identifier for its record and its bytes.");
    }
    return items;
  }

  // What a promotion writes to the build history: `{ add: { entry, data }, remove: [historyId] }`, both optional.
  function historyWrites(history) {
    const add = history?.add?.entry && history.add.data ? history.add : null;
    if (add && (typeof add.entry.historyId !== "string" || !add.entry.historyId || add.data.historyId !== add.entry.historyId)) throw new TypeError("A kept build needs one identifier for its record and its data.");
    return { add, remove: Array.isArray(history?.remove) ? history.remove.filter((id) => typeof id === "string" && id) : [] };
  }

  // The saved backup of one account, as a handed-over build is stored.
  function snapshotRecord(input) {
    if (typeof input?.accountId !== "string" || !input.accountId || !input.document || typeof input.document !== "object") throw new TypeError("A saved backup needs its account and its document.");
    return { accountId: input.accountId, runId: input.runId ?? null, promotedAt: input.promotedAt, document: input.document };
  }

  // What one atomic change to a run may write. Each field is optional; a decision with none of them writes nothing.
  //   job, authorization, stagedRun, receipt: records to store.
  //   page: one page record to store.
  //   removePages: [{ collectionId, section }] whose stored pages are deleted first. `section: null` means every section.
  //   removeStagedRun: true deletes the run's staged record.
  //   paceHistory: pace history records to store; removePaceHistory: the history keys to delete.
  //   removePageKeys: single page records to delete, such as a step's pending phase.
  //   statusFeedCache: the status feed's record, stored only when it is newer.
  function decisionWrites(decision) {
    return {
      removePageKeys: Array.isArray(decision?.removePageKeys) ? decision.removePageKeys : [],
      statusFeedCache: decision?.statusFeedCache ?? null,
      paceHistory: Array.isArray(decision?.paceHistory) ? decision.paceHistory : [],
      removePaceHistory: Array.isArray(decision?.removePaceHistory) ? decision.removePaceHistory : [],
      removePages: Array.isArray(decision?.removePages) ? decision.removePages : [],
      page: decision?.page ?? null,
      receipt: decision?.receipt ?? null,
      authorization: decision?.authorization ?? null,
      stagedRun: decision?.stagedRun ?? null,
      removeStagedRun: decision?.removeStagedRun === true,
      job: decision?.job ?? null
    };
  }

  // The status revision (§12.5): one record in the runtime store. A write raises it only when what the dashboard is
  // shown of the record changes; `project` gives that part, and the whole record when the caller names none.
  const STATUS_SEQUENCE_ID = "statusSequence";

  function projectionChanged(project, before, after) {
    return JSON.stringify(before ? project(before) : null) !== JSON.stringify(after ? project(after) : null);
  }

  function raisedSequence(record, floor = 0) {
    const revision = Number.isSafeInteger(record?.revision) && record.revision >= 0 ? record.revision : 0;
    return { id: STATUS_SEQUENCE_ID, revision: Math.max(revision, floor) + 1 };
  }

  // A status-feed result for a job (§7.5, §12.10), merged inside the run's transaction with its smart-check line, which
  // takes the job's next activity number. It is dropped when the job is gone, belongs to another run, is neither running
  // nor paused, shows no warning any more, or already holds a result as new.
  function statusPageDecision({ runId, statusPage, activity = null, activityLimit = 20 }) {
    const checkedAtMs = Date.parse(statusPage?.checkedAt);
    return ({ job }) => {
      if (!job || job.runId !== runId || !["running", "paused"].includes(job.status) || !job.pace) return { outcome: { merged: false } };
      if (!job.pace.warning || !Number.isFinite(checkedAtMs)) return { outcome: { merged: false } };
      if (Date.parse(job.pace.statusPage?.checkedAt) >= checkedAtMs) return { outcome: { merged: false } };
      const merged = { ...job, pace: { ...job.pace, statusPage: clone(statusPage) } };
      if (activity) {
        // The next number after the stored sequence and every number the log holds (§12.5).
        const numbers = (Array.isArray(job.activityLog) ? job.activityLog : []).map((line) => Number.isSafeInteger(line?.seq) ? line.seq : 0);
        const sequence = Math.max(Number.isSafeInteger(job.activitySequence) ? job.activitySequence : 0, ...numbers) + 1;
        merged.activityLog = [...(job.activityLog ?? []), { ...clone(activity), seq: sequence }].slice(-activityLimit);
        merged.activitySequence = sequence;
      }
      return { job: merged, outcome: { merged: true } };
    };
  }

  function createIndexedDbRepository(factory = globalThis.indexedDB) {
    // What the dashboard is shown of a job and of the worker's state; the running worker sets them.
    let projectJob = (job) => job;
    let projectRuntime = (value) => value;
    const setStatusProjections = (projections) => {
      if (typeof projections?.projectJob === "function") projectJob = projections.projectJob;
      if (typeof projections?.projectRuntime === "function") projectRuntime = projections.projectRuntime;
    };
    let databasePromise;
    const database = () => (databasePromise ??= openDatabase(factory));
    const prefixRange = (prefix) => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

    async function read(storeName, key) {
      const db = await database();
      const transaction = db.transaction(storeName, "readonly");
      return requestResult(transaction.objectStore(storeName).get(key));
    }

    async function write(storeName, value, options = undefined) {
      const db = await database();
      const transaction = db.transaction(storeName, "readwrite", options);
      transaction.objectStore(storeName).put(clone(value));
      await transactionDone(transaction);
      return value;
    }

    async function remove(storeName, key) {
      const db = await database();
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      await transactionDone(transaction);
    }

    async function all(storeName) {
      const db = await database();
      const transaction = db.transaction(storeName, "readonly");
      return requestResult(transaction.objectStore(storeName).getAll());
    }

    // Stores a record and, in the same transaction, raises the status revision when its projection changed.
    async function writeRevised(storeName, key, value, project) {
      const db = await database();
      const transaction = db.transaction([storeName, "runtime"], "readwrite");
      const store = transaction.objectStore(storeName);
      const before = await requestResult(store.get(key));
      store.put(clone(value));
      if (projectionChanged(project, before, value)) {
        const runtime = transaction.objectStore("runtime");
        runtime.put(raisedSequence(await requestResult(runtime.get(STATUS_SEQUENCE_ID))));
      }
      await transactionDone(transaction);
      return value;
    }

    async function getStatusRevision() {
      return (await read("runtime", STATUS_SEQUENCE_ID))?.revision ?? 0;
    }

    // A change only the worker knows of, such as a cool-down, that the public status shows.
    async function advanceStatusRevision() {
      const db = await database();
      const transaction = db.transaction("runtime", "readwrite");
      const runtime = transaction.objectStore("runtime");
      const next = raisedSequence(await requestResult(runtime.get(STATUS_SEQUENCE_ID)));
      runtime.put(next);
      await transactionDone(transaction);
      return next.revision;
    }

    // Stores the status feed's record when it is newer than the stored one, and returns the newest (§9.3). The lease
    // `leaseId` names is released in the same transaction; a lease another caller took since is kept.
    async function putStatusFeedCache(record, leaseId = null) {
      const db = await database();
      const transaction = db.transaction("statusFeedCache", "readwrite", DURABLE);
      const store = transaction.objectStore("statusFeedCache");
      const stored = await requestResult(store.get(STATUS_FEED_ID));
      const next = newerStatusFeed(record, stored) ? { ...record, id: STATUS_FEED_ID } : stored;
      if (next !== stored) store.put(clone(next));
      if (leaseId !== null && (await requestResult(store.get(STATUS_FEED_LEASE_ID)))?.leaseId === leaseId) store.delete(STATUS_FEED_LEASE_ID);
      await transactionDone(transaction);
      return next ? clone(next) : null;
    }

    // Reserves the status feed's one read of a cache period, in one read-modify-write transaction (§9.3).
    async function reserveStatusFeedRead(input) {
      const db = await database();
      const transaction = db.transaction("statusFeedCache", "readwrite", DURABLE);
      const store = transaction.objectStore("statusFeedCache");
      const cached = await requestResult(store.get(STATUS_FEED_ID));
      const decision = statusFeedReservation(cached, await requestResult(store.get(STATUS_FEED_LEASE_ID)), input);
      if (decision.lease) store.put(clone(decision.lease));
      await transactionDone(transaction);
      return clone(decision.outcome);
    }

    // Releases only the lease this caller owns, when its pre-request reservation was declined.
    async function releaseStatusFeedRead(leaseId) {
      const db = await database();
      const transaction = db.transaction("statusFeedCache", "readwrite", DURABLE);
      const store = transaction.objectStore("statusFeedCache");
      if ((await requestResult(store.get(STATUS_FEED_LEASE_ID)))?.leaseId === leaseId) store.delete(STATUS_FEED_LEASE_ID);
      await transactionDone(transaction);
    }

    async function listPages(collectionId, section) {
      const db = await database();
      const transaction = db.transaction("pages", "readonly");
      return requestResult(transaction.objectStore("pages").getAll(prefixRange(pagePrefix(collectionId, section))));
    }

    async function deletePages(collectionId, section = null) {
      const db = await database();
      const transaction = db.transaction("pages", "readwrite");
      transaction.objectStore("pages").delete(prefixRange(pagePrefix(collectionId, section)));
      await transactionDone(transaction);
    }

    // Reads and replaces one pace-history record in one durable transaction. `decide` must be synchronous so no
    // other writer can observe the old value and overwrite this decision with a merge based on the same old value.
    async function updatePaceHistoryRecord(historyKey, decide) {
      const db = await database();
      const transaction = db.transaction("paceHistory", "readwrite", DURABLE);
      const store = transaction.objectStore("paceHistory");
      const finished = transactionDone(transaction);
      finished.catch(() => {});
      try {
        const next = decide(clone(await requestResult(store.get(historyKey))));
        if (!next || next.historyKey !== historyKey) throw new TypeError("A pace history update must return the record named by its history key.");
        store.put(clone(next));
        await finished;
        return clone(next);
      } catch (error) {
        try { transaction.abort(); } catch { /* The transaction already ended. */ }
        throw error;
      }
    }

    // Reads a run's job, authorization, and, when asked, its staged record and the pace history, lets `decide` choose what to write, and
    // writes all of it in one transaction that waits for the disk. A step's page is therefore stored exactly when its
    // progress is. `decide` runs inside the transaction and must not wait for anything. Resolves to the `outcome` the
    // decision carries.
    async function updateRun({ jobId, authorizationId = null, runId = null, withStagedRun = false, withPaceHistory = false, decide }) {
      const db = await database();
      const transaction = db.transaction([...RUN_STORES, "runtime"], "readwrite", DURABLE);
      const finished = transactionDone(transaction);
      finished.catch(() => {});
      try {
        const [job, authorization, stagedRun, paceHistory] = await Promise.all([
          requestResult(transaction.objectStore("jobs").get(jobId)),
          authorizationId ? requestResult(transaction.objectStore("authorizations").get(authorizationId)) : undefined,
          withStagedRun && runId ? requestResult(transaction.objectStore("stagedRuns").get(runId)) : undefined,
          withPaceHistory ? requestResult(transaction.objectStore("paceHistory").getAll()) : undefined
        ]);
        const decision = decide({ job, authorization, stagedRun, paceHistory }) ?? {};
        const writes = decisionWrites(decision);
        for (const key of writes.removePaceHistory) transaction.objectStore("paceHistory").delete(key);
        for (const record of writes.paceHistory) transaction.objectStore("paceHistory").put(clone(record));
        for (const target of writes.removePages) transaction.objectStore("pages").delete(prefixRange(pagePrefix(target.collectionId, target.section ?? null)));
        for (const key of writes.removePageKeys) transaction.objectStore("pages").delete(key);
        if (writes.statusFeedCache) {
          const feed = transaction.objectStore("statusFeedCache");
          if (newerStatusFeed(writes.statusFeedCache, await requestResult(feed.get(STATUS_FEED_ID)))) feed.put(clone({ ...writes.statusFeedCache, id: STATUS_FEED_ID }));
        }
        if (writes.page) transaction.objectStore("pages").put(writes.page);
        if (writes.receipt) transaction.objectStore("receipts").put(clone(writes.receipt));
        if (writes.authorization) transaction.objectStore("authorizations").put(clone(writes.authorization));
        if (writes.removeStagedRun && runId) transaction.objectStore("stagedRuns").delete(runId);
        else if (writes.stagedRun) transaction.objectStore("stagedRuns").put(clone(writes.stagedRun));
        if (writes.job) transaction.objectStore("jobs").put(clone(writes.job));
        if (writes.job && projectionChanged(projectJob, job, writes.job)) {
          const runtime = transaction.objectStore("runtime");
          runtime.put(raisedSequence(await requestResult(runtime.get(STATUS_SEQUENCE_ID))));
        }
        await finished;
        return decision.outcome;
      } catch (error) {
        try { transaction.abort(); } catch { /* The transaction already ended. */ }
        throw error;
      }
    }

    // Stores the finished document as the account's saved backup and closes the run, all or nothing. The staged run
    // keeps only what `input.stagedRun` holds, so the collected results are not kept twice.
    async function promoteRun(input) {
      const db = await database();
      const history = historyWrites(input.history);
      const stores = ["stagedRuns", "snapshots", "checkpoints", "jobs", "receipts", "pages", "paceHistory", "runtime", ...HISTORY_STORES];
      const transaction = db.transaction(stores, "readwrite", DURABLE);
      const stagedStore = transaction.objectStore("stagedRuns");
      const staged = await requestResult(stagedStore.get(input.runId));
      if (!staged || !OPEN_STAGED_STATUSES.includes(staged.status)) {
        transaction.abort();
        throw new Error("Only an open staged run can be promoted.");
      }
      transaction.objectStore("snapshots").put(clone({
        accountId: input.accountId,
        runId: input.runId,
        promotedAt: input.promotedAt,
        document: input.document
      }));
      for (const checkpoint of input.checkpoints ?? []) transaction.objectStore("checkpoints").put(clone(checkpoint));
      for (const receipt of input.receipts ?? []) transaction.objectStore("receipts").put(clone(receipt));
      if (input.job) {
        const before = await requestResult(transaction.objectStore("jobs").get(input.job.jobId));
        transaction.objectStore("jobs").put(clone(input.job));
        if (projectionChanged(projectJob, before, input.job)) {
          const runtime = transaction.objectStore("runtime");
          runtime.put(raisedSequence(await requestResult(runtime.get(STATUS_SEQUENCE_ID))));
        }
      }
      if (input.collectionId) transaction.objectStore("pages").delete(prefixRange(pagePrefix(input.collectionId)));
      // The finished run's pace history: its record closed, aged records folded into the aggregates.
      for (const key of input.paceHistory?.remove ?? []) transaction.objectStore("paceHistory").delete(key);
      for (const record of input.paceHistory?.put ?? []) transaction.objectStore("paceHistory").put(clone(record));
      // The build this one replaces is kept, and builds beyond the number to keep are dropped, in the same step.
      if (history.add) {
        transaction.objectStore("history").put(clone(history.add.entry));
        transaction.objectStore("historyData").put(clone(history.add.data));
      }
      for (const id of history.remove) for (const name of HISTORY_STORES) transaction.objectStore(name).delete(id);
      stagedStore.put(clone({ ...(input.stagedRun ?? staged), runId: input.runId, status: "promoted", promotedAt: input.promotedAt }));
      await transactionDone(transaction);
    }

    // Stores a finished build that was handed over, not collected, as the account's saved backup. The build it
    // replaces is kept, and builds beyond the number to keep are dropped, in the same step.
    async function saveSnapshot(input) {
      const history = historyWrites(input.history);
      const db = await database();
      const transaction = db.transaction(["snapshots", ...HISTORY_STORES], "readwrite", DURABLE);
      transaction.objectStore("snapshots").put(clone(snapshotRecord(input)));
      if (history.add) {
        transaction.objectStore("history").put(clone(history.add.entry));
        transaction.objectStore("historyData").put(clone(history.add.data));
      }
      for (const id of history.remove) for (const name of HISTORY_STORES) transaction.objectStore(name).delete(id);
      await transactionDone(transaction);
    }

    // Writes one kept copy, in place of a copy of the same identifier.
    async function saveHistoryCopy(copy) {
      const { add } = historyWrites({ add: copy });
      if (!add) throw new TypeError("A kept copy needs its record and its data.");
      const db = await database();
      const transaction = db.transaction(HISTORY_STORES, "readwrite", DURABLE);
      transaction.objectStore("history").put(clone(add.entry));
      transaction.objectStore("historyData").put(clone(add.data));
      await transactionDone(transaction);
    }

    // Kept images: `items` are `{ entry, data }` pairs with one asset identifier each.
    async function saveMedia(items) {
      const db = await database();
      const transaction = db.transaction(MEDIA_STORES, "readwrite", DURABLE);
      for (const item of mediaWrites(items)) {
        transaction.objectStore("media").put(clone(item.entry));
        transaction.objectStore("mediaData").put(clone(item.data));
      }
      await transactionDone(transaction);
    }

    async function getMediaData(assetIds) {
      const db = await database();
      const store = db.transaction("mediaData", "readonly").objectStore("mediaData");
      return (await Promise.all(assetIds.map((assetId) => requestResult(store.get(assetId))))).filter(Boolean);
    }

    async function clearMedia() {
      const db = await database();
      const transaction = db.transaction(MEDIA_STORES, "readwrite", DURABLE);
      for (const name of MEDIA_STORES) transaction.objectStore(name).clear();
      await transactionDone(transaction);
    }

    async function deleteHistory(ids) {
      const db = await database();
      const transaction = db.transaction(HISTORY_STORES, "readwrite", DURABLE);
      for (const id of ids) for (const name of HISTORY_STORES) transaction.objectStore(name).delete(id);
      await transactionDone(transaction);
    }

    async function clearHistory() {
      const db = await database();
      const transaction = db.transaction(HISTORY_STORES, "readwrite", DURABLE);
      for (const name of HISTORY_STORES) transaction.objectStore(name).clear();
      await transactionDone(transaction);
    }

    async function exportBackup() {
      const output = {};
      for (const storeName of Object.keys(STORE_DEFINITIONS)) output[storeName] = await all(storeName);
      return { databaseVersion: DATABASE_VERSION, exportedAt: new Date().toISOString(), stores: output };
    }

    async function clearAll() {
      const db = await database();
      const names = [...Object.keys(STORE_DEFINITIONS), ...HISTORY_STORES, ...MEDIA_STORES];
      const transaction = db.transaction(names, "readwrite");
      // Clear All resets the local data store, the status revision with it (§12.5); the revision grows again from there.
      for (const name of names) transaction.objectStore(name).clear();
      await transactionDone(transaction);
    }

    async function restoreBackup(backup) {
      const checked = validateBackup(backup);
      const db = await database();
      const names = Object.keys(STORE_DEFINITIONS);
      const transaction = db.transaction(names, "readwrite");
      const before = await requestResult(transaction.objectStore("runtime").get(STATUS_SEQUENCE_ID));
      for (const name of names) {
        const store = transaction.objectStore(name);
        store.clear();
        for (const record of checked.stores[name]) store.put(record);
      }
      // The revision never falls: a dashboard keeps the greatest it has seen.
      const restored = checked.stores.runtime.find((record) => record.id === STATUS_SEQUENCE_ID);
      transaction.objectStore("runtime").put(raisedSequence(restored, before?.revision ?? 0));
      await transactionDone(transaction);
    }

    return Object.freeze({
      getRuntime: () => read("runtime", "current"),
      saveRuntime: (value) => writeRevised("runtime", "current", { ...value, id: "current" }, (record) => projectRuntime(record)),
      getStatusRevision,
      advanceStatusRevision,
      setStatusProjections,
      getStatusFeedCache: () => read("statusFeedCache", STATUS_FEED_ID),
      reserveStatusFeedRead,
      releaseStatusFeedRead,
      putStatusFeedCache,
      getProposal: (key) => read("proposals", key),
      saveProposal: (value) => write("proposals", value),
      getAuthorization: (key) => read("authorizations", key),
      saveAuthorization: (value) => write("authorizations", value),
      getJob: (key) => read("jobs", key),
      saveJob: (value) => writeRevised("jobs", value.jobId, value, (job) => projectJob(job)),
      listJobs: () => all("jobs"),
      getStagedRun: (key) => read("stagedRuns", key),
      saveStagedRun: (value) => write("stagedRuns", value, DURABLE),
      getSnapshot: (key) => read("snapshots", key),
      saveCheckpoint: (value) => write("checkpoints", value),
      getCheckpoint: (key) => read("checkpoints", key),
      saveReceipt: (value) => write("receipts", value),
      getReplaySession: (key) => read("replaySessions", key),
      saveReplaySession: (value) => write("replaySessions", value),
      listPages,
      getPage: (key) => read("pages", key),
      deletePages,
      updateRun,
      mergeStatusPage: async (input) => (await updateRun({ jobId: input.jobId, decide: statusPageDecision(input) }))?.merged === true,
      listPaceHistory: () => all("paceHistory"),
      updatePaceHistoryRecord,
      deleteIncompleteRun: async (runId) => {
        const staged = await read("stagedRuns", runId);
        if (staged?.status === "promoted") throw new Error("A promoted run cannot be deleted as incomplete.");
        await remove("stagedRuns", runId);
        // Its detailed pace history goes with it; what it had merged into the aggregates stays.
        await remove("paceHistory", `run:${runId}`);
        const jobs = await all("jobs");
        for (const job of jobs.filter((value) => value.runId === runId && value.status !== "complete")) await remove("jobs", job.jobId);
      },
      deleteStagedRun: (runId) => remove("stagedRuns", runId),
      promoteRun,
      saveSnapshot,
      listHistory: () => all("history"),
      getHistoryData: (key) => read("historyData", key),
      saveHistoryCopy,
      listMedia: () => all("media"),
      getMediaData,
      saveMedia,
      clearMedia,
      listSnapshots: () => all("snapshots"),
      deleteHistory,
      clearHistory,
      exportBackup,
      restoreBackup,
      clearAll,
      close: async () => (await database()).close()
    });
  }

  function createMemoryRepository(seed = {}) {
    // What the dashboard is shown of a job and of the worker's state; the running worker sets them.
    let projectJob = (job) => job;
    let projectRuntime = (value) => value;
    const setStatusProjections = (projections) => {
      if (typeof projections?.projectJob === "function") projectJob = projections.projectJob;
      if (typeof projections?.projectRuntime === "function") projectRuntime = projections.projectRuntime;
    };
    const stores = {};
    for (const [name, keyPath] of Object.entries(STORE_DEFINITIONS)) {
      stores[name] = new Map((seed[name] ?? []).map((item) => [item[keyPath], clone(item)]));
    }
    const history = Object.fromEntries(HISTORY_STORES.map((name) => [name, new Map()]));
    const media = Object.fromEntries(MEDIA_STORES.map((name) => [name, new Map()]));
    const deleteHistoryNow = (ids) => {
      for (const id of ids) for (const name of HISTORY_STORES) history[name].delete(id);
    };
    const read = async (store, key) => clone(stores[store].get(key));
    const write = async (store, value) => {
      stores[store].set(value[STORE_DEFINITIONS[store]], clone(value));
      return clone(value);
    };
    const all = async (store) => [...stores[store].values()].map(clone);
    const raiseRevision = (floor = 0) => {
      const next = raisedSequence(stores.runtime.get(STATUS_SEQUENCE_ID), floor);
      stores.runtime.set(STATUS_SEQUENCE_ID, next);
      return next.revision;
    };
    const writeRevised = async (store, key, value, project) => {
      const before = stores[store].get(key);
      stores[store].set(key, clone(value));
      if (projectionChanged(project, before, value)) raiseRevision();
      return clone(value);
    };
    const pageKeys = (collectionId, section = null) => {
      const prefix = pagePrefix(collectionId, section);
      return [...stores.pages.keys()].filter((key) => key.startsWith(prefix)).sort();
    };
    const deletePagesNow = (collectionId, section = null) => {
      for (const key of pageKeys(collectionId, section)) stores.pages.delete(key);
    };
    const methods = {
      getRuntime: () => read("runtime", "current"),
      saveRuntime: (value) => writeRevised("runtime", "current", { ...value, id: "current" }, (record) => projectRuntime(record)),
      getStatusRevision: async () => stores.runtime.get(STATUS_SEQUENCE_ID)?.revision ?? 0,
      advanceStatusRevision: async () => raiseRevision(),
      setStatusProjections,
      getStatusFeedCache: async () => clone(stores.statusFeedCache.get(STATUS_FEED_ID)),
      putStatusFeedCache: async (record, leaseId = null) => {
        if (newerStatusFeed(record, stores.statusFeedCache.get(STATUS_FEED_ID))) stores.statusFeedCache.set(STATUS_FEED_ID, clone({ ...record, id: STATUS_FEED_ID }));
        if (leaseId !== null && stores.statusFeedCache.get(STATUS_FEED_LEASE_ID)?.leaseId === leaseId) stores.statusFeedCache.delete(STATUS_FEED_LEASE_ID);
        return clone(stores.statusFeedCache.get(STATUS_FEED_ID) ?? null);
      },
      reserveStatusFeedRead: async (input) => {
        const decision = statusFeedReservation(stores.statusFeedCache.get(STATUS_FEED_ID), stores.statusFeedCache.get(STATUS_FEED_LEASE_ID), input);
        if (decision.lease) stores.statusFeedCache.set(STATUS_FEED_LEASE_ID, clone(decision.lease));
        return clone(decision.outcome);
      },
      releaseStatusFeedRead: async (leaseId) => {
        if (stores.statusFeedCache.get(STATUS_FEED_LEASE_ID)?.leaseId === leaseId) stores.statusFeedCache.delete(STATUS_FEED_LEASE_ID);
      },
      getProposal: (key) => read("proposals", key),
      saveProposal: (value) => write("proposals", value),
      getAuthorization: (key) => read("authorizations", key),
      saveAuthorization: (value) => write("authorizations", value),
      getJob: (key) => read("jobs", key),
      saveJob: (value) => writeRevised("jobs", value.jobId, value, (job) => projectJob(job)),
      listJobs: () => all("jobs"),
      getStagedRun: (key) => read("stagedRuns", key),
      saveStagedRun: (value) => write("stagedRuns", value),
      getSnapshot: (key) => read("snapshots", key),
      saveCheckpoint: (value) => write("checkpoints", value),
      getCheckpoint: (key) => read("checkpoints", key),
      saveReceipt: (value) => write("receipts", value),
      getReplaySession: (key) => read("replaySessions", key),
      saveReplaySession: (value) => write("replaySessions", value),
      listPages: async (collectionId, section) => pageKeys(collectionId, section).map((key) => clone(stores.pages.get(key))),
      getPage: async (key) => clone(stores.pages.get(key)),
      deletePages: async (collectionId, section = null) => deletePagesNow(collectionId, section),
      updateRun: async ({ jobId, authorizationId = null, runId = null, withStagedRun = false, withPaceHistory = false, decide }) => {
        const decision = decide({
          job: clone(stores.jobs.get(jobId)),
          authorization: authorizationId ? clone(stores.authorizations.get(authorizationId)) : undefined,
          stagedRun: withStagedRun && runId ? clone(stores.stagedRuns.get(runId)) : undefined,
          paceHistory: withPaceHistory ? [...stores.paceHistory.values()].map(clone) : undefined
        }) ?? {};
        const writes = decisionWrites(decision);
        for (const key of writes.removePaceHistory) stores.paceHistory.delete(key);
        for (const record of writes.paceHistory) stores.paceHistory.set(record.historyKey, clone(record));
        for (const target of writes.removePages) deletePagesNow(target.collectionId, target.section ?? null);
        for (const key of writes.removePageKeys) stores.pages.delete(key);
        if (writes.statusFeedCache && newerStatusFeed(writes.statusFeedCache, stores.statusFeedCache.get(STATUS_FEED_ID))) stores.statusFeedCache.set(STATUS_FEED_ID, clone({ ...writes.statusFeedCache, id: STATUS_FEED_ID }));
        if (writes.page) stores.pages.set(writes.page.pageKey, clone(writes.page));
        if (writes.receipt) stores.receipts.set(writes.receipt.receiptId, clone(writes.receipt));
        if (writes.authorization) stores.authorizations.set(writes.authorization.authorizationId, clone(writes.authorization));
        if (writes.removeStagedRun && runId) stores.stagedRuns.delete(runId);
        else if (writes.stagedRun) stores.stagedRuns.set(writes.stagedRun.runId, clone(writes.stagedRun));
        if (writes.job) {
          const before = stores.jobs.get(writes.job.jobId);
          stores.jobs.set(writes.job.jobId, clone(writes.job));
          if (projectionChanged(projectJob, before, writes.job)) raiseRevision();
        }
        return clone(decision.outcome);
      },
      listPaceHistory: async () => [...stores.paceHistory.values()].map(clone),
      updatePaceHistoryRecord: async (historyKey, decide) => {
        const next = decide(clone(stores.paceHistory.get(historyKey)));
        if (!next || next.historyKey !== historyKey) throw new TypeError("A pace history update must return the record named by its history key.");
        stores.paceHistory.set(historyKey, clone(next));
        return clone(next);
      },
      deleteIncompleteRun: async (runId) => {
        if (stores.stagedRuns.get(runId)?.status === "promoted") throw new Error("A promoted run cannot be deleted as incomplete.");
        stores.stagedRuns.delete(runId);
        stores.paceHistory.delete(`run:${runId}`);
        for (const [key, job] of stores.jobs) if (job.runId === runId && job.status !== "complete") stores.jobs.delete(key);
      },
      deleteStagedRun: async (runId) => { stores.stagedRuns.delete(runId); },
      promoteRun: async (input) => {
        const staged = stores.stagedRuns.get(input.runId);
        if (!staged || !OPEN_STAGED_STATUSES.includes(staged.status)) throw new Error("Only an open staged run can be promoted.");
        const kept = historyWrites(input.history);
        stores.snapshots.set(input.accountId, clone({ accountId: input.accountId, runId: input.runId, promotedAt: input.promotedAt, document: input.document }));
        for (const checkpoint of input.checkpoints ?? []) stores.checkpoints.set(checkpoint.checkpointKey, clone(checkpoint));
        for (const receipt of input.receipts ?? []) stores.receipts.set(receipt.receiptId, clone(receipt));
        if (input.job) {
          const before = stores.jobs.get(input.job.jobId);
          stores.jobs.set(input.job.jobId, clone(input.job));
          if (projectionChanged(projectJob, before, input.job)) raiseRevision();
        }
        if (input.collectionId) deletePagesNow(input.collectionId);
        for (const key of input.paceHistory?.remove ?? []) stores.paceHistory.delete(key);
        for (const record of input.paceHistory?.put ?? []) stores.paceHistory.set(record.historyKey, clone(record));
        if (kept.add) {
          history.history.set(kept.add.entry.historyId, clone(kept.add.entry));
          history.historyData.set(kept.add.data.historyId, clone(kept.add.data));
        }
        deleteHistoryNow(kept.remove);
        stores.stagedRuns.set(input.runId, clone({ ...(input.stagedRun ?? staged), runId: input.runId, status: "promoted", promotedAt: input.promotedAt }));
      },
      saveSnapshot: async (input) => {
        const kept = historyWrites(input.history);
        const record = snapshotRecord(input);
        stores.snapshots.set(record.accountId, clone(record));
        if (kept.add) {
          history.history.set(kept.add.entry.historyId, clone(kept.add.entry));
          history.historyData.set(kept.add.data.historyId, clone(kept.add.data));
        }
        deleteHistoryNow(kept.remove);
      },
      listHistory: async () => [...history.history.values()].map(clone),
      getHistoryData: async (key) => clone(history.historyData.get(key)),
      saveHistoryCopy: async (copy) => {
        const { add } = historyWrites({ add: copy });
        if (!add) throw new TypeError("A kept copy needs its record and its data.");
        history.history.set(add.entry.historyId, clone(add.entry));
        history.historyData.set(add.data.historyId, clone(add.data));
      },
      listSnapshots: async () => all("snapshots"),
      listMedia: async () => [...media.media.values()].map(clone),
      getMediaData: async (assetIds) => assetIds.map((assetId) => clone(media.mediaData.get(assetId))).filter(Boolean),
      saveMedia: async (items) => {
        for (const item of mediaWrites(items)) {
          media.media.set(item.entry.assetId, clone(item.entry));
          media.mediaData.set(item.data.assetId, clone(item.data));
        }
      },
      clearMedia: async () => MEDIA_STORES.forEach((name) => { media[name].clear(); }),
      deleteHistory: async (ids) => deleteHistoryNow(ids),
      clearHistory: async () => HISTORY_STORES.forEach((name) => { history[name].clear(); }),
      exportBackup: async () => ({ databaseVersion: DATABASE_VERSION, stores: Object.fromEntries(await Promise.all(Object.keys(stores).map(async (name) => [name, await all(name)]))) }),
      restoreBackup: async (backup) => {
        const checked = validateBackup(backup);
        const before = stores.runtime.get(STATUS_SEQUENCE_ID)?.revision ?? 0;
        for (const name of Object.keys(stores)) {
          stores[name].clear();
          const keyPath = STORE_DEFINITIONS[name];
          for (const record of checked.stores[name]) stores[name].set(record[keyPath], clone(record));
        }
        // The revision never falls: a dashboard keeps the greatest it has seen.
        stores.runtime.set(STATUS_SEQUENCE_ID, raisedSequence(checked.stores.runtime.find((record) => record.id === STATUS_SEQUENCE_ID), before));
      },
      clearAll: async () => {
        // Clear All resets the local data store, the status revision with it (§12.5).
        [...Object.values(stores), ...Object.values(history), ...Object.values(media)].forEach((store) => { store.clear(); });
      },
      inspect: () => stores,
      close: async () => {}
    };
    return Object.freeze({ ...methods, mergeStatusPage: async (input) => (await methods.updateRun({ jobId: input.jobId, decide: statusPageDecision(input) }))?.merged === true });
  }

  return Object.freeze({ DATABASE_NAME, DATABASE_VERSION, STORE_DEFINITIONS, HISTORY_STORES, MEDIA_STORES, pageKey, pendingPageKey, validateBackup, createIndexedDbRepository, createMemoryRepository });
});
