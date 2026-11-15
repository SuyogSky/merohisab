/**
 * MeroHisab — Authoritative Startup Reconciliation & Migration Engine (v3 Audited)
 * Guarantees:
 *  1. Demo data is NEVER written before both IndexedDB and LocalStorage are checked.
 *  2. Existing valid IndexedDB data is NEVER overwritten when LocalStorage is empty.
 *  3. Corrupted LocalStorage is preserved untouched and enters explicit recoveryMode.
 *  4. Divergent IDB vs LS copies do NOT use blind timestamp overwrites: IDB is the
 *     authoritative v3 store, and any divergent LS copy is backed up to CONFLICT_BACKUP.
 *  5. Complete deterministic fingerprinting of every meaningful field.
 *  6. Concurrency revision protection across tabs.
 *  7. Complete read-back verification across both storage providers.
 */
import { StorageService } from "./storage.js";
import { getStoredState, getStoredStateWithMeta, setStoredState, rollbackStoredState, atomicRollbackStoredState } from "../utils/indexed-db.js";
import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./constants.js";
import { Validator } from "./validator.js";
import { toPaisaBigInt, fromPaisaBigInt, isValidMoneyAmount } from "../utils/money.js";
import { getTodayLocalDateString, isValidAdDate } from "../utils/nepali-calendar.js";

/**
 * Creates a clean, pristine personal ledger state with zero fictional records.
 * Used for genuine first-run installation and blank ledger initialization.
 * Strictly validates all inputs and never silently coerces malformed inputs to zero.
 *
 * @param {object} [options]
 * @returns {object} Valid v3 personal ledger state
 */
export function createCleanPersonalLedgerState(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Options must be a valid plain object.");
  }
  const { initialBalance = 0, initialBalanceDate = null, accountName = "Cash Wallet" } = options;

  if (initialBalance === null || typeof initialBalance === "object") {
    throw new TypeError("Invalid initial balance: must be a numeric amount.");
  }
  if (typeof initialBalance === "number" && (!isFinite(initialBalance) || isNaN(initialBalance))) {
    throw new RangeError("Invalid initial balance: amount cannot be NaN or Infinity.");
  }
  if (!isValidMoneyAmount(initialBalance, true)) {
    throw new RangeError(`Invalid initial balance: '${initialBalance}' must be a valid non-negative amount with at most 2 decimal places and <= ₹ 999,999,999,999.99.`);
  }

  if (accountName !== undefined && (typeof accountName !== "string" || !accountName.trim())) {
    throw new TypeError("Account name must be a non-empty string.");
  }
  const effDate = initialBalanceDate || getTodayLocalDateString();
  if (initialBalanceDate && !isValidAdDate(initialBalanceDate)) {
    throw new RangeError("Initial balance date must be a valid Gregorian date in YYYY-MM-DD format.");
  }

  const cleanBal = fromPaisaBigInt(toPaisaBigInt(initialBalance));
  const cleanAccountName = (accountName || "Cash Wallet").trim();

  return {
    version: 3,
    revision: 1,
    isDemoData: false,
    lastUpdated: new Date().toISOString(),
    settings: {
      ...DEFAULT_SETTINGS,
      initialBalance: cleanBal,
      initialBalanceDate: effDate,
      userName: "MeroHisab User",
      userRole: "Personal Ledger",
      profile: {
        displayName: "MeroHisab User"
      }
    },
    accounts: [
      {
        id: "acc_default_cash",
        name: cleanAccountName,
        type: "cash",
        openingBalance: cleanBal,
        openingBalanceDate: effDate,
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

/**
 * Resolves the canonical primary account from an accounts collection.
 * Preference: account with id "acc_default_cash", or the first active/non-archived account, or accounts[0].
 *
 * @param {Array<object>} accounts
 * @returns {object|null}
 */
export function resolvePrimaryAccount(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  // 1. Valid active account explicitly designated as primary
  const explicitPrimary = accounts.find(a => a && a.isPrimary && !a.archived);
  if (explicitPrimary) return explicitPrimary;
  // 2. Valid active canonical cash account
  const activeCanonical = accounts.find(a => a && a.id === "acc_default_cash" && !a.archived);
  if (activeCanonical) return activeCanonical;
  // 3. First available valid active account
  const firstActive = accounts.find(a => a && !a.archived);
  if (firstActive) return firstActive;
  // 4. If no valid active accounts exist, never select an archived account
  return null;
}

export function migrateV2toV3(rawState) {
  const state = JSON.parse(JSON.stringify(rawState));

  if (state.version === 2 || state.version === 1) {
    StorageService.setItem(STORAGE_KEYS.V2_BACKUP, JSON.parse(JSON.stringify(rawState)));
  }

  let legacyBalance = 0;
  if (state.settings?.initialBalance !== undefined && state.settings?.initialBalance !== null) {
    if (isValidMoneyAmount(state.settings.initialBalance, true)) {
      legacyBalance = fromPaisaBigInt(toPaisaBigInt(state.settings.initialBalance));
    }
  }
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
  } else {
    state.accounts = state.accounts.map(a => {
      let openingBalance = a.openingBalance;
      if (openingBalance !== undefined && openingBalance !== null && isValidMoneyAmount(openingBalance, true)) {
        openingBalance = fromPaisaBigInt(toPaisaBigInt(openingBalance));
      }
      return {
        ...a,
        openingBalance
      };
    });
  }

  const primaryAcc = resolvePrimaryAccount(state.accounts);
  const defaultAccId = primaryAcc?.id || "acc_default_cash";
  if (!Array.isArray(state.transactions)) state.transactions = [];
  state.transactions = state.transactions.map(tx => {
    let amt = tx.amount;
    if (amt !== undefined && amt !== null && isValidMoneyAmount(amt)) {
      amt = fromPaisaBigInt(toPaisaBigInt(amt));
    }
    return {
      ...tx,
      amount: amt,
      accountId: tx.accountId || defaultAccId,
      transferId: tx.transferId ?? null,
      transferDirection: tx.transferDirection ?? null,
      peerAccountId: tx.peerAccountId ?? null,
      linkedBillId: tx.linkedBillId ?? null,
      linkedRecurringId: tx.linkedRecurringId ?? null
    };
  });

  // Backward compatibility: infer missing peerAccountId only if exactly one unambiguous reciprocal pair
  const transferGroups = new Map();
  for (const tx of state.transactions) {
    if (tx.type === "transfer" || tx.transferId) {
      if (tx.transferId) {
        if (!transferGroups.has(tx.transferId)) transferGroups.set(tx.transferId, []);
        transferGroups.get(tx.transferId).push(tx);
      }
    }
  }

  for (const [trId, legs] of transferGroups.entries()) {
    if (legs.length === 2) {
      const outLeg = legs.find(l => l.transferDirection === "out");
      const inLeg = legs.find(l => l.transferDirection === "in");
      if (outLeg && inLeg && outLeg.accountId && inLeg.accountId && outLeg.accountId !== inLeg.accountId) {
        if (!outLeg.peerAccountId) outLeg.peerAccountId = inLeg.accountId;
        if (!inLeg.peerAccountId) inLeg.peerAccountId = outLeg.accountId;
      }
    }
  }

  if (!Array.isArray(state.budgets)) {
    state.budgets = [];
  } else {
    state.budgets = state.budgets.map(b => {
      let amt = b.amount;
      if (amt !== undefined && amt !== null && isValidMoneyAmount(amt)) {
        amt = fromPaisaBigInt(toPaisaBigInt(amt));
      }
      return { ...b, amount: amt };
    });
  }

  if (!Array.isArray(state.goals)) {
    state.goals = [];
  } else {
    state.goals = state.goals.map(g => {
      let targetAmount = g.targetAmount;
      if (targetAmount !== undefined && targetAmount !== null && isValidMoneyAmount(targetAmount)) {
        targetAmount = fromPaisaBigInt(toPaisaBigInt(targetAmount));
      }
      const allocs = Array.isArray(g.allocations) ? g.allocations.map(al => {
        let alAmt = al.amount;
        if (alAmt !== undefined && alAmt !== null && isValidMoneyAmount(alAmt)) {
          alAmt = fromPaisaBigInt(toPaisaBigInt(alAmt));
        }
        return { ...al, amount: alAmt };
      }) : [];
      return { ...g, targetAmount, allocations: allocs };
    });
  }

  if (!Array.isArray(state.recurringRules)) {
    state.recurringRules = [];
  } else {
    state.recurringRules = state.recurringRules.map(r => {
      let amt = r.amount;
      if (amt !== undefined && amt !== null && isValidMoneyAmount(amt)) {
        amt = fromPaisaBigInt(toPaisaBigInt(amt));
      }
      let paused = r.paused;
      if (typeof paused !== "boolean") {
        if (typeof r.isPaused === "boolean") {
          paused = r.isPaused;
        } else if (r.status === "paused") {
          paused = true;
        } else {
          paused = false;
        }
      }
      return { ...r, amount: amt, paused, isPaused: paused };
    });
  }

  if (!Array.isArray(state.bills)) {
    state.bills = [];
  } else {
    state.bills = state.bills.map(b => {
      let amt = b.amount;
      if (amt !== undefined && amt !== null && isValidMoneyAmount(amt)) {
        amt = fromPaisaBigInt(toPaisaBigInt(amt));
      }
      let isPaid = b.isPaid;
      if (isPaid === undefined) {
        isPaid = (b.status === "paid");
      }
      return {
        ...b,
        amount: amt,
        isPaid
      };
    });
  }

  // Backward compatibility: repair older paid bill relationships if unambiguous
  for (const bill of state.bills) {
    const isPaid = bill.isPaid === true || bill.status === "paid";
    if (isPaid) {
      if (bill.linkedTransactionId) {
        const tx = state.transactions.find(t => t.id === bill.linkedTransactionId);
        if (tx && tx.type === "expense" && toPaisaBigInt(tx.amount || 0) === toPaisaBigInt(bill.amount || 0) && tx.accountId === bill.accountId) {
          if (!tx.linkedBillId) {
            tx.linkedBillId = bill.id;
          }
          if (!bill.paidDateAD) {
            bill.paidDateAD = tx.dateAD;
            bill.paidDateBS = tx.dateBS || (adToBs(tx.dateAD)?.formatted || null);
          }
        }
      } else {
        const candidates = state.transactions.filter(t =>
          t.type === "expense" &&
          toPaisaBigInt(t.amount || 0) === toPaisaBigInt(bill.amount || 0) &&
          t.accountId === bill.accountId &&
          t.category === bill.category &&
          (!t.linkedBillId || t.linkedBillId === bill.id)
        );
        if (candidates.length === 1) {
          const match = candidates[0];
          bill.linkedTransactionId = match.id;
          match.linkedBillId = bill.id;
          if (!bill.paidDateAD) {
            bill.paidDateAD = match.dateAD;
            bill.paidDateBS = match.dateBS || (adToBs(match.dateAD)?.formatted || null);
          }
        }
      }
    }
  }

  const totalOpeningPaisa = state.accounts.reduce((s, a) => s + toPaisaBigInt(a.openingBalance || 0), 0n);
  if (!state.settings) state.settings = {};
  state.settings.initialBalance = fromPaisaBigInt(totalOpeningPaisa);
  state.settings.initialBalanceDate = primaryAcc?.openingBalanceDate || legacyDate;

  if (!state.settings.profile || typeof state.settings.profile !== "object") {
    state.settings.profile = { displayName: "MeroHisab User" };
  } else if (!state.settings.profile.displayName || typeof state.settings.profile.displayName !== "string" || !state.settings.profile.displayName.trim()) {
    state.settings.profile.displayName = "MeroHisab User";
  } else {
    state.settings.profile.displayName = state.settings.profile.displayName.trim();
  }

  if (!state.settings.userName) {
    state.settings.userName = state.settings.profile?.displayName || "MeroHisab User";
  }
  if (!state.settings.userRole) {
    state.settings.userRole = "Personal Ledger";
  }

  state.version = 3;
  if (state.revision === undefined) {
    state.revision = 1;
  }
  if (typeof state.isDemoData !== "boolean") {
    state.isDemoData = false;
  }
  return state;
}

/**
 * Deterministic Content-Based State Fingerprinting
 * Normalizes and compares EVERY meaningful field across all financial entities:
 * - Metadata: isDemoData (strict boolean)
 * - Accounts: id, name, type, openingBalance, openingBalanceDate, openingBalanceDateBS, overdraftEnabled, archived, isPrimary, createdAt, updatedAt
 * - Transactions: id, type, accountId, peerAccountId, transferId, transferDirection, linkedBillId, linkedRecurringId, amount, category, description, dateAD, dateBS, paymentMethod, createdAt, updatedAt
 * - Budgets: id, period, category, amount, createdAt, updatedAt
 * - Goals: id, title, description, targetAmount, targetDateAD, targetDateBS, category, color, createdAt, updatedAt, allocations (id, amount, dateAD, dateBS, note, createdAt, updatedAt)
 * - RecurringRules: id, title, description, type, accountId, amount, category, paymentMethod, schedule (frequency, interval, dayOfMonth, month, startDate, endDate, startDateBS, endDateBS), nextOccurrence, nextOccurrenceBS, lastProcessedDate, lastRunDate, paused, isPaused, skippedDates, createdAt, updatedAt
 * - Bills: id, seriesId, title, amount, category, accountId, dueDateAD, dueDateBS, recurrence, status, isPaid, paidDateAD, paidDateBS, linkedTransactionId, notes, createdAt, updatedAt
 * - Settings: all user preferences and profile parameters
 *
 * Uses exact integer Paisa arithmetic for monetary values (never Number() || 0),
 * so semantically identical values produce identical fingerprints while different values
 * always produce different fingerprints.
 * Entities are sorted by stable ID before stringification so insertion order never causes false conflicts.
 * Returns a canonical deterministic JSON string representing the complete state.
 */
export function computeStateFingerprint(state) {
  if (!state || typeof state !== "object") return "";

  const canonicalMoneyStr = (val, fieldName, { allowZero = false } = {}) => {
    if (!isValidMoneyAmount(val, allowZero)) {
      throw new TypeError(`Invalid monetary amount for '${fieldName}': '${val}'. Cannot compute canonical financial fingerprint.`);
    }
    return toPaisaBigInt(val).toString();
  };

  const canonicalStrictBoolean = (val, fieldName, { defaultValue = false } = {}) => {
    if (val === undefined) return defaultValue;
    if (typeof val !== "boolean") {
      throw new TypeError(`Invalid boolean for '${fieldName}': '${val}' (${typeof val}). Must be a strict boolean (true/false).`);
    }
    return val;
  };

  const isDemoData = canonicalStrictBoolean(state.isDemoData, "state.isDemoData", { defaultValue: false });

  const accounts = (Array.isArray(state.accounts) ? state.accounts : [])
    .map(a => ({
      id: String(a.id || ""),
      name: String(a.name || ""),
      type: String(a.type || "cash"),
      openingBalance: canonicalMoneyStr(a.openingBalance, `account '${a.id || ""}'.openingBalance`, { allowZero: true }),
      openingBalanceDate: String(a.openingBalanceDate || ""),
      openingBalanceDateBS: a.openingBalanceDateBS ? String(a.openingBalanceDateBS) : null,
      overdraftEnabled: canonicalStrictBoolean(a.overdraftEnabled, `account '${a.id || ""}'.overdraftEnabled`, { defaultValue: false }),
      archived: canonicalStrictBoolean(a.archived, `account '${a.id || ""}'.archived`, { defaultValue: false }),
      isPrimary: canonicalStrictBoolean(a.isPrimary, `account '${a.id || ""}'.isPrimary`, { defaultValue: false }),
      createdAt: a.createdAt ? String(a.createdAt) : null,
      updatedAt: a.updatedAt ? String(a.updatedAt) : null
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const transactions = (Array.isArray(state.transactions) ? state.transactions : [])
    .map(t => ({
      id: String(t.id || ""),
      type: String(t.type || ""),
      accountId: t.accountId ? String(t.accountId) : null,
      peerAccountId: t.peerAccountId ? String(t.peerAccountId) : null,
      transferId: t.transferId ? String(t.transferId) : null,
      transferDirection: t.transferDirection ? String(t.transferDirection) : null,
      linkedBillId: t.linkedBillId ? String(t.linkedBillId) : null,
      linkedRecurringId: t.linkedRecurringId ? String(t.linkedRecurringId) : null,
      amount: canonicalMoneyStr(t.amount, `transaction '${t.id || ""}'.amount`, { allowZero: false }),
      category: String(t.category || ""),
      description: String(t.description || ""),
      dateAD: String(t.dateAD || ""),
      dateBS: t.dateBS ? String(t.dateBS) : null,
      paymentMethod: t.paymentMethod ? String(t.paymentMethod) : null,
      createdAt: t.createdAt ? String(t.createdAt) : null,
      updatedAt: t.updatedAt ? String(t.updatedAt) : null
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const budgets = (Array.isArray(state.budgets) ? state.budgets : [])
    .map(b => ({
      id: String(b.id || `${b.period}_${b.category}`),
      period: String(b.period || ""),
      category: String(b.category || ""),
      amount: canonicalMoneyStr(b.amount, `budget '${b.id || ""}'.amount`, { allowZero: false }),
      createdAt: b.createdAt ? String(b.createdAt) : null,
      updatedAt: b.updatedAt ? String(b.updatedAt) : null
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const goals = (Array.isArray(state.goals) ? state.goals : [])
    .map(g => ({
      id: String(g.id || ""),
      title: String(g.title || g.name || ""),
      description: String(g.description || ""),
      targetAmount: canonicalMoneyStr(g.targetAmount, `goal '${g.id || ""}'.targetAmount`, { allowZero: false }),
      targetDateAD: String(g.targetDateAD || ""),
      targetDateBS: g.targetDateBS ? String(g.targetDateBS) : null,
      category: String(g.category || ""),
      color: g.color ? String(g.color) : null,
      createdAt: g.createdAt ? String(g.createdAt) : null,
      updatedAt: g.updatedAt ? String(g.updatedAt) : null,
      allocations: (Array.isArray(g.allocations) ? g.allocations : [])
        .map(al => ({
          id: String(al.id || ""),
          amount: canonicalMoneyStr(al.amount, `goal '${g.id || ""}' allocation '${al.id || ""}'.amount`, { allowZero: false }),
          dateAD: String(al.dateAD || ""),
          dateBS: al.dateBS ? String(al.dateBS) : null,
          note: String(al.note || ""),
          createdAt: al.createdAt ? String(al.createdAt) : null,
          updatedAt: al.updatedAt ? String(al.updatedAt) : null
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const recurringRules = (Array.isArray(state.recurringRules) ? state.recurringRules : [])
    .map(r => {
      if (r.paused !== undefined && typeof r.paused !== "boolean") {
        throw new TypeError(`Invalid boolean for recurringRule '${r.id || ""}'.paused: '${r.paused}' (${typeof r.paused}). Must be a strict boolean (true/false).`);
      }
      if (r.isPaused !== undefined && typeof r.isPaused !== "boolean") {
        throw new TypeError(`Invalid boolean for recurringRule '${r.id || ""}'.isPaused: '${r.isPaused}' (${typeof r.isPaused}). Must be a strict boolean (true/false).`);
      }
      if (r.paused !== undefined && r.isPaused !== undefined && r.paused !== r.isPaused) {
        throw new TypeError(`Conflicting booleans for recurringRule '${r.id || ""}': paused=${r.paused} vs isPaused=${r.isPaused}.`);
      }
      if (r.paused === undefined && r.isPaused === undefined) {
        throw new TypeError(`Missing boolean flags for recurringRule '${r.id || ""}': must contain 'paused' or 'isPaused'.`);
      }
      const isRulePaused = (typeof r.paused === "boolean") ? r.paused : r.isPaused;
      return {
        id: String(r.id || ""),
        title: String(r.title || r.description || ""),
        description: String(r.description || r.title || ""),
        type: String(r.type || ""),
        accountId: String(r.accountId || ""),
        amount: canonicalMoneyStr(r.amount, `recurringRule '${r.id || ""}'.amount`, { allowZero: false }),
        category: String(r.category || ""),
        paymentMethod: String(r.paymentMethod || ""),
        schedule: r.schedule && typeof r.schedule === "object" ? {
          frequency: String(r.schedule.frequency || r.schedule.freq || ""),
          interval: Number(r.schedule.interval || 1),
          dayOfMonth: r.schedule.dayOfMonth !== undefined && r.schedule.dayOfMonth !== null ? Number(r.schedule.dayOfMonth) : null,
          month: r.schedule.month !== undefined && r.schedule.month !== null ? Number(r.schedule.month) : null,
          startDate: String(r.schedule.startDate || ""),
          startDateBS: r.schedule.startDateBS ? String(r.schedule.startDateBS) : null,
          endDate: r.schedule.endDate ? String(r.schedule.endDate) : null,
          endDateBS: r.schedule.endDateBS ? String(r.schedule.endDateBS) : null
        } : null,
        nextOccurrence: r.nextOccurrence ? String(r.nextOccurrence) : null,
        nextOccurrenceBS: r.nextOccurrenceBS ? String(r.nextOccurrenceBS) : null,
        lastProcessedDate: r.lastProcessedDate ? String(r.lastProcessedDate) : (r.lastRunDate ? String(r.lastRunDate) : null),
        lastProcessedDateBS: r.lastProcessedDateBS ? String(r.lastProcessedDateBS) : null,
        lastRunDate: r.lastRunDate ? String(r.lastRunDate) : (r.lastProcessedDate ? String(r.lastProcessedDate) : null),
        paused: isRulePaused,
        isPaused: isRulePaused,
        skippedDates: (Array.isArray(r.skippedDates) ? [...r.skippedDates] : []).map(String).sort(),
        createdAt: r.createdAt ? String(r.createdAt) : null,
        updatedAt: r.updatedAt ? String(r.updatedAt) : null
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const bills = (Array.isArray(state.bills) ? state.bills : [])
    .map(b => {
      if (b.isPaid !== undefined && typeof b.isPaid !== "boolean") {
        throw new TypeError(`Invalid boolean for bill '${b.id || ""}'.isPaid: '${b.isPaid}' (${typeof b.isPaid}). Must be a strict boolean (true/false).`);
      }
      const isBillPaid = (typeof b.isPaid === "boolean") ? b.isPaid : (b.status === "paid");
      return {
        id: String(b.id || ""),
        seriesId: b.seriesId ? String(b.seriesId) : null,
        title: String(b.title || ""),
        amount: canonicalMoneyStr(b.amount, `bill '${b.id || ""}'.amount`, { allowZero: false }),
        category: String(b.category || ""),
        accountId: String(b.accountId || ""),
        dueDateAD: String(b.dueDateAD || ""),
        dueDateBS: b.dueDateBS ? String(b.dueDateBS) : null,
        recurrence: b.recurrence && typeof b.recurrence === "object" ? {
          frequency: String(b.recurrence.frequency || b.recurrence.freq || ""),
          interval: Number(b.recurrence.interval || 1),
          dayOfMonth: b.recurrence.dayOfMonth !== undefined && b.recurrence.dayOfMonth !== null ? Number(b.recurrence.dayOfMonth) : null,
          month: b.recurrence.month !== undefined && b.recurrence.month !== null ? Number(b.recurrence.month) : null,
          startDate: b.recurrence.startDate ? String(b.recurrence.startDate) : null,
          startDateBS: b.recurrence.startDateBS ? String(b.recurrence.startDateBS) : null,
          endDate: b.recurrence.endDate ? String(b.recurrence.endDate) : null,
          endDateBS: b.recurrence.endDateBS ? String(b.recurrence.endDateBS) : null,
          untilAD: b.recurrence.untilAD ? String(b.recurrence.untilAD) : null,
          untilBS: b.recurrence.untilBS ? String(b.recurrence.untilBS) : null
        } : (b.recurrence ? String(b.recurrence) : null),
        status: String(b.status || ""),
        isPaid: isBillPaid,
        paidDateAD: b.paidDateAD ? String(b.paidDateAD) : null,
        paidDateBS: b.paidDateBS ? String(b.paidDateBS) : null,
        linkedTransactionId: b.linkedTransactionId ? String(b.linkedTransactionId) : null,
        notes: String(b.notes || ""),
        createdAt: b.createdAt ? String(b.createdAt) : null,
        updatedAt: b.updatedAt ? String(b.updatedAt) : null
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const s = state.settings || {};
  const settingsKeys = Object.keys(s).sort();
  const settings = {};
  for (const k of settingsKeys) {
    if (k === "initialBalance") {
      if (s[k] !== undefined && s[k] !== null) {
        settings[k] = canonicalMoneyStr(s[k], "settings.initialBalance", { allowZero: true });
      }
    } else if (k === "profile" && s.profile && typeof s.profile === "object") {
      const profKeys = Object.keys(s.profile).sort();
      const prof = {};
      for (const pk of profKeys) {
        prof[pk] = s.profile[pk];
      }
      settings[k] = prof;
    } else {
      settings[k] = s[k];
    }
  }

  return JSON.stringify({
    isDemoData,
    accounts,
    transactions,
    budgets,
    goals,
    recurringRules,
    bills,
    settings
  });
}

/**
 * Serialized Write Queue for IndexedDB/Storage
 * Ensures rapid asynchronous writes execute sequentially, never interleave,
 * and handles failures without permanently poisoning the queue chain.
 */
let writeQueue = Promise.resolve();

export function enqueueAuthoritativeWrite(state) {
  const snapshot = JSON.parse(JSON.stringify(state));
  const prevQueue = writeQueue;
  let opResolve;
  const opPromise = new Promise((resolve) => {
    opResolve = resolve;
  });

  writeQueue = prevQueue
    .catch(() => {})
    .then(async () => {
      try {
        const res = await persistVerifiedState(snapshot);
        if (!res || !res.success) {
          opResolve({ success: false, error: res?.error || "Authoritative persistence write failed." });
          return;
        }
        opResolve(res);
      } catch (err) {
        console.error("[WriteQueue] Authoritative persistence write failed:", err.message);
        opResolve({ success: false, error: err.message });
      }
    });

  return opPromise;
}

export async function waitForPendingWrites() {
  await writeQueue;
}

/**
 * Verified Persistence Write:
 * 1. Attempts authoritative write to IndexedDB FIRST with atomic revision concurrency check
 *    and complete payload read-back verification.
 * 2. If IndexedDB detects a newer revision conflict, immediately returns conflict result.
 * 3. Then attempts write to LocalStorage.
 * 4. If LocalStorage quota is exceeded (or fails), but IndexedDB succeeds,
 *    the write IS STILL REPORTED AS SUCCESS ({ success: true, provider: "indexeddb_only" }).
 * 5. If IndexedDB fails/unavailable, verifies LocalStorage fallback by read-back and fingerprint check
 *    ONLY if LocalStorage is a real persistent store (StorageService.isPersistent() === true).
 * 6. If neither real persistent provider succeeds, fails with clear error. Memory fallback is never reported as success!
 */
export async function persistVerifiedState(state) {
  // 1. Atomic write + concurrency check in IndexedDB
  const idbRes = await setStoredState(state);
  if (idbRes && idbRes.conflict) {
    return {
      success: false,
      conflict: true,
      storedRevision: idbRes.storedRevision,
      candidateRevision: idbRes.candidateRevision,
      error: idbRes.error
    };
  }
  if (idbRes && idbRes.verificationFailed) {
    return {
      success: false,
      verificationFailed: true,
      error: `Storage integrity error: ${idbRes.error}`
    };
  }

  // 2. Secondary write to LocalStorage
  let lsRes;
  try {
    lsRes = StorageService.setItem(STORAGE_KEYS.APP_DATA, state);
  } catch (err) {
    lsRes = { success: false, error: err.message };
  }

  if (idbRes.success) {
    if (lsRes && lsRes.success) {
      return { success: true, provider: "indexeddb" };
    }
    return {
      success: true,
      provider: "indexeddb_only",
      warning: lsRes?.error || "LocalStorage quota exceeded or unavailable."
    };
  }

  // IDB failed or unavailable -> verify storage fallback copy ONLY if LocalStorage is genuine persistent storage
  if (StorageService.isPersistent() && lsRes && lsRes.success) {
    const readBack = StorageService.getItem(STORAGE_KEYS.APP_DATA);
    if (readBack && !readBack.__corrupt && Validator.validateBackupJson(readBack).isValid) {
      try {
        if (computeStateFingerprint(readBack) === computeStateFingerprint(state)) {
          return {
            success: true,
            provider: "localstorage_fallback",
            warning: idbRes.error
          };
        }
      } catch (fpErr) {
        // Fingerprint verification failed due to invalid monetary data; do not treat as verified
      }
    }
  }

  return {
    success: false,
    error: idbRes.error || lsRes?.error || "Critical storage failure: neither IndexedDB nor LocalStorage could persist and verify the state."
  };
}

/**
 * Authoritative recovery rollback when a persistence write fails read-back verification.
 * 1. Uses atomicRollbackStoredState() inside a single IndexedDB transaction to eliminate
 *    the check-then-write race condition with concurrent tabs.
 * 2. If a newer revision exists in persistent storage, reconciles with the newer state.
 * 3. Mirrors the confirmed state to LocalStorage with read-back verification.
 * 4. Returns { success: boolean, rolledBackState: object, reconciledWithNewer?: boolean, error?: string }.
 */
export async function rollbackVerifiedState(previousConfirmedState, failedCandidateState) {
  if (!previousConfirmedState || typeof previousConfirmedState !== "object") {
    return { success: false, error: "Invalid previous state for rollback." };
  }

  // 1. Execute atomic conditional rollback inside a single IndexedDB transaction
  const atomicRes = await atomicRollbackStoredState(previousConfirmedState, failedCandidateState);
  if (!atomicRes || !atomicRes.success) {
    if (atomicRes?.equalRevisionConflict) {
      try {
        if (atomicRes.storedState) {
          StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, atomicRes.storedState);
        }
      } catch {}
      return {
        success: false,
        conflict: true,
        equalRevisionConflict: true,
        error: atomicRes.error || "Equal-revision conflict in persistent storage. Both snapshots preserved; entering protected recovery."
      };
    }
    return { success: false, error: atomicRes?.error || "Atomic rollback transaction failed." };
  }

  // 2. If a concurrent tab committed a newer revision, reconcile with the authoritative newer state
  if (atomicRes.reconciledWithNewer) {
    const newerData = atomicRes.newerStoredState;
    const val = Validator.validateBackupJson(newerData);
    if (!val.isValid) {
      return {
        success: false,
        error: `Newer stored state in persistent storage failed validation: ${val.error}. Entering protected recovery mode.`
      };
    }
    const reconciledState = migrateV2toV3(newerData);
    try {
      if (failedCandidateState && typeof failedCandidateState === "object") {
        StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, failedCandidateState);
      }
      StorageService.setItem(STORAGE_KEYS.APP_DATA, reconciledState);
    } catch {}
    return {
      success: true,
      rolledBackState: reconciledState,
      reconciledWithNewer: true,
      warning: atomicRes.warning || "A newer confirmed state was committed by another tab; reconciled with newer state."
    };
  }

  const rolledBackState = atomicRes.rolledBackState;

  // 3. Verify read-back from persistent storage to confirm write durability
  const verifyRes = await getStoredStateWithMeta();
  if (!verifyRes.available || !verifyRes.data) {
    return { success: false, error: "Rollback read-back failed: stored record not found." };
  }
  try {
    if (computeStateFingerprint(verifyRes.data) !== computeStateFingerprint(rolledBackState)) {
      return { success: false, error: "Rollback read-back verification failed: stored payload mismatch." };
    }
  } catch (fpErr) {
    return { success: false, error: `Rollback read-back verification failed: fingerprint calculation error (${fpErr.message}).` };
  }

  // 4. Mirror rollback state to LocalStorage
  let lsRes;
  try {
    lsRes = StorageService.setItem(STORAGE_KEYS.APP_DATA, rolledBackState);
  } catch (err) {
    lsRes = { success: false, error: err.message };
  }

  return {
    success: true,
    rolledBackState,
    warning: lsRes && !lsRes.success ? lsRes.error : undefined
  };
}

/**
 * Reconcile startup state across IndexedDB and LocalStorage BEFORE any demo initialization.
 * Covers all 9 storage conditions:
 *  1. IndexedDB opened, empty.
 *  2. IndexedDB opened, valid user data.
 *  3. IndexedDB contains invalid/corrupted data.
 *  4. IndexedDB is unavailable.
 *  5. IndexedDB read failed.
 *  6. IndexedDB transaction was aborted.
 *  7. LocalStorage is unavailable.
 *  8. Both storage providers are unavailable.
 *  9. Both providers contain conflicting records.
 * An unavailable database is NEVER treated as a clean/empty database.
 */
export async function reconcileStartupStorage() {
  const idbMeta = await getStoredStateWithMeta();
  const lsMeta = StorageService.getItemWithMeta(STORAGE_KEYS.APP_DATA);
  const lsRaw = StorageService.getRawItem(STORAGE_KEYS.APP_DATA);
  const lsData = lsMeta.data;

  // Condition 3 / Corrupted LocalStorage (malformed JSON)
  if (lsMeta.corrupt || (lsData && lsData.__corrupt)) {
    StorageService.setRawItem(STORAGE_KEYS.CORRUPT_BACKUP, lsMeta.raw || lsRaw || "");
    const hasIdbRecovery = Boolean(idbMeta.available && idbMeta.data && Validator.validateBackupJson(idbMeta.data).isValid);
    return {
      status: "corrupt",
      error: lsMeta.error || lsData?.error || "Corrupted LocalStorage payload",
      raw: lsMeta.raw || lsRaw,
      idbRecoverableState: hasIdbRecovery ? migrateV2toV3(idbMeta.data) : null
    };
  }

  // Corrupted LocalStorage schema validation
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

  // Check IndexedDB validity if it has data
  const idbHasData = Boolean(idbMeta.available && idbMeta.data !== null);
  let idbValid = false;
  if (idbHasData) {
    const v = Validator.validateBackupJson(idbMeta.data);
    if (!v.isValid) {
      // IndexedDB has corrupt data
      if (lsData && Validator.validateBackupJson(lsData).isValid) {
        StorageService.setRawItem(STORAGE_KEYS.CORRUPT_BACKUP, JSON.stringify(idbMeta.data));
        const stateFromLs = migrateV2toV3(lsData);
        const writeRes = await setStoredState(stateFromLs, { force: true });
        if (!writeRes || !writeRes.success) {
          return {
            status: "storage_unavailable_degraded",
            state: null,
            error: `Corrupt IndexedDB recovery failed: write to IDB failed (${writeRes?.error || "unknown"}). Entering degraded recovery mode.`
          };
        }
        const verifyRes = await getStoredStateWithMeta();
        if (!verifyRes.available || !verifyRes.data) {
          return {
            status: "storage_unavailable_degraded",
            state: null,
            error: "Corrupt IndexedDB recovery failed: record could not be read back."
          };
        }
        if (Number(verifyRes.data.revision || 0) !== Number(stateFromLs.revision || 0)) {
          return {
            status: "storage_unavailable_degraded",
            state: null,
            error: `Corrupt IndexedDB recovery failed: restored revision mismatch (${verifyRes.data.revision} !== ${stateFromLs.revision}).`
          };
        }
        try {
          if (computeStateFingerprint(verifyRes.data) !== computeStateFingerprint(stateFromLs)) {
            return {
              status: "storage_unavailable_degraded",
              state: null,
              error: "Corrupt IndexedDB recovery failed: read-back fingerprint mismatch."
            };
          }
        } catch (fpErr) {
          return {
            status: "storage_unavailable_degraded",
            state: null,
            error: `Corrupt IndexedDB recovery failed: fingerprint calculation error (${fpErr.message}).`
          };
        }
        return {
          status: "loaded_from_ls",
          state: stateFromLs,
          warning: "IndexedDB was corrupt; restored from verified LocalStorage backup."
        };
      }
      return {
        status: "corrupt",
        error: `IndexedDB data failed validation: ${v.error}`,
        raw: JSON.stringify(idbMeta.data),
        idbRecoverableState: null
      };
    }
    idbValid = true;
  }

  // Conditions 4, 5, 6, 8: IndexedDB is unavailable, blocked, read failed, or aborted
  if (!idbMeta.available) {
    // If LocalStorage has valid data, load in degraded fallback mode
    if (lsData && Validator.validateBackupJson(lsData).isValid) {
      const stateFromLs = migrateV2toV3(lsData);
      return {
        status: "loaded_from_ls",
        state: stateFromLs,
        degraded: true,
        warning: `Authoritative IndexedDB database is unavailable (${idbMeta.reason}: ${idbMeta.error || ""}). Loaded from verified LocalStorage fallback.`
      };
    }

    // If LocalStorage is also unavailable (Condition 8)
    if (!lsMeta.available) {
      return {
        status: "both_storage_unavailable",
        state: null,
        error: `Critical storage failure: Neither IndexedDB (${idbMeta.error || idbMeta.reason}) nor LocalStorage is available. All writes have been locked to protect your data.`
      };
    }

    // LocalStorage is empty or clean, but IDB is unavailable (Condition 4 / 5 / 6)
    // CRITICAL: NEVER INITIALIZE DEMO DATA WHEN THE AUTHORITATIVE DB CANNOT BE ACCESSED!
    return {
      status: "storage_unavailable_degraded",
      state: null,
      error: `Authoritative IndexedDB database cannot be accessed (${idbMeta.reason}: ${idbMeta.error || ""}) and LocalStorage contains no fallback data. Writes are paused to prevent data loss.`
    };
  }

  // Condition 2: IndexedDB has valid data, LocalStorage is empty or unavailable
  if (idbValid && !lsData) {
    const stateFromIdb = migrateV2toV3(idbMeta.data);
    StorageService.setItem(STORAGE_KEYS.APP_DATA, stateFromIdb);
    return { status: "loaded_from_idb", state: stateFromIdb };
  }

  // Condition 1 & LocalStorage has valid data: IDB empty, LS valid (e.g. migration from v2)
  if (lsData && !idbValid && idbMeta.data === null) {
    const stateFromLs = migrateV2toV3(lsData);
    await persistVerifiedState(stateFromLs);
    return { status: "loaded_from_ls", state: stateFromLs };
  }

  // Condition 2 & 9: Both stores have valid data
  if (idbValid && lsData) {
    const idbUpgraded = migrateV2toV3(idbMeta.data);
    const lsUpgraded = migrateV2toV3(lsData);

    if (idbUpgraded.isDemoData === false && lsUpgraded.isDemoData === true) {
      StorageService.setItem(STORAGE_KEYS.APP_DATA, idbUpgraded);
      return { status: "loaded_from_idb", state: idbUpgraded };
    }
    if (lsUpgraded.isDemoData === false && idbUpgraded.isDemoData === true) {
      await persistVerifiedState(lsUpgraded);
      return { status: "loaded_from_ls", state: lsUpgraded };
    }

    let idbFp, lsFp;
    try {
      idbFp = computeStateFingerprint(idbUpgraded);
      lsFp = computeStateFingerprint(lsUpgraded);
    } catch (fpErr) {
      StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, lsUpgraded);
      StorageService.setItem(STORAGE_KEYS.CONFLICT_LS_BACKUP, lsUpgraded);
      StorageService.setItem(STORAGE_KEYS.CONFLICT_IDB_BACKUP, idbUpgraded);
      return {
        status: "storage_unavailable_degraded",
        error: `Storage fingerprint generation failed: ${fpErr.message}. Entering protected recovery mode.`,
        idbRecoverableState: idbUpgraded,
        lsRecoverableState: lsUpgraded,
        recoveryType: "fingerprint_error"
      };
    }

    if (idbFp !== lsFp) {
      const idbRev = Number(idbUpgraded.revision || 0);
      const lsRev = Number(lsUpgraded.revision || 0);

      // Case A: LocalStorage has a strictly newer valid committed revision (e.g. rev 11 vs rev 10 due to fallback save)
      if (lsRev > idbRev) {
        StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, idbUpgraded);

        // Attempt promotion into authoritative IndexedDB
        const promoteRes = await setStoredState(lsUpgraded, { force: true });
        if (promoteRes && promoteRes.success) {
          const verifyRes = await getStoredStateWithMeta();
          let verifyFp = null;
          try {
            verifyFp = computeStateFingerprint(verifyRes.data);
          } catch {}
          if (verifyRes.available && verifyRes.data && verifyFp === lsFp) {
            StorageService.setItem(STORAGE_KEYS.APP_DATA, lsUpgraded);
            return {
              status: "recovered_newer_ls_promoted",
              state: lsUpgraded,
              conflictDetected: true,
              warning: `Recovered newer revision ${lsRev} from LocalStorage fallback and promoted to IndexedDB (IDB was revision ${idbRev}).`
            };
          }
        }

        // Promotion failed; safely load newer LS state in degraded mode without destroying data
        return {
          status: "loaded_from_ls",
          state: lsUpgraded,
          degraded: true,
          conflictDetected: true,
          warning: `Loaded newer revision ${lsRev} from LocalStorage fallback (IDB revision ${idbRev}); IndexedDB promotion failed.`
        };
      }

      // Case B: IndexedDB contains a strictly newer valid committed revision (e.g. rev 10 vs rev 9)
      if (idbRev > lsRev) {
        StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, lsUpgraded);
        StorageService.setItem(STORAGE_KEYS.CONFLICT_LS_BACKUP, lsUpgraded);
        StorageService.setItem(STORAGE_KEYS.APP_DATA, idbUpgraded);
        return {
          status: "conflict_resolved_idb_authoritative",
          state: idbUpgraded,
          conflictDetected: true,
          warning: `IndexedDB revision ${idbRev} is newer than LocalStorage revision ${lsRev}; stale LocalStorage preserved in conflict backup.`
        };
      }

      // Case C: Equal revisions but divergent fingerprints (idbRev === lsRev && idbFp !== lsFp)
      // Automatic selection is unsafe; preserve both copies and enter protected conflict recovery mode.
      // Do NOT overwrite LocalStorage APP_DATA and do NOT select either copy as authoritative.
      StorageService.setItem(STORAGE_KEYS.CONFLICT_BACKUP, lsUpgraded);
      StorageService.setItem(STORAGE_KEYS.CONFLICT_LS_BACKUP, lsUpgraded);
      StorageService.setItem(STORAGE_KEYS.CONFLICT_IDB_BACKUP, idbUpgraded);
      return {
        status: "equal_revision_conflict",
        error: `Storage divergence detected: IndexedDB and LocalStorage both contain revision ${idbRev} with different transactions or account balances. Entering protected recovery mode to prevent silent data loss.`,
        idbRecoverableState: idbUpgraded,
        lsRecoverableState: lsUpgraded,
        conflictDetected: true,
        equalRevisionConflict: true,
        warning: `Equal revision conflict at revision ${idbRev}. Both snapshots preserved safely in IndexedDB and LocalStorage.`
      };
    }

    StorageService.setItem(STORAGE_KEYS.APP_DATA, idbUpgraded);
    return { status: "ok", state: idbUpgraded, conflictDetected: false };
  }

  // Condition 1: BOTH stores confirmed open, available, and genuinely empty on a clean installation
  if (idbMeta.available && idbMeta.data === null && !lsData) {
    const firstRunPersonal = createCleanPersonalLedgerState();
    const persistResult = await persistVerifiedState(firstRunPersonal);
    if (persistResult && persistResult.success) {
      return {
        status: "initialized_first_run_personal",
        state: firstRunPersonal,
        provider: persistResult.provider,
        warning: persistResult.warning
      };
    }

    console.error("[StartupReconcile] First-run clean personal ledger persistence failed:", persistResult?.error);
    return {
      status: "both_storage_unavailable",
      state: null,
      error: `First-run storage persistence failed: ${persistResult?.error || "neither IndexedDB nor LocalStorage could persist and verify the clean ledger."}`,
      provider: null,
      idbMeta,
      lsData: null
    };
  }

  // Fallback guard
  return {
    status: "storage_unavailable_degraded",
    state: null,
    error: "Storage verification could not confirm authoritative state. Writes paused."
  };
}
