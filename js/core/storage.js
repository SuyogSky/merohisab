/**
 * MeroHisab — LocalStorage Persistence Adapter
 * Distinguishes missing keys from corrupted JSON payloads so user data is never
 * silently overwritten with demo data.
 */
import { STORAGE_KEYS } from "./constants.js";

const memoryFallback = new Map();

function isLocalStorageAvailable() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const testKey = "__mero_hisab_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

const hasStorage = isLocalStorageAvailable();

export const StorageService = {
  isPersistent() {
    return hasStorage;
  },

  /**
   * Read raw string without parsing
   */
  getRawItem(key) {
    try {
      if (hasStorage) {
        return window.localStorage.getItem(key);
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
      if (hasStorage) {
        window.localStorage.setItem(key, String(rawString));
      } else {
        memoryFallback.set(key, String(rawString));
      }
      return { success: true };
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
    try {
      if (hasStorage) {
        raw = window.localStorage.getItem(key);
        if (raw === null || raw === undefined) return null;
        return JSON.parse(raw);
      }
      if (!memoryFallback.has(key)) return null;
      const memVal = memoryFallback.get(key);
      if (typeof memVal === "string") {
        raw = memVal;
        return JSON.parse(memVal);
      }
      return JSON.parse(JSON.stringify(memVal));
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
   * Save item to storage with read-back verification and quota tracking
   */
  setItem(key, value) {
    try {
      const serialized = JSON.stringify(value);
      if (hasStorage) {
        window.localStorage.setItem(key, serialized);
        const readBack = window.localStorage.getItem(key);
        if (readBack !== serialized) {
          return { success: false, error: "Storage read-back verification failed." };
        }
      } else {
        memoryFallback.set(key, JSON.parse(serialized));
      }
      return { success: true };
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
      if (hasStorage) {
        window.localStorage.removeItem(key);
      } else {
        memoryFallback.delete(key);
      }
    } catch (err) {
      console.warn(`[StorageService] Failed to remove "${key}":`, err);
    }
  },

  clear() {
    this.removeItem(STORAGE_KEYS.APP_DATA);
    this.removeItem(STORAGE_KEYS.THEME);
  }
};
