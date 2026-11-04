/**
 * MeroHisab — Authoritative IndexedDB Storage Adapter (v3 Audited)
 * Includes read-back verification after every write and a deterministic test-harness
 * adapter for Node.js startup/failure-injection testing.
 */
const DB_NAME = "MeroHisabDB";
const STORE_NAME = "app_state";
const DB_VERSION = 1;

// Test harness hook for isolated Node.js unit testing of startup scenarios A-H
let mockIdbStore = null;
let mockIdbUnavailable = false;
let mockIdbWriteFailure = false;

export function __configureMockIdb({ initialData = undefined, unavailable = false, writeFailure = false } = {}) {
  mockIdbUnavailable = Boolean(unavailable);
  mockIdbWriteFailure = Boolean(writeFailure);
  if (initialData === null) {
    mockIdbStore = new Map();
  } else if (initialData !== undefined) {
    mockIdbStore = new Map([["app_state", JSON.parse(JSON.stringify(initialData))]]);
  }
}

export function __disableMockIdb() {
  mockIdbStore = null;
  mockIdbUnavailable = false;
  mockIdbWriteFailure = false;
}

function isBrowserIdbSupported() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!isBrowserIdbSupported()) {
      return resolve(null);
    }
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error || new Error("IndexedDB open failed"));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Read state from IndexedDB
 * @returns {Promise<{ available: boolean, data: object|null, error?: string }>}
 */
export async function getStoredStateWithMeta() {
  if (mockIdbStore !== null || mockIdbUnavailable) {
    if (mockIdbUnavailable) {
      return { available: false, data: null, error: "IndexedDB unavailable" };
    }
    const val = mockIdbStore.get("app_state") ?? null;
    return { available: true, data: val ? JSON.parse(JSON.stringify(val)) : null };
  }

  if (!isBrowserIdbSupported()) {
    return { available: false, data: null, error: "IndexedDB not supported in this environment" };
  }

  try {
    const db = await openDb();
    if (!db) return { available: false, data: null };
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get("app_state");
      req.onsuccess = (e) => resolve({ available: true, data: e.target.result?.payload ?? null });
      req.onerror = (e) => resolve({ available: false, data: null, error: e.target.error?.message || "IDB read error" });
    });
  } catch (err) {
    return { available: false, data: null, error: err.message };
  }
}

export async function getStoredState() {
  const res = await getStoredStateWithMeta();
  return res.data;
}

/**
 * Write state to IndexedDB with mandatory read-back verification
 */
export async function setStoredState(state) {
  if (mockIdbStore !== null || mockIdbUnavailable || mockIdbWriteFailure) {
    if (mockIdbUnavailable || mockIdbWriteFailure) {
      return { success: false, error: "IndexedDB write failure or unavailable" };
    }
    const serialized = JSON.stringify(state);
    mockIdbStore.set("app_state", JSON.parse(serialized));
    const readBack = mockIdbStore.get("app_state");
    if (!readBack || JSON.stringify(readBack) !== serialized) {
      return { success: false, error: "IndexedDB read-back verification failed" };
    }
    return { success: true };
  }

  if (!isBrowserIdbSupported()) {
    return { success: false, unavailable: true, error: "IndexedDB not supported" };
  }

  try {
    const db = await openDb();
    if (!db) return { success: false, unavailable: true, error: "IndexedDB unavailable" };
    const serialized = JSON.stringify(state);

    const writeOk = await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({ id: "app_state", payload: JSON.parse(serialized), ts: Date.now() });
      tx.oncomplete = () => resolve({ success: true });
      tx.onerror = (e) => resolve({ success: false, error: e.target.error?.message || "IDB write failed" });
    });

    if (!writeOk.success) return writeOk;

    // Perform read-back verification from IndexedDB
    const verifyRes = await getStoredStateWithMeta();
    if (!verifyRes.available || !verifyRes.data || verifyRes.data.version !== state.version) {
      return { success: false, error: "IndexedDB read-back verification failed." };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function clearStoredState() {
  if (mockIdbStore !== null) {
    mockIdbStore.clear();
    return { success: true };
  }
  if (!isBrowserIdbSupported()) return { success: true };
  try {
    const db = await openDb();
    if (!db) return { success: true };
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete("app_state");
      tx.oncomplete = () => resolve({ success: true });
      tx.onerror = () => resolve({ success: false });
    });
  } catch {
    return { success: false };
  }
}
