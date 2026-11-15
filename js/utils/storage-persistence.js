/**
 * MeroHisab — Centralized Storage Persistence & Eviction-Protection Manager (v3.1.0)
 *
 * Manages browser StorageManager persistence guarantees (navigator.storage.persisted / persist).
 * Clearly distinguishes between:
 *  - Browser storage persistence (prevents automatic eviction under storage pressure).
 *  - External backups (protects against device loss, user cache clearing, or OS failure).
 */

export const PERSISTENCE_STATUS = {
  GRANTED: "granted",
  NOT_GRANTED: "not_granted",
  UNSUPPORTED: "unsupported",
  UNAVAILABLE: "unavailable",
  CHECKING: "checking"
};

let currentStatus = PERSISTENCE_STATUS.CHECKING;
let statusChecked = false;
const listeners = new Set();

/**
 * Returns the current storage persistence status enum.
 * @returns {"granted"|"not_granted"|"unsupported"|"unavailable"|"checking"}
 */
export function getPersistenceStatus() {
  return currentStatus;
}

/**
 * Subscribe to persistence status updates.
 * @param {Function} listener
 * @returns {Function} unsubscribe function
 */
export function subscribePersistenceStatus(listener) {
  if (typeof listener === "function") {
    listeners.add(listener);
    try {
      listener(currentStatus);
    } catch {}
  }
  return () => listeners.delete(listener);
}

function updateStatus(status) {
  currentStatus = status;
  statusChecked = true;
  if (typeof window !== "undefined") {
    window.__storagePersisted = (status === PERSISTENCE_STATUS.GRANTED);
    window.__storagePersistenceStatus = status;
  }
  for (const listener of listeners) {
    try {
      listener(status);
    } catch (err) {
      console.warn("[StoragePersistence] Listener error:", err);
    }
  }
}

/**
 * Check existing browser storage persistence status.
 * Safe for all environments; handles unsupported browsers, rejected promises, and exceptions.
 * @returns {Promise<string>}
 */
export async function checkPersistenceStatus() {
  if (typeof navigator === "undefined" || !navigator.storage) {
    updateStatus(PERSISTENCE_STATUS.UNSUPPORTED);
    return PERSISTENCE_STATUS.UNSUPPORTED;
  }

  if (typeof navigator.storage.persisted !== "function") {
    updateStatus(PERSISTENCE_STATUS.UNSUPPORTED);
    return PERSISTENCE_STATUS.UNSUPPORTED;
  }

  try {
    const isPersisted = await navigator.storage.persisted();
    const status = isPersisted ? PERSISTENCE_STATUS.GRANTED : PERSISTENCE_STATUS.NOT_GRANTED;
    updateStatus(status);
    return status;
  } catch (err) {
    console.warn("[StoragePersistence] Error inspecting persistence status:", err);
    updateStatus(PERSISTENCE_STATUS.UNAVAILABLE);
    return PERSISTENCE_STATUS.UNAVAILABLE;
  }
}

/**
 * User-initiated request for browser storage persistence guarantee.
 * @returns {Promise<{ success: boolean, status: string, error?: string }>}
 */
export async function requestPersistence() {
  if (typeof navigator === "undefined" || !navigator.storage || typeof navigator.storage.persist !== "function") {
    updateStatus(PERSISTENCE_STATUS.UNSUPPORTED);
    return {
      success: false,
      status: PERSISTENCE_STATUS.UNSUPPORTED,
      error: "Storage persistence API is not supported in this browser."
    };
  }

  try {
    const granted = await navigator.storage.persist();
    const status = granted ? PERSISTENCE_STATUS.GRANTED : PERSISTENCE_STATUS.NOT_GRANTED;
    updateStatus(status);
    return {
      success: granted,
      status,
      message: granted
        ? "Browser persistent storage guarantee granted."
        : "Browser declined storage persistence guarantee (standard storage remains active)."
    };
  } catch (err) {
    console.warn("[StoragePersistence] Exception requesting persistence:", err);
    updateStatus(PERSISTENCE_STATUS.UNAVAILABLE);
    return {
      success: false,
      status: PERSISTENCE_STATUS.UNAVAILABLE,
      error: err.message || "Failed to request storage persistence."
    };
  }
}
