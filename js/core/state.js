/**
 * MeroHisab — Centralized Encapsulated State Manager (v3 Audited)
 *
 * Enforces:
 *  - Full Transactional Async Persistence Contract (every mutation awaits verified persistence)
 *  - Non-destructive rollback on persistence or validation failure
 *  - Integer Paisa arithmetic for financial balance and headroom calculations
 *  - Transfer-leg editing protection (rejects updating individual transfer legs via updateTransaction)
 *  - Atomic paired transfer updates and deletions
 *  - Account-specific opening balance date reconciliation
 *  - Overdraft protection on Expenses, Edits, Transfers, and Bill Payments
 *  - Atomic Bill payments and Recurring occurrence processing
 *  - Historic / Archived account opening balance immutability
 */
import { StorageService } from "./storage.js";
import {
  migrateV2toV3,
  createCleanPersonalLedgerState,
  resolvePrimaryAccount,
  reconcileStartupStorage,
  persistVerifiedState,
  rollbackVerifiedState,
  enqueueAuthoritativeWrite,
  waitForPendingWrites as idbWaitForPendingWrites,
  computeStateFingerprint
} from "./migrate-to-idb.js";
import { getStoredState } from "../utils/indexed-db.js";
import { STORAGE_KEYS, DEFAULT_SETTINGS, DEFAULT_PROFILE_NAME } from "./constants.js";
import { getDemoData } from "./demo-data.js";
import { adToBs, getTodayLocalDateString, isValidAdDate } from "../utils/nepali-calendar.js";
import { Validator } from "./validator.js";
import { toPaisa, fromPaisa, toPaisaBigInt, fromPaisaBigInt, checkAggregateOverflow, MAX_SAFE_RUPEES, isValidMoneyAmount } from "../utils/money.js";

export { migrateV2toV3, resolvePrimaryAccount, computeStateFingerprint, createCleanPersonalLedgerState };

let currentState = null;
const listeners = new Set();
let mutationQueue = Promise.resolve();

export function generateId(prefix = "item") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function syncSettingsInitialBalance(targetState = currentState) {
  if (!targetState || !Array.isArray(targetState.accounts)) return;
  const totalOpeningPaisa = targetState.accounts.reduce(
    (sumPaisa, a) => sumPaisa + toPaisaBigInt(a.openingBalance || 0),
    0n
  );
  if (!targetState.settings) targetState.settings = {};
  targetState.settings.initialBalance = fromPaisaBigInt(totalOpeningPaisa);
}

/**
 * Initialize state from storage safely.
 * NEVER overwrites corrupted user data with demo data!
 */
export function init() {
  const saved = StorageService.getItem(STORAGE_KEYS.APP_DATA);

  // 1. Detect malformed JSON in LocalStorage -> Enter recovery mode & NEVER overwrite
  if (saved && saved.__corrupt) {
    console.warn("[StateManager] Corrupted JSON detected in LocalStorage. Entering safe recovery mode.");
    StorageService.setRawItem(STORAGE_KEYS.CORRUPT_BACKUP, saved.raw || "");
    currentState = {
      version: 3,
      revision: 1,
      isDemoData: false,
      recoveryMode: true,
      recoveryError: saved.error,
      corruptRawBackup: saved.raw,
      lastUpdated: new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS, initialBalance: 0 },
      accounts: [
        {
          id: "acc_default_cash",
          name: "Cash Wallet",
          type: "cash",
          openingBalance: 0,
          openingBalanceDate: getTodayLocalDateString(),
          overdraftEnabled: false,
          archived: false
        }
      ],
      transactions: [],
      budgets: [],
      goals: [],
      recurringRules: [],
      bills: []
    };
    return;
  }

  // 1b. Detect storage access error / unavailable in LocalStorage
  if (saved && saved.__unavailable) {
    console.warn("[StateManager] LocalStorage access blocked/unavailable. Entering safe recovery mode.");
    currentState = {
      version: 3,
      revision: 1,
      isDemoData: false,
      recoveryMode: true,
      recoveryType: "both_storage_unavailable",
      recoveryError: saved.error,
      corruptRawBackup: null,
      lastUpdated: new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS, initialBalance: 0 },
      accounts: [
        {
          id: "acc_default_cash",
          name: "Cash Wallet",
          type: "cash",
          openingBalance: 0,
          openingBalanceDate: getTodayLocalDateString(),
          overdraftEnabled: false,
          archived: false
        }
      ],
      transactions: [],
      budgets: [],
      goals: [],
      recurringRules: [],
      bills: []
    };
    return;
  }

  // 2. Existing valid object in LocalStorage -> Load into memory without overwriting IDB yet
  if (saved && typeof saved === "object") {
    const validation = Validator.validateBackupJson(saved);
    if (validation.isValid) {
      currentState = migrateV2toV3(saved);
      currentState.recoveryMode = false;
      currentState.recoveryType = null;
      if (saved.version < 3) {
        StorageService.setItem(STORAGE_KEYS.APP_DATA, currentState);
      }
      return;
    } else {
      console.warn("[StateManager] Schema validation failed on persisted data. Entering recovery mode:", validation.error);
      StorageService.setItem(STORAGE_KEYS.CORRUPT_BACKUP, saved);
      currentState = {
        version: 3,
        revision: 1,
        isDemoData: false,
        recoveryMode: true,
        recoveryError: validation.error,
        lastUpdated: new Date().toISOString(),
        settings: { ...DEFAULT_SETTINGS, initialBalance: 0 },
        accounts: [
          {
            id: "acc_default_cash",
            name: "Cash Wallet",
            type: "cash",
            openingBalance: 0,
            openingBalanceDate: getTodayLocalDateString(),
            overdraftEnabled: false,
            archived: false
          }
        ],
        transactions: [],
        budgets: [],
        goals: [],
        recurringRules: [],
        bills: []
      };
      return;
    }
  }

  // 3. LocalStorage is empty: DO NOT write demo data or clean state to LocalStorage or IndexedDB here!
  // Hold an in-memory clean personal placeholder until hydrateFromIndexedDB() checks IndexedDB first.
  currentState = createCleanPersonalLedgerState();
  currentState.isUninitializedBoot = true;
}

init();

/**
 * Authoritative Startup Hydration:
 * Checks BOTH IndexedDB and LocalStorage before deciding whether to load existing
 * data, enter recoveryMode, or initialize first-run demo data.
 */
export async function hydrateFromIndexedDB() {
  const res = await reconcileStartupStorage();
  if (
    res.status === "corrupt" ||
    res.status === "storage_unavailable_degraded" ||
    res.status === "both_storage_unavailable" ||
    res.status === "equal_revision_conflict"
  ) {
    currentState = {
      version: 3,
      revision: res.idbRecoverableState?.revision || res.lsRecoverableState?.revision || 1,
      isDemoData: false,
      recoveryMode: true,
      recoveryType: res.status,
      recoveryError: res.error || "Storage access failed; entered protected recovery state.",
      corruptRawBackup: res.raw || null,
      idbRecoverableState: res.idbRecoverableState || null,
      lsRecoverableState: res.lsRecoverableState || null,
      lastUpdated: new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS, initialBalance: 0 },
      accounts: [
        {
          id: "acc_default_cash",
          name: "Cash Wallet",
          type: "cash",
          openingBalance: 0,
          openingBalanceDate: getTodayLocalDateString(),
          overdraftEnabled: false,
          archived: false
        }
      ],
      transactions: [],
      budgets: [],
      goals: [],
      recurringRules: [],
      bills: []
    };
  } else if (res.state) {
    currentState = res.state;
    currentState.recoveryMode = false;
    currentState.recoveryType = null;
    delete currentState.isUninitializedBoot;
  }

  notifyListeners();
  return res;
}

/**
 * Authoritative Transactional Mutation Commit:
 * 1. Serializes mutations through an execution queue.
 * 2. Evaluates mutation logic against a candidate snapshot.
 * 3. On validation failure, rejects immediately leaving currentState untouched.
 * 4. Increments candidate revision and timestamp.
 * 5. Durably saves and verifies state using persistVerifiedState (IDB first, verified LS fallback).
 * 6. If persistence fails: rolls back completely! currentState is untouched and listeners are NOT notified.
 * 7. If persistence succeeds: commits currentState = candidateState, notifies listeners, broadcasts cross-tab sync.
 * 8. Returns { success: true, ...mutationResult, provider, warning }.
 */
export async function commitMutation(mutationFn, { allowInRecovery = false, allowInEqualRevisionConflict = false } = {}) {
  const prevQueue = mutationQueue;
  let opResolve;
  const opPromise = new Promise((resolve) => {
    opResolve = resolve;
  });

  mutationQueue = prevQueue
    .catch(() => {})
    .then(async () => {
      try {
        if (currentState?.recoveryMode) {
          if (currentState.recoveryType === "equal_revision_conflict") {
            if (!allowInEqualRevisionConflict) {
              opResolve({
                success: false,
                error: "Application is in an equal-revision storage conflict recovery state. Normal mutations, resets, and backup restorations are blocked until the conflict between IndexedDB and LocalStorage is explicitly resolved."
              });
              return;
            }
          } else if (!allowInRecovery) {
            opResolve({
              success: false,
              error: "Application is in data-recovery mode to protect your original storage. Please export your raw data or explicitly reset the ledger in Settings."
            });
            return;
          }
        }

        // 1. Snapshot candidate state
        const candidateState = JSON.parse(JSON.stringify(currentState));
        if (allowInRecovery || allowInEqualRevisionConflict) {
          candidateState.recoveryMode = false;
          candidateState.recoveryType = null;
          delete candidateState.recoveryError;
          delete candidateState.corruptRawBackup;
          delete candidateState.idbRecoverableState;
          delete candidateState.lsRecoverableState;
        }

        // 2. Execute mutation logic on candidate state
        let mutationResult;
        try {
          mutationResult = await mutationFn(candidateState);
        } catch (err) {
          console.error("[MutationQueue] Unexpected mutation exception:", err);
          opResolve({
            success: false,
            error: err.message || "Unexpected mutation error."
          });
          return;
        }

        if (!mutationResult || mutationResult.success === false) {
          opResolve(mutationResult || { success: false, error: "Mutation validation failed." });
          return;
        }

        // Validate the entire candidate state before persistence (Requirement 11)
        const fullValidation = Validator.validateState(candidateState);
        if (fullValidation && !fullValidation.isValid) {
          console.error("[StateManager] Pre-commit candidate state validation failed:", fullValidation.error);
          opResolve({
            success: false,
            error: `Candidate state validation failed: ${fullValidation.error}`
          });
          return;
        }

        // 3. Increment revision and timestamp on candidate
        delete candidateState.isUninitializedBoot;
        candidateState.revision = Number(candidateState.revision || 0) + 1;
        candidateState.lastUpdated = new Date().toISOString();

        // 4. Durably persist and verify candidate state (IDB first, verified LS fallback)
        const persistResult = await persistVerifiedState(candidateState);
        if (!persistResult.success) {
          if (persistResult.conflict) {
            try {
              const latestStored = await getStoredState();
              if (latestStored && Validator.validateBackupJson(latestStored).isValid) {
                currentState = migrateV2toV3(latestStored);
              }
            } catch {}
          } else if (persistResult.verificationFailed) {
            try {
              const rollbackRes = await rollbackVerifiedState(currentState, candidateState);
              if (rollbackRes.success) {
                currentState = rollbackRes.rolledBackState;
              } else {
                currentState.recoveryMode = true;
                currentState.recoveryError = `Read-back verification failed and automatic storage rollback was unconfirmed: ${rollbackRes.error}`;
              }
            } catch (rbErr) {
              currentState.recoveryMode = true;
              currentState.recoveryError = `Read-back verification failed and automatic rollback threw an exception: ${rbErr.message}`;
            }
          }

          opResolve({
            success: false,
            conflict: persistResult.conflict || false,
            error: `Persistence failure: ${persistResult.error || "Storage write could not be verified."}`
          });
          return;
        }

        // 5. Persistence verified! Commit candidate state to memory
        currentState = candidateState;

        // 6. Notify in-memory listeners
        // 6. Notify subscribers of confirmed persistent state
        notifyListeners();

        // 7. Broadcast cross-tab sync message with loop prevention
        if (typeof BroadcastChannel !== "undefined") {
          try {
            const channel = new BroadcastChannel("merohisab_sync");
            channel.postMessage({
              type: "state_updated",
              tabId: TAB_ID,
              revision: candidateState.revision,
              timestamp: Date.now()
            });
            channel.close();
          } catch {}
        }

        opResolve({
          ...mutationResult,
          success: true,
          provider: persistResult.provider,
          warning: persistResult.warning
        });
      } catch (err) {
        console.error("[MutationQueue] Unexpected system error during commit:", err);
        opResolve({
          success: false,
          error: err.message || "Unexpected commit error."
        });
      }
    });

  return opPromise;
}

export async function waitForPendingWrites() {
  await mutationQueue;
  await idbWaitForPendingWrites();
}

export const TAB_ID = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export function notifyListeners() {
  try {
    const snapshot = getState();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("[StateManager] Listener error:", err);
      }
    }
  } catch (err) {
    console.error("[StateManager] notifyListeners error:", err);
  }
}

export function getState() {
  if (!currentState) init();
  if (!currentState) {
    currentState = {
      version: 3,
      revision: 1,
      isDemoData: false,
      lastUpdated: new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS, initialBalance: 0 },
      accounts: [
        {
          id: "acc_default_cash",
          name: "Cash Wallet",
          type: "cash",
          openingBalance: 0,
          openingBalanceDate: getTodayLocalDateString(),
          overdraftEnabled: false,
          archived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      transactions: [],
      budgets: [],
      goals: [],
      recurringRules: [],
      bills: []
    };
  }
  return JSON.parse(JSON.stringify(currentState));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Compute per-account balance accurately using integer Paisa arithmetic
 */
export function calculateAccountBalance(state, accountId) {
  const acc = (state?.accounts || []).find(a => a.id === accountId);
  if (!acc) return 0;
  let balPaisa = toPaisaBigInt(acc.openingBalance || 0);
  const openDate = acc.openingBalanceDate || "1970-01-01";
  const txs = Array.isArray(state?.transactions) ? state.transactions : [];
  for (const tx of txs) {
    if (tx.accountId !== accountId) continue;
    if (tx.dateAD < openDate) continue;
    if (tx.type === "transfer") {
      // Cross-account opening date neutrality invariant:
      // If the peer account exists and this transfer occurred before the peer's opening date,
      // the transfer cannot be unilaterally counted on this account while excluded on the peer.
      // Both legs are included or excluded together, preserving zero net effect on global balance.
      const peerAcc = (state?.accounts || []).find(a => a.id === tx.peerAccountId);
      if (!peerAcc || (peerAcc.openingBalanceDate && tx.dateAD < peerAcc.openingBalanceDate)) {
        continue;
      }
    }
    const amtPaisa = toPaisaBigInt(tx.amount);
    if (tx.type === "income") {
      balPaisa += amtPaisa;
    } else if (tx.type === "expense") {
      balPaisa -= amtPaisa;
    } else if (tx.type === "transfer") {
      balPaisa += tx.transferDirection === "in" ? amtPaisa : -amtPaisa;
    }
  }
  return fromPaisaBigInt(balPaisa);
}

/**
 * Authoritative unallocated headroom calculation in integer Paisa:
 * estimatedLedgerBalance - totalEarmarkedSavings
 */
export function calculateAvailableToAllocate(state) {
  if (state === null) return 0;
  const s = state || currentState || {};
  const accounts = Array.isArray(s.accounts) ? s.accounts : [];
  const hasAccounts = accounts.length > 0;
  let estimatedLedgerBalancePaisa = 0n;
  if (hasAccounts) {
    estimatedLedgerBalancePaisa = accounts.reduce(
      (sumPaisa, a) => sumPaisa + toPaisaBigInt(calculateAccountBalance(s, a.id)),
      0n
    );
  } else {
    const initialBalPaisa = toPaisaBigInt(s.settings?.initialBalance || 0);
    const initialDate = s.settings?.initialBalanceDate || "1970-01-01";
    let activeIncomePaisa = 0n;
    let activeExpensePaisa = 0n;
    const txs = Array.isArray(s.transactions) ? s.transactions : [];
    for (const t of txs) {
      if (t && t.dateAD >= initialDate) {
        if (t.type === "income") activeIncomePaisa += toPaisaBigInt(t.amount);
        else if (t.type === "expense") activeExpensePaisa += toPaisaBigInt(t.amount);
      }
    }
    estimatedLedgerBalancePaisa = initialBalPaisa + activeIncomePaisa - activeExpensePaisa;
  }

  let totalEarmarkedSavingsPaisa = 0n;
  const goals = Array.isArray(s.goals) ? s.goals : [];
  for (const goal of goals) {
    const allocs = Array.isArray(goal?.allocations) ? goal.allocations : [];
    for (const alloc of allocs) {
      totalEarmarkedSavingsPaisa += toPaisaBigInt(alloc?.amount || 0);
    }
  }

  return fromPaisaBigInt(estimatedLedgerBalancePaisa - totalEarmarkedSavingsPaisa);
}

export function getProfileDisplayName(state = currentState) {
  const name = state?.settings?.profile?.displayName || state?.settings?.userName;
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }
  return DEFAULT_PROFILE_NAME || "MeroHisab User";
}

export function computeProfileInitials(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "MU";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0][0] || "";
    const second = parts[1][0] || "";
    return (first + second).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export async function updateProfile(profileData) {
  const rawName = typeof profileData === "string" ? profileData : profileData?.displayName || profileData?.userName;
  const validation = Validator.validateProfileName(rawName);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }
  return await commitMutation((candidate) => {
    if (!candidate.settings) candidate.settings = {};
    candidate.settings.userName = validation.trimmedName;
    candidate.settings.profile = {
      ...(candidate.settings.profile || {}),
      displayName: validation.trimmedName
    };
    if (profileData && typeof profileData === "object" && profileData.userRole !== undefined) {
      candidate.settings.userRole = String(profileData.userRole).trim();
    }
    return { success: true, profile: candidate.settings.profile, settings: candidate.settings };
  });
}

export async function updateSettings(newSettings) {
  if (newSettings && newSettings.profile) {
    const pName = newSettings.profile.displayName;
    if (pName !== undefined) {
      const valRes = Validator.validateProfileName(pName);
      if (!valRes.isValid) {
        return { success: false, errors: valRes.errors, error: valRes.errors.join("; ") };
      }
    }
  }

  // Validate initialBalance if provided
  if (newSettings && newSettings.initialBalance !== undefined) {
    if (!isValidMoneyAmount(newSettings.initialBalance, true)) {
      return { success: false, errors: ["Opening balance must be a valid non-negative number with at most 2 decimal places."], error: "Opening balance must be a valid non-negative number with at most 2 decimal places." };
    }
  }
  if (newSettings && newSettings.initialBalanceDate !== undefined) {
    if (!isValidAdDate(newSettings.initialBalanceDate)) {
      return { success: false, errors: ["Invalid baseline effective date (AD)."], error: "Invalid baseline effective date (AD)." };
    }
  }

  return await commitMutation((candidate) => {
    if (newSettings && newSettings.profile) {
      const pName = newSettings.profile.displayName;
      if (pName !== undefined) {
        const valRes = Validator.validateProfileName(pName);
        if (!valRes.isValid) {
          return { success: false, errors: valRes.errors, error: valRes.errors.join("; ") };
        }
        candidate.settings.profile = {
          ...(candidate.settings.profile || {}),
          displayName: valRes.trimmedName
        };
      }
    }

    if (newSettings && newSettings.userName !== undefined) {
      const uName = String(newSettings.userName).trim();
      candidate.settings.userName = uName;
      if (!candidate.settings.profile) candidate.settings.profile = {};
      candidate.settings.profile.displayName = uName;
    }
    if (newSettings && newSettings.userRole !== undefined) {
      candidate.settings.userRole = String(newSettings.userRole).trim();
    }

    // Atomically update primary account opening balance and/or effective date if supplied
    if (Array.isArray(candidate.accounts) && candidate.accounts.length > 0) {
      const primaryAcc = resolvePrimaryAccount(candidate.accounts);
      if (primaryAcc && !primaryAcc.archived) {
        if (newSettings && newSettings.initialBalance !== undefined) {
          primaryAcc.openingBalance = Number(newSettings.initialBalance);
        }
        if (newSettings && newSettings.initialBalanceDate) {
          primaryAcc.openingBalanceDate = newSettings.initialBalanceDate;
          const bsRes = adToBs(newSettings.initialBalanceDate);
          if (bsRes) primaryAcc.openingBalanceDateBS = bsRes.formatted;
        }
      }
    }

    const { profile, userName, userRole, initialBalance, ...otherSettings } = newSettings || {};
    candidate.settings = {
      ...candidate.settings,
      ...otherSettings,
      ...(candidate.settings?.profile ? { profile: candidate.settings.profile } : {}),
      ...(candidate.settings?.userName ? { userName: candidate.settings.userName } : {}),
      ...(candidate.settings?.userRole ? { userRole: candidate.settings.userRole } : {})
    };
    if (newSettings.currencyFormat) {
      candidate.settings.currencyDisplay = newSettings.currencyFormat;
    } else if (newSettings.currencyDisplay) {
      candidate.settings.currencyFormat = newSettings.currencyDisplay;
    }
    if (newSettings.theme) {
      StorageService.setItem(STORAGE_KEYS.THEME, newSettings.theme);
    }
    syncSettingsInitialBalance(candidate);
    return { success: true, settings: candidate.settings, accounts: candidate.accounts };
  });
}

// ============================================================================
// ACCOUNTS CRUD (With Historic & Archived Opening-Balance Protection)
// ============================================================================
export async function addAccount(accData) {
  return await commitMutation((candidate) => {
    const defaultDate = candidate.settings?.initialBalanceDate || getTodayLocalDateString();
    if (!isValidMoneyAmount(accData?.openingBalance ?? 0, true)) {
      return { success: false, errors: ["Opening balance must be a valid non-negative amount with at most 2 decimal places."], error: "Opening balance must be a valid non-negative amount with at most 2 decimal places." };
    }
    const parsedOpeningBalance = fromPaisaBigInt(toPaisaBigInt(accData?.openingBalance ?? 0));
    const newAcc = {
      id: accData?.id || generateId("acc"),
      name: (accData?.name || "").trim(),
      type: accData?.type || "cash",
      openingBalance: parsedOpeningBalance,
      openingBalanceDate: accData?.openingBalanceDate || defaultDate,
      overdraftEnabled: Boolean(accData?.overdraftEnabled),
      archived: Boolean(accData?.archived),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const validation = Validator.validateAccount(newAcc);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }
    if (!Array.isArray(candidate.accounts)) candidate.accounts = [];
    if (candidate.accounts.some(a => a.name.toLowerCase() === newAcc.name.toLowerCase())) {
      return { success: false, errors: ["An account with this name already exists."], error: "An account with this name already exists." };
    }
    candidate.accounts.push(newAcc);
    syncSettingsInitialBalance(candidate);
    return { success: true, account: newAcc };
  });
}

export async function updateAccount(accIdOrPayload, maybeData) {
  const accId = typeof accIdOrPayload === "string" ? accIdOrPayload : accIdOrPayload?.id;
  const accData = typeof accIdOrPayload === "string" ? (maybeData || {}) : (accIdOrPayload?.data || accIdOrPayload || {});
  return await commitMutation((candidate) => {
    const idx = (candidate.accounts || []).findIndex(a => a.id === accId);
    if (idx === -1) {
      return { success: false, errors: ["Account not found."], error: "Account not found." };
    }
    const orig = candidate.accounts[idx];
    let openingBalance = orig.openingBalance;
    if (accData.openingBalance !== undefined) {
      if (!isValidMoneyAmount(accData.openingBalance, true)) {
        return { success: false, errors: ["Opening balance must be a valid non-negative amount with at most 2 decimal places."], error: "Opening balance must be a valid non-negative amount with at most 2 decimal places." };
      }
      openingBalance = fromPaisaBigInt(toPaisaBigInt(accData.openingBalance));
    }
    if (orig.archived && accData.openingBalance !== undefined && openingBalance !== orig.openingBalance) {
      return {
        success: false,
        errors: ["Cannot modify opening balance of an archived account. Unarchive the account first."],
        error: "Cannot modify opening balance of an archived account. Unarchive the account first."
      };
    }
    const updated = {
      ...orig,
      ...accData,
      id: orig.id,
      name: (accData.name !== undefined ? accData.name : orig.name).trim(),
      type: accData.type || orig.type,
      openingBalance,
      openingBalanceDate: accData.openingBalanceDate || orig.openingBalanceDate,
      overdraftEnabled: accData.overdraftEnabled !== undefined ? Boolean(accData.overdraftEnabled) : orig.overdraftEnabled,
      archived: accData.archived !== undefined ? Boolean(accData.archived) : orig.archived,
      updatedAt: new Date().toISOString()
    };
    const validation = Validator.validateAccount(updated);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }
    candidate.accounts[idx] = updated;
    syncSettingsInitialBalance(candidate);
    return { success: true, account: updated };
  });
}

export async function archiveAccount(idOrObj) {
  const accId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  const shouldArchive = typeof idOrObj === "object" && idOrObj?.archive !== undefined ? Boolean(idOrObj.archive) : true;
  return await commitMutation((candidate) => {
    const acc = (candidate.accounts || []).find(a => a.id === accId);
    if (!acc) return { success: false, error: "Account not found." };
    acc.archived = shouldArchive;
    acc.updatedAt = new Date().toISOString();
    return { success: true, account: acc };
  });
}

export async function deleteAccount(idOrObj) {
  const accId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  return await commitMutation((candidate) => {
    if (!candidate.accounts || candidate.accounts.length <= 1) {
      return { success: false, error: "Cannot delete the sole remaining account. At least one account must exist." };
    }
    const acc = candidate.accounts.find(a => a.id === accId);
    if (!acc) return { success: false, error: "Account not found." };

    const hasTransactions = (candidate.transactions || []).some(t => t.accountId === accId || t.peerAccountId === accId);
    if (hasTransactions) {
      return { success: false, error: "Cannot delete account with existing transactions. Please archive it or delete its transactions first." };
    }

    candidate.accounts = candidate.accounts.filter(a => a.id !== accId);
    syncSettingsInitialBalance(candidate);
    return { success: true };
  });
}

// ============================================================================
// TRANSACTIONS CRUD (With Overdraft & Transfer Protection)
// ============================================================================
export async function addTransaction(transactionData) {
  return await commitMutation((candidate) => {
    const primaryAcc = resolvePrimaryAccount(candidate.accounts);
    const defaultAccId = primaryAcc?.id || "acc_default_cash";
    const targetAccId = transactionData.accountId || defaultAccId;
    const targetAcc = (candidate.accounts || []).find(a => a.id === targetAccId);
    if (!targetAcc) {
      return { success: false, errors: ["Selected account does not exist."], error: "Selected account does not exist." };
    }
    if (targetAcc.archived) {
      return { success: false, errors: ["Cannot add transaction to an archived account."], error: "Cannot add transaction to an archived account." };
    }

    const txDateAD = transactionData.dateAD || getTodayLocalDateString();
    const bsResult = adToBs(txDateAD);
    const dateBS = bsResult ? bsResult.formatted : "N/A";
    if (!isValidMoneyAmount(transactionData?.amount)) {
      return { success: false, errors: ["Amount must be a positive number with at most 2 decimal places."], error: "Amount must be a positive number with at most 2 decimal places." };
    }
    const numAmount = fromPaisaBigInt(toPaisaBigInt(transactionData.amount));

    const newTx = {
      id: transactionData.id || generateId("tx"),
      type: transactionData.type,
      accountId: targetAccId,
      transferId: null,
      transferDirection: null,
      peerAccountId: null,
      linkedBillId: transactionData.linkedBillId || null,
      linkedRecurringId: transactionData.linkedRecurringId || null,
      amount: numAmount,
      category: transactionData.category,
      description: (transactionData.description || "").trim(),
      dateAD: txDateAD,
      dateBS,
      paymentMethod: transactionData.paymentMethod || candidate.settings?.defaultPaymentMethod || "fonepay",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const validation = Validator.validateTransaction(newTx);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }

    // Overdraft protection on expense
    if (newTx.type === "expense" && !targetAcc.overdraftEnabled) {
      const openDate = targetAcc.openingBalanceDate || "1970-01-01";
      if (newTx.dateAD >= openDate) {
        const currentBal = calculateAccountBalance(candidate, targetAccId);
        if (toPaisaBigInt(currentBal) < toPaisaBigInt(numAmount)) {
          const msg = `Insufficient funds in ${targetAcc.name} (Available: रु ${currentBal.toFixed(2)}). Overdraft is disabled.`;
          return { success: false, errors: [msg], error: msg };
        }
      }
    }

    if (!Array.isArray(candidate.transactions)) candidate.transactions = [];
    candidate.transactions.unshift(newTx);
    return { success: true, transaction: newTx };
  });
}

export async function updateTransaction(txData) {
  return await commitMutation((candidate) => {
    const index = (candidate.transactions || []).findIndex(t => t.id === txData.id);
    if (index === -1) {
      return { success: false, errors: ["Transaction not found."], error: "Transaction not found." };
    }
    const originalTx = candidate.transactions[index];

    // CRITICAL: Transfer-leg editing vulnerability protection!
    if (originalTx.type === "transfer" || originalTx.transferId) {
      return {
        success: false,
        errors: ["Transfer legs cannot be updated via updateTransaction. Use updateTransfer (UPDATE_TRANSFER) to maintain leg integrity."],
        error: "Transfer legs cannot be updated via updateTransaction. Use updateTransfer (UPDATE_TRANSFER) to maintain leg integrity."
      };
    }

    const targetAccId = txData.accountId || originalTx.accountId || candidate.accounts?.[0]?.id;
    const targetAcc = (candidate.accounts || []).find(a => a.id === targetAccId);
    if (!targetAcc) {
      return { success: false, errors: ["Selected account does not exist."], error: "Selected account does not exist." };
    }
    if (targetAcc.archived) {
      return { success: false, errors: ["Cannot move transaction to an archived account."], error: "Cannot move transaction to an archived account." };
    }

    const bsResult = adToBs(txData.dateAD || originalTx.dateAD);
    let numAmount = originalTx.amount;
    if (txData.amount !== undefined) {
      if (!isValidMoneyAmount(txData.amount)) {
        return { success: false, errors: ["Amount must be a positive number with at most 2 decimal places."], error: "Amount must be a positive number with at most 2 decimal places." };
      }
      numAmount = fromPaisaBigInt(toPaisaBigInt(txData.amount));
    }
    const updatedTx = {
      ...originalTx,
      type: txData.type ?? originalTx.type,
      accountId: targetAccId,
      amount: numAmount,
      category: txData.category ?? originalTx.category,
      description: (txData.description !== undefined ? txData.description : originalTx.description).trim(),
      dateAD: txData.dateAD || originalTx.dateAD,
      dateBS: bsResult ? bsResult.formatted : "N/A",
      paymentMethod: txData.paymentMethod || originalTx.paymentMethod,
      updatedAt: new Date().toISOString()
    };

    const validation = Validator.validateTransaction(updatedTx);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }

    candidate.transactions[index] = updatedTx;

    // Synchronize linked bill if present
    const linkedBillId = updatedTx.linkedBillId || originalTx.linkedBillId;
    if (linkedBillId && Array.isArray(candidate.bills)) {
      const bill = candidate.bills.find(b => b.id === linkedBillId || b.linkedTransactionId === updatedTx.id);
      if (bill) {
        bill.amount = updatedTx.amount;
        bill.category = updatedTx.category;
        bill.accountId = updatedTx.accountId;
        bill.paidDateAD = updatedTx.dateAD;
        bill.paidDateBS = updatedTx.dateBS;
        bill.updatedAt = new Date().toISOString();
      }
    }

    // Overdraft re-verification on affected accounts
    const affectedAccounts = new Set([originalTx.accountId, targetAccId]);
    for (const accId of affectedAccounts) {
      const acc = (candidate.accounts || []).find(a => a.id === accId);
      if (acc && !acc.overdraftEnabled) {
        const bal = calculateAccountBalance(candidate, accId);
        if (toPaisaBigInt(bal) < 0n) {
          return {
            success: false,
            errors: [`Editing transaction causes insufficient balance in ${acc.name}. Overdraft is disabled.`],
            error: `Editing transaction causes insufficient balance in ${acc.name}. Overdraft is disabled.`
          };
        }
      }
    }

    return { success: true, transaction: updatedTx };
  });
}

export async function deleteTransaction(txIdOrObj) {
  const txId = typeof txIdOrObj === "string" ? txIdOrObj : txIdOrObj?.id;
  const target = (currentState?.transactions || []).find(t => t.id === txId);
  if (!target) {
    return { success: false, errors: ["Transaction not found."], error: "Transaction not found." };
  }
  if (target.transferId) {
    return await deleteTransfer(target.transferId);
  }

  return await commitMutation((candidate) => {
    candidate.transactions = (candidate.transactions || []).filter(t => t.id !== txId);
    const todayStr = getTodayLocalDateString();
    for (const bill of candidate.bills || []) {
      if (bill.linkedTransactionId === txId || target.linkedBillId === bill.id) {
        bill.linkedTransactionId = null;
        bill.isPaid = false;
        bill.paidDateAD = null;
        bill.paidDateBS = null;
        bill.status = computeBillStatus(bill, todayStr);
        bill.updatedAt = new Date().toISOString();
      }
    }
    return { success: true };
  });
}

// ============================================================================
// TRANSFERS (Atomic Paired Out/In Legs)
// ============================================================================
export async function addTransfer(transferData) {
  return await commitMutation((candidate) => {
    const { fromAccountId, toAccountId, amount, dateAD, description, paymentMethod } = transferData || {};
    if (!fromAccountId || !toAccountId) {
      return { success: false, errors: ["Source and destination accounts are required."], error: "Source and destination accounts are required." };
    }
    if (fromAccountId === toAccountId) {
      return { success: false, errors: ["Source and destination accounts must be different."], error: "Source and destination accounts must be different." };
    }
    const fromAcc = (candidate.accounts || []).find(a => a.id === fromAccountId);
    const toAcc = (candidate.accounts || []).find(a => a.id === toAccountId);
    if (!fromAcc || !toAcc) {
      return { success: false, errors: ["Invalid source or destination account."], error: "Invalid source or destination account." };
    }
    if (fromAcc.archived || toAcc.archived) {
      return { success: false, errors: ["Cannot transfer to or from an archived account."], error: "Cannot transfer to or from an archived account." };
    }
    if (!isValidMoneyAmount(amount)) {
      return { success: false, errors: ["Transfer amount must be a positive number with at most 2 decimal places."], error: "Transfer amount must be a positive number with at most 2 decimal places." };
    }
    const numAmount = fromPaisaBigInt(toPaisaBigInt(amount));
    const sourceBalance = calculateAccountBalance(candidate, fromAccountId);
    if (!fromAcc.overdraftEnabled && toPaisaBigInt(sourceBalance) < toPaisaBigInt(numAmount)) {
      const msg = `Insufficient balance in ${fromAcc.name} (Available: रु ${sourceBalance.toFixed(2)}). Overdraft is disabled.`;
      return { success: false, errors: [msg], error: msg };
    }

    const txDateAD = dateAD || getTodayLocalDateString();
    if (fromAcc.openingBalanceDate && txDateAD < fromAcc.openingBalanceDate) {
      const msg = `Transfer date (${txDateAD}) cannot be earlier than source account opening balance date (${fromAcc.openingBalanceDate}).`;
      return { success: false, errors: [msg], error: msg };
    }
    if (toAcc.openingBalanceDate && txDateAD < toAcc.openingBalanceDate) {
      const msg = `Transfer date (${txDateAD}) cannot be earlier than destination account opening balance date (${toAcc.openingBalanceDate}).`;
      return { success: false, errors: [msg], error: msg };
    }
    const bsResult = adToBs(txDateAD);
    const dateBS = bsResult ? bsResult.formatted : "N/A";
    const transferId = generateId("tr");
    const nowIso = new Date().toISOString();
    const cleanDesc = (description || `Transfer: ${fromAcc.name} → ${toAcc.name}`).trim();
    const method = paymentMethod || "bank_transfer";

    const outLeg = {
      id: generateId("tx"),
      type: "transfer",
      accountId: fromAccountId,
      peerAccountId: toAccountId,
      transferId,
      transferDirection: "out",
      amount: numAmount,
      category: "transfer",
      description: cleanDesc,
      dateAD: txDateAD,
      dateBS,
      paymentMethod: method,
      linkedBillId: null,
      linkedRecurringId: null,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const inLeg = {
      id: generateId("tx"),
      type: "transfer",
      accountId: toAccountId,
      peerAccountId: fromAccountId,
      transferId,
      transferDirection: "in",
      amount: numAmount,
      category: "transfer",
      description: cleanDesc,
      dateAD: txDateAD,
      dateBS,
      paymentMethod: method,
      linkedBillId: null,
      linkedRecurringId: null,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const vOut = Validator.validateTransferLeg(outLeg);
    const vIn = Validator.validateTransferLeg(inLeg);
    if (!vOut.isValid || !vIn.isValid) {
      const errs = [...(vOut.errors || []), ...(vIn.errors || [])];
      return { success: false, errors: errs, error: errs.join("; ") };
    }

    if (!Array.isArray(candidate.transactions)) candidate.transactions = [];
    candidate.transactions.unshift(inLeg, outLeg);
    return { success: true, transferId, outLeg, inLeg };
  });
}

export async function updateTransfer(transferData) {
  return await commitMutation((candidate) => {
    const { transferId, fromAccountId, toAccountId, amount, dateAD, description, paymentMethod } = transferData || {};
    const legs = (candidate.transactions || []).filter(t => t.transferId === transferId);
    if (legs.length !== 2) {
      return { success: false, error: "Transfer not found." };
    }
    const outIdx = candidate.transactions.findIndex(t => t.transferId === transferId && t.transferDirection === "out");
    const inIdx = candidate.transactions.findIndex(t => t.transferId === transferId && t.transferDirection === "in");

    const oldFrom = candidate.transactions[outIdx].accountId;
    const oldTo = candidate.transactions[inIdx].accountId;

    const newFrom = fromAccountId || oldFrom;
    const newTo = toAccountId || oldTo;
    if (newFrom === newTo) {
      return { success: false, error: "Source and destination accounts must be different." };
    }

    const fromAcc = (candidate.accounts || []).find(a => a.id === newFrom);
    const toAcc = (candidate.accounts || []).find(a => a.id === newTo);
    if (!fromAcc || !toAcc) {
      return { success: false, error: "Invalid source or destination account." };
    }
    if (fromAcc.archived || toAcc.archived) {
      return { success: false, error: "Cannot transfer to or from an archived account." };
    }

    let numAmount = candidate.transactions[outIdx].amount;
    if (amount !== undefined) {
      if (!isValidMoneyAmount(amount)) {
        return { success: false, error: "Transfer amount must be a positive number with at most 2 decimal places." };
      }
      numAmount = fromPaisaBigInt(toPaisaBigInt(amount));
    }

    const newDateAD = dateAD || candidate.transactions[outIdx].dateAD;
    if (fromAcc.openingBalanceDate && newDateAD < fromAcc.openingBalanceDate) {
      return { success: false, error: `Transfer date (${newDateAD}) cannot be earlier than source account opening balance date (${fromAcc.openingBalanceDate}).` };
    }
    if (toAcc.openingBalanceDate && newDateAD < toAcc.openingBalanceDate) {
      return { success: false, error: `Transfer date (${newDateAD}) cannot be earlier than destination account opening balance date (${toAcc.openingBalanceDate}).` };
    }
    const bsRes = adToBs(newDateAD);
    const newDateBS = bsRes ? bsRes.formatted : "N/A";
    const newDesc = (description ?? candidate.transactions[outIdx].description).trim();
    const newMethod = paymentMethod || candidate.transactions[outIdx].paymentMethod;

    const updatedOut = {
      ...candidate.transactions[outIdx],
      accountId: newFrom,
      peerAccountId: newTo,
      amount: numAmount,
      dateAD: newDateAD,
      dateBS: newDateBS,
      description: newDesc,
      paymentMethod: newMethod,
      updatedAt: new Date().toISOString()
    };

    const updatedIn = {
      ...candidate.transactions[inIdx],
      accountId: newTo,
      peerAccountId: newFrom,
      amount: numAmount,
      dateAD: newDateAD,
      dateBS: newDateBS,
      description: newDesc,
      paymentMethod: newMethod,
      updatedAt: new Date().toISOString()
    };

    const outVal = Validator.validateTransferLeg(updatedOut);
    if (!outVal.isValid) {
      return { success: false, errors: outVal.errors, error: outVal.errors.join("; ") };
    }
    const inVal = Validator.validateTransferLeg(updatedIn);
    if (!inVal.isValid) {
      return { success: false, errors: inVal.errors, error: inVal.errors.join("; ") };
    }

    candidate.transactions[outIdx] = updatedOut;
    candidate.transactions[inIdx] = updatedIn;

    const affectedAccIds = new Set([oldFrom, oldTo, newFrom, newTo]);
    for (const accId of affectedAccIds) {
      const acc = (candidate.accounts || []).find(a => a.id === accId);
      if (acc && !acc.overdraftEnabled) {
        const bal = calculateAccountBalance(candidate, accId);
        if (bal < 0) {
          return {
            success: false,
            error: `Insufficient funds in ${acc.name} for updated transfer (रु ${bal.toFixed(2)}). Overdraft is disabled.`
          };
        }
      }
    }

    return { success: true, transferId, outLeg: updatedOut, inLeg: updatedIn };
  });
}

export async function deleteTransfer(transferId) {
  return await commitMutation((candidate) => {
    const legs = (candidate.transactions || []).filter(t => t.transferId === transferId);
    if (legs.length === 0) {
      return { success: false, error: "Transfer not found." };
    }
    candidate.transactions = candidate.transactions.filter(t => t.transferId !== transferId);
    return { success: true };
  });
}

// ============================================================================
// RECURRING TRANSACTIONS ENGINE (Atomic + Catch-Up Backlog Support)
// ============================================================================
export function computeNextOccurrence(schedule, fromDateAD) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) return null;
  if (!fromDateAD || typeof fromDateAD !== "string" || !isValidAdDate(fromDateAD)) return null;

  // fromDateAD must be within supported calendar range (BS 2070 - BS 2090)
  if (!adToBs(fromDateAD)) return null;

  // Frequency is mandatory - never silently default
  const freq = schedule.frequency || schedule.freq;
  const allowedFreq = ["daily", "weekly", "monthly", "yearly"];
  if (!freq || typeof freq !== "string" || !allowedFreq.includes(freq)) return null;

  // Positive safe-integer interval
  const rawInterval = schedule.interval;
  if (rawInterval !== undefined && rawInterval !== null) {
    if (typeof rawInterval !== "number" || !Number.isInteger(rawInterval) || rawInterval < 1 || !Number.isSafeInteger(rawInterval) || isNaN(rawInterval) || !isFinite(rawInterval)) {
      return null;
    }
  }
  const interval = (rawInterval === undefined || rawInterval === null) ? 1 : Number(rawInterval);
  if (!Number.isInteger(interval) || interval < 1 || !Number.isSafeInteger(interval) || isNaN(interval) || !isFinite(interval)) {
    return null;
  }

  // Start date validation - required schedule boundary
  if (!schedule.startDate || typeof schedule.startDate !== "string" || !isValidAdDate(schedule.startDate) || !adToBs(schedule.startDate)) {
    return null;
  }

  // Next occurrence / reference date cannot be before schedule startDate
  if (fromDateAD < schedule.startDate) {
    return null;
  }

  // End date validation (when supplied)
  if (schedule.endDate !== undefined && schedule.endDate !== null && schedule.endDate !== "") {
    if (typeof schedule.endDate !== "string" || !isValidAdDate(schedule.endDate) || !adToBs(schedule.endDate)) {
      return null;
    }
    if (schedule.endDate < schedule.startDate) {
      return null;
    }
    if (fromDateAD > schedule.endDate) {
      return null;
    }
  }

  // Day of month validation (when supplied)
  if (schedule.dayOfMonth !== undefined && schedule.dayOfMonth !== null) {
    const dom = schedule.dayOfMonth;
    if (typeof dom !== "number" || !Number.isInteger(dom) || dom < 1 || dom > 31) {
      return null;
    }
  }

  // Yearly month validation (when supplied)
  if (schedule.month !== undefined && schedule.month !== null) {
    const m = schedule.month;
    if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 12) {
      return null;
    }
  }

  const [y, m, d] = fromDateAD.split("-").map(Number);

  let nextY = y;
  let nextM = m;
  let nextD = d;

  if (freq === "daily") {
    const dt = new Date(Date.UTC(y, m - 1, d + interval));
    nextY = dt.getUTCFullYear();
    nextM = dt.getUTCMonth() + 1;
    nextD = dt.getUTCDate();
  } else if (freq === "weekly") {
    const dt = new Date(Date.UTC(y, m - 1, d + interval * 7));
    nextY = dt.getUTCFullYear();
    nextM = dt.getUTCMonth() + 1;
    nextD = dt.getUTCDate();
  } else if (freq === "monthly") {
    // Preserve intended day of month (e.g. day 31):
    // Prioritize explicit schedule.dayOfMonth, then schedule.startDate's day, then fromDateAD's day.
    const targetDom = (schedule.dayOfMonth !== undefined && schedule.dayOfMonth !== null)
      ? Number(schedule.dayOfMonth)
      : (schedule.startDate ? Number(schedule.startDate.split("-")[2]) : d);

    const totalMonths = (y * 12 + (m - 1)) + interval;
    nextY = Math.floor(totalMonths / 12);
    nextM = (totalMonths % 12) + 1;
    const daysInTargetMonth = new Date(Date.UTC(nextY, nextM, 0)).getUTCDate();
    nextD = Math.min(targetDom, daysInTargetMonth);
  } else if (freq === "yearly") {
    const targetDom = (schedule.dayOfMonth !== undefined && schedule.dayOfMonth !== null)
      ? Number(schedule.dayOfMonth)
      : (schedule.startDate ? Number(schedule.startDate.split("-")[2]) : d);

    const targetMonth = (schedule.month !== undefined && schedule.month !== null)
      ? Number(schedule.month)
      : (schedule.startDate ? Number(schedule.startDate.split("-")[1]) : m);

    nextY = y + interval;
    nextM = targetMonth;
    const daysInTargetMonth = new Date(Date.UTC(nextY, nextM, 0)).getUTCDate();
    nextD = Math.min(targetDom, daysInTargetMonth);
  }

  const nextStr = `${nextY}-${String(nextM).padStart(2, "0")}-${String(nextD).padStart(2, "0")}`;
  if (!isValidAdDate(nextStr)) return null;

  if (schedule.endDate && nextStr > schedule.endDate) {
    return null;
  }

  // Prevent dates from exceeding supported Bikram Sambat calendar range (BS 2070 - BS 2090)
  const bsCheck = adToBs(nextStr);
  if (!bsCheck) {
    return null;
  }

  return nextStr;
}

export function getMissedOccurrences(rule, asOfDateAD = null, maxCount = 36) {
  if (!rule || rule.paused || rule.isPaused || !rule.nextOccurrence) return [];
  const cutoff = asOfDateAD || getTodayLocalDateString();
  const due = [];
  let cursor = rule.nextOccurrence;
  const skipped = new Set(rule.skippedDates || []);

  while (cursor && cursor <= cutoff && due.length < maxCount) {
    if (!skipped.has(cursor)) {
      due.push(cursor);
    }
    cursor = computeNextOccurrence(rule.schedule, cursor);
  }
  return due;
}

export async function addRecurringRule(ruleData) {
  return await commitMutation((candidate) => {
    const primaryAcc = resolvePrimaryAccount(candidate.accounts);
    const defaultAccId = primaryAcc?.id || "acc_default_cash";
    const targetAccountId = ruleData.accountId || defaultAccId;
    const targetAcc = (candidate.accounts || []).find(a => a.id === targetAccountId);
    if (!targetAcc || targetAcc.archived) {
      return { success: false, errors: ["Cannot assign recurring rule to an unavailable or archived account."], error: "Cannot assign recurring rule to an unavailable or archived account." };
    }

    const schedule = {
      frequency: ruleData.schedule?.frequency || ruleData.schedule?.freq || "monthly",
      interval: Number(ruleData.schedule?.interval || 1),
      dayOfMonth: ruleData.schedule?.dayOfMonth !== undefined
        ? Number(ruleData.schedule.dayOfMonth)
        : Number((ruleData.schedule?.startDate || getTodayLocalDateString()).split("-")[2]),
      startDate: ruleData.schedule?.startDate || getTodayLocalDateString(),
      endDate: ruleData.schedule?.endDate || null
    };

    if (!isValidMoneyAmount(ruleData?.amount)) {
      return { success: false, errors: ["Recurring amount must be a positive number with at most 2 decimal places."], error: "Recurring amount must be a positive number with at most 2 decimal places." };
    }
    const numAmount = fromPaisaBigInt(toPaisaBigInt(ruleData.amount));

    if (ruleData.paused !== undefined && typeof ruleData.paused !== "boolean") {
      return { success: false, errors: ["Recurring rule field 'paused' must be a strict boolean (true/false)."], error: "Recurring rule field 'paused' must be a strict boolean (true/false)." };
    }
    if (ruleData.isPaused !== undefined && typeof ruleData.isPaused !== "boolean") {
      return { success: false, errors: ["Recurring rule field 'isPaused' must be a strict boolean (true/false)."], error: "Recurring rule field 'isPaused' must be a strict boolean (true/false)." };
    }
    if (ruleData.paused !== undefined && ruleData.isPaused !== undefined && ruleData.paused !== ruleData.isPaused) {
      return { success: false, errors: ["Recurring rule fields 'paused' and 'isPaused' must not contradict each other."], error: "Recurring rule fields 'paused' and 'isPaused' must not contradict each other." };
    }
    const rulePaused = (typeof ruleData.paused === "boolean") ? ruleData.paused : ((typeof ruleData.isPaused === "boolean") ? ruleData.isPaused : false);

    const newRule = {
      id: ruleData.id || generateId("rr"),
      title: (ruleData.title || ruleData.description || "").trim(),
      description: (ruleData.description || ruleData.title || "").trim(),
      type: ruleData.type || "expense",
      accountId: targetAccountId,
      amount: numAmount,
      category: ruleData.category || (ruleData.type === "income" ? "salary" : "utilities"),
      paymentMethod: ruleData.paymentMethod || candidate.settings?.defaultPaymentMethod || "fonepay",
      schedule,
      nextOccurrence: ruleData.nextOccurrence !== undefined ? ruleData.nextOccurrence : schedule.startDate,
      paused: rulePaused,
      isPaused: rulePaused,
      skippedDates: Array.isArray(ruleData.skippedDates) ? [...ruleData.skippedDates] : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const validation = Validator.validateRecurringRule(newRule);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }

    if (!Array.isArray(candidate.recurringRules)) candidate.recurringRules = [];
    candidate.recurringRules.push(newRule);
    return { success: true, rule: newRule };
  });
}

export async function updateRecurringRule(idOrPayload, maybeData) {
  const ruleId = typeof idOrPayload === "string" ? idOrPayload : idOrPayload?.id;
  const data = typeof idOrPayload === "string" ? (maybeData || {}) : (idOrPayload?.data || idOrPayload || {});
  return await commitMutation((candidate) => {
    const idx = (candidate.recurringRules || []).findIndex(r => r.id === ruleId);
    if (idx === -1) return { success: false, errors: ["Recurring rule not found."], error: "Recurring rule not found." };

    const orig = candidate.recurringRules[idx];
    const targetAccountId = data.accountId || orig.accountId;
    const targetAcc = (candidate.accounts || []).find(a => a.id === targetAccountId);
    if (!targetAcc) {
      return { success: false, errors: ["Target account does not exist."], error: "Target account does not exist." };
    }
    if (targetAcc.archived) {
      return { success: false, errors: ["Cannot assign recurring rule to an archived account."], error: "Cannot assign recurring rule to an archived account." };
    }

    const mergedSchedule = data.schedule ? {
      ...orig.schedule,
      ...data.schedule,
      frequency: data.schedule.frequency || data.schedule.freq || orig.schedule.frequency
    } : orig.schedule;

    const preservedSkipped = Array.isArray(data.skippedDates)
      ? Array.from(new Set([...(orig.skippedDates || []), ...data.skippedDates]))
      : [...(orig.skippedDates || [])];

    let nextOccurrence = data.nextOccurrence !== undefined ? data.nextOccurrence : orig.nextOccurrence;

    const postedDates = new Set(
      (candidate.transactions || [])
        .filter(t => t.linkedRecurringId === orig.id)
        .map(t => t.dateAD)
    );

    while (nextOccurrence && postedDates.has(nextOccurrence)) {
      const next = computeNextOccurrence(mergedSchedule, nextOccurrence);
      if (!next || next <= nextOccurrence) {
        nextOccurrence = null;
        break;
      }
      nextOccurrence = next;
    }

    let ruleAmount = orig.amount;
    if (data.amount !== undefined) {
      if (!isValidMoneyAmount(data.amount)) {
        return { success: false, errors: ["Recurring amount must be a positive number with at most 2 decimal places."], error: "Recurring amount must be a positive number with at most 2 decimal places." };
      }
      ruleAmount = fromPaisaBigInt(toPaisaBigInt(data.amount));
    }

    if (data.paused !== undefined && typeof data.paused !== "boolean") {
      return { success: false, errors: ["Recurring rule field 'paused' must be a strict boolean (true/false)."], error: "Recurring rule field 'paused' must be a strict boolean (true/false)." };
    }
    if (data.isPaused !== undefined && typeof data.isPaused !== "boolean") {
      return { success: false, errors: ["Recurring rule field 'isPaused' must be a strict boolean (true/false)."], error: "Recurring rule field 'isPaused' must be a strict boolean (true/false)." };
    }
    if (data.paused !== undefined && data.isPaused !== undefined && data.paused !== data.isPaused) {
      return { success: false, errors: ["Recurring rule fields 'paused' and 'isPaused' must not contradict each other."], error: "Recurring rule fields 'paused' and 'isPaused' must not contradict each other." };
    }
    let nextRulePaused = orig.paused;
    if (typeof data.paused === "boolean") {
      nextRulePaused = data.paused;
    } else if (typeof data.isPaused === "boolean") {
      nextRulePaused = data.isPaused;
    }

    const updated = {
      ...orig,
      ...data,
      id: orig.id,
      accountId: targetAccountId,
      title: (data.title ?? orig.title).trim(),
      description: (data.description ?? data.title ?? orig.description).trim(),
      amount: ruleAmount,
      schedule: mergedSchedule,
      skippedDates: preservedSkipped,
      nextOccurrence,
      paused: nextRulePaused,
      isPaused: nextRulePaused,
      updatedAt: new Date().toISOString()
    };

    const validation = Validator.validateRecurringRule(updated);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }

    candidate.recurringRules[idx] = updated;
    return { success: true, rule: updated };
  });
}

export async function deleteRecurringRule(idOrObj) {
  const ruleId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  return await commitMutation((candidate) => {
    candidate.recurringRules = (candidate.recurringRules || []).filter(r => r.id !== ruleId);
    return { success: true };
  });
}

export async function togglePauseRecurringRule(idOrObj) {
  const ruleId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  const targetRule = (currentState?.recurringRules || []).find(r => r.id === ruleId);
  if (!targetRule) return { success: false, error: "Recurring rule not found." };
  let nextPaused;
  if (typeof idOrObj === "object") {
    if (idOrObj?.paused !== undefined && typeof idOrObj.paused !== "boolean") {
      return { success: false, error: "Recurring rule field 'paused' must be a strict boolean (true/false)." };
    }
    if (idOrObj?.isPaused !== undefined && typeof idOrObj.isPaused !== "boolean") {
      return { success: false, error: "Recurring rule field 'isPaused' must be a strict boolean (true/false)." };
    }
    if (idOrObj?.paused !== undefined && idOrObj?.isPaused !== undefined && idOrObj.paused !== idOrObj.isPaused) {
      return { success: false, error: "Recurring rule fields 'paused' and 'isPaused' must not contradict each other." };
    }
    if (typeof idOrObj?.paused === "boolean") {
      nextPaused = idOrObj.paused;
    } else if (typeof idOrObj?.isPaused === "boolean") {
      nextPaused = idOrObj.isPaused;
    } else {
      nextPaused = !targetRule.paused;
    }
  } else {
    nextPaused = !targetRule.paused;
  }
  return await updateRecurringRule(ruleId, { paused: nextPaused, isPaused: nextPaused });
}

export async function skipRecurringOccurrence(idOrObj) {
  const ruleId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  return await commitMutation((candidate) => {
    const rule = (candidate.recurringRules || []).find(r => r.id === ruleId);
    if (!rule || !rule.nextOccurrence) {
      return { success: false, error: "No upcoming occurrence to skip." };
    }
    const skippedDate = rule.nextOccurrence;
    if (!rule.skippedDates) rule.skippedDates = [];
    if (!rule.skippedDates.includes(skippedDate)) {
      rule.skippedDates.push(skippedDate);
    }
    rule.nextOccurrence = computeNextOccurrence(rule.schedule, skippedDate);
    rule.updatedAt = new Date().toISOString();
    return { success: true, skippedDate, nextOccurrence: rule.nextOccurrence };
  });
}

export async function processRecurringOccurrence(idOrObj) {
  const ruleId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  return await commitMutation((candidate) => {
    const rule = (candidate.recurringRules || []).find(r => r.id === ruleId);
    if (!rule) return { success: false, error: "Recurring rule not found." };
    if (rule.paused || rule.isPaused) return { success: false, error: "Cannot process a paused recurring rule." };
    if (!rule.nextOccurrence) return { success: false, error: "Recurring rule has no further occurrences." };

    const occDate = (typeof idOrObj === "object" && idOrObj?.dateAD) ? idOrObj.dateAD : rule.nextOccurrence;

    const duplicate = (candidate.transactions || []).some(
      t => t.linkedRecurringId === rule.id && t.dateAD === occDate
    );
    if (duplicate) {
      return { success: false, error: `Occurrence for ${occDate} has already been posted.` };
    }

    const targetAcc = (candidate.accounts || []).find(a => a.id === rule.accountId);
    if (!targetAcc || targetAcc.archived) {
      return { success: false, error: "Assigned account is unavailable or archived." };
    }

    if (rule.type === "expense" && !targetAcc.overdraftEnabled) {
      const openDate = targetAcc.openingBalanceDate || "1970-01-01";
      if (occDate >= openDate) {
        const bal = calculateAccountBalance(candidate, rule.accountId);
        if (toPaisaBigInt(bal) < toPaisaBigInt(rule.amount)) {
          return {
            success: false,
            error: `Insufficient funds in ${targetAcc.name} to process recurring expense. Overdraft is disabled.`
          };
        }
      }
    }

    const bsRes = adToBs(occDate);
    const ruleAmt = fromPaisaBigInt(toPaisaBigInt(rule.amount));
    const newTx = {
      id: generateId("tx"),
      type: rule.type,
      accountId: rule.accountId,
      transferId: null,
      transferDirection: null,
      peerAccountId: null,
      linkedBillId: null,
      linkedRecurringId: rule.id,
      amount: ruleAmt,
      category: rule.category,
      description: `${rule.title} (Recurring)`,
      dateAD: occDate,
      dateBS: bsRes ? bsRes.formatted : "N/A",
      paymentMethod: rule.paymentMethod,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!Array.isArray(candidate.transactions)) candidate.transactions = [];
    candidate.transactions.unshift(newTx);
    rule.lastRunDate = occDate;
    rule.nextOccurrence = computeNextOccurrence(rule.schedule, occDate);
    rule.updatedAt = new Date().toISOString();

    return { success: true, transaction: newTx, nextOccurrence: rule.nextOccurrence };
  });
}

// ============================================================================
// BILLS & ATOMIC PAYMENT TRACKING ENGINE
// ============================================================================
export function computeBillStatus(bill, todayAD = null) {
  if (!bill) return "upcoming";
  const txList = currentState?.transactions || [];
  if (bill.status === "paid" && bill.linkedTransactionId) {
    const linkedExists = txList.some(t => t.id === bill.linkedTransactionId);
    if (linkedExists) return "paid";
  }
  const today = todayAD || getTodayLocalDateString();
  if (bill.dueDateAD < today) {
    return "overdue";
  }
  const [tY, tM, tD] = today.split("-").map(Number);
  const [dY, dM, dD] = bill.dueDateAD.split("-").map(Number);
  const diffDays = Math.round((Date.UTC(dY, dM - 1, dD) - Date.UTC(tY, tM - 1, tD)) / 86400000);
  if (diffDays <= 7) {
    return "dueSoon";
  }
  return "upcoming";
}

export async function addBill(billData) {
  return await commitMutation((candidate) => {
    const primaryAcc = resolvePrimaryAccount(candidate.accounts);
    const defaultAccId = primaryAcc?.id || "acc_default_cash";
    const targetAccountId = billData.accountId || defaultAccId;
    const targetAcc = (candidate.accounts || []).find(a => a.id === targetAccountId);
    if (!targetAcc || targetAcc.archived) {
      return { success: false, errors: ["Cannot assign bill to an unavailable or archived account."], error: "Cannot assign bill to an unavailable or archived account." };
    }

    if (!isValidMoneyAmount(billData?.amount)) {
      return { success: false, errors: ["Bill amount must be a positive number with at most 2 decimal places."], error: "Bill amount must be a positive number with at most 2 decimal places." };
    }
    const numAmount = fromPaisaBigInt(toPaisaBigInt(billData.amount));

    const bsRes = adToBs(billData.dueDateAD);
    const newBill = {
      id: billData.id || generateId("bill"),
      seriesId: billData.seriesId || (billData.recurrence ? generateId("bseries") : null),
      title: (billData.title || "").trim(),
      amount: numAmount,
      category: billData.category || "utilities",
      accountId: targetAccountId,
      dueDateAD: billData.dueDateAD,
      dueDateBS: bsRes ? bsRes.formatted : "N/A",
      recurrence: billData.recurrence || null,
      status: "upcoming",
      isPaid: false,
      linkedTransactionId: null,
      notes: (billData.notes || "").trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    newBill.status = computeBillStatus(newBill);

    const validation = Validator.validateBill(newBill);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }

    if (!Array.isArray(candidate.bills)) candidate.bills = [];
    candidate.bills.push(newBill);
    return { success: true, bill: newBill };
  });
}

export async function updateBill(idOrPayload, maybeData) {
  const billId = typeof idOrPayload === "string" ? idOrPayload : idOrPayload?.id;
  const data = typeof idOrPayload === "string" ? (maybeData || {}) : (idOrPayload?.data || idOrPayload || {});
  return await commitMutation((candidate) => {
    const idx = (candidate.bills || []).findIndex(b => b.id === billId);
    if (idx === -1) return { success: false, error: "Bill not found." };

    const orig = candidate.bills[idx];
    const targetAccountId = data.accountId || orig.accountId;
    const targetAcc = (candidate.accounts || []).find(a => a.id === targetAccountId);
    if (!targetAcc) {
      return { success: false, errors: ["Target account does not exist."], error: "Target account does not exist." };
    }
    if (targetAcc.archived) {
      return { success: false, errors: ["Cannot assign bill to an archived account."], error: "Cannot assign bill to an archived account." };
    }

    const dueDateAD = data.dueDateAD || orig.dueDateAD;
    const bsRes = adToBs(dueDateAD);

    let billAmount = orig.amount;
    if (data.amount !== undefined) {
      if (!isValidMoneyAmount(data.amount)) {
        return { success: false, errors: ["Bill amount must be a positive number with at most 2 decimal places."], error: "Bill amount must be a positive number with at most 2 decimal places." };
      }
      billAmount = fromPaisaBigInt(toPaisaBigInt(data.amount));
    }

    const updated = {
      ...orig,
      ...data,
      id: orig.id,
      accountId: targetAccountId,
      title: (data.title ?? orig.title).trim(),
      amount: billAmount,
      category: data.category || orig.category,
      dueDateAD,
      dueDateBS: bsRes ? bsRes.formatted : orig.dueDateBS,
      isPaid: typeof data.isPaid === "boolean" ? data.isPaid : (typeof orig.isPaid === "boolean" ? orig.isPaid : false),
      updatedAt: new Date().toISOString()
    };
    updated.status = computeBillStatus(updated);

    const validation = Validator.validateBill(updated);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }

    // Synchronize linked transaction if bill was already paid
    if (orig.linkedTransactionId) {
      const txIdx = (candidate.transactions || []).findIndex(t => t.id === orig.linkedTransactionId);
      if (txIdx !== -1) {
        const origTx = candidate.transactions[txIdx];
        candidate.transactions[txIdx] = {
          ...origTx,
          amount: updated.amount,
          category: updated.category,
          accountId: updated.accountId,
          description: `Bill Payment: ${updated.title}`,
          updatedAt: new Date().toISOString()
        };

        if (!targetAcc.overdraftEnabled) {
          const bal = calculateAccountBalance(candidate, targetAccountId);
          if (bal < 0) {
            return {
              success: false,
              error: `Updating bill causes insufficient balance in ${targetAcc.name}. Overdraft is disabled.`
            };
          }
        }
      }
    }

    candidate.bills[idx] = updated;
    return { success: true, bill: updated };
  });
}

export async function deleteBill(idOrObj) {
  const billId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  return await commitMutation((candidate) => {
    candidate.bills = (candidate.bills || []).filter(b => b.id !== billId);
    for (const tx of candidate.transactions || []) {
      if (tx.linkedBillId === billId) {
        tx.linkedBillId = null;
        tx.updatedAt = new Date().toISOString();
      }
    }
    return { success: true };
  });
}

export async function payBill(idOrPayload) {
  const billId = typeof idOrPayload === "string" ? idOrPayload : idOrPayload?.id || idOrPayload?.billId;
  const paymentDateAD = (typeof idOrPayload === "object" && idOrPayload?.dateAD) ? idOrPayload.dateAD : getTodayLocalDateString();
  return await commitMutation((candidate) => {
    const bill = (candidate.bills || []).find(b => b.id === billId);
    if (!bill) return { success: false, error: "Bill not found." };

    if (bill.status === "paid" && bill.linkedTransactionId && (candidate.transactions || []).some(t => t.id === bill.linkedTransactionId)) {
      return { success: false, error: "Bill is already paid." };
    }

    const targetAcc = (candidate.accounts || []).find(a => a.id === bill.accountId);
    if (!targetAcc || targetAcc.archived) {
      return { success: false, error: "Bill payment account is unavailable or archived." };
    }
    if (!targetAcc.overdraftEnabled) {
      const currentBal = calculateAccountBalance(candidate, bill.accountId);
      if (paymentDateAD >= (targetAcc.openingBalanceDate || "1970-01-01") && toPaisaBigInt(currentBal) < toPaisaBigInt(bill.amount)) {
        return {
          success: false,
          error: `Insufficient funds in ${targetAcc.name} (Available: रु ${currentBal.toFixed(2)}) to pay bill. Overdraft is disabled.`
        };
      }
    }

    const bsResult = adToBs(paymentDateAD);
    const billAmt = fromPaisaBigInt(toPaisaBigInt(bill.amount));
    const newTx = {
      id: generateId("tx"),
      type: "expense",
      accountId: bill.accountId,
      transferId: null,
      transferDirection: null,
      peerAccountId: null,
      linkedBillId: bill.id,
      linkedRecurringId: null,
      amount: billAmt,
      category: bill.category,
      description: `Bill Payment: ${bill.title}`,
      dateAD: paymentDateAD,
      dateBS: bsResult ? bsResult.formatted : "N/A",
      paymentMethod: targetAcc.type === "cash" ? "cash" : "bank_transfer",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!Array.isArray(candidate.transactions)) candidate.transactions = [];
    candidate.transactions.unshift(newTx);
    bill.status = "paid";
    bill.isPaid = true;
    bill.paidDateAD = paymentDateAD;
    bill.paidDateBS = bsResult ? bsResult.formatted : null;
    bill.linkedTransactionId = newTx.id;
    bill.updatedAt = new Date().toISOString();

    let nextBill = null;
    if (bill.recurrence && (bill.recurrence.frequency || bill.recurrence.freq)) {
      const recSchedule = {
        frequency: bill.recurrence.frequency || bill.recurrence.freq,
        interval: Number(bill.recurrence.interval || 1),
        dayOfMonth: bill.recurrence.dayOfMonth || Number(bill.dueDateAD.split("-")[2]),
        startDate: bill.recurrence.startDate || bill.dueDateAD,
        endDate: bill.recurrence.endDate || null
      };
      const nextDue = computeNextOccurrence(recSchedule, bill.dueDateAD);
      if (nextDue) {
        const sId = bill.seriesId || generateId("bseries");
        bill.seriesId = sId;
        const alreadyExists = (candidate.bills || []).some(
          b => b.seriesId === sId && b.dueDateAD === nextDue
        );
        if (!alreadyExists) {
          const nextBs = adToBs(nextDue);
          nextBill = {
            id: generateId("bill"),
            seriesId: sId,
            title: bill.title,
            amount: billAmt,
            category: bill.category,
            accountId: bill.accountId,
            dueDateAD: nextDue,
            dueDateBS: nextBs ? nextBs.formatted : "N/A",
            recurrence: { ...bill.recurrence },
            status: "upcoming",
            isPaid: false,
            linkedTransactionId: null,
            notes: bill.notes || "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          nextBill.status = computeBillStatus(nextBill);
          candidate.bills.push(nextBill);
        }
      }
    }

    return { success: true, bill, transaction: newTx, nextBill };
  });
}

// ============================================================================
// BUDGETS & GOALS
// ============================================================================
export async function setBudget(budgetData) {
  return await commitMutation((candidate) => {
    const validation = Validator.validateBudget(budgetData, candidate.budgets);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }
    const parsedAmount = fromPaisaBigInt(toPaisaBigInt(budgetData.amount));
    if (!Array.isArray(candidate.budgets)) candidate.budgets = [];
    const existingIdx = candidate.budgets.findIndex(
      b => b.id === budgetData.id || (b.period === budgetData.period && b.category === budgetData.category)
    );
    if (existingIdx !== -1) {
      candidate.budgets[existingIdx] = {
        ...candidate.budgets[existingIdx],
        amount: parsedAmount,
        updatedAt: new Date().toISOString()
      };
    } else {
      candidate.budgets.push({
        id: budgetData.id || generateId("bg"),
        period: budgetData.period,
        category: budgetData.category,
        amount: parsedAmount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    return { success: true };
  });
}

export async function deleteBudget(budgetId) {
  return await commitMutation((candidate) => {
    candidate.budgets = (candidate.budgets || []).filter(b => b.id !== budgetId);
    return { success: true };
  });
}

export async function addGoal(goalData) {
  return await commitMutation((candidate) => {
    let dateBS = "";
    if (goalData?.targetDateAD) {
      const bsRes = adToBs(goalData.targetDateAD);
      dateBS = bsRes ? bsRes.formatted : "";
    }
    if (!isValidMoneyAmount(goalData?.targetAmount)) {
      return { success: false, errors: ["Target amount must be a positive number with at most 2 decimal places."], error: "Target amount must be a positive number with at most 2 decimal places." };
    }
    const targetAmount = fromPaisaBigInt(toPaisaBigInt(goalData.targetAmount));
    const newGoal = {
      id: goalData?.id || generateId("gl"),
      title: (goalData?.title || "").trim(),
      description: (goalData?.description || "").trim(),
      targetAmount,
      targetDateAD: goalData?.targetDateAD || "",
      targetDateBS: dateBS,
      category: goalData?.category || "General",
      allocations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const validation = Validator.validateGoal(newGoal);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }
    if (!Array.isArray(candidate.goals)) candidate.goals = [];
    candidate.goals.push(newGoal);
    return { success: true, goal: newGoal };
  });
}

export async function updateGoal(goalIdOrObj, maybeGoalData) {
  const goalId = typeof goalIdOrObj === "string" ? goalIdOrObj : goalIdOrObj?.id;
  const goalData = typeof goalIdOrObj === "string" ? maybeGoalData : goalIdOrObj;
  return await commitMutation((candidate) => {
    const index = (candidate.goals || []).findIndex(g => g.id === goalId);
    if (index === -1) {
      return { success: false, errors: ["Goal not found."], error: "Goal not found." };
    }
    const originalGoal = candidate.goals[index];
    let targetAmount = originalGoal.targetAmount;
    if (goalData.targetAmount !== undefined) {
      if (!isValidMoneyAmount(goalData.targetAmount)) {
        return { success: false, errors: ["Target amount must be a positive number with at most 2 decimal places."], error: "Target amount must be a positive number with at most 2 decimal places." };
      }
      targetAmount = fromPaisaBigInt(toPaisaBigInt(goalData.targetAmount));
    }
    const validation = Validator.validateGoal({ ...originalGoal, ...goalData, targetAmount });
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }
    let dateBS = "";
    if (goalData.targetDateAD) {
      const bsRes = adToBs(goalData.targetDateAD);
      dateBS = bsRes ? bsRes.formatted : "";
    }
    candidate.goals[index] = {
      ...originalGoal,
      title: (goalData.title !== undefined ? goalData.title : originalGoal.title).trim(),
      description: (goalData.description !== undefined ? goalData.description : originalGoal.description).trim(),
      targetAmount,
      targetDateAD: goalData.targetDateAD || "",
      targetDateBS: dateBS,
      category: goalData.category || originalGoal.category || "General",
      updatedAt: new Date().toISOString()
    };
    return { success: true };
  });
}

export async function deleteGoal(goalId) {
  return await commitMutation((candidate) => {
    candidate.goals = (candidate.goals || []).filter(g => g.id !== goalId);
    return { success: true };
  });
}

export async function addGoalAllocation(goalId, allocData, maxAvailable) {
  return await commitMutation((candidate) => {
    const goal = (candidate.goals || []).find(g => g.id === goalId);
    if (!goal) {
      return { success: false, errors: ["Goal not found."], error: "Goal not found." };
    }
    // Authoritative headroom calculation from state - never trust caller-supplied maxAvailable
    const authoritativeAvailable = calculateAvailableToAllocate(candidate);
    const validation = Validator.validateAllocation(allocData, authoritativeAvailable, goal.allocations || []);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
    }
    const bsRes = adToBs(allocData.dateAD);
    const parsedAmount = fromPaisaBigInt(toPaisaBigInt(allocData.amount));
    const newAlloc = {
      id: allocData.id || generateId("al"),
      amount: parsedAmount,
      dateAD: allocData.dateAD,
      dateBS: bsRes ? bsRes.formatted : "",
      note: (allocData.note || "").trim()
    };
    if (!goal.allocations) goal.allocations = [];
    goal.allocations.push(newAlloc);
    goal.updatedAt = new Date().toISOString();
    return { success: true, allocation: newAlloc };
  });
}

export async function removeGoalAllocation(goalId, allocId) {
  return await commitMutation((candidate) => {
    const goal = (candidate.goals || []).find(g => g.id === goalId);
    if (!goal || !goal.allocations) {
      return { success: false, errors: ["Goal or allocations not found."], error: "Goal or allocations not found." };
    }
    goal.allocations = goal.allocations.filter(a => a.id !== allocId);
    goal.updatedAt = new Date().toISOString();
    return { success: true };
  });
}

export async function resetToDemoData() {
  if (currentState?.recoveryMode && currentState.recoveryType === "equal_revision_conflict") {
    return {
      success: false,
      error: "Demo data reset is blocked during an equal-revision storage conflict. Please resolve the conflict between IndexedDB and LocalStorage first."
    };
  }
  return await commitMutation((candidate) => {
    const currentRev = candidate.revision;
    const demo = migrateV2toV3(getDemoData());
    Object.keys(candidate).forEach(k => delete candidate[k]);
    Object.assign(candidate, demo);
    candidate.revision = Math.max(Number(demo.revision || 0), Number(currentRev || 0));
    candidate.isDemoData = true;
    return { success: true };
  }, { allowInRecovery: true, allowInEqualRevisionConflict: false });
}

export async function clearAllData() {
  if (currentState?.recoveryMode && currentState.recoveryType === "equal_revision_conflict") {
    return {
      success: false,
      error: "Clearing all data is blocked during an equal-revision storage conflict. Please resolve the conflict between IndexedDB and LocalStorage first."
    };
  }
  return await commitMutation((candidate) => {
    const currentRev = candidate.revision;
    candidate.accounts = [
      {
        id: "acc_default_cash",
        name: "Cash Wallet",
        type: "cash",
        openingBalance: 0,
        openingBalanceDate: getTodayLocalDateString(),
        overdraftEnabled: false,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    candidate.transactions = [];
    candidate.budgets = [];
    candidate.goals = [];
    candidate.recurringRules = [];
    candidate.bills = [];
    candidate.settings = { ...DEFAULT_SETTINGS, initialBalance: 0 };
    candidate.isDemoData = false;
    candidate.revision = Number(currentRev || 0);
    return { success: true };
  }, { allowInRecovery: true, allowInEqualRevisionConflict: false });
}

export async function initializePersonalLedger({ initialBalance = 0, initialBalanceDate, accountName = "Cash Wallet" } = {}) {
  if (currentState?.recoveryMode && currentState.recoveryType === "equal_revision_conflict") {
    return {
      success: false,
      error: "Personal ledger initialization is blocked during an equal-revision storage conflict. Please resolve the conflict between IndexedDB and LocalStorage first."
    };
  }
  if (!isValidMoneyAmount(initialBalance, true)) {
    return {
      success: false,
      error: "Invalid initial balance: must be a non-negative number with at most 2 decimal places."
    };
  }
  if (typeof accountName !== "string" || !accountName.trim()) {
    return {
      success: false,
      error: "Account name cannot be empty."
    };
  }
  const effDate = initialBalanceDate || getTodayLocalDateString();
  if (initialBalanceDate && !isValidAdDate(initialBalanceDate)) {
    return {
      success: false,
      error: "Invalid initial balance date: must be in YYYY-MM-DD format."
    };
  }
  const parsedInitialBalance = fromPaisaBigInt(toPaisaBigInt(initialBalance));

  return await commitMutation((candidate) => {
    const currentRev = candidate.revision;
    candidate.accounts = [
      {
        id: "acc_default_cash",
        name: accountName.trim(),
        type: "cash",
        openingBalance: parsedInitialBalance,
        openingBalanceDate: effDate,
        overdraftEnabled: false,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    candidate.transactions = [];
    candidate.budgets = [];
    candidate.goals = [];
    candidate.recurringRules = [];
    candidate.bills = [];
    candidate.settings = {
      ...DEFAULT_SETTINGS,
      initialBalance: parsedInitialBalance,
      initialBalanceDate: effDate
    };
    candidate.isDemoData = false;
    delete candidate.isFirstRun;
    candidate.revision = Number(currentRev || 0);
    return { success: true };
  }, { allowInRecovery: true, allowInEqualRevisionConflict: false });
}

export async function restoreBackup(backupData) {
  if (currentState?.recoveryMode && currentState.recoveryType === "equal_revision_conflict") {
    return {
      success: false,
      error: "Backup restoration is blocked during an equal-revision storage conflict. Please resolve the conflict between IndexedDB and LocalStorage first."
    };
  }

  // 1. Save current state to CONFLICT_BACKUP before touching anything (never save empty recovery dummy)
  try {
    if (!currentState?.recoveryMode) {
      StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, getState());
    } else if (currentState.idbRecoverableState) {
      StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, currentState.idbRecoverableState);
    } else if (currentState.lsRecoverableState) {
      StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, currentState.lsRecoverableState);
    }
  } catch {}

  // 2. Validate backup schema first
  const validation = Validator.validateBackupJson(backupData);
  if (!validation.isValid) {
    return {
      success: false,
      error: `Backup validation failed: ${validation.error}. Current state was preserved untouched.`
    };
  }

  // 3. Migrate and commit
  return await commitMutation((candidate) => {
    const currentRev = candidate.revision;
    const upgraded = migrateV2toV3(backupData);
    const postValidation = Validator.validateBackupJson(upgraded);
    if (!postValidation.isValid) {
      return {
        success: false,
        error: `Migrated backup validation failed: ${postValidation.error}`
      };
    }
    Object.keys(candidate).forEach(k => delete candidate[k]);
    Object.assign(candidate, upgraded);
    candidate.revision = Math.max(Number(upgraded.revision || 0), Number(currentRev || 0));
    candidate.isDemoData = typeof upgraded.isDemoData === "boolean" ? upgraded.isDemoData : false;
    return { success: true };
  }, { allowInRecovery: true, allowInEqualRevisionConflict: false });
}

export async function resolveStorageConflict(choice = "idb") {
  if (!currentState?.recoveryMode || currentState?.recoveryType !== "equal_revision_conflict") {
    return { success: false, error: "Application is not in an equal-revision storage conflict recovery state." };
  }
  if (choice !== "idb" && choice !== "ls") {
    return { success: false, error: `Invalid recovery choice '${choice}'. Must be 'idb' or 'ls'.` };
  }
  const targetState = choice === "ls" ? currentState.lsRecoverableState : currentState.idbRecoverableState;
  const alternateState = choice === "ls" ? currentState.idbRecoverableState : currentState.lsRecoverableState;
  if (!targetState) {
    return { success: false, error: `Selected snapshot '${choice}' is not available.` };
  }

  // Schema & relationship validation on chosen snapshot
  const targetVal = Validator.validateBackupJson(targetState);
  if (!targetVal.isValid) {
    return {
      success: false,
      error: `Chosen snapshot '${choice}' failed integrity validation: ${targetVal.error}. Conflict resolution aborted; original stores remain untouched.`
    };
  }

  // 1. Preserve alternate snapshot independently before touching active records
  if (alternateState) {
    try {
      const backupKey = choice === "ls" ? STORAGE_KEYS.CONFLICT_IDB_BACKUP : STORAGE_KEYS.CONFLICT_LS_BACKUP;
      const saveRes1 = StorageService.setItem(backupKey, alternateState);
      const saveRes2 = StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, alternateState);
      if (!saveRes1.success || !saveRes2.success) {
        return {
          success: false,
          error: `Failed to safely preserve unchosen snapshot in backup storage (${saveRes1.error || saveRes2.error || "quota error"}). Recovery aborted; original stores remain untouched.`
        };
      }
      // Read-back verification of the preserved alternate snapshot
      if (StorageService.isPersistent()) {
        const readBack = StorageService.getItem(STORAGE_KEYS.CONFLICT_BACKUP);
        if (!readBack || computeStateFingerprint(readBack) !== computeStateFingerprint(alternateState)) {
          return {
            success: false,
            error: "Read-back verification of preserved unchosen snapshot failed. Recovery aborted; original stores remain untouched."
          };
        }
      }
    } catch (saveErr) {
      return {
        success: false,
        error: `Exception while preserving unchosen snapshot: ${saveErr.message}. Recovery aborted; original stores remain untouched.`
      };
    }
  }

  // 2. Commit chosen snapshot with monotonic revision advancement
  return await commitMutation((candidate) => {
    Object.keys(candidate).forEach(k => delete candidate[k]);
    Object.assign(candidate, JSON.parse(JSON.stringify(targetState)));
    candidate.recoveryMode = false;
    candidate.recoveryType = null;
    delete candidate.recoveryError;
    delete candidate.idbRecoverableState;
    delete candidate.lsRecoverableState;
    delete candidate.corruptRawBackup;
    candidate.revision = Number(targetState.revision || 1);
    candidate.isDemoData = false;
    return { success: true, chosen: choice, revision: Number(targetState.revision || 1) + 1 };
  }, { allowInEqualRevisionConflict: true });
}

export async function resolveStorageConflictWithBackup(backupData) {
  if (!currentState?.recoveryMode || currentState?.recoveryType !== "equal_revision_conflict") {
    return { success: false, error: "Application is not in an equal-revision storage conflict recovery state." };
  }
  const validation = Validator.validateBackupJson(backupData);
  if (!validation.isValid) {
    return {
      success: false,
      error: `Imported backup failed validation: ${validation.error}. Both conflicting snapshots remain untouched.`
    };
  }

  // Preserve both original snapshots first
  try {
    if (currentState.idbRecoverableState) {
      const s1 = StorageService.setItem(STORAGE_KEYS.CONFLICT_IDB_BACKUP, currentState.idbRecoverableState);
      if (!s1.success) return { success: false, error: `Failed to preserve IndexedDB snapshot: ${s1.error}` };
    }
    if (currentState.lsRecoverableState) {
      const s2 = StorageService.setItem(STORAGE_KEYS.CONFLICT_LS_BACKUP, currentState.lsRecoverableState);
      const s3 = StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, currentState.lsRecoverableState);
      if (!s2.success || !s3.success) return { success: false, error: `Failed to preserve LocalStorage snapshot: ${s2.error || s3.error}` };
    }
  } catch (err) {
    return { success: false, error: `Failed to preserve original snapshots prior to backup import: ${err.message}. Recovery aborted.` };
  }

  return await commitMutation((candidate) => {
    const upgraded = migrateV2toV3(backupData);
    const postValidation = Validator.validateBackupJson(upgraded);
    if (!postValidation.isValid) {
      return { success: false, error: `Migrated backup validation failed: ${postValidation.error}` };
    }
    const currentRev = Math.max(
      Number(currentState.idbRecoverableState?.revision || 0),
      Number(currentState.lsRecoverableState?.revision || 0),
      Number(upgraded.revision || 0)
    );
    Object.keys(candidate).forEach(k => delete candidate[k]);
    Object.assign(candidate, upgraded);
    candidate.recoveryMode = false;
    candidate.recoveryType = null;
    delete candidate.recoveryError;
    delete candidate.idbRecoverableState;
    delete candidate.lsRecoverableState;
    delete candidate.corruptRawBackup;
    candidate.revision = currentRev;
    candidate.isDemoData = false;
    return { success: true, restoredFromBackup: true };
  }, { allowInEqualRevisionConflict: true });
}

// ============================================================================
// CENTRAL DISPATCHER (Async Persistence Contract)
// ============================================================================
export async function dispatch(action, payload) {
  switch (action) {
    case "RESOLVE_STORAGE_CONFLICT":
      return await resolveStorageConflict(payload);
    case "RESOLVE_STORAGE_CONFLICT_WITH_BACKUP":
      return await resolveStorageConflictWithBackup(payload);
    case "INITIALIZE_PERSONAL_LEDGER":
      return await initializePersonalLedger(payload);
    case "SET_THEME":
      return await updateSettings({ theme: payload });
    case "UPDATE_SETTINGS":
      return await updateSettings(payload);
    case "UPDATE_PROFILE":
      return await updateProfile(payload);
    case "RESET_TO_DEMO":
      return await resetToDemoData();
    case "CLEAR_ALL_DATA":
      return await clearAllData();
    case "RESTORE_BACKUP":
      return await restoreBackup(payload);
    case "ADD_ACCOUNT":
      return await addAccount(payload);
    case "UPDATE_ACCOUNT":
      return await updateAccount(payload);
    case "ARCHIVE_ACCOUNT":
      return await archiveAccount(payload);
    case "DELETE_ACCOUNT":
      return await deleteAccount(payload);
    case "ADD_TRANSACTION":
      return await addTransaction(payload);
    case "UPDATE_TRANSACTION":
      return await updateTransaction(payload);
    case "DELETE_TRANSACTION":
      return await deleteTransaction(payload);
    case "ADD_TRANSFER":
      return await addTransfer(payload);
    case "UPDATE_TRANSFER":
      return await updateTransfer(payload);
    case "DELETE_TRANSFER":
      return await deleteTransfer(payload);
    case "ADD_RECURRING_RULE":
      return await addRecurringRule(payload);
    case "UPDATE_RECURRING_RULE":
      return await updateRecurringRule(payload);
    case "DELETE_RECURRING_RULE":
      return await deleteRecurringRule(payload);
    case "TOGGLE_PAUSE_RECURRING_RULE":
      return await togglePauseRecurringRule(payload);
    case "SKIP_RECURRING_OCCURRENCE":
      return await skipRecurringOccurrence(payload);
    case "PROCESS_RECURRING_OCCURRENCE":
      return await processRecurringOccurrence(payload);
    case "ADD_BILL":
      return await addBill(payload);
    case "UPDATE_BILL":
      return await updateBill(payload);
    case "DELETE_BILL":
      return await deleteBill(payload);
    case "PAY_BILL":
      return await payBill(payload);
    case "SET_BUDGET":
      return await setBudget(payload);
    case "DELETE_BUDGET":
      return await deleteBudget(payload);
    case "ADD_GOAL":
      return await addGoal(payload);
    case "UPDATE_GOAL":
      return await updateGoal(payload.id, payload.data);
    case "DELETE_GOAL":
      return await deleteGoal(payload);
    case "ADD_ALLOCATION":
      return await addGoalAllocation(payload.goalId, payload.data || payload, payload.maxAvailable ?? payload.data?.maxAvailable);
    case "REMOVE_ALLOCATION":
      return await removeGoalAllocation(payload.goalId, payload.allocId);
    default:
      console.warn("[StateManager] Unknown action: " + action);
      return { success: false, error: "Unknown action: " + action };
  }
}
