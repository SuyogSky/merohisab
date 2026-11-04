/**
 * MeroHisab — Centralized Encapsulated State Manager (v3 Audited)
 * Enforces:
 *  - Non-destructive corruption recovery (never overwrites corrupt LS with demo data)
 *  - Account-specific opening balance date reconciliation
 *  - Overdraft protection on Expenses, Edits, and Transfers
 *  - Atomic Bill payments and Recurring occurrence processing
 *  - Historic / Archived account opening balance immutability
 */
import { StorageService } from "./storage.js";
import { setStoredState } from "../utils/indexed-db.js";
import { migrateV2toV3, reconcileStartupStorage } from "./migrate-to-idb.js";
import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./constants.js";
import { getDemoData } from "./demo-data.js";
import { adToBs, getTodayLocalDateString } from "../utils/nepali-calendar.js";
import { Validator } from "./validator.js";

export { migrateV2toV3 };

let currentState = null;
const listeners = new Set();

export function generateId(prefix = "item") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function syncSettingsInitialBalance() {
  if (!currentState || !Array.isArray(currentState.accounts)) return;
  const totalOpening = currentState.accounts.reduce(
    (sum, a) => sum + (Number(a.openingBalance) || 0),
    0
  );
  currentState.settings.initialBalance = Math.round(totalOpening * 100) / 100;
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

  // 2. Existing valid object in LocalStorage -> Load into memory without overwriting IDB yet
  if (saved && typeof saved === "object") {
    const validation = Validator.validateBackupJson(saved);
    if (validation.isValid) {
      currentState = migrateV2toV3(saved);
      if (saved.version < 3) {
        StorageService.setItem(STORAGE_KEYS.APP_DATA, currentState);
      }
      return;
    } else {
      console.warn("[StateManager] Schema validation failed on persisted data. Entering recovery mode:", validation.error);
      StorageService.setItem(STORAGE_KEYS.CORRUPT_BACKUP, saved);
      currentState = {
        version: 3,
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

  // 3. LocalStorage is empty: DO NOT write demo data to LocalStorage or IndexedDB here!
  // Hold an in-memory placeholder until hydrateFromIndexedDB() checks IndexedDB first.
  currentState = migrateV2toV3(getDemoData());
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
  if (res.status === "corrupt") {
    currentState = {
      version: 3,
      isDemoData: false,
      recoveryMode: true,
      recoveryError: res.error,
      corruptRawBackup: res.raw,
      idbRecoverableState: res.idbRecoverableState || null,
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
    delete currentState.isUninitializedBoot;
  }

  const snapshot = getState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch {}
  }
  return res;
}

function notifyListeners() {
  // Block destructive writes while in unrecovered corrupt state
  if (currentState.recoveryMode) {
    return {
      success: false,
      error: "Application is in data-recovery mode to protect your original storage. Please export your raw data or explicitly reset the ledger in Settings."
    };
  }
  delete currentState.isUninitializedBoot;
  currentState.lastUpdated = new Date().toISOString();
  const writeRes = StorageService.setItem(STORAGE_KEYS.APP_DATA, currentState);
  if (writeRes && writeRes.success === false) {
    return writeRes;
  }
  setStoredState(currentState).catch(() => {});
  const snapshot = getState();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error("[StateManager] Listener error:", err);
    }
  }
  return writeRes;
}

export function getState() {
  if (!currentState) init();
  return JSON.parse(JSON.stringify(currentState));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Compute per-account balance accurately using that account's openingBalanceDate
 */
export function calculateAccountBalance(state, accountId) {
  const acc = (state.accounts || []).find(a => a.id === accountId);
  if (!acc) return 0;
  let bal = Number(acc.openingBalance) || 0;
  const openDate = acc.openingBalanceDate || "1970-01-01";
  for (const tx of state.transactions || []) {
    if (tx.accountId !== accountId) continue;
    if (tx.dateAD < openDate) continue;
    const amt = Number(tx.amount) || 0;
    if (tx.type === "income") {
      bal += amt;
    } else if (tx.type === "expense") {
      bal -= amt;
    } else if (tx.type === "transfer") {
      bal += tx.transferDirection === "in" ? amt : -amt;
    }
  }
  return Math.round(bal * 100) / 100;
}

export function updateSettings(newSettings) {
  const prevSettings = JSON.parse(JSON.stringify(currentState.settings));
  const prevAccounts = JSON.parse(JSON.stringify(currentState.accounts));

  const updated = {
    ...currentState.settings,
    ...newSettings
  };
  if (newSettings.currencyFormat) {
    updated.currencyDisplay = newSettings.currencyFormat;
  } else if (newSettings.currencyDisplay) {
    updated.currencyFormat = newSettings.currencyDisplay;
  }
  currentState.settings = updated;

  if (newSettings.initialBalance !== undefined && currentState.accounts.length > 0) {
    const othersSum = currentState.accounts
      .slice(1)
      .reduce((s, a) => s + (Number(a.openingBalance) || 0), 0);
    currentState.accounts[0].openingBalance = Math.max(0, Number(newSettings.initialBalance) - othersSum);
  }
  if (newSettings.initialBalanceDate && currentState.accounts.length > 0) {
    currentState.accounts[0].openingBalanceDate = newSettings.initialBalanceDate;
  }

  if (newSettings.theme) {
    StorageService.setItem(STORAGE_KEYS.THEME, newSettings.theme);
  }
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.settings = prevSettings;
    currentState.accounts = prevAccounts;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

// ============================================================================
// ACCOUNTS CRUD (With Historic & Archived Opening-Balance Protection)
// ============================================================================
export function addAccount(accData) {
  const newAcc = {
    id: accData.id || generateId("acc"),
    name: (accData.name || "").trim(),
    type: accData.type || "cash",
    openingBalance: Number(accData.openingBalance ?? 0),
    openingBalanceDate: accData.openingBalanceDate || currentState.settings.initialBalanceDate || getTodayLocalDateString(),
    overdraftEnabled: Boolean(accData.overdraftEnabled),
    archived: Boolean(accData.archived),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const validation = Validator.validateAccount(newAcc);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }
  currentState.accounts.push(newAcc);
  syncSettingsInitialBalance();
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.accounts.pop();
    syncSettingsInitialBalance();
    return { success: false, error: writeRes.error };
  }
  return { success: true, account: newAcc };
}

export function updateAccount(accIdOrPayload, maybeData) {
  const accId = typeof accIdOrPayload === "string" ? accIdOrPayload : accIdOrPayload?.id;
  const accData = typeof accIdOrPayload === "string" ? (maybeData || {}) : (accIdOrPayload?.data || accIdOrPayload || {});
  const idx = currentState.accounts.findIndex(a => a.id === accId);
  if (idx === -1) {
    return { success: false, errors: ["Account not found."], error: "Account not found." };
  }
  const orig = currentState.accounts[idx];

  // Restrict modifying openingBalance or openingBalanceDate on archived accounts
  if (orig.archived) {
    if (
      (accData.openingBalance !== undefined && Number(accData.openingBalance) !== orig.openingBalance) ||
      (accData.openingBalanceDate !== undefined && accData.openingBalanceDate !== orig.openingBalanceDate)
    ) {
      return {
        success: false,
        errors: ["Cannot modify opening balance or opening date of an archived account."],
        error: "Cannot modify opening balance or opening date of an archived account."
      };
    }
  }

  const updated = {
    ...orig,
    name: accData.name !== undefined ? String(accData.name).trim() : orig.name,
    type: accData.type !== undefined ? accData.type : orig.type,
    openingBalance: accData.openingBalance !== undefined ? Number(accData.openingBalance) : orig.openingBalance,
    openingBalanceDate: accData.openingBalanceDate !== undefined ? accData.openingBalanceDate : orig.openingBalanceDate,
    overdraftEnabled: accData.overdraftEnabled !== undefined ? Boolean(accData.overdraftEnabled) : orig.overdraftEnabled,
    archived: accData.archived !== undefined ? Boolean(accData.archived) : orig.archived,
    updatedAt: new Date().toISOString()
  };
  const validation = Validator.validateAccount(updated);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }
  currentState.accounts[idx] = updated;
  syncSettingsInitialBalance();
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.accounts[idx] = orig;
    syncSettingsInitialBalance();
    return { success: false, error: writeRes.error };
  }
  return { success: true, account: updated };
}

export function archiveAccount(accId, archive = true) {
  const id = typeof accId === "string" ? accId : accId?.id;
  const flag = typeof accId === "object" && accId?.archive !== undefined ? Boolean(accId.archive) : Boolean(archive);
  return updateAccount(id, { archived: flag });
}

export function deleteAccount(accIdOrObj) {
  const accId = typeof accIdOrObj === "string" ? accIdOrObj : accIdOrObj?.id;
  const idx = currentState.accounts.findIndex(a => a.id === accId);
  if (idx === -1) {
    return { success: false, errors: ["Account not found."], error: "Account not found." };
  }
  if (currentState.accounts.length <= 1) {
    return { success: false, errors: ["Cannot delete the only remaining account."], error: "Cannot delete the only remaining account." };
  }
  const hasRefs =
    currentState.transactions.some(t => t.accountId === accId || t.peerAccountId === accId) ||
    currentState.recurringRules.some(r => r.accountId === accId) ||
    currentState.bills.some(b => b.accountId === accId);
  if (hasRefs) {
    return {
      success: false,
      errors: ["Cannot delete an account with transaction, recurring, or bill history. Please archive it instead."],
      error: "Cannot delete an account with transaction, recurring, or bill history. Please archive it instead."
    };
  }
  const removed = currentState.accounts.splice(idx, 1)[0];
  syncSettingsInitialBalance();
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.accounts.splice(idx, 0, removed);
    syncSettingsInitialBalance();
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

// ============================================================================
// TRANSACTIONS & ATOMIC TRANSFERS (With Full Overdraft Enforcement)
// ============================================================================
export function addTransaction(txData) {
  const bsResult = adToBs(txData.dateAD);
  const defaultAccId = currentState.accounts?.[0]?.id || "acc_default_cash";
  const targetAccId = txData.accountId || defaultAccId;
  const targetAcc = (currentState.accounts || []).find(a => a.id === targetAccId);

  if (!targetAcc) {
    return { success: false, errors: ["Selected account does not exist."], error: "Selected account does not exist." };
  }
  if (targetAcc.archived) {
    return { success: false, errors: ["Cannot record transactions on an archived account."], error: "Cannot record transactions on an archived account." };
  }

  const newTx = {
    id: txData.id || generateId("tx"),
    type: txData.type,
    accountId: targetAccId,
    transferId: txData.transferId ?? null,
    transferDirection: txData.transferDirection ?? null,
    peerAccountId: txData.peerAccountId ?? null,
    linkedBillId: txData.linkedBillId ?? null,
    linkedRecurringId: txData.linkedRecurringId ?? null,
    amount: Number(txData.amount),
    category: txData.category,
    description: (txData.description || "").trim(),
    dateAD: txData.dateAD,
    dateBS: bsResult ? bsResult.formatted : "N/A",
    paymentMethod: txData.paymentMethod || currentState.settings?.defaultPaymentMethod || "cash",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const validation = Validator.validateTransaction(newTx);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }

  // Enforce Overdraft Policy for Expense Transactions
  if (newTx.type === "expense" && !targetAcc.overdraftEnabled) {
    const currentBal = calculateAccountBalance(currentState, targetAccId);
    if (newTx.dateAD >= (targetAcc.openingBalanceDate || "1970-01-01") && currentBal < newTx.amount) {
      const msg = `Insufficient funds in ${targetAcc.name} (Available: रु ${currentBal.toFixed(2)}). Overdraft is disabled for this account.`;
      return { success: false, errors: [msg], error: msg };
    }
  }

  currentState.transactions.unshift(newTx);
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.transactions.shift();
    return { success: false, error: writeRes.error };
  }
  return { success: true, transaction: newTx };
}

export function updateTransaction(txData) {
  const index = currentState.transactions.findIndex(t => t.id === txData.id);
  if (index === -1) {
    return { success: false, errors: ["Transaction not found."], error: "Transaction not found." };
  }
  const originalTx = currentState.transactions[index];
  const bsResult = adToBs(txData.dateAD || originalTx.dateAD);
  const targetAccId = txData.accountId || originalTx.accountId || currentState.accounts?.[0]?.id;
  const targetAcc = (currentState.accounts || []).find(a => a.id === targetAccId);
  if (!targetAcc) {
    return { success: false, errors: ["Selected account does not exist."], error: "Selected account does not exist." };
  }

  const updatedTx = {
    ...originalTx,
    type: txData.type ?? originalTx.type,
    accountId: targetAccId,
    amount: Number(txData.amount ?? originalTx.amount),
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

  // Tentatively apply update and verify overdraft invariant on affected account(s)
  currentState.transactions[index] = updatedTx;
  if (!targetAcc.overdraftEnabled) {
    const newBal = calculateAccountBalance(currentState, targetAccId);
    if (newBal < 0) {
      currentState.transactions[index] = originalTx;
      const msg = `Update would cause negative balance in ${targetAcc.name} (रु ${newBal.toFixed(2)}). Overdraft is disabled.`;
      return { success: false, errors: [msg], error: msg };
    }
  }

  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.transactions[index] = originalTx;
    return { success: false, error: writeRes.error };
  }
  return { success: true, transaction: updatedTx };
}

export function addTransfer(transferData) {
  const { fromAccountId, toAccountId, amount, dateAD, description, paymentMethod } = transferData || {};
  if (!fromAccountId || !toAccountId) {
    return { success: false, errors: ["Source and destination accounts are required."], error: "Source and destination accounts are required." };
  }
  if (fromAccountId === toAccountId) {
    return { success: false, errors: ["Source and destination accounts must be different."], error: "Source and destination accounts must be different." };
  }
  const fromAcc = currentState.accounts.find(a => a.id === fromAccountId);
  const toAcc = currentState.accounts.find(a => a.id === toAccountId);
  if (!fromAcc || !toAcc) {
    return { success: false, errors: ["Invalid source or destination account."], error: "Invalid source or destination account." };
  }
  if (fromAcc.archived || toAcc.archived) {
    return { success: false, errors: ["Cannot transfer to or from an archived account."], error: "Cannot transfer to or from an archived account." };
  }
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return { success: false, errors: ["Transfer amount must be greater than 0."], error: "Transfer amount must be greater than 0." };
  }
  const sourceBalance = calculateAccountBalance(currentState, fromAccountId);
  if (!fromAcc.overdraftEnabled && sourceBalance < numAmount) {
    const msg = `Insufficient balance in ${fromAcc.name} (Available: रु ${sourceBalance.toFixed(2)}). Overdraft is disabled.`;
    return { success: false, errors: [msg], error: msg };
  }

  const txDateAD = dateAD || getTodayLocalDateString();
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
    createdAt: nowIso,
    updatedAt: nowIso
  };

  const vOut = Validator.validateTransferLeg(outLeg);
  const vIn = Validator.validateTransferLeg(inLeg);
  if (!vOut.isValid || !vIn.isValid) {
    const errs = [...(vOut.errors || []), ...(vIn.errors || [])];
    return { success: false, errors: errs, error: errs.join("; ") };
  }

  const prevTxs = [...currentState.transactions];
  currentState.transactions.unshift(inLeg, outLeg);
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.transactions = prevTxs;
    return { success: false, error: writeRes.error };
  }
  return { success: true, transferId, outLeg, inLeg };
}

/**
 * Atomic Transfer Update (edits both paired legs simultaneously)
 */
export function updateTransfer(transferData) {
  const { transferId, fromAccountId, toAccountId, amount, dateAD, description, paymentMethod } = transferData || {};
  const legs = currentState.transactions.filter(t => t.transferId === transferId);
  if (legs.length !== 2) {
    return { success: false, error: "Transfer not found." };
  }
  const prevTxs = JSON.parse(JSON.stringify(currentState.transactions));
  const outIdx = currentState.transactions.findIndex(t => t.transferId === transferId && t.transferDirection === "out");
  const inIdx = currentState.transactions.findIndex(t => t.transferId === transferId && t.transferDirection === "in");

  const newFrom = fromAccountId || currentState.transactions[outIdx].accountId;
  const newTo = toAccountId || currentState.transactions[inIdx].accountId;
  if (newFrom === newTo) {
    return { success: false, error: "Source and destination accounts must be different." };
  }
  const numAmount = Number(amount ?? currentState.transactions[outIdx].amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return { success: false, error: "Transfer amount must be greater than 0." };
  }
  const newDateAD = dateAD || currentState.transactions[outIdx].dateAD;
  const bsRes = adToBs(newDateAD);
  const newDateBS = bsRes ? bsRes.formatted : "N/A";
  const newDesc = (description ?? currentState.transactions[outIdx].description).trim();
  const newMethod = paymentMethod || currentState.transactions[outIdx].paymentMethod;

  currentState.transactions[outIdx] = {
    ...currentState.transactions[outIdx],
    accountId: newFrom,
    peerAccountId: newTo,
    amount: numAmount,
    dateAD: newDateAD,
    dateBS: newDateBS,
    description: newDesc,
    paymentMethod: newMethod,
    updatedAt: new Date().toISOString()
  };
  currentState.transactions[inIdx] = {
    ...currentState.transactions[inIdx],
    accountId: newTo,
    peerAccountId: newFrom,
    amount: numAmount,
    dateAD: newDateAD,
    dateBS: newDateBS,
    description: newDesc,
    paymentMethod: newMethod,
    updatedAt: new Date().toISOString()
  };

  const fromAcc = currentState.accounts.find(a => a.id === newFrom);
  if (fromAcc && !fromAcc.overdraftEnabled && calculateAccountBalance(currentState, newFrom) < 0) {
    currentState.transactions = prevTxs;
    return { success: false, error: `Insufficient funds in ${fromAcc.name} for updated transfer.` };
  }

  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.transactions = prevTxs;
    return { success: false, error: writeRes.error };
  }
  return { success: true, transferId };
}

export function deleteTransfer(transferIdOrObj) {
  const transferId = typeof transferIdOrObj === "string" ? transferIdOrObj : transferIdOrObj?.transferId || transferIdOrObj?.id;
  const prevTxs = [...currentState.transactions];
  currentState.transactions = currentState.transactions.filter(t => t.transferId !== transferId);
  if (currentState.transactions.length === prevTxs.length) {
    return { success: false, errors: ["Transfer not found."], error: "Transfer not found." };
  }
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.transactions = prevTxs;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function deleteTransaction(txIdOrObj) {
  const txId = typeof txIdOrObj === "string" ? txIdOrObj : txIdOrObj?.id;
  const target = currentState.transactions.find(t => t.id === txId);
  if (!target) {
    return { success: false, errors: ["Transaction not found."], error: "Transaction not found." };
  }

  if (target.transferId) {
    return deleteTransfer(target.transferId);
  }

  const prevTxs = [...currentState.transactions];
  const prevBills = JSON.parse(JSON.stringify(currentState.bills || []));

  currentState.transactions = currentState.transactions.filter(t => t.id !== txId);

  const todayStr = getTodayLocalDateString();
  for (const bill of currentState.bills || []) {
    if (bill.linkedTransactionId === txId || target.linkedBillId === bill.id) {
      bill.linkedTransactionId = null;
      bill.status = "upcoming";
      bill.status = computeBillStatus(bill, todayStr);
      bill.updatedAt = new Date().toISOString();
    }
  }

  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.transactions = prevTxs;
    currentState.bills = prevBills;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

// ============================================================================
// RECURRING TRANSACTIONS ENGINE (Atomic + Catch-Up Backlog Support)
// ============================================================================
export function computeNextOccurrence(schedule, fromDateAD) {
  if (!schedule || !fromDateAD) return null;
  const freq = schedule.frequency || schedule.freq || "monthly";
  const interval = Math.max(1, Number(schedule.interval || 1));
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
    const targetDom = Number(schedule.dayOfMonth || d);
    const totalMonths = (y * 12 + (m - 1)) + interval;
    nextY = Math.floor(totalMonths / 12);
    nextM = (totalMonths % 12) + 1;
    const daysInTargetMonth = new Date(Date.UTC(nextY, nextM, 0)).getUTCDate();
    nextD = Math.min(targetDom, daysInTargetMonth);
  } else if (freq === "yearly") {
    const targetDom = Number(schedule.dayOfMonth || d);
    const targetMonth = Number(schedule.month || m);
    nextY = y + interval;
    nextM = targetMonth;
    const daysInTargetMonth = new Date(Date.UTC(nextY, nextM, 0)).getUTCDate();
    nextD = Math.min(targetDom, daysInTargetMonth);
  }

  const nextStr = `${nextY}-${String(nextM).padStart(2, "0")}-${String(nextD).padStart(2, "0")}`;
  if (schedule.endDate && nextStr > schedule.endDate) {
    return null;
  }
  return nextStr;
}

/**
 * Preview missed/due occurrences up to asOfDateAD (capped at maxCount to prevent runaway loops)
 */
export function getMissedOccurrences(rule, asOfDateAD = null, maxCount = 36) {
  if (!rule || rule.paused || !rule.nextOccurrence) return [];
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

export function addRecurringRule(ruleData) {
  const defaultAccId = currentState.accounts?.[0]?.id || "acc_default_cash";
  const schedule = {
    frequency: ruleData.schedule?.frequency || ruleData.schedule?.freq || "monthly",
    interval: Number(ruleData.schedule?.interval || 1),
    dayOfMonth: ruleData.schedule?.dayOfMonth !== undefined
      ? Number(ruleData.schedule.dayOfMonth)
      : Number((ruleData.schedule?.startDate || getTodayLocalDateString()).split("-")[2]),
    startDate: ruleData.schedule?.startDate || getTodayLocalDateString(),
    endDate: ruleData.schedule?.endDate || null
  };

  const newRule = {
    id: ruleData.id || generateId("rr"),
    title: (ruleData.title || ruleData.description || "").trim(),
    description: (ruleData.description || ruleData.title || "").trim(),
    type: ruleData.type || "expense",
    accountId: ruleData.accountId || defaultAccId,
    amount: Number(ruleData.amount),
    category: ruleData.category || (ruleData.type === "income" ? "salary" : "utilities"),
    paymentMethod: ruleData.paymentMethod || currentState.settings?.defaultPaymentMethod || "fonepay",
    schedule,
    nextOccurrence: ruleData.nextOccurrence !== undefined ? ruleData.nextOccurrence : schedule.startDate,
    paused: Boolean(ruleData.paused),
    skippedDates: Array.isArray(ruleData.skippedDates) ? [...ruleData.skippedDates] : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const validation = Validator.validateRecurringRule(newRule);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }

  currentState.recurringRules.push(newRule);
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.recurringRules.pop();
    return { success: false, error: writeRes.error };
  }
  return { success: true, rule: newRule };
}

export function updateRecurringRule(idOrPayload, maybeData) {
  const ruleId = typeof idOrPayload === "string" ? idOrPayload : idOrPayload?.id;
  const data = typeof idOrPayload === "string" ? (maybeData || {}) : (idOrPayload?.data || idOrPayload || {});
  const idx = currentState.recurringRules.findIndex(r => r.id === ruleId);
  if (idx === -1) return { success: false, errors: ["Recurring rule not found."], error: "Recurring rule not found." };

  const orig = currentState.recurringRules[idx];
  const mergedSchedule = data.schedule ? {
    ...orig.schedule,
    ...data.schedule,
    frequency: data.schedule.frequency || data.schedule.freq || orig.schedule.frequency
  } : orig.schedule;

  const updated = {
    ...orig,
    ...data,
    id: orig.id,
    title: (data.title ?? orig.title).trim(),
    description: (data.description ?? data.title ?? orig.description).trim(),
    amount: data.amount !== undefined ? Number(data.amount) : orig.amount,
    schedule: mergedSchedule,
    updatedAt: new Date().toISOString()
  };

  const validation = Validator.validateRecurringRule(updated);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }

  currentState.recurringRules[idx] = updated;
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.recurringRules[idx] = orig;
    return { success: false, error: writeRes.error };
  }
  return { success: true, rule: updated };
}

export function deleteRecurringRule(idOrObj) {
  const ruleId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  const prev = [...currentState.recurringRules];
  currentState.recurringRules = currentState.recurringRules.filter(r => r.id !== ruleId);
  if (currentState.recurringRules.length === prev.length) {
    return { success: false, errors: ["Recurring rule not found."], error: "Recurring rule not found." };
  }
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.recurringRules = prev;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function togglePauseRecurringRule(idOrObj) {
  const ruleId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  const rule = currentState.recurringRules.find(r => r.id === ruleId);
  if (!rule) return { success: false, error: "Recurring rule not found." };
  const nextPaused = typeof idOrObj === "object" && idOrObj?.paused !== undefined ? Boolean(idOrObj.paused) : !rule.paused;
  return updateRecurringRule(ruleId, { paused: nextPaused });
}

export function skipRecurringOccurrence(idOrObj) {
  const ruleId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  const rule = currentState.recurringRules.find(r => r.id === ruleId);
  if (!rule || !rule.nextOccurrence) {
    return { success: false, error: "No upcoming occurrence to skip." };
  }
  const prevRule = JSON.parse(JSON.stringify(rule));
  const skippedDate = rule.nextOccurrence;
  if (!rule.skippedDates.includes(skippedDate)) {
    rule.skippedDates.push(skippedDate);
  }
  rule.nextOccurrence = computeNextOccurrence(rule.schedule, skippedDate);
  rule.updatedAt = new Date().toISOString();
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    Object.assign(rule, prevRule);
    return { success: false, error: writeRes.error };
  }
  return { success: true, skippedDate, nextOccurrence: rule.nextOccurrence };
}

/**
 * Atomic Recurring Occurrence Processor (creates transaction + advances rule in a single commit)
 */
export function processRecurringOccurrence(idOrObj) {
  const ruleId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  const rule = currentState.recurringRules.find(r => r.id === ruleId);
  if (!rule) return { success: false, error: "Recurring rule not found." };
  if (rule.paused) return { success: false, error: "Cannot process a paused recurring rule." };
  if (!rule.nextOccurrence) return { success: false, error: "Recurring rule has no further occurrences." };

  const occDate = (typeof idOrObj === "object" && idOrObj?.dateAD) ? idOrObj.dateAD : rule.nextOccurrence;

  // Idempotency guard
  const duplicate = currentState.transactions.some(
    t => t.linkedRecurringId === rule.id && t.dateAD === occDate
  );
  if (duplicate) {
    return { success: false, error: `Occurrence for ${occDate} has already been posted.` };
  }

  const targetAcc = (currentState.accounts || []).find(a => a.id === rule.accountId);
  if (!targetAcc || targetAcc.archived) {
    return { success: false, error: "Assigned account is unavailable or archived." };
  }
  if (rule.type === "expense" && !targetAcc.overdraftEnabled) {
    const bal = calculateAccountBalance(currentState, rule.accountId);
    if (occDate >= (targetAcc.openingBalanceDate || "1970-01-01") && bal < rule.amount) {
      return { success: false, error: `Insufficient funds in ${targetAcc.name} to post recurring expense.` };
    }
  }

  const bsResult = adToBs(occDate);
  const newTx = {
    id: generateId("tx"),
    type: rule.type,
    accountId: rule.accountId,
    transferId: null,
    transferDirection: null,
    peerAccountId: null,
    linkedBillId: null,
    linkedRecurringId: rule.id,
    amount: Number(rule.amount),
    category: rule.category,
    description: (rule.title || rule.description || "").trim(),
    dateAD: occDate,
    dateBS: bsResult ? bsResult.formatted : "N/A",
    paymentMethod: rule.paymentMethod || "fonepay",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const prevNext = rule.nextOccurrence;
  const prevUpdated = rule.updatedAt;

  // Single atomic mutation & commit
  currentState.transactions.unshift(newTx);
  rule.nextOccurrence = computeNextOccurrence(rule.schedule, occDate);
  rule.updatedAt = new Date().toISOString();

  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.transactions.shift();
    rule.nextOccurrence = prevNext;
    rule.updatedAt = prevUpdated;
    return { success: false, error: writeRes.error };
  }
  return { success: true, transaction: newTx, nextOccurrence: rule.nextOccurrence };
}

// ============================================================================
// BILLS & ATOMIC PAYMENT TRACKING ENGINE (Audit 1E)
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

export function addBill(billData) {
  const defaultAccId = currentState.accounts?.[0]?.id || "acc_default_cash";
  const bsRes = adToBs(billData.dueDateAD);
  const newBill = {
    id: billData.id || generateId("bill"),
    seriesId: billData.seriesId || (billData.recurrence ? generateId("bseries") : null),
    title: (billData.title || "").trim(),
    amount: Number(billData.amount),
    category: billData.category || "utilities",
    accountId: billData.accountId || defaultAccId,
    dueDateAD: billData.dueDateAD,
    dueDateBS: bsRes ? bsRes.formatted : "N/A",
    recurrence: billData.recurrence || null,
    status: "upcoming",
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

  currentState.bills.push(newBill);
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.bills.pop();
    return { success: false, error: writeRes.error };
  }
  return { success: true, bill: newBill };
}

export function updateBill(idOrPayload, maybeData) {
  const billId = typeof idOrPayload === "string" ? idOrPayload : idOrPayload?.id;
  const data = typeof idOrPayload === "string" ? (maybeData || {}) : (idOrPayload?.data || idOrPayload || {});
  const idx = currentState.bills.findIndex(b => b.id === billId);
  if (idx === -1) return { success: false, error: "Bill not found." };

  const orig = currentState.bills[idx];
  const dueDateAD = data.dueDateAD || orig.dueDateAD;
  const bsRes = adToBs(dueDateAD);

  const updated = {
    ...orig,
    ...data,
    id: orig.id,
    title: (data.title ?? orig.title).trim(),
    amount: data.amount !== undefined ? Number(data.amount) : orig.amount,
    dueDateAD,
    dueDateBS: bsRes ? bsRes.formatted : orig.dueDateBS,
    updatedAt: new Date().toISOString()
  };
  updated.status = computeBillStatus(updated);

  const validation = Validator.validateBill(updated);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }

  currentState.bills[idx] = updated;
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.bills[idx] = orig;
    return { success: false, error: writeRes.error };
  }
  return { success: true, bill: updated };
}

export function deleteBill(idOrObj) {
  const billId = typeof idOrObj === "string" ? idOrObj : idOrObj?.id;
  const prev = [...currentState.bills];
  currentState.bills = currentState.bills.filter(b => b.id !== billId);
  if (currentState.bills.length === prev.length) {
    return { success: false, error: "Bill not found." };
  }
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.bills = prev;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

/**
 * Atomic Bill Payment:
 * Creates linked expense, marks bill paid, and spawns next recurring bill in ONE single transaction commit.
 * Rolls back all mutations if storage write fails.
 */
export function payBill(idOrPayload) {
  const billId = typeof idOrPayload === "string" ? idOrPayload : idOrPayload?.id || idOrPayload?.billId;
  const paymentDateAD = (typeof idOrPayload === "object" && idOrPayload?.dateAD) ? idOrPayload.dateAD : getTodayLocalDateString();
  const bill = currentState.bills.find(b => b.id === billId);
  if (!bill) {
    return { success: false, error: "Bill not found." };
  }

  if (bill.status === "paid" && bill.linkedTransactionId && currentState.transactions.some(t => t.id === bill.linkedTransactionId)) {
    return { success: false, error: "Bill is already paid." };
  }

  const targetAcc = (currentState.accounts || []).find(a => a.id === bill.accountId);
  if (!targetAcc || targetAcc.archived) {
    return { success: false, error: "Bill payment account is unavailable or archived." };
  }
  if (!targetAcc.overdraftEnabled) {
    const currentBal = calculateAccountBalance(currentState, bill.accountId);
    if (paymentDateAD >= (targetAcc.openingBalanceDate || "1970-01-01") && currentBal < bill.amount) {
      return {
        success: false,
        error: `Insufficient funds in ${targetAcc.name} (Available: रु ${currentBal.toFixed(2)}) to pay bill. Overdraft is disabled.`
      };
    }
  }

  const bsResult = adToBs(paymentDateAD);
  const newTx = {
    id: generateId("tx"),
    type: "expense",
    accountId: bill.accountId,
    transferId: null,
    transferDirection: null,
    peerAccountId: null,
    linkedBillId: bill.id,
    linkedRecurringId: null,
    amount: Number(bill.amount),
    category: bill.category,
    description: `Bill Payment: ${bill.title}`,
    dateAD: paymentDateAD,
    dateBS: bsResult ? bsResult.formatted : "N/A",
    paymentMethod: currentState.settings?.defaultPaymentMethod || "fonepay",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const txVal = Validator.validateTransaction(newTx);
  if (!txVal.isValid) {
    return { success: false, errors: txVal.errors, error: txVal.errors.join("; ") };
  }

  // Snapshot before atomic mutation
  const prevTxs = [...currentState.transactions];
  const prevBills = JSON.parse(JSON.stringify(currentState.bills));

  currentState.transactions.unshift(newTx);
  bill.status = "paid";
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
      const alreadyExists = currentState.bills.some(
        b => b.seriesId === sId && b.dueDateAD === nextDue
      );
      if (!alreadyExists) {
        const nextBs = adToBs(nextDue);
        nextBill = {
          id: generateId("bill"),
          seriesId: sId,
          title: bill.title,
          amount: bill.amount,
          category: bill.category,
          accountId: bill.accountId,
          dueDateAD: nextDue,
          dueDateBS: nextBs ? nextBs.formatted : "N/A",
          recurrence: { ...bill.recurrence },
          status: "upcoming",
          linkedTransactionId: null,
          notes: bill.notes || "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        nextBill.status = computeBillStatus(nextBill);
        currentState.bills.push(nextBill);
      }
    }
  }

  // Single atomic persistence write
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.transactions = prevTxs;
    currentState.bills = prevBills;
    return { success: false, error: writeRes.error };
  }
  return { success: true, bill, transaction: newTx, nextBill };
}

// ============================================================================
// BUDGETS & GOALS
// ============================================================================
export function setBudget(budgetData) {
  const validation = Validator.validateBudget(budgetData, currentState.budgets);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }
  const prevBudgets = JSON.parse(JSON.stringify(currentState.budgets));
  const existingIdx = currentState.budgets.findIndex(
    b => b.id === budgetData.id || (b.period === budgetData.period && b.category === budgetData.category)
  );
  if (existingIdx !== -1) {
    currentState.budgets[existingIdx] = {
      ...currentState.budgets[existingIdx],
      amount: Number(budgetData.amount),
      updatedAt: new Date().toISOString()
    };
  } else {
    currentState.budgets.push({
      id: budgetData.id || generateId("bg"),
      period: budgetData.period,
      category: budgetData.category,
      amount: Number(budgetData.amount),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.budgets = prevBudgets;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function deleteBudget(budgetId) {
  const prevBudgets = [...currentState.budgets];
  currentState.budgets = currentState.budgets.filter(b => b.id !== budgetId);
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.budgets = prevBudgets;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function addGoal(goalData) {
  const validation = Validator.validateGoal(goalData);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }
  let dateBS = "";
  if (goalData.targetDateAD) {
    const bsRes = adToBs(goalData.targetDateAD);
    dateBS = bsRes ? bsRes.formatted : "";
  }
  const newGoal = {
    id: goalData.id || generateId("gl"),
    title: goalData.title.trim(),
    description: (goalData.description || "").trim(),
    targetAmount: Number(goalData.targetAmount),
    targetDateAD: goalData.targetDateAD || "",
    targetDateBS: dateBS,
    category: goalData.category || "General",
    allocations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  currentState.goals.push(newGoal);
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.goals.pop();
    return { success: false, error: writeRes.error };
  }
  return { success: true, goal: newGoal };
}

export function updateGoal(goalIdOrObj, maybeGoalData) {
  const goalId = typeof goalIdOrObj === "string" ? goalIdOrObj : goalIdOrObj?.id;
  const goalData = typeof goalIdOrObj === "string" ? maybeGoalData : goalIdOrObj;
  const index = currentState.goals.findIndex(g => g.id === goalId);
  if (index === -1) {
    return { success: false, errors: ["Goal not found."], error: "Goal not found." };
  }
  const validation = Validator.validateGoal(goalData);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }
  const originalGoal = currentState.goals[index];
  let dateBS = "";
  if (goalData.targetDateAD) {
    const bsRes = adToBs(goalData.targetDateAD);
    dateBS = bsRes ? bsRes.formatted : "";
  }
  currentState.goals[index] = {
    ...originalGoal,
    title: goalData.title.trim(),
    description: (goalData.description || "").trim(),
    targetAmount: Number(goalData.targetAmount),
    targetDateAD: goalData.targetDateAD || "",
    targetDateBS: dateBS,
    category: goalData.category || originalGoal.category || "General",
    updatedAt: new Date().toISOString()
  };
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.goals[index] = originalGoal;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function deleteGoal(goalId) {
  const prevGoals = [...currentState.goals];
  currentState.goals = currentState.goals.filter(g => g.id !== goalId);
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState.goals = prevGoals;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function addGoalAllocation(goalId, allocData, maxAvailable) {
  const goal = currentState.goals.find(g => g.id === goalId);
  if (!goal) {
    return { success: false, errors: ["Goal not found."], error: "Goal not found." };
  }
  const validation = Validator.validateAllocation(allocData, maxAvailable);
  if (!validation.isValid) {
    return { success: false, errors: validation.errors, error: validation.errors.join("; ") };
  }
  const bsRes = adToBs(allocData.dateAD);
  const newAlloc = {
    id: allocData.id || generateId("al"),
    amount: Number(allocData.amount),
    dateAD: allocData.dateAD,
    dateBS: bsRes ? bsRes.formatted : "",
    note: (allocData.note || "").trim()
  };
  if (!goal.allocations) goal.allocations = [];
  goal.allocations.push(newAlloc);
  goal.updatedAt = new Date().toISOString();
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    goal.allocations.pop();
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function removeGoalAllocation(goalId, allocId) {
  const goal = currentState.goals.find(g => g.id === goalId);
  if (!goal || !goal.allocations) {
    return { success: false, errors: ["Goal or allocations not found."], error: "Goal or allocations not found." };
  }
  const prevAllocs = [...goal.allocations];
  goal.allocations = goal.allocations.filter(a => a.id !== allocId);
  goal.updatedAt = new Date().toISOString();
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    goal.allocations = prevAllocs;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function resetToDemoData() {
  const prev = currentState;
  currentState = migrateV2toV3(getDemoData());
  currentState.recoveryMode = false;
  delete currentState.recoveryError;
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState = prev;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function clearAllData() {
  const prev = currentState;
  const today = getTodayLocalDateString();
  currentState = {
    version: 3,
    isDemoData: false,
    recoveryMode: false,
    lastUpdated: new Date().toISOString(),
    settings: {
      ...DEFAULT_SETTINGS,
      initialBalance: 0,
      initialBalanceDate: today
    },
    accounts: [
      {
        id: "acc_default_cash",
        name: "Cash Wallet",
        type: "cash",
        openingBalance: 0,
        openingBalanceDate: today,
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
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState = prev;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function restoreBackup(backupData) {
  const validation = Validator.validateBackupJson(backupData);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }
  const prev = currentState;
  currentState = migrateV2toV3(backupData);
  currentState.isDemoData = false;
  currentState.recoveryMode = false;
  currentState.lastUpdated = new Date().toISOString();
  const writeRes = notifyListeners();
  if (writeRes && writeRes.success === false) {
    currentState = prev;
    return { success: false, error: writeRes.error };
  }
  return { success: true };
}

export function dispatch(action, payload) {
  switch (action) {
    case "SET_THEME":
      return updateSettings({ theme: payload });
    case "UPDATE_SETTINGS":
      return updateSettings(payload);
    case "RESET_TO_DEMO":
      return resetToDemoData();
    case "CLEAR_ALL_DATA":
      return clearAllData();
    case "RESTORE_BACKUP":
      return restoreBackup(payload);
    case "ADD_ACCOUNT":
      return addAccount(payload);
    case "UPDATE_ACCOUNT":
      return updateAccount(payload);
    case "ARCHIVE_ACCOUNT":
      return archiveAccount(payload);
    case "DELETE_ACCOUNT":
      return deleteAccount(payload);
    case "ADD_TRANSACTION":
      return addTransaction(payload);
    case "UPDATE_TRANSACTION":
      return updateTransaction(payload);
    case "DELETE_TRANSACTION":
      return deleteTransaction(payload);
    case "ADD_TRANSFER":
      return addTransfer(payload);
    case "UPDATE_TRANSFER":
      return updateTransfer(payload);
    case "DELETE_TRANSFER":
      return deleteTransfer(payload);
    case "ADD_RECURRING_RULE":
      return addRecurringRule(payload);
    case "UPDATE_RECURRING_RULE":
      return updateRecurringRule(payload);
    case "DELETE_RECURRING_RULE":
      return deleteRecurringRule(payload);
    case "TOGGLE_PAUSE_RECURRING_RULE":
      return togglePauseRecurringRule(payload);
    case "SKIP_RECURRING_OCCURRENCE":
      return skipRecurringOccurrence(payload);
    case "PROCESS_RECURRING_OCCURRENCE":
      return processRecurringOccurrence(payload);
    case "ADD_BILL":
      return addBill(payload);
    case "UPDATE_BILL":
      return updateBill(payload);
    case "DELETE_BILL":
      return deleteBill(payload);
    case "PAY_BILL":
      return payBill(payload);
    case "SET_BUDGET":
      return setBudget(payload);
    case "DELETE_BUDGET":
      return deleteBudget(payload);
    case "ADD_GOAL":
      return addGoal(payload);
    case "UPDATE_GOAL":
      return updateGoal(payload.id, payload.data);
    case "DELETE_GOAL":
      return deleteGoal(payload);
    case "ADD_ALLOCATION":
      return addGoalAllocation(payload.goalId, payload.data, payload.maxAvailable);
    case "REMOVE_ALLOCATION":
      return removeGoalAllocation(payload.goalId, payload.allocId);
    default:
      console.warn("[StateManager] Unknown action: " + action);
      return { success: false, error: "Unknown action: " + action };
  }
}
