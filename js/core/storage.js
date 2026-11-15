/**
 * MeroHisab — LocalStorage Persistence Adapter
 * Distinguishes missing keys from corrupted JSON payloads so user data is never
 * silently overwritten with demo data.
 * Guarantees that memory-only storage is never reported as durable persistence.
 */
import { STORAGE_KEYS } from "./constants.js";

const memoryFallback = new Map();

function getUnderlyingStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const testKey = "__mero_hisab_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    }
  } catch {}
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      const testKey = "__mero_hisab_test__";
      globalThis.localStorage.setItem(testKey, "1");
      globalThis.localStorage.removeItem(testKey);
      return globalThis.localStorage;
    }
  } catch {}
  return null;
}

export const StorageService = {
  isPersistent() {
    return Boolean(getUnderlyingStorage());
  },

  isAvailable() {
    return Boolean(getUnderlyingStorage());
  },

  /**
   * Diagnostic read of LocalStorage distinguishing:
   *  - available & ok (valid data)
   *  - available & empty (key missing)
   *  - available & corrupt (malformed JSON)
   *  - unavailable (storage API disabled / blocked)
   */
  getItemWithMeta(key) {
    const storage = getUnderlyingStorage();
    if (!storage) {
      if (!memoryFallback.has(key)) {
        return { available: false, data: null, reason: "unavailable", error: "LocalStorage is unavailable." };
      }
      try {
        const memVal = memoryFallback.get(key);
        const parsed = typeof memVal === "string" ? JSON.parse(memVal) : JSON.parse(JSON.stringify(memVal));
        return { available: false, isMemoryFallback: true, data: parsed, reason: "memory_only" };
      } catch (err) {
        return { available: false, isMemoryFallback: true, data: null, corrupt: true, error: err.message };
      }
    }

    let raw = null;
    try {
      raw = storage.getItem(key);
    } catch (err) {
      return {
        available: false,
        data: null,
        reason: "unavailable",
        error: `Storage access error in key "${key}": ${err.message}`
      };
    }

    if (raw === null || raw === undefined) {
      return { available: true, data: null, reason: "empty" };
    }

    try {
      const data = JSON.parse(raw);
      return { available: true, data, reason: "ok" };
    } catch (err) {
      return {
        available: true,
        data: null,
        corrupt: true,
        raw,
        reason: "corrupt",
        error: `Malformed JSON in storage key "${key}": ${err.message}`
      };
    }
  },

  /**
   * Read raw string without parsing
   */
  getRawItem(key) {
    try {
      const storage = getUnderlyingStorage();
      if (storage) {
        return storage.getItem(key);
      }
      const val = memoryFallback.get(key);
      return val !== undefined ? (typeof val === "string" ? val : JSON.stringify(val)) : null;
    } catch {
      return null;
    }
  },

  /**
   * Set raw string directly (used for preserving corrupted raw payloads)
   */
  setRawItem(key, rawString) {
    try {
      const storage = getUnderlyingStorage();
      if (storage) {
        storage.setItem(key, String(rawString));
        return { success: true };
      } else {
        memoryFallback.set(key, String(rawString));
        return {
          success: false,
          isMemoryFallback: true,
          error: "LocalStorage is unavailable (memory fallback only)."
        };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Retrieve item from storage.
   * Returns null ONLY if key does not exist.
   * Returns { __corrupt: true, raw, error } if JSON parsing fails!
   */
  getItem(key) {
    let raw = null;
    let readError = null;
    try {
      const storage = getUnderlyingStorage();
      if (storage) {
        try {
          raw = storage.getItem(key);
        } catch (readErr) {
          readError = readErr;
        }
      } else {
        if (!memoryFallback.has(key)) return null;
        const memVal = memoryFallback.get(key);
        if (typeof memVal === "string") {
          raw = memVal;
        } else {
          return JSON.parse(JSON.stringify(memVal));
        }
      }
    } catch (err) {
      readError = err;
    }

    if (readError) {
      console.warn(`[StorageService] Storage access error in key "${key}":`, readError.message);
      return {
        __unavailable: true,
        raw: null,
        error: `Storage access error in key "${key}": ${readError.message}`
      };
    }

    if (raw === null || raw === undefined) return null;

    try {
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[StorageService] Malformed JSON in key "${key}":`, err.message);
      return {
        __corrupt: true,
        raw: raw,
        error: `Malformed JSON in storage key "${key}": ${err.message}`
      };
    }
  },

  /**
   * Save item to storage with read-back verification and quota tracking.
   * Returns success: false when using in-memory fallback.
   */
  setItem(key, value) {
    try {
      const serialized = JSON.stringify(value);
      const storage = getUnderlyingStorage();
      if (storage) {
        storage.setItem(key, serialized);
        const readBack = storage.getItem(key);
        if (readBack !== serialized) {
          return { success: false, error: "Storage read-back verification failed." };
        }
        return { success: true };
      } else {
        memoryFallback.set(key, JSON.parse(serialized));
        return {
          success: false,
          isMemoryFallback: true,
          error: "LocalStorage is unavailable (memory fallback only)."
        };
      }
    } catch (err) {
      const isQuota =
        err &&
        (err.name === "QuotaExceededError" ||
          err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          err.code === 22 ||
          err.code === 1014);
      return {
        success: false,
        error: isQuota
          ? "LocalStorage quota exceeded. Please export a backup and clear unused data."
          : `Storage write failure: ${err.message || "Storage unavailable."}`
      };
    }
  },

  removeItem(key) {
    try {
      const storage = getUnderlyingStorage();
      if (storage) {
        storage.removeItem(key);
      }
      memoryFallback.delete(key);
    } catch (err) {
      console.warn(`[StorageService] Failed to remove "${key}":`, err);
    }
  },

  clear() {
    this.removeItem(STORAGE_KEYS.APP_DATA);
    this.removeItem(STORAGE_KEYS.THEME);
  }
};
