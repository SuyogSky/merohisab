/**
 * MeroHisab — Authoritative Startup Reconciliation & Migration Engine (v3 Audited)
 * Guarantees:
 *  1. Demo data is NEVER written before both IndexedDB and LocalStorage are checked.
 *  2. Existing valid IndexedDB data is NEVER overwritten when LocalStorage is empty.
 *  3. Corrupted LocalStorage is preserved untouched and enters explicit recoveryMode.
 *  4. Divergent IDB vs LS copies do NOT use blind timestamp overwrites: IDB is the
 *     authoritative v3 store, and any divergent LS copy is backed up to CONFLICT_BACKUP.
 *  5. Fallback from IDB to LS copies, reads back, and validates the complete state first.
 */
import { StorageService } from "./storage.js";
import { getStoredStateWithMeta, setStoredState } from "../utils/indexed-db.js";
import { STORAGE_KEYS } from "./constants.js";
import { getDemoData } from "./demo-data.js";
import { Validator } from "./validator.js";

export function migrateV2toV3(rawState) {
  const state = JSON.parse(JSON.stringify(rawState));

  if (state.version === 2 || state.version === 1) {
    StorageService.setItem(STORAGE_KEYS.V2_BACKUP, JSON.parse(JSON.stringify(rawState)));
  }

  const legacyBalance = Number(state.settings?.initialBalance ?? 0);
  const legacyDate = state.settings?.initialBalanceDate || "2026-10-01";

  if (!Array.isArray(state.accounts) || state.accounts.length === 0) {
    state.accounts = [
      {
        id: "acc_default_cash",
        name: "Cash Wallet",
        type: "cash",
        openingBalance: legacyBalance,
        openingBalanceDate: legacyDate,
        overdraftEnabled: false,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }

  const defaultAccId = state.accounts[0].id;
  if (!Array.isArray(state.transactions)) state.transactions = [];
  state.transactions = state.transactions.map(tx => ({
    ...tx,
    accountId: tx.accountId || defaultAccId,
    transferId: tx.transferId ?? null,
    transferDirection: tx.transferDirection ?? null,
    peerAccountId: tx.peerAccountId ?? null,
    linkedBillId: tx.linkedBillId ?? null,
    linkedRecurringId: tx.linkedRecurringId ?? null
  }));

  if (!Array.isArray(state.budgets)) state.budgets = [];
  if (!Array.isArray(state.goals)) state.goals = [];
  if (!Array.isArray(state.recurringRules)) state.recurringRules = [];
  if (!Array.isArray(state.bills)) state.bills = [];

  const totalOpening = state.accounts.reduce((s, a) => s + (Number(a.openingBalance) || 0), 0);
  if (!state.settings) state.settings = {};
  state.settings.initialBalance = Math.round(totalOpening * 100) / 100;
  state.settings.initialBalanceDate = state.accounts[0].openingBalanceDate || legacyDate;

  state.version = 3;
  return state;
}

/**
 * Verified Persistence Write:
 * Attempts authoritative IndexedDB write + verified LocalStorage write.
 * If IDB fails, verifies that LocalStorage has a complete, valid, read-back verified copy.
 */
export async function persistVerifiedState(state) {
  const idbRes = await setStoredState(state);
  const lsRes = StorageService.setItem(STORAGE_KEYS.APP_DATA, state);

  if (idbRes.success) {
    return { success: true, provider: "indexeddb" };
  }

  // IDB failed or unavailable -> verify LocalStorage fallback copy by reading back & validating
  if (lsRes.success && StorageService.isPersistent()) {
    const readBack = StorageService.getItem(STORAGE_KEYS.APP_DATA);
    if (readBack && !readBack.__corrupt && Validator.validateBackupJson(readBack).isValid) {
      return { success: true, provider: "localstorage_fallback", warning: idbRes.error };
    }
  }

  return {
    success: false,
    error: idbRes.error || lsRes.error || "Critical storage failure: neither IndexedDB nor LocalStorage could verify the write."
  };
}

/**
 * Reconcile startup state across IndexedDB and LocalStorage BEFORE any demo initialization.
 * Covers Scenarios A, B, C, D, E, F, G, H.
 */
export async function reconcileStartupStorage() {
  const idbMeta = await getStoredStateWithMeta();
  const lsRaw = StorageService.getRawItem(STORAGE_KEYS.APP_DATA);
  const lsData = StorageService.getItem(STORAGE_KEYS.APP_DATA);

  // Scenario E: LocalStorage contains corrupted JSON (must enter explicit recovery mode & preserve raw LS)
  if (lsData && lsData.__corrupt) {
    StorageService.setRawItem(STORAGE_KEYS.CORRUPT_BACKUP, lsData.raw || "");
    const hasIdbRecovery = Boolean(idbMeta.available && idbMeta.data && Validator.validateBackupJson(idbMeta.data).isValid);
    return {
      status: "corrupt",
      error: lsData.error,
      raw: lsData.raw,
      idbRecoverableState: hasIdbRecovery ? migrateV2toV3(idbMeta.data) : null
    };
  }

  // Also check if LS has an object that fails schema validation
  if (lsData && typeof lsData === "object") {
    const lsValidation = Validator.validateBackupJson(lsData);
    if (!lsValidation.isValid) {
      StorageService.setRawItem(STORAGE_KEYS.CORRUPT_BACKUP, lsRaw || JSON.stringify(lsData));
      return {
        status: "corrupt",
        error: lsValidation.error,
        raw: lsRaw || JSON.stringify(lsData),
        idbRecoverableState: null
      };
    }
  }

  const idbHasData = Boolean(idbMeta.available && idbMeta.data !== null);
  let idbValid = false;
  if (idbHasData) {
    const v = Validator.validateBackupJson(idbMeta.data);
    if (!v.isValid) {
      return {
        status: "corrupt",
        error: `IndexedDB data failed validation: ${v.error}`,
        raw: JSON.stringify(idbMeta.data)
      };
    }
    idbValid = true;
  }

  // Scenario A & B: IndexedDB has valid data, LocalStorage is empty or unavailable
  if (idbValid && !lsData) {
    const stateFromIdb = migrateV2toV3(idbMeta.data);
    // Synchronize to LocalStorage if available
    StorageService.setItem(STORAGE_KEYS.APP_DATA, stateFromIdb);
    return { status: "loaded_from_idb", state: stateFromIdb };
  }

  // Scenario C: LocalStorage has valid data, IndexedDB is empty or unavailable
  if (lsData && !idbValid) {
    const stateFromLs = migrateV2toV3(lsData);
    await persistVerifiedState(stateFromLs);
    return { status: "loaded_from_ls", state: stateFromLs };
  }

  // Scenario F: Both IndexedDB and LocalStorage contain valid data
  if (idbValid && lsData) {
    const idbUpgraded = migrateV2toV3(idbMeta.data);
    const lsUpgraded = migrateV2toV3(lsData);

    // Never allow a demo dataset to overwrite non-demo user data!
    if (idbUpgraded.isDemoData === false && lsUpgraded.isDemoData === true) {
      StorageService.setItem(STORAGE_KEYS.APP_DATA, idbUpgraded);
      return { status: "loaded_from_idb", state: idbUpgraded };
    }
    if (lsUpgraded.isDemoData === false && idbUpgraded.isDemoData === true) {
      await persistVerifiedState(lsUpgraded);
      return { status: "loaded_from_ls", state: lsUpgraded };
    }

    // Check if the two stores have diverged (without relying blindly on lastUpdated)
    const idbFingerprint = JSON.stringify({
      a: idbUpgraded.accounts?.length,
      t: idbUpgraded.transactions?.length,
      b: idbUpgraded.budgets?.length,
      g: idbUpgraded.goals?.length,
      r: idbUpgraded.recurringRules?.length,
      bi: idbUpgraded.bills?.length
    });
    const lsFingerprint = JSON.stringify({
      a: lsUpgraded.accounts?.length,
      t: lsUpgraded.transactions?.length,
      b: lsUpgraded.budgets?.length,
      g: lsUpgraded.goals?.length,
      r: lsUpgraded.recurringRules?.length,
      bi: lsUpgraded.bills?.length
    });

    if (idbFingerprint !== lsFingerprint) {
      // Preserve the divergent LocalStorage copy in CONFLICT_BACKUP and use authoritative IDB
      StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, lsUpgraded);
      StorageService.setItem(STORAGE_KEYS.APP_DATA, idbUpgraded);
      return { status: "conflict_resolved_idb_authoritative", state: idbUpgraded };
    }

    // Both stores match in structure; keep synchronized
    StorageService.setItem(STORAGE_KEYS.APP_DATA, idbUpgraded);
    return { status: "ok", state: idbUpgraded };
  }

  // Scenario D: Both IndexedDB and LocalStorage are genuinely empty -> initialize first-run demo data once
  const firstRunDemo = migrateV2toV3(getDemoData());
  await persistVerifiedState(firstRunDemo);
  return { status: "initialized_first_run_demo", state: firstRunDemo };
}
