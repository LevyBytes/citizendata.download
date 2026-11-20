(function initializeCitizenDataDatabase(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataDatabase = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataDatabase() {
  "use strict";

  const DATABASE_NAME = "citizendata.jobs.v1";
  // Version 2 added the `pages` store, version 3 the two build history stores, and version 4 the two stores for kept
  // images. Opening an older database creates
  // the missing stores and keeps everything else.
  const DATABASE_VERSION = 4;
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
    pages: "pageKey"
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
    1: Object.freeze(Object.keys(STORE_DEFINITIONS).filter((name) => name !== "pages")),
    2: Object.freeze(Object.keys(STORE_DEFINITIONS)),
    3: Object.freeze(Object.keys(STORE_DEFINITIONS)),
    4: Object.freeze(Object.keys(STORE_DEFINITIONS))
  });
  // A step commit and a promotion wait until the data is on disk. Chrome's default since version 121 does not.
  const DURABLE = Object.freeze({ durability: "strict" });
  const RUN_STORES = Object.freeze(["jobs", "authorizations", "stagedRuns", "receipts", "pages"]);
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

  function pageKey(collectionId, section, step) {
    if (!Number.isSafeInteger(step) || step < 1 || step > 999999) throw new TypeError("A page step must be a positive integer.");
    return `${pagePrefix(collectionId, section)}${String(step).padStart(6, "0")}`;
  }

  function validateBackup(backup) {
    const expected = STORES_BY_VERSION[backup?.databaseVersion];
    if (!backup || !expected || !backup.stores || typeof backup.stores !== "object") throw new Error("Unsupported CitizenData recovery backup.");
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
    // A recovery file written before the `pages` store existed restores with no stored pages.
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
  function decisionWrites(decision) {
    return {
      removePages: Array.isArray(decision?.removePages) ? decision.removePages : [],
      page: decision?.page ?? null,
      receipt: decision?.receipt ?? null,
      authorization: decision?.authorization ?? null,
      stagedRun: decision?.stagedRun ?? null,
      removeStagedRun: decision?.removeStagedRun === true,
      job: decision?.job ?? null
    };
  }

  function createIndexedDbRepository(factory = globalThis.indexedDB) {
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

    // Reads a run's job, authorization, and, when asked, its staged record, lets `decide` choose what to write, and
    // writes all of it in one transaction that waits for the disk. A step's page is therefore stored exactly when its
    // progress is. `decide` runs inside the transaction and must not wait for anything. Resolves to the `outcome` the
    // decision carries.
    async function updateRun({ jobId, authorizationId = null, runId = null, withStagedRun = false, decide }) {
      const db = await database();
      const transaction = db.transaction(RUN_STORES, "readwrite", DURABLE);
      const finished = transactionDone(transaction);
      finished.catch(() => {});
      try {
        const [job, authorization, stagedRun] = await Promise.all([
          requestResult(transaction.objectStore("jobs").get(jobId)),
          authorizationId ? requestResult(transaction.objectStore("authorizations").get(authorizationId)) : undefined,
          withStagedRun && runId ? requestResult(transaction.objectStore("stagedRuns").get(runId)) : undefined
        ]);
        const decision = decide({ job, authorization, stagedRun }) ?? {};
        const writes = decisionWrites(decision);
        for (const target of writes.removePages) transaction.objectStore("pages").delete(prefixRange(pagePrefix(target.collectionId, target.section ?? null)));
        if (writes.page) transaction.objectStore("pages").put(writes.page);
        if (writes.receipt) transaction.objectStore("receipts").put(clone(writes.receipt));
        if (writes.authorization) transaction.objectStore("authorizations").put(clone(writes.authorization));
        if (writes.removeStagedRun && runId) transaction.objectStore("stagedRuns").delete(runId);
        else if (writes.stagedRun) transaction.objectStore("stagedRuns").put(clone(writes.stagedRun));
        if (writes.job) transaction.objectStore("jobs").put(clone(writes.job));
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
      const stores = ["stagedRuns", "snapshots", "checkpoints", "jobs", "receipts", "pages", ...HISTORY_STORES];
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
      if (input.job) transaction.objectStore("jobs").put(clone(input.job));
      if (input.collectionId) transaction.objectStore("pages").delete(prefixRange(pagePrefix(input.collectionId)));
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
      for (const name of names) transaction.objectStore(name).clear();
      await transactionDone(transaction);
    }

    async function restoreBackup(backup) {
      const checked = validateBackup(backup);
      const db = await database();
      const names = Object.keys(STORE_DEFINITIONS);
      const transaction = db.transaction(names, "readwrite");
      for (const name of names) {
        const store = transaction.objectStore(name);
        store.clear();
        for (const record of checked.stores[name]) store.put(record);
      }
      await transactionDone(transaction);
    }

    return Object.freeze({
      getRuntime: () => read("runtime", "current"),
      saveRuntime: (value) => write("runtime", { ...value, id: "current" }),
      getProposal: (key) => read("proposals", key),
      saveProposal: (value) => write("proposals", value),
      getAuthorization: (key) => read("authorizations", key),
      saveAuthorization: (value) => write("authorizations", value),
      getJob: (key) => read("jobs", key),
      saveJob: (value) => write("jobs", value),
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
      deletePages,
      updateRun,
      deleteIncompleteRun: async (runId) => {
        const staged = await read("stagedRuns", runId);
        if (staged?.status === "promoted") throw new Error("A promoted run cannot be deleted as incomplete.");
        await remove("stagedRuns", runId);
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
    const pageKeys = (collectionId, section = null) => {
      const prefix = pagePrefix(collectionId, section);
      return [...stores.pages.keys()].filter((key) => key.startsWith(prefix)).sort();
    };
    const deletePagesNow = (collectionId, section = null) => {
      for (const key of pageKeys(collectionId, section)) stores.pages.delete(key);
    };
    return Object.freeze({
      getRuntime: () => read("runtime", "current"),
      saveRuntime: (value) => write("runtime", { ...value, id: "current" }),
      getProposal: (key) => read("proposals", key),
      saveProposal: (value) => write("proposals", value),
      getAuthorization: (key) => read("authorizations", key),
      saveAuthorization: (value) => write("authorizations", value),
      getJob: (key) => read("jobs", key),
      saveJob: (value) => write("jobs", value),
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
      deletePages: async (collectionId, section = null) => deletePagesNow(collectionId, section),
      updateRun: async ({ jobId, authorizationId = null, runId = null, withStagedRun = false, decide }) => {
        const decision = decide({
          job: clone(stores.jobs.get(jobId)),
          authorization: authorizationId ? clone(stores.authorizations.get(authorizationId)) : undefined,
          stagedRun: withStagedRun && runId ? clone(stores.stagedRuns.get(runId)) : undefined
        }) ?? {};
        const writes = decisionWrites(decision);
        for (const target of writes.removePages) deletePagesNow(target.collectionId, target.section ?? null);
        if (writes.page) stores.pages.set(writes.page.pageKey, clone(writes.page));
        if (writes.receipt) stores.receipts.set(writes.receipt.receiptId, clone(writes.receipt));
        if (writes.authorization) stores.authorizations.set(writes.authorization.authorizationId, clone(writes.authorization));
        if (writes.removeStagedRun && runId) stores.stagedRuns.delete(runId);
        else if (writes.stagedRun) stores.stagedRuns.set(writes.stagedRun.runId, clone(writes.stagedRun));
        if (writes.job) stores.jobs.set(writes.job.jobId, clone(writes.job));
        return clone(decision.outcome);
      },
      deleteIncompleteRun: async (runId) => {
        if (stores.stagedRuns.get(runId)?.status === "promoted") throw new Error("A promoted run cannot be deleted as incomplete.");
        stores.stagedRuns.delete(runId);
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
        if (input.job) stores.jobs.set(input.job.jobId, clone(input.job));
        if (input.collectionId) deletePagesNow(input.collectionId);
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
      clearMedia: async () => MEDIA_STORES.forEach((name) => media[name].clear()),
      deleteHistory: async (ids) => deleteHistoryNow(ids),
      clearHistory: async () => HISTORY_STORES.forEach((name) => history[name].clear()),
      exportBackup: async () => ({ databaseVersion: DATABASE_VERSION, stores: Object.fromEntries(await Promise.all(Object.keys(stores).map(async (name) => [name, await all(name)]))) }),
      restoreBackup: async (backup) => {
        const checked = validateBackup(backup);
        for (const name of Object.keys(stores)) {
          stores[name].clear();
          const keyPath = STORE_DEFINITIONS[name];
          for (const record of checked.stores[name]) stores[name].set(record[keyPath], clone(record));
        }
      },
      clearAll: async () => [...Object.values(stores), ...Object.values(history), ...Object.values(media)].forEach((store) => store.clear()),
      inspect: () => stores,
      close: async () => {}
    });
  }

  return Object.freeze({ DATABASE_NAME, DATABASE_VERSION, STORE_DEFINITIONS, HISTORY_STORES, MEDIA_STORES, pageKey, validateBackup, createIndexedDbRepository, createMemoryRepository });
});
