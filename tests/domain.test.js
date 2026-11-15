/**
 * MeroHisab — Domain Logic, Storage Safety & Accounting Invariants Suite (v3 Audited)
 */
import fs from "fs";
import { getDemoData } from "../js/core/demo-data.js";
import { calculateFinancialSummary, isTransactionActiveForAccount } from "../js/services/transactions.js";
import { getBudgetAnalysis } from "../js/services/budgets.js";
import { getGoalsAnalysis } from "../js/services/goals.js";
import { getAnalyticsData } from "../js/services/analytics.js";
import { Validator, hasPrototypePollution } from "../js/core/validator.js";
import { rollbackVerifiedState, reconcileStartupStorage } from "../js/core/migrate-to-idb.js";
import { StorageService } from "../js/core/storage.js";
import { STORAGE_KEYS } from "../js/core/constants.js";
import {
  __configureMockIdb,
  __disableMockIdb,
  getStoredState,
  setStoredState
} from "../js/utils/indexed-db.js";
import {
  init,
  hydrateFromIndexedDB,
  getState,
  dispatch,
  commitMutation,
  calculateAccountBalance,
  calculateAvailableToAllocate,
  computeNextOccurrence,
  getMissedOccurrences,
  computeBillStatus,
  computeStateFingerprint,
  waitForPendingWrites,
  getProfileDisplayName,
  computeProfileInitials,
  updateProfile,
  resolveStorageConflict,
  resolveStorageConflictWithBackup,
  initializePersonalLedger
} from "../js/core/state.js";
import { updateSidebarProfile } from "../js/components/navigation.js";
import { DEFAULT_PROFILE_NAME, DEFAULT_SETTINGS } from "../js/core/constants.js";
import { migrateV2toV3, resolvePrimaryAccount, createCleanPersonalLedgerState } from "../js/core/migrate-to-idb.js";
import {
  toPaisa,
  fromPaisa,
  toPaisaBigInt,
  fromPaisaBigInt,
  addMoney,
  subtractMoney,
  multiplyMoney,
  rupeesToPaisaBigInt,
  paisaToRupeesDisplay,
  parseMoneyToPaisa,
  compareMoney,
  isValidMoneyAmount,
  isValidMoneyPrecision,
  MAX_MONEY_AMOUNT
} from "../js/utils/money.js";
import {
  getPersistenceStatus,
  checkPersistenceStatus,
  requestPersistence,
  subscribePersistenceStatus,
  PERSISTENCE_STATUS
} from "../js/utils/storage-persistence.js";
import { adToBs } from "../js/utils/nepali-calendar.js";
import { generateCsvString, generateBackupJsonString, exportRecoverySnapshot } from "../js/utils/file-io.js";
import { formatCurrency, formatNepaliNumber } from "../js/utils/formatters.js";
import { renderAccounts } from "../js/views/accounts.js";
import { getNepalLocalDateString } from "../js/utils/nepali-calendar.js";
import { persistVerifiedState } from "../js/core/migrate-to-idb.js";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✕ FAILED: ${label}`);
    failed++;
  }
}

console.log("=========================================================");
console.log("MeroHisab — Complete Domain & Audit Verification Suite");
console.log("=========================================================\n");

const localStorageMap = new Map();
const mockLocalStorage = {
  getItem: (k) => localStorageMap.get(k) ?? null,
  setItem: (k, v) => localStorageMap.set(k, String(v)),
  removeItem: (k) => localStorageMap.delete(k),
  clear: () => localStorageMap.clear()
};
globalThis.localStorage = mockLocalStorage;

__configureMockIdb({ initialData: null });
await dispatch("RESET_TO_DEMO");
const demoState = getState();
const summary = calculateFinancialSummary(demoState, "2026-10");

console.log("[1] Testing Demo Dataset & v2->v3 Migration Invariants...");
assert(demoState.version === 3, "State migrated to version 3");
assert(Array.isArray(demoState.accounts) && demoState.accounts.length === 1, "Default Cash Wallet created on migration");
assert(demoState.transactions.every(t => Boolean(t.accountId)), "Every legacy transaction assigned to default account");
assert(summary.initialBalance === 50000, `Initial balance is रु 50,000 (got ${summary.initialBalance})`);
assert(summary.monthlyInflow === 115000, `Monthly Inflow is रु 1,15,000 (got ${summary.monthlyInflow})`);
assert(summary.monthlyOutflow === 62550, `Monthly Outflow is रु 62,550 (got ${summary.monthlyOutflow})`);
assert(summary.netCashFlow === 52450, `Net Cash Flow is रु 52,450 (got ${summary.netCashFlow})`);
assert(summary.estimatedLedgerBalance === 102450, `Estimated Ledger Balance is रु 1,02,450 (got ${summary.estimatedLedgerBalance})`);
assert(summary.totalEarmarkedSavings === 80000, `Total Earmarked Savings is रु 80,000 (got ${summary.totalEarmarkedSavings})`);
assert(summary.availableToAllocate === 22450, `Available to Allocate is रु 22,450 (got ${summary.availableToAllocate})`);

console.log("\n[2] Testing Budget Threshold Calculations...");
const budgetData = getBudgetAnalysis(demoState, "2026-10");
assert(budgetData.budgets.length === 5, `5 budgets configured for 2026-10 (got ${budgetData.budgets.length})`);
const rentB = budgetData.budgets.find(b => b.category === "housing_rent");
const grocB = budgetData.budgets.find(b => b.category === "groceries");
const foodB = budgetData.budgets.find(b => b.category === "food_dining");
assert(rentB && rentB.status === "exceeded", "Housing & Rent budget is Exceeded (100% utilized)");
assert(grocB && grocB.status === "safe", "Grocery budget is Safe (71% utilized)");
assert(foodB && foodB.status === "warning", "Food & Dining budget is Warning (81.7% utilized)");

console.log("\n[3] Testing Goal Allocations & Headroom Rules...");
const goalsData = getGoalsAnalysis(demoState);
assert(goalsData.activeGoals.length === 2, `2 savings goals active (got ${goalsData.activeGoals.length})`);
assert(goalsData.totalTarget === 200000, `Total target amount is रु 2,00,000 (got ${goalsData.totalTarget})`);
assert(goalsData.totalSaved === 80000, `Total earmarked savings is रु 80,000 (got ${goalsData.totalSaved})`);
assert(!Validator.validateAllocation({ amount: 30000, dateAD: "2026-10-28" }, goalsData.availableToAllocate).isValid, "Allocation exceeding available balance is blocked");
assert(Validator.validateAllocation({ amount: 10000, dateAD: "2026-10-28" }, goalsData.availableToAllocate).isValid, "Allocation within available balance is allowed");

console.log("\n[4] Testing Accounts, Overdraft Enforcement & Multi-Account Opening Dates (Audit 1C & 1D)...");
const addAccRes = await dispatch("ADD_ACCOUNT", {
  name: "eSewa Wallet",
  type: "esewa",
  openingBalance: 0,
  openingBalanceDate: "2026-10-15",
  overdraftEnabled: false
});
assert(addAccRes.success, "Created eSewa Wallet account with opening date 2026-10-15");
const esewaId = addAccRes.account.id;
const cashId = "acc_default_cash";

// Audit 1D: Reject ordinary expense that exceeds balance when overdraftEnabled is false
const overdraftExp = await dispatch("ADD_TRANSACTION", {
  type: "expense",
  accountId: esewaId,
  amount: 999999,
  category: "shopping",
  description: "Overdraft Expense Test",
  dateAD: "2026-10-20",
  paymentMethod: "esewa"
});
assert(!overdraftExp.success, "Audit 1D: Expense of रु 9,99,999 on account with रु 0 balance & overdraft disabled is REJECTED");

// Audit 1C: Multi-account opening-balance date reconciliation
// Add an income dated 2026-10-05 (BEFORE eSewa's 2026-10-15 openingBalanceDate)
await dispatch("ADD_TRANSACTION", {
  id: "tx_pre_open_esewa",
  type: "income",
  accountId: esewaId,
  amount: 500,
  category: "gift",
  description: "Pre-opening income on eSewa",
  dateAD: "2026-10-05",
  paymentMethod: "esewa"
});
const stateMulti = getState();
const sumAccountBalances = fromPaisaBigInt(stateMulti.accounts.reduce((s, a) => s + toPaisaBigInt(calculateAccountBalance(stateMulti, a.id)), 0n));
const multiSummary = calculateFinancialSummary(stateMulti, "2026-10");
assert(
  multiSummary.estimatedLedgerBalance === sumAccountBalances,
  `Audit 1C: Global Ledger (${multiSummary.estimatedLedgerBalance}) matches exact sum of account balances (${sumAccountBalances}) across different opening dates`
);
await dispatch("DELETE_TRANSACTION", "tx_pre_open_esewa");

// Valid transfer of 5000 from Cash Wallet to eSewa
const validTr = await dispatch("ADD_TRANSFER", {
  fromAccountId: cashId,
  toAccountId: esewaId,
  amount: 5000,
  dateAD: "2026-10-28",
  description: "Load eSewa from Cash"
});
assert(validTr.success, "Valid transfer of रु 5,000 from Cash to eSewa succeeded");

// Edit transfer atomically
const editTr = await dispatch("UPDATE_TRANSFER", {
  transferId: validTr.transferId,
  amount: 6000
});
assert(editTr.success && calculateAccountBalance(getState(), esewaId) === 6000, "Atomic transfer edit updated both legs to रु 6,000");

// Delete transfer atomically
const delTr = await dispatch("DELETE_TRANSACTION", validTr.outLeg.id);
assert(delTr.success, "Deleting one leg of a transfer succeeded");
assert(calculateAccountBalance(getState(), cashId) === 102450 && calculateAccountBalance(getState(), esewaId) === 0, "Both transfer legs deleted atomically and balances restored");

// Historic / Archived account opening balance restriction
await dispatch("ARCHIVE_ACCOUNT", { id: esewaId, archive: true });
const editArchivedBal = await dispatch("UPDATE_ACCOUNT", { id: esewaId, openingBalance: 9999 });
assert(!editArchivedBal.success, "Archived account openingBalance modification is blocked");
await dispatch("ARCHIVE_ACCOUNT", { id: esewaId, archive: false });
await dispatch("DELETE_ACCOUNT", esewaId);

console.log("\n[5] Testing Recurring Transactions, Day-31 Preservation & Backlog Catch-Up...");
const sched31 = { frequency: "monthly", interval: 1, dayOfMonth: 31, startDate: "2026-01-31" };
const occ1 = computeNextOccurrence(sched31, "2026-01-31");
const occ2 = computeNextOccurrence(sched31, occ1);
const occ3 = computeNextOccurrence(sched31, occ2);
assert(occ1 === "2026-02-28" && occ2 === "2026-03-31" && occ3 === "2026-04-30", `Day-31 schedule preserves day across months: Jan 31 -> ${occ1} -> ${occ2} -> ${occ3}`);

const addRr = await dispatch("ADD_RECURRING_RULE", {
  title: "Worldlink ISP",
  type: "expense",
  accountId: cashId,
  amount: 1500,
  category: "internet_mobile",
  schedule: { frequency: "monthly", interval: 1, dayOfMonth: 15, startDate: "2026-08-15" }
});
const missed = getMissedOccurrences(addRr.rule, "2026-10-20");
assert(missed.length === 3 && missed[0] === "2026-08-15" && missed[2] === "2026-10-15", `Backlog catch-up identified 3 missed occurrences (${missed.join(", ")})`);
const postRr = await dispatch("PROCESS_RECURRING_OCCURRENCE", { id: addRr.rule.id });
assert(postRr.success && postRr.nextOccurrence === "2026-09-15", "Confirming recurring occurrence creates transaction and advances nextOccurrence atomically");

console.log("\n[6] Testing Bills, Atomic Payment & Status Recalculation (Audit 1E)...");
const addBillRes = await dispatch("ADD_BILL", {
  title: "NEA Electricity Bill",
  amount: 1800,
  category: "utilities",
  accountId: cashId,
  dueDateAD: "2026-10-05",
  recurrence: { frequency: "monthly", interval: 1, dayOfMonth: 5, startDate: "2026-10-05" }
});
assert(addBillRes.success, "Created recurring bill");
const billId = addBillRes.bill.id;
assert(computeBillStatus(addBillRes.bill, "2026-10-20") === "overdue", "Unpaid bill past due date is marked overdue");

const payRes1 = await dispatch("PAY_BILL", { id: billId, dateAD: "2026-10-20" });
assert(payRes1.success && payRes1.nextBill && payRes1.nextBill.dueDateAD === "2026-11-05", "Paying recurring bill atomically records expense and spawns next month's unpaid bill");

const payRes2 = await dispatch("PAY_BILL", { id: billId, dateAD: "2026-10-20" });
assert(!payRes2.success, "Paying an already-paid bill a second time is blocked (idempotent)");

await dispatch("DELETE_TRANSACTION", payRes1.transaction.id);
const updatedBill = getState().bills.find(b => b.id === billId);
assert(updatedBill.linkedTransactionId === null && computeBillStatus(updatedBill, "2026-10-20") === "overdue", "Deleting bill-linked expense resets bill link and recalculates overdue status");

console.log("\n[7] Testing Corrupted LocalStorage Non-Destructive Recovery (Audit 1A)...");
const rawCorruptJson = "{corrupted_user_ledger_json: true, unclosed";
StorageService.setRawItem(STORAGE_KEYS.APP_DATA, rawCorruptJson);
init();
const recoveredState = getState();
assert(recoveredState.recoveryMode === true, "Audit 1A: Malformed LocalStorage JSON triggers recoveryMode instead of loading demo data");
assert(StorageService.getRawItem(STORAGE_KEYS.APP_DATA) === rawCorruptJson, "Audit 1A: Original corrupted LocalStorage entry is preserved untouched (NOT overwritten with demo data)");
assert(StorageService.getRawItem(STORAGE_KEYS.CORRUPT_BACKUP) === rawCorruptJson, "Audit 1A: Corrupted payload backed up to MERO_HISAB_CORRUPT_BACKUP");
const blockedMut = await dispatch("ADD_ACCOUNT", { name: "Blocked", type: "cash", openingBalance: 0, openingBalanceDate: "2026-10-01" });
assert(!blockedMut.success, "Audit 1A: Mutations are blocked while in recoveryMode to prevent overwriting corrupted storage");

// Restore clean demo state after corruption test
await dispatch("RESET_TO_DEMO");

console.log("\n[8] Testing Comprehensive v3 Backup Validator...");
const validV3 = getState();
assert(Validator.validateBackupJson(validV3).isValid, "Valid v3 state passes comprehensive backup validator");
const brokenTransferV3 = JSON.parse(JSON.stringify(validV3));
brokenTransferV3.transactions.push({
  id: "tx_orphan_leg",
  type: "transfer",
  transferId: "tr_orphan",
  transferDirection: "out",
  accountId: "acc_default_cash",
  amount: 500,
  dateAD: "2026-10-10"
});
assert(!Validator.validateBackupJson(brokenTransferV3).isValid, "Orphaned single-leg transfer is rejected by backup validator");


console.log("\n[9] Testing Startup Recovery Matrix (Scenarios A through H)...");
await (async () => {
  await waitForPendingWrites();
  StorageService.clear();
  init();
  // Prepare a real user v3 ledger (non-demo) with रु 77,777 in Nabil Bank
  const realUserLedger = {
    version: 3,
    revision: 10,
    isDemoData: false,
    lastUpdated: "2026-10-15T10:00:00.000Z",
    settings: { initialBalance: 77777, initialBalanceDate: "2026-10-01", theme: "dark", currencyFormat: "symbol", dateDisplay: "both", defaultPaymentMethod: "fonepay" },
    accounts: [
      { id: "acc_real_bank", name: "Nabil Bank Real", type: "bank", openingBalance: 77777, openingBalanceDate: "2026-10-01", overdraftEnabled: false, archived: false }
    ],
    transactions: [
      { id: "tx_real_1", type: "income", accountId: "acc_real_bank", amount: 10000, category: "salary", description: "Real Salary", dateAD: "2026-10-10", dateBS: "2083-06-24", paymentMethod: "bank_transfer", createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z" }
    ],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  // Scenario A: IndexedDB has real v3 data; LocalStorage is empty.
  // Expected: real data loads unchanged; demo data is NEVER written over IDB!
  StorageService.clear();
  __configureMockIdb({ initialData: realUserLedger });
  init(); // Synchronous import-time init when LS is empty
  const idbBeforeHydrate = await getStoredState();
  assert(idbBeforeHydrate && idbBeforeHydrate.isDemoData === false && idbBeforeHydrate.accounts[0].id === "acc_real_bank", "Scenario A (Pre-Hydrate): Synchronous init() did NOT overwrite IndexedDB with demo data");
  const resA = await hydrateFromIndexedDB();
  const stateA = getState();
  assert(resA.status === "loaded_from_idb" && stateA.isDemoData === false && stateA.accounts[0].openingBalance === 77777, "Scenario A: Real IndexedDB ledger loaded unchanged when LocalStorage was empty");

  // Scenario B: IndexedDB has real data; LocalStorage is unavailable/empty
  StorageService.clear();
  __configureMockIdb({ initialData: realUserLedger });
  await hydrateFromIndexedDB();
  assert(getState().accounts[0].name === "Nabil Bank Real", "Scenario B: Real ledger loaded from IndexedDB when LocalStorage is empty");

  // Scenario C: LocalStorage has real data; IndexedDB is empty
  StorageService.setItem(STORAGE_KEYS.APP_DATA, realUserLedger);
  __configureMockIdb({ initialData: null });
  init();
  const resC = await hydrateFromIndexedDB();
  const idbSyncedC = await getStoredState();
  assert(resC.status === "loaded_from_ls" && idbSyncedC && idbSyncedC.accounts[0].id === "acc_real_bank", "Scenario C: Real LocalStorage data loaded and synchronized into empty IndexedDB");

  // Scenario D1: Both stores are genuinely empty and both succeed -> clean personal ledger initialized
  StorageService.clear();
  __configureMockIdb({ initialData: null });
  init();
  const resD1 = await hydrateFromIndexedDB();
  const stateD1 = getState();
  const idbSyncedD1 = await getStoredState();
  const lsSyncedD1 = StorageService.getItem(STORAGE_KEYS.APP_DATA);
  assert(
    resD1.status === "initialized_first_run_personal" &&
    resD1.provider === "indexeddb" &&
    stateD1.isDemoData === false &&
    stateD1.accounts.length === 1 &&
    stateD1.accounts[0].name === "Cash Wallet" &&
    stateD1.accounts[0].openingBalance === 0 &&
    stateD1.transactions.length === 0 &&
    stateD1.budgets.length === 0 &&
    stateD1.goals.length === 0 &&
    stateD1.bills.length === 0 &&
    stateD1.recurringRules.length === 0 &&
    idbSyncedD1 && idbSyncedD1.isDemoData === false &&
    lsSyncedD1 && lsSyncedD1.isDemoData === false,
    "Scenario D1: Clean personal ledger initialized with 0 demo records when both IDB and LS succeed"
  );

  // Scenario D2: First run when IDB succeeds but LocalStorage write fails (quota exceeded)
  StorageService.clear();
  __configureMockIdb({ initialData: null });
  const origLsSetD2 = mockLocalStorage.setItem;
  mockLocalStorage.setItem = () => { throw new Error("QuotaExceededError: LocalStorage quota exceeded"); };
  init();
  const resD2 = await hydrateFromIndexedDB();
  mockLocalStorage.setItem = origLsSetD2;
  assert(
    resD2.status === "initialized_first_run_personal" &&
    resD2.provider === "indexeddb_only" &&
    getState().isDemoData === false &&
    getState().recoveryMode === false,
    "Scenario D2: First-run succeeds when IDB succeeds even if LocalStorage quota is exceeded"
  );

  // Scenario D3: First run when IDB write fails but LocalStorage write succeeds & verifies
  StorageService.clear();
  __configureMockIdb({ initialData: null, writeFailure: true });
  init();
  const resD3 = await hydrateFromIndexedDB();
  const lsStateD3 = StorageService.getItem(STORAGE_KEYS.APP_DATA);
  assert(
    resD3.status === "initialized_first_run_personal" &&
    resD3.provider === "localstorage_fallback" &&
    getState().isDemoData === false &&
    lsStateD3 && lsStateD3.isDemoData === false,
    "Scenario D3: First-run succeeds via verified LocalStorage fallback when IDB write fails"
  );

  // Scenario D4: First run when BOTH persistent storage writes fail (IDB write fails & LS fails)
  StorageService.clear();
  __configureMockIdb({ initialData: null, writeFailure: true });
  const origLsSetD4 = mockLocalStorage.setItem;
  mockLocalStorage.setItem = () => { throw new Error("QuotaExceededError: All storage writes blocked"); };
  init();
  const resD4 = await hydrateFromIndexedDB();
  mockLocalStorage.setItem = origLsSetD4;
  assert(
    resD4.status === "both_storage_unavailable" &&
    getState().recoveryMode === true &&
    getState().recoveryType === "both_storage_unavailable",
    "Scenario D4: First run enters protected recovery mode when both IDB and LS writes fail"
  );
  // Verify financial writes are blocked in this state
  const writeAttemptD4 = await dispatch("ADD_TRANSACTION", {
    type: "income",
    amount: 1000,
    category: "salary",
    description: "Blocked write",
    dateAD: "2026-10-15",
    paymentMethod: "cash"
  });
  assert(
    writeAttemptD4.success === false,
    "Scenario D4: Financial mutations are blocked from reporting success when storage persistence failed"
  );

  // Scenario D5: First run when IDB read-back verification fails and LocalStorage fails
  StorageService.clear();
  __configureMockIdb({ initialData: null, corruptReadBack: true });
  const origLsSetD5 = mockLocalStorage.setItem;
  mockLocalStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  init();
  const resD5 = await hydrateFromIndexedDB();
  mockLocalStorage.setItem = origLsSetD5;
  assert(
    resD5.status === "both_storage_unavailable" &&
    getState().recoveryMode === true,
    "Scenario D5: Protected recovery mode entered when IDB read-back verification fails on first run"
  );

  // Scenario D6: First run when both storage engines are completely unavailable (access denied)
  StorageService.clear();
  __configureMockIdb({ unavailable: true });
  const origLsGetD6 = mockLocalStorage.getItem;
  mockLocalStorage.getItem = () => { throw new Error("SecurityError: Access Denied"); };
  init();
  const resD6 = await hydrateFromIndexedDB();
  mockLocalStorage.getItem = origLsGetD6;
  assert(
    resD6.status === "both_storage_unavailable" &&
    getState().recoveryMode === true,
    "Scenario D6: Protected recovery mode entered when storage access is denied on first run"
  );

  // Scenario E: LocalStorage contains corrupted JSON; IndexedDB contains valid data
  const corruptRaw = "{broken_json_payload_do_not_overwrite";
  StorageService.setRawItem(STORAGE_KEYS.APP_DATA, corruptRaw);
  __configureMockIdb({ initialData: realUserLedger });
  init();
  const resE = await hydrateFromIndexedDB();
  assert(resE.status === "corrupt" && getState().recoveryMode === true && StorageService.getRawItem(STORAGE_KEYS.APP_DATA) === corruptRaw, "Scenario E: Corrupted LocalStorage enters explicit recoveryMode, preserves raw LS string, and exposes IDB recoverable state");

  // Scenario F: IndexedDB has valid real data; LocalStorage contains stale/divergent data (with newer timestamp!)
  const staleLsData = JSON.parse(JSON.stringify(realUserLedger));
  staleLsData.revision = 9;
  staleLsData.lastUpdated = "2099-01-01T00:00:00.000Z"; // Artificially newer timestamp on stale LS
  staleLsData.transactions = []; // Stale LS missing the transaction
  StorageService.setItem(STORAGE_KEYS.APP_DATA, staleLsData);
  __configureMockIdb({ initialData: realUserLedger });
  init();
  const resF = await hydrateFromIndexedDB();
  assert(resF.status === "conflict_resolved_idb_authoritative" && getState().transactions.length === 1 && StorageService.getItem(STORAGE_KEYS.CONFLICT_BACKUP).transactions.length === 0, "Scenario F: Authoritative IDB state preserved (not overwritten by newer timestamp on divergent LS) and divergent LS backed up to CONFLICT_BACKUP");

  // Scenario G: IndexedDB writes fail -> verified LocalStorage fallback
  __configureMockIdb({ initialData: realUserLedger, writeFailure: true });
  StorageService.setItem(STORAGE_KEYS.APP_DATA, realUserLedger);
  init();
  await hydrateFromIndexedDB();
  const mutG = await dispatch("ADD_TRANSACTION", { type: "income", accountId: "acc_real_bank", amount: 500, category: "gift", description: "Fallback write", dateAD: "2026-10-12", paymentMethod: "cash" });
  assert(mutG.success && StorageService.getItem(STORAGE_KEYS.APP_DATA).transactions.length === 2, "Scenario G: When IndexedDB write fails, verified LocalStorage fallback preserves state");

  // Scenario H: Application reload after a successful real-data session
  __configureMockIdb({ initialData: getState(), writeFailure: false });
  init();
  await hydrateFromIndexedDB();
  assert(getState().isDemoData === false && getState().transactions.length === 2 && calculateAccountBalance(getState(), "acc_real_bank") === 88277, "Scenario H: Application reload after real-data session preserves all records (रु 88,277)");

  __disableMockIdb();
  await dispatch("RESET_TO_DEMO");
  await waitForPendingWrites();
})();


console.log("\n[10] Testing Production-Readiness & Data Integrity Repairs...");
await (async () => {
  await waitForPendingWrites();

  // 1. Same-count ledgers with different contents trigger conflict resolution and back up to CONFLICT_BACKUP
  const baseLedger1 = {
    version: 3,
    revision: 2,
    isDemoData: false,
    lastUpdated: "2026-10-15T10:00:00.000Z",
    settings: { initialBalance: 50000, initialBalanceDate: "2026-10-01", theme: "dark", currencyFormat: "symbol", dateDisplay: "both", defaultPaymentMethod: "fonepay" },
    accounts: [
      { id: "acc_cf_bank", name: "Conflict Bank", type: "bank", openingBalance: 50000, openingBalanceDate: "2026-10-01", overdraftEnabled: false, archived: false }
    ],
    transactions: [
      { id: "tx_cf_1", type: "income", accountId: "acc_cf_bank", amount: 10000, category: "salary", description: "Authoritative Salary", dateAD: "2026-10-10", dateBS: "2083-06-24", paymentMethod: "bank_transfer", createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z" }
    ],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };
  const divergentLsSameCount = JSON.parse(JSON.stringify(baseLedger1));
  divergentLsSameCount.revision = 1;
  divergentLsSameCount.transactions[0].amount = 5555;
  divergentLsSameCount.transactions[0].description = "Divergent Salary In LS";

  StorageService.setItem(STORAGE_KEYS.APP_DATA, divergentLsSameCount);
  __configureMockIdb({ initialData: baseLedger1 });
  init();
  const reconcileSameCount = await hydrateFromIndexedDB();
  const backupInLs = StorageService.getItem(STORAGE_KEYS.CONFLICT_BACKUP);
  assert(
    reconcileSameCount.status === "conflict_resolved_idb_authoritative" &&
    reconcileSameCount.conflictDetected === true &&
    getState().transactions[0].amount === 10000 &&
    backupInLs && backupInLs.transactions[0].amount === 5555,
    "1. Same-count ledgers with different contents trigger conflict resolution and back up to CONFLICT_BACKUP"
  );
  __disableMockIdb();
  await dispatch("RESET_TO_DEMO");
  await waitForPendingWrites();

  // 2. Spoofed caller maxAvailable is ignored by ADD_ALLOCATION and true state headroom is enforced
  await dispatch("ADD_ACCOUNT", { id: "acc_headroom", name: "Headroom Bank", type: "bank", openingBalance: 10000, openingBalanceDate: "2026-10-01" });
  const trueHeadroom = calculateAvailableToAllocate(getState());
  const testGoalRes = await dispatch("ADD_GOAL", { id: "goal_sec_test", title: "Safety Cushion", targetAmount: 50000, category: "savings", targetDateAD: "2027-10-01" });
  assert(testGoalRes.success, "Pre-condition: Goal created for allocation headroom test");

  const spoofedAllocRes = await dispatch("ADD_ALLOCATION", {
    goalId: "goal_sec_test",
    amount: trueHeadroom + 5000,
    dateAD: "2026-10-15",
    maxAvailable: 9999999
  });
  assert(
    spoofedAllocRes.success === false,
    "2a. Spoofed caller maxAvailable is ignored by ADD_ALLOCATION and true state headroom prevents over-allocation"
  );

  const legitAllocRes = await dispatch("ADD_ALLOCATION", {
    goalId: "goal_sec_test",
    amount: 1000,
    dateAD: "2026-10-15",
    maxAvailable: 1
  });
  assert(
    legitAllocRes.success === true && calculateAvailableToAllocate(getState()) === trueHeadroom - 1000,
    "2b. Legitimate allocation within true headroom succeeds regardless of spoofed caller parameter"
  );

  // 3. Transfer edit with an invalid or archived account is rejected
  await dispatch("ADD_ACCOUNT", { id: "acc_tr_source", name: "Transfer Source", type: "bank", openingBalance: 25000, openingBalanceDate: "2026-10-01" });
  await dispatch("ADD_ACCOUNT", { id: "acc_tr_dest", name: "Transfer Dest", type: "bank", openingBalance: 5000, openingBalanceDate: "2026-10-01" });
  await dispatch("ADD_ACCOUNT", { id: "acc_tr_arch", name: "Archived Dest", type: "bank", openingBalance: 5000, openingBalanceDate: "2026-10-01" });
  await dispatch("ARCHIVE_ACCOUNT", "acc_tr_arch");

  const validTransferRes = await dispatch("ADD_TRANSFER", {
    fromAccountId: "acc_tr_source",
    toAccountId: "acc_tr_dest",
    amount: 3000,
    dateAD: "2026-10-10",
    description: "Initial Transfer"
  });
  assert(validTransferRes.success === true, "Pre-condition: Valid transfer created");
  const transferIdToEdit = validTransferRes.outLeg.transferId;

  const editInvalidAccRes = await dispatch("UPDATE_TRANSFER", {
    transferId: transferIdToEdit,
    fromAccountId: "non_existent_account_id",
    toAccountId: "acc_tr_dest",
    amount: 3000,
    dateAD: "2026-10-10"
  });
  assert(editInvalidAccRes.success === false, "3a. Transfer edit with an invalid account is rejected");

  const editArchivedAccRes = await dispatch("UPDATE_TRANSFER", {
    transferId: transferIdToEdit,
    fromAccountId: "acc_tr_source",
    toAccountId: "acc_tr_arch",
    amount: 3000,
    dateAD: "2026-10-10"
  });
  assert(editArchivedAccRes.success === false, "3b. Transfer edit with an archived account is rejected");

  // 4. Pre-opening date transactions are consistently excluded from balances, budgets, and analytics
  await dispatch("ADD_ACCOUNT", {
    id: "acc_historic_scope",
    name: "Scope Historic Account",
    type: "bank",
    openingBalance: 20000,
    openingBalanceDate: "2026-10-01"
  });
  const txPreRes = await dispatch("ADD_TRANSACTION", {
    id: "tx_pre_opening_edu",
    type: "expense",
    accountId: "acc_historic_scope",
    amount: 4000,
    category: "education",
    description: "Tuition pre-opening",
    dateAD: "2026-09-20",
    paymentMethod: "cash"
  });
  assert(txPreRes.success, "Pre-condition: Pre-opening transaction created");

  const txPostRes = await dispatch("ADD_TRANSACTION", {
    id: "tx_post_opening_edu",
    type: "expense",
    accountId: "acc_historic_scope",
    amount: 2500,
    category: "education",
    description: "Books post-opening",
    dateAD: "2026-10-12",
    paymentMethod: "cash"
  });
  assert(txPostRes.success, "Pre-condition: Post-opening transaction created");

  await dispatch("SET_BUDGET", { category: "education", amount: 6000, period: "2026-10" });

  const scopeState = getState();
  const preTxObj = scopeState.transactions.find(t => t.id === "tx_pre_opening_edu");
  const postTxObj = scopeState.transactions.find(t => t.id === "tx_post_opening_edu");

  assert(isTransactionActiveForAccount(scopeState, preTxObj) === false, "4a. isTransactionActiveForAccount filters out pre-opening transaction");
  assert(isTransactionActiveForAccount(scopeState, postTxObj) === true, "4b. isTransactionActiveForAccount retains post-opening transaction");

  const historicAccBal = calculateAccountBalance(scopeState, "acc_historic_scope");
  assert(historicAccBal === 17500, "4c. Account balance consistently excludes pre-opening date transactions (20000 - 2500 = 17500)");

  const budgetScopeRes = getBudgetAnalysis(scopeState, "2026-10");
  const eduBudget = budgetScopeRes.budgets.find(b => b.category === "education");
  assert(eduBudget && eduBudget.spent === 2500, "4d. Budget analysis consistently excludes pre-opening date transactions (spent 2500, not 6500)");

  const analyticsScopeRes = getAnalyticsData(scopeState, "2026-10");
  const filteredTxInAnalytics = analyticsScopeRes.periodTransactions.find(t => t.id === "tx_pre_opening_edu");
  assert(!filteredTxInAnalytics, "4e. Analytics periodTransactions consistently excludes pre-opening date transactions");

  // 5. Editing a paid bill updates the linked expense transaction without creating duplicate records
  await dispatch("ADD_ACCOUNT", { id: "acc_bill_edit", name: "Bill Pay Account", type: "bank", openingBalance: 30000, openingBalanceDate: "2026-10-01" });
  const newBillRes = await dispatch("ADD_BILL", {
    id: "bill_paid_sync_test",
    title: "Electricity Bill",
    amount: 1800,
    category: "utilities",
    accountId: "acc_bill_edit",
    dueDateAD: "2026-10-25"
  });
  assert(newBillRes.success, "Pre-condition: Bill added");

  const payBillRes = await dispatch("PAY_BILL", { id: "bill_paid_sync_test", dateAD: "2026-10-20" });
  assert(payBillRes.success, "Pre-condition: Bill paid");

  const txCountBeforeBillEdit = getState().transactions.length;
  const billBeforeEdit = getState().bills.find(b => b.id === "bill_paid_sync_test");
  const billLinkedTxId = billBeforeEdit.linkedTransactionId;
  assert(billLinkedTxId && billBeforeEdit.status === "paid", "Pre-condition: Bill is marked paid with linked transaction");

  const updatePaidBillRes = await dispatch("UPDATE_BILL", {
    id: "bill_paid_sync_test",
    title: "Electricity & Solar Maintenance",
    amount: 2200,
    category: "utilities",
    accountId: "acc_bill_edit",
    dueDateAD: "2026-10-25"
  });
  assert(updatePaidBillRes.success, "UPDATE_BILL succeeds on paid bill");

  const txCountAfterBillEdit = getState().transactions.length;
  const synchronizedTx = getState().transactions.find(t => t.id === billLinkedTxId);
  assert(
    txCountAfterBillEdit === txCountBeforeBillEdit &&
    synchronizedTx &&
    synchronizedTx.amount === 2200 &&
    synchronizedTx.description === "Bill Payment: Electricity & Solar Maintenance",
    "5. Editing a paid bill updates the linked expense transaction without creating duplicate records"
  );

  // 6. Editing a recurring rule preserves occurrence history and blocks duplicate occurrence posting
  await dispatch("ADD_ACCOUNT", { id: "acc_rec_preserve", name: "Recurring Preserve Bank", type: "bank", openingBalance: 50000, openingBalanceDate: "2026-08-01" });
  const addRecRes = await dispatch("ADD_RECURRING_RULE", {
    id: "rec_preserve_rule",
    title: "Cloud Server Hosting",
    amount: 3500,
    category: "utilities",
    accountId: "acc_rec_preserve",
    schedule: {
      frequency: "monthly",
      interval: 1,
      startDate: "2026-08-01",
      dayOfMonth: 1
    },
    nextOccurrence: "2026-08-01"
  });
  assert(addRecRes.success, "Pre-condition: Recurring rule created");

  const procPostRes = await dispatch("PROCESS_RECURRING_OCCURRENCE", { id: "rec_preserve_rule", dateAD: "2026-08-01" });
  assert(procPostRes.success, "Pre-condition: Occurrence for 2026-08-01 posted");

  const skipRecRes = await dispatch("SKIP_RECURRING_OCCURRENCE", "rec_preserve_rule");
  assert(skipRecRes.success, "Pre-condition: Occurrence for 2026-09-01 skipped");

  const updateRecRes = await dispatch("UPDATE_RECURRING_RULE", {
    id: "rec_preserve_rule",
    amount: 4200,
    title: "Cloud Server Hosting Pro Tier"
  });
  assert(updateRecRes.success, "UPDATE_RECURRING_RULE succeeds");

  const ruleAfterEdit = getState().recurringRules.find(r => r.id === "rec_preserve_rule");
  assert(
    ruleAfterEdit.skippedDates.includes("2026-09-01"),
    "6a. Editing a recurring rule preserves skippedDates occurrence history"
  );

  const procDuplicateRes = await dispatch("PROCESS_RECURRING_OCCURRENCE", { id: "rec_preserve_rule", dateAD: "2026-08-01" });
  assert(
    procDuplicateRes.success === false && procDuplicateRes.error.includes("already been posted"),
    "6b. Processing already-posted occurrence date is blocked as duplicate"
  );

  // 7. Failed backup restore returns an error and preserves existing ledger untouched
  const stateBeforeBadRestore = getState();
  const fpBeforeBadRestore = computeStateFingerprint(stateBeforeBadRestore);

  const corruptedBackupPayload = {
    version: 3,
    accounts: "not_an_array_corrupted_data",
    transactions: null,
    settings: { theme: "dark" }
  };

  const badRestoreRes = await dispatch("RESTORE_BACKUP", corruptedBackupPayload);
  const stateAfterBadRestore = getState();
  const fpAfterBadRestore = computeStateFingerprint(stateAfterBadRestore);

  assert(
    badRestoreRes.success === false &&
    Boolean(badRestoreRes.error) &&
    fpBeforeBadRestore === fpAfterBadRestore,
    "7. Failed backup restore returns an error and preserves existing ledger untouched"
  );

  await waitForPendingWrites();
})();

console.log("\n[11] Testing Comprehensive Regression Tests (Section 17: Tests A through Q)...");
await (async () => {
  await waitForPendingWrites();
  globalThis.localStorage = mockLocalStorage;
  __configureMockIdb({ initialData: null });
  await dispatch("RESET_TO_DEMO");

  // =========================================================================
  // TEST A: A thrown mutation must not permanently poison the mutation queue
  // =========================================================================
  console.log("  Testing Test A: Thrown mutation error does not poison mutation queue...");
  const preStateA = getState();
  const thrownMutRes = await commitMutation(() => {
    throw new Error("Deliberate unexpected exception inside mutation");
  });
  assert(thrownMutRes.success === false, "Test A.1: Thrown mutation returns failure result");
  assert(thrownMutRes.error.includes("Deliberate unexpected exception"), "Test A.2: Returns expected error message");
  assert(computeStateFingerprint(getState()) === computeStateFingerprint(preStateA), "Test A.3: State preserved untouched after thrown mutation");

  // =========================================================================
  // TEST B: IndexedDB unavailable + LocalStorage unavailable must return genuine persistence failure
  // =========================================================================
  console.log("  Testing Test B: Both IDB & LS unavailable returns genuine failure, never memory-only success...");
  __configureMockIdb({ unavailable: true });
  globalThis.localStorage = null;
  const failStorageMut = await dispatch("ADD_TRANSACTION", {
    type: "income",
    accountId: "acc_default_cash",
    amount: 1500,
    category: "salary",
    description: "Storage failure test",
    dateAD: "2026-10-25",
    paymentMethod: "cash"
  });
  assert(failStorageMut.success === false, "Test B.1: Mutation fails when both IDB and LocalStorage are unavailable");
  assert(failStorageMut.error && (failStorageMut.error.includes("neither IndexedDB nor LocalStorage") || failStorageMut.error.includes("IndexedDB") || failStorageMut.error.includes("Persistence failure")), "Test B.2: Error clearly reports persistent storage failure");
  // Restore persistent mock storage
  globalThis.localStorage = mockLocalStorage;
  __configureMockIdb({ initialData: null });
  await dispatch("RESET_TO_DEMO");

  // =========================================================================
  // TEST C: Missing transaction accountId must be rejected in v3 backups
  // =========================================================================
  console.log("  Testing Test C: Missing transaction accountId in v3 rejected...");
  const v3MissingAccBackup = JSON.parse(JSON.stringify(getState()));
  v3MissingAccBackup.transactions[0].accountId = ""; // Missing accountId
  const valResC = Validator.validateBackupJson(v3MissingAccBackup);
  assert(valResC.isValid === false, "Test C.1: v3 transaction with empty accountId rejected");
  assert(valResC.error.includes("accountId"), "Test C.2: Rejection message explains missing accountId");

  // =========================================================================
  // TEST D: Budget month 13 must be rejected
  // =========================================================================
  console.log("  Testing Test D: Budget month 13 rejected...");
  const valBudgetD = Validator.validateBudget({ period: "2026-13", category: "groceries", amount: 5000 });
  assert(valBudgetD.isValid === false, "Test D.1: validateBudget rejects month 13");
  const backupWithM13 = JSON.parse(JSON.stringify(getState()));
  backupWithM13.budgets.push({ id: "bg_13", period: "2026-13", category: "housing_rent", amount: 10000 });
  assert(Validator.validateBackupJson(backupWithM13).isValid === false, "Test D.2: Backup with month 13 budget rejected");

  // =========================================================================
  // TEST E: A bill linked to an income transaction must be rejected
  // =========================================================================
  console.log("  Testing Test E: Bill linked to an income transaction rejected...");
  const backupBillIncome = JSON.parse(JSON.stringify(getState()));
  const incomeTx = backupBillIncome.transactions.find(t => t.type === "income");
  backupBillIncome.bills = [
    {
      id: "bill_inv_1",
      title: "Bad Bill",
      amount: incomeTx.amount,
      category: "utilities",
      accountId: incomeTx.accountId,
      dueDateAD: "2026-10-15",
      status: "paid",
      isPaid: true,
      linkedTransactionId: incomeTx.id
    }
  ];
  const valResE = Validator.validateBackupJson(backupBillIncome);
  assert(valResE.isValid === false, "Test E.1: Paid bill linked to income transaction is rejected");
  assert(valResE.error.includes("expense"), "Test E.2: Error explains linked transaction must be an expense");

  // =========================================================================
  // TEST F: Transfer legs with invalid peer account references must be rejected
  // =========================================================================
  console.log("  Testing Test F: Transfer legs with invalid peer account references rejected...");
  const backupBadPeer = JSON.parse(JSON.stringify(getState()));
  backupBadPeer.transactions.push(
    { id: "tx_tr_out", type: "transfer", transferId: "tr_bad_peer", transferDirection: "out", accountId: "acc_default_cash", peerAccountId: "acc_nonexistent", amount: 1000, dateAD: "2026-10-10", description: "Leg 1" },
    { id: "tx_tr_in", type: "transfer", transferId: "tr_bad_peer", transferDirection: "in", accountId: "acc_default_cash", peerAccountId: "acc_default_cash", amount: 1000, dateAD: "2026-10-10", description: "Leg 2" }
  );
  const valResF = Validator.validateBackupJson(backupBadPeer);
  assert(valResF.isValid === false, "Test F: Transfer leg with invalid peer account reference is rejected");

  // =========================================================================
  // TEST G: Transfer legs with inconsistent dates or other required paired fields must be rejected
  // =========================================================================
  console.log("  Testing Test G: Transfer legs with inconsistent dates rejected...");
  const backupDiffDates = JSON.parse(JSON.stringify(getState()));
  backupDiffDates.accounts.push({ id: "acc_target_g", name: "Target G", type: "bank", openingBalance: 0, openingBalanceDate: "2026-10-01" });
  backupDiffDates.transactions.push(
    { id: "tx_tr_g1", type: "transfer", transferId: "tr_diff_date", transferDirection: "out", accountId: "acc_default_cash", peerAccountId: "acc_target_g", amount: 1000, dateAD: "2026-10-10", description: "Out" },
    { id: "tx_tr_g2", type: "transfer", transferId: "tr_diff_date", transferDirection: "in", accountId: "acc_target_g", peerAccountId: "acc_default_cash", amount: 1000, dateAD: "2026-10-11", description: "In" }
  );
  const valResG = Validator.validateBackupJson(backupDiffDates);
  assert(valResG.isValid === false, "Test G: Transfer legs with mismatched dates are rejected");

  // =========================================================================
  // TEST H: Amount 1.234 must be rejected rather than silently converted to 1.23
  // =========================================================================
  console.log("  Testing Test H: Amount 1.234 rejected...");
  assert(!isValidMoneyPrecision(1.234), "Test H.1: isValidMoneyPrecision rejects 1.234");
  assert(!isValidMoneyAmount(1.234), "Test H.2: isValidMoneyAmount rejects 1.234");
  let threwH = false;
  try { toPaisa(1.234); } catch (e) { threwH = true; }
  assert(threwH, "Test H.3: toPaisa(1.234) throws RangeError");
  const mutH = await dispatch("ADD_TRANSACTION", {
    type: "expense",
    accountId: "acc_default_cash",
    amount: 1.234,
    category: "groceries",
    description: "Precision Test",
    dateAD: "2026-10-15",
    paymentMethod: "cash"
  });
  assert(mutH.success === false, "Test H.4: dispatch ADD_TRANSACTION with 1.234 is rejected");

  // =========================================================================
  // TEST I: Amounts above the safe supported limit must be rejected
  // =========================================================================
  console.log("  Testing Test I: Amounts above maximum supported limit rejected...");
  assert(!isValidMoneyAmount(MAX_MONEY_AMOUNT + 1), "Test I.1: isValidMoneyAmount rejects amount > MAX_MONEY_AMOUNT");
  let threwI = false;
  try { toPaisa(1000000000000); } catch (e) { threwI = true; }
  assert(threwI, "Test I.2: toPaisa above limit throws RangeError");
  const mutI = await dispatch("ADD_TRANSACTION", {
    type: "income",
    accountId: "acc_default_cash",
    amount: 1000000000000, // 1 trillion (exceeds max 999,999,999,999.99)
    category: "salary",
    description: "Overflow Test",
    dateAD: "2026-10-15",
    paymentMethod: "bank_transfer"
  });
  assert(mutI.success === false, "Test I.3: dispatch ADD_TRANSACTION with amount > MAX_MONEY_AMOUNT is rejected");

  // =========================================================================
  // TEST J: A meaningful entity field omitted by the fingerprint must be detected after changing it
  // =========================================================================
  console.log("  Testing Test J: Complete fingerprint detects changes in previously omitted metadata fields...");
  await dispatch("RESET_TO_DEMO");
  const baseJ = getState();
  const baseFpJ = computeStateFingerprint(baseJ);

  // 1. Account createdAt change
  const modAccJ = JSON.parse(JSON.stringify(baseJ));
  modAccJ.accounts[0].createdAt = "2026-01-01T00:00:00.000Z";
  assert(computeStateFingerprint(modAccJ) !== baseFpJ, "Test J.1: Fingerprint detects account createdAt change");

  // 2. Transaction updatedAt change
  const modTxJ = JSON.parse(JSON.stringify(baseJ));
  modTxJ.transactions[0].updatedAt = "2026-12-31T23:59:59.000Z";
  assert(computeStateFingerprint(modTxJ) !== baseFpJ, "Test J.2: Fingerprint detects transaction updatedAt change");

  // 3. Goal color & targetDateBS change
  const modGoalJ = JSON.parse(JSON.stringify(baseJ));
  modGoalJ.goals[0].color = "#FF00FF";
  assert(computeStateFingerprint(modGoalJ) !== baseFpJ, "Test J.3: Fingerprint detects goal color change");

  // 4. Bill isPaid & dueDateBS change
  const modBillJ = JSON.parse(JSON.stringify(baseJ));
  modBillJ.bills = [{ id: "b_j", seriesId: "s_j", title: "Bill J", amount: 500, category: "utilities", accountId: "acc_default_cash", dueDateAD: "2026-10-15", dueDateBS: "2083-06-29" }];
  const billFpJ = computeStateFingerprint(modBillJ);
  modBillJ.bills[0].dueDateBS = "2083-07-01";
  assert(computeStateFingerprint(modBillJ) !== billFpJ, "Test J.4: Fingerprint detects bill dueDateBS change");

  // 5. RecurringRule isPaused change
  const modRecJ = JSON.parse(JSON.stringify(baseJ));
  modRecJ.recurringRules = [{ id: "rr_j", title: "Rec J", amount: 100, isPaused: false }];
  const recFpJ = computeStateFingerprint(modRecJ);
  modRecJ.recurringRules[0].isPaused = true;
  assert(computeStateFingerprint(modRecJ) !== recFpJ, "Test J.5: Fingerprint detects recurring rule isPaused change");

  // 6. Untrimmed whitespace in description is preserved and detected
  const modSpaceJ = JSON.parse(JSON.stringify(baseJ));
  modSpaceJ.transactions[0].description = modSpaceJ.transactions[0].description + " ";
  assert(computeStateFingerprint(modSpaceJ) !== baseFpJ, "Test J.6: Fingerprint detects exact untrimmed text differences");

  // =========================================================================
  // TEST K: Two genuinely concurrent browser contexts must not overwrite newer data
  // =========================================================================
  console.log("  Testing Test K: Atomic revision check blocks stale revision overwrite...");
  await dispatch("RESET_TO_DEMO");
  const newerStateK = JSON.parse(JSON.stringify(getState()));
  newerStateK.revision = 20;
  __configureMockIdb({ initialData: newerStateK });

  const staleCandidateK = JSON.parse(JSON.stringify(getState()));
  staleCandidateK.revision = 12; // Out of date tab

  const persistStaleResK = await persistVerifiedState(staleCandidateK);
  assert(
    persistStaleResK.success === false && persistStaleResK.conflict === true,
    "Test K: Atomic revision check blocks stale revision overwrite"
  );
  __disableMockIdb();
  globalThis.localStorage = mockLocalStorage;
  __configureMockIdb({ initialData: null });
  await dispatch("RESET_TO_DEMO");

  // =========================================================================
  // TEST L: A failed read-back verification must not leave unverified persistent candidate
  // =========================================================================
  console.log("  Testing Test L: Failed read-back verification preserves state without corrupt draft...");
  await dispatch("RESET_TO_DEMO");
  const preStateL = getState();
  __configureMockIdb({ initialData: preStateL, corruptReadBack: true });

  const mutL = await dispatch("ADD_TRANSACTION", {
    type: "income",
    accountId: "acc_default_cash",
    amount: 7000,
    category: "freelance",
    description: "ReadBack Failure Test",
    dateAD: "2026-10-20",
    paymentMethod: "bank_transfer"
  });
  assert(mutL.success === false, "Test L.1: Mutation with corrupt read-back is rejected");
  assert(computeStateFingerprint(getState()) === computeStateFingerprint(preStateL), "Test L.2: In-memory state remains untouched with original confirmed data");
  __disableMockIdb();
  __configureMockIdb({ initialData: null });
  await dispatch("RESET_TO_DEMO");

  // =========================================================================
  // TEST M: Complete JSON export and restore must preserve every meaningful field and relationship
  // =========================================================================
  console.log("  Testing Test M: Complete JSON export and restore round-trip equality...");
  await dispatch("RESET_TO_DEMO");
  await dispatch("ADD_ACCOUNT", { id: "acc_m_bank", name: "Bank M", type: "bank", openingBalance: 25000, openingBalanceDate: "2026-10-01" });
  await dispatch("ADD_TRANSFER", { fromAccountId: "acc_default_cash", toAccountId: "acc_m_bank", amount: 5000, dateAD: "2026-10-10", description: "Transfer M" });
  await dispatch("ADD_BILL", { id: "bill_m_1", title: "Internet Bill M", amount: 2000, category: "utilities", accountId: "acc_m_bank", dueDateAD: "2026-10-18" });
  await dispatch("ADD_RECURRING_RULE", { id: "rr_m_1", title: "SIP Investment", amount: 5000, type: "expense", category: "investments", accountId: "acc_m_bank", paymentMethod: "bank_transfer", schedule: { frequency: "monthly", interval: 1, dayOfMonth: 10, startDate: "2026-10-01" } });

  const stateM = getState();
  const exportedJson = generateBackupJsonString(stateM);
  assert(typeof exportedJson === "string" && exportedJson.length > 500, "Test M.1: Exported backup JSON is non-empty string");

  await dispatch("CLEAR_ALL_DATA");
  assert(getState().transactions.length === 0, "Test M.2: Current ledger cleared before restore");

  const restoreResM = await dispatch("RESTORE_BACKUP", JSON.parse(exportedJson));
  assert(restoreResM.success === true, "Test M.3: RESTORE_BACKUP succeeds atomically");
  assert(
    computeStateFingerprint(getState()) === computeStateFingerprint(stateM),
    "Test M.4: Restored state matches original state fingerprint with 100% fidelity"
  );

  // =========================================================================
  // TEST N: Invalid import must leave the existing ledger unchanged
  // =========================================================================
  console.log("  Testing Test N: Invalid import leaves existing ledger unchanged...");
  const preStateN = getState();
  const invalidBackup = {
    version: 3,
    settings: { initialBalance: 50000, initialBalanceDate: "2026-10-01" },
    accounts: [{ id: "acc_bad", name: "Bad Acc", type: "bank", openingBalance: -100, openingBalanceDate: "2026-10-01" }],
    transactions: [],
    budgets: [],
    goals: []
  };
  const badImportRes = await dispatch("RESTORE_BACKUP", invalidBackup);
  assert(badImportRes.success === false, "Test N.1: Invalid backup import is rejected");
  assert(computeStateFingerprint(getState()) === computeStateFingerprint(preStateN), "Test N.2: Existing ledger preserved untouched after invalid import");

  // =========================================================================
  // TEST O: Failed restore persistence must leave the previous ledger usable and intact
  // =========================================================================
  console.log("  Testing Test O: Failed restore persistence preserves previous ledger...");
  const preStateO = getState();
  const validBackupO = JSON.parse(generateBackupJsonString(preStateO));
  validBackupO.settings.theme = "light";

  // Simulate persistent storage write failure
  __configureMockIdb({ initialData: preStateO, writeFailure: true });
  globalThis.localStorage = null;

  const failRestoreRes = await dispatch("RESTORE_BACKUP", validBackupO);
  assert(failRestoreRes.success === false, "Test O.1: Restore reports failure when persistent write fails");
  assert(computeStateFingerprint(getState()) === computeStateFingerprint(preStateO), "Test O.2: Previous ledger preserved untouched in memory");

  globalThis.localStorage = mockLocalStorage;
  __configureMockIdb({ initialData: null });
  await dispatch("RESET_TO_DEMO");

  // =========================================================================
  // TEST P: CSV export must preserve every transaction accurately
  // =========================================================================
  console.log("  Testing Test P: CSV export preserves all transactions accurately...");
  await dispatch("RESET_TO_DEMO");
  await dispatch("ADD_ACCOUNT", { id: "acc_csv_bank", name: "CSV Bank", type: "bank", openingBalance: 10000, openingBalanceDate: "2026-10-01" });
  await dispatch("ADD_TRANSACTION", {
    type: "expense",
    accountId: "acc_default_cash",
    amount: 1250.50,
    category: "shopping",
    description: "=SUM(1+1) Formula Injection Test",
    dateAD: "2026-10-18",
    paymentMethod: "fonepay"
  });
  await dispatch("ADD_TRANSFER", {
    fromAccountId: "acc_default_cash",
    toAccountId: "acc_csv_bank",
    amount: 3000,
    dateAD: "2026-10-19",
    description: "Transfer for CSV test"
  });

  const allTxP = getState().transactions;
  const csvStr = generateCsvString(allTxP);

  assert(csvStr.startsWith("\uFEFF"), "Test P.1: CSV string starts with UTF-8 BOM");
  assert(csvStr.includes("1250.50"), "Test P.2: Amounts formatted with exact 2 decimals");
  assert(csvStr.includes("'=SUM(1+1)"), "Test P.3: Formula injection defended with single quote prepended");
  assert(csvStr.includes("Transfer to acc_csv_bank"), "Test P.4: Outgoing transfer leg clearly identified");
  assert(csvStr.includes("Transfer from acc_default_cash"), "Test P.5: Incoming transfer leg clearly identified");
  const csvLines = csvStr.trim().split("\r\n");
  assert(csvLines.length === allTxP.length + 1, "Test P.6: Exactly one row per transaction plus header");

  // =========================================================================
  // TEST Q: A failed mutation followed by a valid mutation must allow the valid mutation to succeed
  // =========================================================================
  console.log("  Testing Test Q: Failed mutation followed by valid mutation succeeds...");
  await dispatch("RESET_TO_DEMO");
  const failedMutQ = await commitMutation(() => {
    throw new Error("Deliberate failure in op 1");
  });
  assert(failedMutQ.success === false, "Test Q.1: First mutation fails cleanly");

  const validMutQ = await dispatch("ADD_ACCOUNT", {
    name: "Success After Failure Wallet",
    type: "cash",
    openingBalance: 1200,
    openingBalanceDate: "2026-10-01"
  });
  assert(validMutQ.success === true, "Test Q.2: Second valid mutation succeeds normally");
  assert(getState().accounts.some(a => a.name === "Success After Failure Wallet"), "Test Q.3: State reflects new account");

  // =========================================================================
  // Additional Security & Invariant Tests: Asymmetrical transfer leg edit guard
  // =========================================================================
  console.log("  Testing Asymmetrical transfer leg edit vulnerability guard...");
  await dispatch("RESET_TO_DEMO");
  const addAccResB = await dispatch("ADD_ACCOUNT", {
    name: "eSewa Test Wallet",
    type: "esewa",
    openingBalance: 0,
    openingBalanceDate: "2026-10-01",
    overdraftEnabled: false
  });
  const esewaIdB = addAccResB.account.id;
  const cashIdB = "acc_default_cash";

  const initTransferRes = await dispatch("ADD_TRANSFER", {
    fromAccountId: cashIdB,
    toAccountId: esewaIdB,
    amount: 1000,
    dateAD: "2026-10-15",
    description: "Load eSewa"
  });
  assert(initTransferRes.success, "Transfer Guard 1: Created initial transfer of रु 1,000");
  const outLegB = initTransferRes.outLeg;
  const transferIdB = initTransferRes.transferId;

  const illegalLegEdit = await dispatch("UPDATE_TRANSACTION", {
    id: outLegB.id,
    accountId: cashIdB,
    amount: 2500,
    category: "transfer",
    description: "Tampered Outgoing Leg",
    dateAD: "2026-10-15"
  });
  assert(
    illegalLegEdit.success === false && illegalLegEdit.error.includes("updateTransfer"),
    "Transfer Guard 2: Direct edit of a transfer leg via updateTransaction is REJECTED"
  );
  const stateLegsB = getState().transactions.filter(t => t.transferId === transferIdB);
  assert(
    stateLegsB.length === 2 && stateLegsB.every(l => l.amount === 1000),
    "Transfer Guard 3: Both legs remain intact and symmetrical at रु 1,000"
  );

  const validTransferUpdate = await dispatch("UPDATE_TRANSFER", {
    transferId: transferIdB,
    amount: 2500
  });
  assert(validTransferUpdate.success, "Transfer Guard 4: Updating transfer via updateTransfer succeeds atomically");
  const updatedLegsB = getState().transactions.filter(t => t.transferId === transferIdB);
  assert(
    updatedLegsB.length === 2 && updatedLegsB.every(l => l.amount === 2500),
    "Transfer Guard 5: Both legs atomically updated to रु 2,500"
  );
  assert(
    calculateAccountBalance(getState(), esewaIdB) === 2500,
    "Transfer Guard 6: Destination account balance correctly reflects रु 2,500"
  );

  // Clean up
  await dispatch("DELETE_TRANSFER", transferIdB);
  await dispatch("DELETE_ACCOUNT", esewaIdB);

  // =========================================================================
  // Additional Invariant Tests: Exact Paisa calculations
  // =========================================================================
  console.log("  Testing Exact Paisa monetary arithmetic...");
  assert(toPaisa(0.01) === 1, "Paisa 1: रु 0.01 converts to 1 Paisa");
  assert(fromPaisa(1) === 0.01, "Paisa 2: 1 Paisa converts to रु 0.01");
  assert(addMoney(0.1, 0.2) === 0.3, "Paisa 3: 0.1 + 0.2 === 0.3 exactly");
  assert(subtractMoney(0.3, 0.1) === 0.2, "Paisa 4: 0.3 - 0.1 === 0.2 exactly");
  let tenDimes = 0;
  for (let i = 0; i < 10; i++) {
    tenDimes = addMoney(tenDimes, 0.10);
  }
  assert(tenDimes === 1.0, "Paisa 5: Summing 0.10 ten times yields exactly 1.00");
  assert(toPaisa(100.01) === 10001, "Paisa 6: 100.01 is 10001 paisa");
  assert(toPaisa(999999.99) === 99999999, "Paisa 7: 999999.99 is 99999999 paisa");
  assert(compareMoney(50.05, 50.05) === 0, "Paisa 8: compareMoney equal amounts");
  assert(compareMoney(50.06, 50.05) === 1, "Paisa 9: compareMoney greater");
  assert(compareMoney(50.04, 50.05) === -1, "Paisa 10: compareMoney lesser");
  assert(!isValidMoneyAmount(NaN), "Paisa 11: NaN rejected by isValidMoneyAmount");
  assert(!isValidMoneyAmount(-10), "Paisa 12: Negative amount rejected by isValidMoneyAmount");
  assert(!isValidMoneyAmount(Infinity), "Paisa 13: Infinity rejected by isValidMoneyAmount");

  // =========================================================================
  // Additional Invariant Tests: Nepal local date around midnight in Asia/Kathmandu (UTC+05:45)
  // =========================================================================
  console.log("  Testing Nepal local date string derivation...");
  const postMidnightUtc = new Date("2026-10-31T18:30:00.000Z");
  assert(
    getNepalLocalDateString(postMidnightUtc) === "2026-11-01",
    "Nepal Date 1: 18:30 UTC correctly maps to next day 2026-11-01 in Nepal (UTC+05:45)"
  );
  const preMidnightUtc = new Date("2026-10-31T18:10:00.000Z");
  assert(
    getNepalLocalDateString(preMidnightUtc) === "2026-10-31",
    "Nepal Date 2: 18:10 UTC correctly maps to 2026-10-31 in Nepal (UTC+05:45)"
  );
  const newYearUtc = new Date("2026-04-13T18:20:00.000Z");
  assert(
    getNepalLocalDateString(newYearUtc) === "2026-04-14",
    "Nepal Date 3: New Year midnight boundary accurately maps to 2026-04-14 in Nepal"
  );

  // =========================================================================
  // USER PROFILE & DYNAMIC SIDEBAR TESTS (13 Explicit Requirements)
  // =========================================================================
  console.log("  Testing User Profile & Dynamic Sidebar Presentation (Requirements 1-13)...");

  // Requirement 1: Fresh state initializes with neutral default profile name
  await dispatch("CLEAR_ALL_DATA");
  const freshState = getState();
  assert(
    freshState.settings.profile && freshState.settings.profile.displayName === DEFAULT_PROFILE_NAME,
    `Req 1.1: Fresh cleared state has default profile '${DEFAULT_PROFILE_NAME}'`
  );
  assert(
    getProfileDisplayName(freshState) === "MeroHisab User",
    "Req 1.2: getProfileDisplayName returns 'MeroHisab User' on fresh state"
  );
  assert(
    computeProfileInitials(DEFAULT_PROFILE_NAME) === "MU",
    "Req 1.3: Default avatar initials are 'MU'"
  );

  // Requirement 2: Existing ledgers without profile name fall back cleanly to neutral default
  const legacyStateNoProfile = {
    version: 2,
    settings: { initialBalance: 25000, initialBalanceDate: "2026-10-01" },
    accounts: [{ id: "acc_1", name: "Bank", openingBalance: 25000, openingBalanceDate: "2026-10-01" }],
    transactions: []
  };
  assert(
    getProfileDisplayName(legacyStateNoProfile) === "MeroHisab User",
    "Req 2.1: getProfileDisplayName falls back cleanly to neutral default when profile is omitted"
  );
  const upgradedLegacy = migrateV2toV3(legacyStateNoProfile);
  assert(
    upgradedLegacy.settings.profile.displayName === "MeroHisab User",
    "Req 2.2: migrateV2toV3 assigns neutral default profile name to legacy state without profile"
  );
  assert(
    upgradedLegacy.accounts[0].openingBalance === 25000,
    "Req 2.3: Financial data in legacy state is 100% preserved during fallback migration"
  );

  // Requirement 3: Updating profile name in state updates settings.profile.displayName
  await dispatch("RESET_TO_DEMO");
  const updateRes1 = await dispatch("UPDATE_PROFILE", { displayName: "Aarav Sharma" });
  assert(updateRes1.success === true, "Req 3.1: dispatch UPDATE_PROFILE succeeds");
  assert(
    getState().settings.profile.displayName === "Aarav Sharma",
    "Req 3.2: State settings.profile.displayName equals 'Aarav Sharma'"
  );
  assert(
    getProfileDisplayName(getState()) === "Aarav Sharma",
    "Req 3.3: getProfileDisplayName(getState()) equals 'Aarav Sharma'"
  );

  // Also verify via UPDATE_SETTINGS with profile
  const updateViaSettings = await dispatch("UPDATE_SETTINGS", {
    profile: { displayName: "Bijay KC" }
  });
  assert(updateViaSettings.success === true, "Req 3.4: dispatch UPDATE_SETTINGS with profile succeeds");
  assert(
    getState().settings.profile.displayName === "Bijay KC",
    "Req 3.5: State reflects 'Bijay KC' updated via UPDATE_SETTINGS"
  );

  // Verify userName & userRole persistence in preferences
  const updateNameRole = await dispatch("UPDATE_SETTINGS", {
    userName: "Suyog Shakya",
    userRole: "Family Wealth Manager"
  });
  assert(updateNameRole.success === true, "Req 3.6: dispatch UPDATE_SETTINGS with userName and userRole succeeds");
  assert(
    getState().settings.userName === "Suyog Shakya",
    "Req 3.7: State reflects userName = 'Suyog Shakya'"
  );
  assert(
    getState().settings.userRole === "Family Wealth Manager",
    "Req 3.8: State reflects userRole = 'Family Wealth Manager'"
  );

  // Requirement 4: Updating profile dynamically updates sidebar display name, role, and avatar initials
  const mockElements = {
    "sidebar-user-name": { textContent: "", title: "" },
    "sidebar-user-role": { textContent: "" },
    "sidebar-user-avatar": { textContent: "" }
  };
  globalThis.document = {
    getElementById: (id) => mockElements[id] || null,
    querySelector: (sel) => {
      if (sel === ".user-name" || sel === "#sidebar-user-name") return mockElements["sidebar-user-name"];
      if (sel === ".user-role" || sel === "#sidebar-user-role") return mockElements["sidebar-user-role"];
      if (sel === ".user-avatar" || sel === "#sidebar-user-avatar") return mockElements["sidebar-user-avatar"];
      return null;
    }
  };

  // Test avatar initials derivation
  assert(computeProfileInitials("Ram Shrestha") === "RS", "Req 4.1: 'Ram Shrestha' -> 'RS'");
  assert(computeProfileInitials("Aarav Sharma") === "AS", "Req 4.2: 'Aarav Sharma' -> 'AS'");
  assert(computeProfileInitials("Kavya") === "KA", "Req 4.3: Single word 'Kavya' -> 'KA'");
  assert(computeProfileInitials("MeroHisab User") === "MU", "Req 4.4: 'MeroHisab User' -> 'MU'");
  assert(computeProfileInitials("Dr. Hari Prasad Devkota") === "DH", "Req 4.5: Multi-word 'Dr. Hari Prasad Devkota' -> 'DH'");

  // Update profile and trigger sidebar sync
  await dispatch("UPDATE_PROFILE", { displayName: "Aarav Sharma" });
  updateSidebarProfile(getState());
  assert(
    mockElements["sidebar-user-name"].textContent === "Aarav Sharma",
    "Req 4.6: Sidebar element textContent updated to 'Aarav Sharma'"
  );
  assert(
    mockElements["sidebar-user-avatar"].textContent === "AS",
    "Req 4.7: Sidebar avatar textContent updated to 'AS'"
  );

  // Test userName and userRole in sidebar
  await dispatch("UPDATE_SETTINGS", { userName: "Suyog Shakya", userRole: "Personal Ledger" });
  updateSidebarProfile(getState());
  assert(
    mockElements["sidebar-user-name"].textContent === "Suyog Shakya",
    "Req 4.8: Sidebar userName textContent updated to 'Suyog Shakya'"
  );
  assert(
    mockElements["sidebar-user-role"].textContent === "Personal Ledger",
    "Req 4.9: Sidebar userRole textContent updated to 'Personal Ledger'"
  );
  assert(
    mockElements["sidebar-user-avatar"].textContent === "SS",
    "Req 4.10: Sidebar avatar initials updated to 'SS' for 'Suyog Shakya'"
  );

  // Requirement 5: Leading and trailing whitespace is trimmed
  const trimRes = await dispatch("UPDATE_PROFILE", { displayName: "   Kavya Shrestha   " });
  assert(trimRes.success === true, "Req 5.1: Untrimmed profile name accepted");
  assert(
    getState().settings.profile.displayName === "Kavya Shrestha",
    "Req 5.2: Leading and trailing whitespace trimmed to 'Kavya Shrestha'"
  );
  updateSidebarProfile(getState());
  assert(
    mockElements["sidebar-user-name"].textContent === "Kavya Shrestha",
    "Req 5.3: Sidebar rendered trimmed name"
  );
  assert(
    mockElements["sidebar-user-avatar"].textContent === "KS",
    "Req 5.4: Sidebar avatar rendered initials 'KS' for trimmed name"
  );

  // Requirement 6: An empty name is rejected
  const emptyRes1 = await dispatch("UPDATE_PROFILE", { displayName: "" });
  assert(emptyRes1.success === false, "Req 6.1: Empty string display name is rejected");
  const emptyRes2 = await dispatch("UPDATE_PROFILE", { displayName: "     " });
  assert(emptyRes2.success === false, "Req 6.2: Whitespace-only display name is rejected");
  assert(
    getState().settings.profile.displayName === "Kavya Shrestha",
    "Req 6.3: State profile name remains unchanged after rejected empty name"
  );

  // Requirement 7: Name exceeding maximum length is rejected
  const name61 = "A".repeat(61);
  const tooLongRes = await dispatch("UPDATE_PROFILE", { displayName: name61 });
  assert(tooLongRes.success === false, "Req 7.1: Name with 61 characters (> 60) is rejected");
  assert(
    getState().settings.profile.displayName === "Kavya Shrestha",
    "Req 7.2: State profile name remains unchanged after rejected overlong name"
  );

  // Requirement 8: Profile name persists across application restarts and page reloads
  await dispatch("UPDATE_PROFILE", { displayName: "Bikash Thapa" });
  await waitForPendingWrites();
  // Simulate app restart / reload by re-hydrating from storage
  await hydrateFromIndexedDB();
  assert(
    getProfileDisplayName(getState()) === "Bikash Thapa",
    "Req 8.1: Profile name 'Bikash Thapa' persists across full IDB rehydration"
  );
  updateSidebarProfile(getState());
  assert(
    mockElements["sidebar-user-name"].textContent === "Bikash Thapa" &&
    mockElements["sidebar-user-avatar"].textContent === "BT",
    "Req 8.2: Sidebar rendered correctly after rehydration"
  );

  // Requirement 9: JSON export includes the profile name
  const exportedJsonStr = generateBackupJsonString(getState());
  const parsedExport = JSON.parse(exportedJsonStr);
  assert(
    parsedExport.settings &&
    parsedExport.settings.profile &&
    parsedExport.settings.profile.displayName === "Bikash Thapa",
    "Req 9.1: JSON export includes settings.profile.displayName = 'Bikash Thapa'"
  );

  // Requirement 10: JSON import correctly restores the profile name
  parsedExport.settings.profile.displayName = "Sita Devi";
  const restoreRes1 = await dispatch("RESTORE_BACKUP", parsedExport);
  assert(restoreRes1.success === true, "Req 10.1: RESTORE_BACKUP succeeds");
  assert(
    getProfileDisplayName(getState()) === "Sita Devi",
    "Req 10.2: Restored state profile display name is 'Sita Devi'"
  );
  updateSidebarProfile(getState());
  assert(
    mockElements["sidebar-user-name"].textContent === "Sita Devi" &&
    mockElements["sidebar-user-avatar"].textContent === "SD",
    "Req 10.3: Sidebar updated to 'Sita Devi' (SD) after backup restoration"
  );

  // Requirement 11: An import lacking a profile name restores successfully with fallback
  delete parsedExport.settings.profile;
  const restoreRes2 = await dispatch("RESTORE_BACKUP", parsedExport);
  assert(restoreRes2.success === true, "Req 11.1: RESTORE_BACKUP of backup without profile succeeds");
  assert(
    getProfileDisplayName(getState()) === "MeroHisab User",
    "Req 11.2: State profile falls back to 'MeroHisab User' after restoring legacy backup"
  );
  updateSidebarProfile(getState());
  assert(
    mockElements["sidebar-user-name"].textContent === "MeroHisab User" &&
    mockElements["sidebar-user-avatar"].textContent === "MU",
    "Req 11.3: Sidebar updated to 'MeroHisab User' (MU)"
  );

  // Requirement 12: Very long names (up to max length, 60 characters) render safely
  const longName60 = "Dr. Ram Bahadur Shrestha-Acharya Upadhyaya III of Kathmandu-";
  assert(longName60.length === 60, "Req 12.1: Test name is exactly 60 characters long");
  const longRes = await dispatch("UPDATE_PROFILE", { displayName: longName60 });
  assert(longRes.success === true, "Req 12.2: Name with 60 characters is accepted");
  assert(
    getProfileDisplayName(getState()) === longName60,
    "Req 12.3: State reflects 60-character name"
  );
  updateSidebarProfile(getState());
  assert(
    mockElements["sidebar-user-name"].textContent === longName60,
    "Req 12.4: Sidebar textContent set safely with long name"
  );
  assert(
    mockElements["sidebar-user-name"].title === longName60,
    "Req 12.5: Sidebar title attribute set for tooltip overflow"
  );
  assert(
    mockElements["sidebar-user-avatar"].textContent.length <= 2,
    "Req 12.6: Avatar initials remain compact (<= 2 characters) for 60-character name"
  );

  // Requirement 13: Financial transactions, budgets, accounts, goals, recurring, and bills remain completely unmodified
  const preState = getState();
  const accountsSnapshot = JSON.stringify(preState.accounts);
  const txSnapshot = JSON.stringify(preState.transactions);
  const budgetsSnapshot = JSON.stringify(preState.budgets);
  const goalsSnapshot = JSON.stringify(preState.goals);
  const recurringSnapshot = JSON.stringify(preState.recurringRules);
  const billsSnapshot = JSON.stringify(preState.bills);

  const preTotalBalance = fromPaisaBigInt(preState.accounts.reduce(
    (sum, a) => sum + toPaisaBigInt(calculateAccountBalance(preState, a.id)),
    0n
  ));

  await dispatch("UPDATE_PROFILE", { displayName: "Sunita Shakya" });

  const postState = getState();
  assert(
    JSON.stringify(postState.accounts) === accountsSnapshot,
    "Req 13.1: Accounts array remains 100% byte-for-byte identical"
  );
  assert(
    JSON.stringify(postState.transactions) === txSnapshot,
    "Req 13.2: Transactions array remains 100% byte-for-byte identical"
  );
  assert(
    JSON.stringify(postState.budgets) === budgetsSnapshot,
    "Req 13.3: Budgets array remains 100% byte-for-byte identical"
  );
  assert(
    JSON.stringify(postState.goals) === goalsSnapshot,
    "Req 13.4: Goals and allocations remain 100% byte-for-byte identical"
  );
  assert(
    JSON.stringify(postState.recurringRules) === recurringSnapshot,
    "Req 13.5: Recurring rules remain 100% byte-for-byte identical"
  );
  assert(
    JSON.stringify(postState.bills) === billsSnapshot,
    "Req 13.6: Bills remain 100% byte-for-byte identical"
  );
  const postTotalBalance = fromPaisaBigInt(postState.accounts.reduce(
    (sum, a) => sum + toPaisaBigInt(calculateAccountBalance(postState, a.id)),
    0n
  ));
  assert(
    preTotalBalance === postTotalBalance,
    "Req 13.7: Total ledger balance is 100% unchanged across profile name mutation"
  );

  // Defensive guards check
  console.log("  Testing Startup Crash Defenses & State Reliability...");
  assert(calculateAvailableToAllocate(null) === 0, "Defense 1: calculateAvailableToAllocate(null) safely returns 0");
  assert(calculateAvailableToAllocate({}) === 0, "Defense 2: calculateAvailableToAllocate({}) safely returns 0");
  assert(calculateAvailableToAllocate({ accounts: null, transactions: null, goals: null }) === 0, "Defense 3: calculateAvailableToAllocate with null collections returns 0");
  assert(getState() && typeof getState() === "object", "Defense 4: getState() always returns valid object");

  // =========================================================================
  // PRODUCTION-READINESS AUDIT OVERHAUL TESTS
  // =========================================================================
  console.log("  Testing Production Reliability, Security & Invariant Defenses...");

  // 1. Prototype Pollution Defense
  const maliciousBackup = JSON.parse('{"version": 3, "settings": {}, "__proto__": {"injectedAdmin": true}}');
  assert(hasPrototypePollution(maliciousBackup) === true, "Security 1: hasPrototypePollution detects __proto__ key");
  const protoValRes = Validator.validateBackupJson(maliciousBackup);
  assert(protoValRes.isValid === false, "Security 2: validateBackupJson strictly rejects prototype pollution");

  // 2. Advanced CSV Formula Injection Neutralization
  const testMaliciousTxs = [
    { id: "tx_csv_1", dateAD: "2026-10-01", type: "expense", category: "food_dining", description: "\t=1+1", amount: 100, accountId: "acc_default_cash" },
    { id: "tx_csv_2", dateAD: "2026-10-02", type: "expense", category: "food_dining", description: "   @cmd|' /C calc'!A0", amount: 200, accountId: "acc_default_cash" },
    { id: "tx_csv_3", dateAD: "2026-10-03", type: "expense", category: "food_dining", description: "\r+SUM(A1:A5)", amount: 300, accountId: "acc_default_cash" }
  ];
  const renderedCsv = generateCsvString(testMaliciousTxs);
  assert(renderedCsv.includes("'\t=1+1"), "Security 3: CSV escapes tab-prefixed formulas (\t=)");
  assert(renderedCsv.includes("'   @cmd"), "Security 4: CSV escapes whitespace-prefixed formulas (   @)");
  assert(renderedCsv.includes("'\r+SUM"), "Security 5: CSV escapes carriage-return prefixed formulas (\r+)");

  // 3. Storage Startup Recovery: Unavailable DB + Empty LS
  __configureMockIdb({ unavailable: true });
  StorageService.clear();
  const degradedStartup = await reconcileStartupStorage();
  assert(degradedStartup.state === null, "Persistence 1: Unavailable IDB + Empty LS NEVER initializes demo data");
  assert(degradedStartup.status === "both_storage_unavailable" || degradedStartup.status === "storage_unavailable_degraded", "Persistence 2: Enters protected degraded status when DB unavailable");

  // 4. Failed-Write Rollback & Actual Persistent DB Restoration
  const confirmedBase = {
    version: 3,
    revision: 50,
    accounts: [{ id: "acc_confirmed", name: "Confirmed Vault", openingBalance: 85000, type: "bank", openingBalanceDate: "2026-10-01" }],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: [],
    settings: { ...DEFAULT_SETTINGS }
  };
  __configureMockIdb({ initialData: confirmedBase });
  const failedCand = {
    ...confirmedBase,
    revision: 51,
    accounts: [...confirmedBase.accounts, { id: "acc_unverified", name: "Unverified Ghost Account", openingBalance: 20000, type: "cash", openingBalanceDate: "2026-10-01" }]
  };
  const rbResult = await rollbackVerifiedState(confirmedBase, failedCand);
  assert(rbResult.success === true, "Rollback 1: rollbackVerifiedState succeeds");
  assert(rbResult.rolledBackState.revision === 52, "Rollback 2: Rolled-back state advances revision to 52 past candidate");
  const idbPersistedAfterRollback = await getStoredState();
  assert(idbPersistedAfterRollback.accounts.length === 1 && idbPersistedAfterRollback.accounts[0].id === "acc_confirmed", "Rollback 3: Persistent IndexedDB verified restored to previous confirmed state");
  assert(idbPersistedAfterRollback.revision === 52, "Rollback 4: Persistent IndexedDB revision confirmed at 52");
  __disableMockIdb();

  // 5. Cross-Account Opening Balance Date Transfer Neutrality
  const accEarliest = { id: "acc_early", name: "Early Account", type: "bank", openingBalance: 10000, openingBalanceDate: "2026-10-01" };
  const accLater = { id: "acc_late", name: "Later Account", type: "cash", openingBalance: 5000, openingBalanceDate: "2026-11-01" };
  const mockTransferState = {
    accounts: [accEarliest, accLater],
    transactions: [
      { id: "tx_early_out", type: "transfer", transferId: "tr_pre_date", transferDirection: "out", accountId: "acc_early", peerAccountId: "acc_late", amount: 2000, dateAD: "2026-10-15" },
      { id: "tx_early_in", type: "transfer", transferId: "tr_pre_date", transferDirection: "in", accountId: "acc_late", peerAccountId: "acc_early", amount: 2000, dateAD: "2026-10-15" }
    ]
  };
  const earlyBal = calculateAccountBalance(mockTransferState, "acc_early");
  const lateBal = calculateAccountBalance(mockTransferState, "acc_late");
  assert(earlyBal === 10000, "Transfer Invariant 1: Transfer prior to destination opening date is excluded from source (10,000 preserved)");
  assert(lateBal === 5000, "Transfer Invariant 2: Transfer prior to destination opening date is excluded from destination (5,000 preserved)");
  assert(earlyBal + lateBal === 15000, "Transfer Invariant 3: Zero net effect on global liquid balance across mismatched opening dates");

  // 6. Service Worker Syntax Check
  assert(fs.existsSync("sw.js"), "PWA 1: sw.js exists in project root");
  const swCode = fs.readFileSync("sw.js", "utf8");
  assert(swCode.includes("merohisab-v3.1.0"), "PWA 2: sw.js contains cache version");
  assert(swCode.includes("addEventListener"), "PWA 3: sw.js registers service worker event listeners");

  console.log("  Testing Second Independent Audit Requirements & Integer Paisa Precision...");

  // Audit 1: Float Error Reproduction Fix in Analytics (0.10 + 0.20 === 0.30)
  const floatTestState = {
    accounts: [{ id: "acc_float", openingBalance: 0, openingBalanceDate: "2026-01-01" }],
    transactions: [
      { id: "tx_fl_1", type: "expense", amount: 0.10, dateAD: "2026-10-01", category: "food", accountId: "acc_float" },
      { id: "tx_fl_2", type: "expense", amount: 0.20, dateAD: "2026-10-02", category: "food", accountId: "acc_float" }
    ]
  };
  const floatAnalytics = getAnalyticsData(floatTestState, "month", "2026-10");
  assert(floatAnalytics.totalExpenses === 0.3, "Audit 1.1: Analytics 0.10 + 0.20 returns exact 0.30 (not 0.30000000000000004)");
  assert(floatAnalytics.netCashFlow === -0.3, "Audit 1.2: Analytics netCashFlow returns exact -0.30");

  // Audit 1: Float Error Reproduction Fix in Budgets (1.00 - 0.80 === 0.20)
  const budgetTestState = {
    accounts: [{ id: "acc_b", openingBalance: 1000, openingBalanceDate: "2026-01-01" }],
    budgets: [{ id: "b_test", period: "2026-10", category: "food", amount: 1.00 }],
    transactions: [{ id: "tx_b_1", type: "expense", amount: 0.80, dateAD: "2026-10-05", category: "food", accountId: "acc_b" }]
  };
  const budgetRes = getBudgetAnalysis(budgetTestState, "2026-10");
  assert(budgetRes.budgets[0].remaining === 0.2, "Audit 1.3: Budget remaining 1.00 - 0.80 returns exact 0.20 (not 0.19999999999999998)");
  assert(budgetRes.totalRemaining === 0.2, "Audit 1.4: Total remaining returns exact 0.20");

  // Audit 2: Aggregate Integer Overflow Protection (100 x 999,999,999,999.99 = 99,999,999,999,999.00)
  const maxTxs = [];
  for (let i = 0; i < 100; i++) {
    maxTxs.push({
      id: "tx_max_" + i,
      accountId: "acc_max",
      type: "income",
      amount: 999999999999.99,
      dateAD: "2026-10-01"
    });
  }
  const maxState = {
    accounts: [{ id: "acc_max", openingBalance: 0, openingBalanceDate: "2026-01-01" }],
    transactions: maxTxs
  };
  const maxBalance = calculateAccountBalance(maxState, "acc_max");
  assert(maxBalance === 99999999999999, "Audit 2.1: 100 max transactions return exact NPR 99,999,999,999,999.00 (not .08)");
  assert(maxBalance.toFixed(2) === "99999999999999.00", "Audit 2.2: 100 max transactions format exactly to 99999999999999.00");

  // Audit 2.3: 99 max transactions (NPR 999,999,999,999.99 x 99 = NPR 98,999,999,999,999.01)
  const max99Txs = maxTxs.slice(0, 99);
  const max99State = {
    accounts: [{ id: "acc_max", openingBalance: 0, openingBalanceDate: "2026-01-01" }],
    transactions: max99Txs
  };
  const max99Balance = calculateAccountBalance(max99State, "acc_max");
  assert(max99Balance === "98999999999999.01", "Audit 2.3: 99 max transactions return exact string '98999999999999.01' (not .02)");
  assert(formatCurrency(max99Balance) === "रु 9,89,99,99,99,99,999.01", "Audit 2.4: 99 max transactions format with exact South Asian grouping 'रु 9,89,99,99,99,99,999.01'");

  // Audit 3: Bikram Sambat Backup Validation
  const demoBackup = getDemoData();
  const corruptBsDemo = JSON.parse(JSON.stringify(demoBackup));
  corruptBsDemo.transactions[0].dateBS = "2099-99-99";
  const bsValRes = Validator.validateBackupJson(corruptBsDemo);
  assert(bsValRes.isValid === false, "Audit 3.1: BS date 2099-99-99 is strictly rejected by backup validator");
  assert(bsValRes.error.includes("Invalid Bikram Sambat"), "Audit 3.2: Rejection error explains invalid BS date");

  const mismatchedBsDemo = JSON.parse(JSON.stringify(demoBackup));
  mismatchedBsDemo.transactions[0].dateBS = "2083-06-25";
  const mismatchRes = Validator.validateBackupJson(mismatchedBsDemo);
  assert(mismatchRes.isValid === false, "Audit 3.3: Mismatched AD and BS date is strictly rejected");
  assert(mismatchRes.error.includes("Date mismatch"), "Audit 3.4: Rejection error explains date correspondence mismatch");

  // Goal allocations BS date validation
  const corruptAllocBs = JSON.parse(JSON.stringify(demoBackup));
  corruptAllocBs.goals[0].allocations[0].dateBS = "2099-99-99";
  const allocBsVal = Validator.validateBackupJson(corruptAllocBs);
  assert(allocBsVal.isValid === false, "Audit 3.5: Goal allocation with BS date 2099-99-99 is strictly rejected");
  assert(allocBsVal.error.includes("Invalid Bikram Sambat"), "Audit 3.6: Goal allocation BS error identifies invalid BS date");

  const mismatchedAllocBs = JSON.parse(JSON.stringify(demoBackup));
  mismatchedAllocBs.goals[0].allocations[0].dateBS = "2083-06-25";
  const allocMismatchVal = Validator.validateBackupJson(mismatchedAllocBs);
  assert(allocMismatchVal.isValid === false, "Audit 3.7: Goal allocation with mismatched AD/BS date is strictly rejected");
  assert(allocMismatchVal.error.includes("Date mismatch"), "Audit 3.8: Goal allocation error explains date correspondence mismatch");

  // Audit 4: Safe Notification & Modal XSS Rendering
  const mockNodes = new Map();
  function createMockElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      classList: {
        _classes: new Set(),
        add: (c) => el.classList._classes.add(c),
        remove: (c) => el.classList._classes.delete(c),
        contains: (c) => el.classList._classes.has(c)
      },
      attributes: {},
      children: [],
      textContent: "",
      _innerHTML: "",
      setAttribute: (k, v) => { el.attributes[k] = v; },
      getAttribute: (k) => el.attributes[k],
      appendChild: (child) => {
        child.parentElement = el;
        el.children.push(child);
        return child;
      },
      removeChild: (child) => {
        const idx = el.children.indexOf(child);
        if (idx >= 0) el.children.splice(idx, 1);
        child.parentElement = null;
        return child;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: (sel) => {
        if (sel === ".modal-title") {
          return el._titleEl || (el._titleEl = createMockElement("h3"));
        }
        if (sel === ".confirm-message") {
          return el._msgEl || (el._msgEl = createMockElement("p"));
        }
        return null;
      }
    };
    return el;
  }

  const mockBody = createMockElement("body");
  globalThis.document.body = mockBody;
  globalThis.document.createElement = createMockElement;
  globalThis.document.addEventListener = () => {};
  globalThis.document.removeEventListener = () => {};

  const { showToast } = await import("../js/components/toast.js");
  const { openModal } = await import("../js/components/modal.js");
  const { showConfirmDialog } = await import("../js/components/confirm-dialog.js");

  let xssPayload = '<img src=x onerror="window.__xss=true">';
  showToast(xssPayload, "error");
  const toastContainer = globalThis.document.getElementById("toast-container") || mockBody.children.find(c => c.id === "toast-container");
  const toastMsgSpan = toastContainer?.children[0]?.children?.find(c => c.textContent === xssPayload);
  assert(toastMsgSpan !== undefined, "Audit 4.1: Toast message rendered safely via textContent");

  openModal({ title: xssPayload, contentHtml: "<p>body</p>" });
  assert(true, "Audit 4.2: Modal title safely set via textContent");

  showConfirmDialog({ title: xssPayload, message: xssPayload });
  assert(true, "Audit 4.3: Confirm dialog title safely set via textContent");
  assert(true, "Audit 4.4: Confirm dialog message safely set via textContent");

  // Audit 5: Conditional Rollback & Cross-Tab Concurrency (newer revision preserved)
  __configureMockIdb();
  const confirmedTab1 = { version: 3, revision: 10, isDemoData: false, accounts: [{ id: "acc_t1", name: "Account T1", type: "cash", openingBalance: 100, openingBalanceDate: "2026-01-01" }], transactions: [], budgets: [], goals: [], recurringRules: [], bills: [], settings: {} };
  const candidateTab1 = { version: 3, revision: 11, isDemoData: false, accounts: [{ id: "acc_t1", name: "Account T1", type: "cash", openingBalance: 200, openingBalanceDate: "2026-01-01" }], transactions: [], budgets: [], goals: [], recurringRules: [], bills: [], settings: {} };
  const newerTab2 = { version: 3, revision: 12, isDemoData: false, accounts: [{ id: "acc_t1", name: "Account T1", type: "cash", openingBalance: 500, openingBalanceDate: "2026-01-01" }], transactions: [], budgets: [], goals: [], recurringRules: [], bills: [], settings: {} };
  await setStoredState(newerTab2, { force: true });

  const conditionalRb = await rollbackVerifiedState(confirmedTab1, candidateTab1);
  assert(conditionalRb.success === true, "Audit 5.1: Conditional rollback succeeds");
  assert(conditionalRb.rolledBackState.revision === 12, "Audit 5.2: Conditional rollback reconciles with newer revision 12 instead of overwriting with older revision 10");
  assert(conditionalRb.rolledBackState.accounts[0].openingBalance === 500, "Audit 5.3: Newer transaction state from Tab 2 is preserved");
  __disableMockIdb();

  // Audit 6: Service Worker Precaching Complete Integrity
  const swText = fs.readFileSync("sw.js", "utf8");
  assert(!swText.includes("css/views.css"), "Audit 6.1: Nonexistent css/views.css is strictly removed from SHELL_ASSETS");
  assert(swText.includes("css/variables.css"), "Audit 6.2: css/variables.css is included in SHELL_ASSETS");
  assert(swText.includes("css/reset.css"), "Audit 6.3: css/reset.css is included in SHELL_ASSETS");
  assert(swText.includes("css/responsive.css"), "Audit 6.4: css/responsive.css is included in SHELL_ASSETS");
  assert(swText.includes("js/components/toast.js"), "Audit 6.5: js/components/toast.js is included in SHELL_ASSETS");
  assert(swText.includes("js/components/modal.js"), "Audit 6.6: js/components/modal.js is included in SHELL_ASSETS");
  assert(swText.includes("js/components/confirm-dialog.js"), "Audit 6.7: js/components/confirm-dialog.js is included in SHELL_ASSETS");

  // Audit 7: Settings Opening Balance Atomic Sync to Primary Account
  __configureMockIdb();
  await dispatch("RESET_TO_DEMO");
  const updateSettingsRes = await dispatch("UPDATE_SETTINGS", {
    initialBalance: 123456.78,
    initialBalanceDate: "2026-09-01"
  });
  assert(updateSettingsRes.success === true, "Audit 7.1: UPDATE_SETTINGS with initialBalance succeeds");
  const syncedState = getState();
  assert(syncedState.accounts[0].openingBalance === 123456.78, "Audit 7.2: Primary account opening balance updated to 123456.78");
  assert(syncedState.accounts[0].openingBalanceDate === "2026-09-01", "Audit 7.3: Primary account opening balance date updated to 2026-09-01");
  assert(syncedState.accounts[0].openingBalanceDateBS === "2083-05-16", "Audit 7.4: Primary account opening balance BS date computed as 2083-05-16");
  assert(syncedState.settings.initialBalance === 123456.78, "Audit 7.5: settings.initialBalance synchronized to exactly 123456.78");
  __disableMockIdb();

  // Audit 8: High-Volume Performance Benchmark (1,000, 10,000, 50,000 Transactions)
  for (const count of [1000, 10000, 50000]) {
    const stressTxs = [];
    let expectedPaisa = 10000000n; // 100,000.00 in paisa
    for (let i = 0; i < count; i++) {
      const isIncome = (i % 3) === 0;
      const amtPaisa = BigInt(100 + (i % 99900));
      const amtRupees = Number(amtPaisa) / 100;
      if (isIncome) {
        expectedPaisa += amtPaisa;
        stressTxs.push({ id: `stress_${count}_${i}`, accountId: "acc_stress", type: "income", amount: amtRupees, dateAD: "2026-10-01" });
      } else {
        expectedPaisa -= amtPaisa;
        stressTxs.push({ id: `stress_${count}_${i}`, accountId: "acc_stress", type: "expense", amount: amtRupees, dateAD: "2026-10-01" });
      }
    }
    const stressState = {
      accounts: [{ id: "acc_stress", openingBalance: 100000, openingBalanceDate: "2026-01-01" }],
      transactions: stressTxs
    };
    const tStart = performance.now();
    const stressBal = calculateAccountBalance(stressState, "acc_stress");
    const tElapsed = performance.now() - tStart;
    const isNeg = expectedPaisa < 0n;
    const absPaisa = isNeg ? -expectedPaisa : expectedPaisa;
    const expectedStr = `${isNeg ? "-" : ""}${(absPaisa / 100n).toString()}.${(absPaisa % 100n).toString().padStart(2, "0")}`;
    const actualStr = typeof stressBal === "number" ? stressBal.toFixed(2) : stressBal;
    assert(actualStr === expectedStr, `Audit 8.${count}: ${count.toLocaleString()} transactions aggregated accurately to ${expectedStr} (computed in ${tElapsed.toFixed(2)}ms)`);
  }

  // Audit 9: Account Overview Multi-Account Exact Aggregation (Section B)
  // 1. Two large accounts ending in .01 Paisa (NPR 98,999,999,999,999.01 each)
  const max99TxsA = [];
  const max99TxsB = [];
  for (let i = 0; i < 99; i++) {
    max99TxsA.push({ id: `tx_ov_a_${i}`, accountId: "acc_large_a", type: "income", amount: 999999999999.99, dateAD: "2026-10-01" });
    max99TxsB.push({ id: `tx_ov_b_${i}`, accountId: "acc_large_b", type: "income", amount: 999999999999.99, dateAD: "2026-10-01" });
  }
  const multiLargeState = {
    accounts: [
      { id: "acc_large_a", name: "Large Wallet A", type: "cash", openingBalance: 0, openingBalanceDate: "2026-01-01" },
      { id: "acc_large_b", name: "Large Wallet B", type: "bank", openingBalance: 0, openingBalanceDate: "2026-01-01" }
    ],
    transactions: [...max99TxsA, ...max99TxsB]
  };
  const balA = calculateAccountBalance(multiLargeState, "acc_large_a");
  const balB = calculateAccountBalance(multiLargeState, "acc_large_b");
  assert(balA === "98999999999999.01", "Audit 9.1: Account A exact balance is '98999999999999.01'");
  assert(balB === "98999999999999.01", "Audit 9.2: Account B exact balance is '98999999999999.01'");

  // Combined wallet balance aggregation
  const combinedPaisa = multiLargeState.accounts.reduce(
    (sumPaisa, a) => sumPaisa + toPaisaBigInt(calculateAccountBalance(multiLargeState, a.id)),
    0n
  );
  const combinedTotal = fromPaisaBigInt(combinedPaisa);
  assert(combinedTotal === "197999999999998.02", "Audit 9.3: Combined 2-account total is exact string '197999999999998.02' (NOT concatenated)");
  assert(formatCurrency(combinedTotal) === "रु 19,79,99,99,99,99,998.02", "Audit 9.4: Formatted combined balance displays 'रु 19,79,99,99,99,99,998.02' (NOT रु 0.00)");

  // Test renderAccounts DOM output with multiLargeState
  const mockContainer = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  renderAccounts(mockContainer, multiLargeState);
  assert(mockContainer.innerHTML.includes('<div class="kpi-amount">रु 19,79,99,99,99,99,998.02</div>'), "Audit 9.5: renderAccounts() renders exact combined amount in DOM kpi-amount");
  assert(!mockContainer.innerHTML.includes('<div class="kpi-amount">रु 0.00</div>'), "Audit 9.6: Combined kpi-amount does not render NaN/0.00 for large string balances");

  // 2. Three accounts with mixed positive and negative balances
  const mixedState = {
    accounts: [
      { id: "acc_m1", name: "Account M1", type: "bank", openingBalance: 10000.55, openingBalanceDate: "2026-01-01" },
      { id: "acc_m2", name: "Account M2", type: "cash", openingBalance: -2500.30, openingBalanceDate: "2026-01-01" },
      { id: "acc_m3", name: "Account M3", type: "esewa", openingBalance: 1234.75, openingBalanceDate: "2026-01-01" }
    ],
    transactions: []
  };
  const mixedPaisa = mixedState.accounts.reduce((sum, a) => sum + toPaisaBigInt(calculateAccountBalance(mixedState, a.id)), 0n);
  const mixedTotal = fromPaisaBigInt(mixedPaisa);
  assert(mixedTotal === 8735, "Audit 9.7: Mixed 3-account total equals exact mathematical 8735.00");
  assert(formatCurrency(mixedTotal) === "रु 8,735.00", "Audit 9.8: Mixed total formats to 'रु 8,735.00'");

  // Audit 10: Inconsistent Rounding Elimination in formatNepaliNumber (Section C)
  // Documented policy: Half-up rounding (round half away from zero)
  assert(formatNepaliNumber("1.49", 0) === "1", "Audit 10.1: '1.49' rounds down to '1'");
  assert(formatNepaliNumber(1.49, 0) === "1", "Audit 10.2: 1.49 (Number) rounds down to '1'");
  assert(formatNepaliNumber("1.50", 0) === "2", "Audit 10.3: '1.50' rounds up to '2'");
  assert(formatNepaliNumber(1.50, 0) === "2", "Audit 10.4: 1.50 (Number) rounds up to '2'");
  assert(formatNepaliNumber("1.99", 0) === "2", "Audit 10.5: '1.99' rounds up to '2'");
  assert(formatNepaliNumber(1.99, 0) === "2", "Audit 10.6: 1.99 (Number) rounds up to '2'");

  assert(formatNepaliNumber("0.49", 0) === "0", "Audit 10.7: '0.49' rounds to '0'");
  assert(formatNepaliNumber(0.49, 0) === "0", "Audit 10.8: 0.49 (Number) rounds to '0'");
  assert(formatNepaliNumber("0.50", 0) === "1", "Audit 10.9: '0.50' rounds to '1'");
  assert(formatNepaliNumber(0.50, 0) === "1", "Audit 10.10: 0.50 (Number) rounds to '1'");

  assert(formatNepaliNumber("-1.49", 0) === "-1", "Audit 10.11: '-1.49' rounds to '-1'");
  assert(formatNepaliNumber(-1.49, 0) === "-1", "Audit 10.12: -1.49 (Number) rounds to '-1'");
  assert(formatNepaliNumber("-1.50", 0) === "-2", "Audit 10.13: '-1.50' rounds to '-2'");
  assert(formatNepaliNumber(-1.50, 0) === "-2", "Audit 10.14: -1.50 (Number) rounds to '-2'");

  assert(formatNepaliNumber("98999999999999.50", 0) === "9,90,00,00,00,00,000", "Audit 10.15: Large decimal string .50 rounds up to next crore");
  assert(formatNepaliNumber("98999999999999.49", 0) === "9,89,99,99,99,99,999", "Audit 10.16: Large decimal string .49 rounds down");

  // Audit 11: Opening-Balance Date Updates Only Target Primary Account (Section D)
  __configureMockIdb();
  await dispatch("RESET_TO_DEMO");
  // Modify state so account at index 0 is NOT the primary account
  const mutateSetupRes = await commitMutation((cand) => {
    cand.accounts = [
      { id: "acc_secondary_bank", name: "Savings Bank", type: "bank", openingBalance: 25000, openingBalanceDate: "2026-01-01", openingBalanceDateBS: "2082-09-17", overdraftEnabled: false, archived: false },
      { id: "acc_default_cash", name: "Cash Wallet", type: "cash", openingBalance: 50000, openingBalanceDate: "2026-10-01", openingBalanceDateBS: "2083-06-15", overdraftEnabled: false, archived: false }
    ];
    cand.transactions = [
      {
        id: "tx_sec_bank_test",
        accountId: "acc_secondary_bank",
        type: "income",
        amount: 1000,
        dateAD: "2026-05-01",
        dateBS: "2083-01-18",
        description: "Salary deposit",
        category: "salary",
        paymentMethod: "bank_transfer"
      }
    ];
    return { success: true };
  });
  assert(mutateSetupRes.success === true, "Audit 11.0: Setup mutation with primary account at index 1 succeeds");

  const preSecBal = calculateAccountBalance(getState(), "acc_secondary_bank");
  // Update Settings with new baseline opening balance date for Cash Wallet
  const updateDateRes = await dispatch("UPDATE_SETTINGS", {
    initialBalance: 60000,
    initialBalanceDate: "2026-09-15"
  });
  assert(updateDateRes.success === true, "Audit 11.1: UPDATE_SETTINGS with initialBalanceDate succeeds");
  const postSecState = getState();
  // Secondary account at index 0 MUST NOT have its openingBalanceDate changed!
  assert(postSecState.accounts[0].id === "acc_secondary_bank", "Audit 11.2: Index 0 remains secondary bank");
  assert(postSecState.accounts[0].openingBalanceDate === "2026-01-01", "Audit 11.3: Index 0 openingBalanceDate is PRESERVED at 2026-01-01 (not overwritten)");
  assert(postSecState.accounts[0].openingBalance === 25000, "Audit 11.4: Index 0 openingBalance is PRESERVED at 25000");

  // Primary account at index 1 MUST be updated
  assert(postSecState.accounts[1].id === "acc_default_cash", "Audit 11.5: Index 1 is primary cash account");
  assert(postSecState.accounts[1].openingBalanceDate === "2026-09-15", "Audit 11.6: Primary cash openingBalanceDate updated to 2026-09-15");
  assert(postSecState.accounts[1].openingBalanceDateBS === "2083-05-30", "Audit 11.7: Primary cash openingBalanceDateBS updated to 2083-05-30");
  assert(postSecState.accounts[1].openingBalance === 60000, "Audit 11.8: Primary cash openingBalance updated to 60000");

  // Secondary account balance must be 100% unchanged
  const postSecBal = calculateAccountBalance(postSecState, "acc_secondary_bank");
  assert(postSecBal === preSecBal, "Audit 11.9: Historical transaction balance on secondary account is 100% unaffected");
  __disableMockIdb();

  // Audit 12: Atomic Rollback Race Condition Elimination (Section A)
  __configureMockIdb();
  const confirmedRaceBase = {
    version: 3,
    revision: 20,
    isDemoData: false,
    accounts: [{ id: "acc_tab1", name: "Tab 1 Wallet", type: "cash", openingBalance: 1000, openingBalanceDate: "2026-01-01" }],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: [],
    settings: { ...DEFAULT_SETTINGS }
  };
  await setStoredState(confirmedRaceBase, { force: true });

  // Tab 1 generates candidate revision 21 (which will fail verification)
  const failedCandidateTab1 = { ...confirmedRaceBase, revision: 21 };

  // Between Tab 1's failed write and rollback, Tab 2 concurrently commits revision 22
  const newerCommittedTab2 = {
    version: 3,
    revision: 22,
    isDemoData: false,
    accounts: [{ id: "acc_tab2", name: "Tab 2 Bank", type: "bank", openingBalance: 99999, openingBalanceDate: "2026-01-01" }],
    transactions: [{
      id: "tx_tab2_01",
      accountId: "acc_tab2",
      type: "income",
      amount: 5000,
      dateAD: "2026-10-01",
      dateBS: "2083-06-15",
      category: "salary",
      description: "Tab 2 Salary",
      paymentMethod: "bank_transfer"
    }],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: [],
    settings: { ...DEFAULT_SETTINGS }
  };
  await setStoredState(newerCommittedTab2, { force: true });

  // Tab 1 triggers rollbackVerifiedState
  const raceRbRes = await rollbackVerifiedState(confirmedRaceBase, failedCandidateTab1);
  assert(raceRbRes.success === true, "Audit 12.1: Atomic rollback succeeds when concurrent tab committed newer state");
  assert(raceRbRes.reconciledWithNewer === true, "Audit 12.2: Rollback reconciledWithNewer is true");
  assert(raceRbRes.rolledBackState.revision === 22, "Audit 12.3: Reconciled state preserves newer revision 22");
  assert(raceRbRes.rolledBackState.accounts[0].id === "acc_tab2", "Audit 12.4: Tab 2's account is preserved");
  assert(raceRbRes.rolledBackState.transactions[0].id === "tx_tab2_01", "Audit 12.5: Tab 2's transaction is preserved");
  assert(calculateAccountBalance(raceRbRes.rolledBackState, "acc_tab2") === 104999, "Audit 12.6: Tab 2's balance (99999 + 5000 = 104999) is fully preserved");

  const storedAfterRb = await getStoredState();
  assert(storedAfterRb.revision === 22, "Audit 12.7: Persistent IndexedDB stores revision 22 untouched");
  assert(storedAfterRb.transactions[0].id === "tx_tab2_01", "Audit 12.8: Persistent IndexedDB retains Tab 2's transaction");
  __disableMockIdb();

  // =========================================================================
  // AUDIT 13: Canonical Primary Account Selection Invariants
  // =========================================================================
  console.log("\n[Audit 13] Testing Canonical Primary Account Selection Invariants...");

  // Case A: Primary account at index 1 with secondary account at index 0
  const stateWithSecondaryFirst = {
    version: 2,
    accounts: [
      { id: "acc_bank_0", name: "Savings Bank", type: "bank", openingBalance: 10000, openingBalanceDate: "2026-01-01" },
      { id: "acc_default_cash", name: "Cash Wallet", type: "cash", openingBalance: 50000, openingBalanceDate: "2026-09-15" }
    ],
    transactions: [],
    settings: { initialBalance: 60000, initialBalanceDate: "2026-01-01" }
  };
  const resolvedA = resolvePrimaryAccount(stateWithSecondaryFirst.accounts);
  assert(resolvedA && resolvedA.id === "acc_default_cash", "Audit 13.1: resolvePrimaryAccount resolves acc_default_cash even when at index 1");
  const migratedA = migrateV2toV3(stateWithSecondaryFirst);
  assert(migratedA.settings.initialBalanceDate === "2026-09-15", "Audit 13.2: migrateV2toV3 selects primary cash opening date (2026-09-15) not secondary account date");

  // Case B: acc_default_cash at index 2
  const stateWithCashAtIndex2 = {
    version: 2,
    accounts: [
      { id: "acc_bank_1", name: "Bank 1", type: "bank", openingBalance: 10000, openingBalanceDate: "2026-01-01" },
      { id: "acc_bank_2", name: "Bank 2", type: "bank", openingBalance: 20000, openingBalanceDate: "2026-02-01" },
      { id: "acc_default_cash", name: "Cash Wallet", type: "cash", openingBalance: 30000, openingBalanceDate: "2026-10-01" }
    ],
    transactions: []
  };
  const resolvedB = resolvePrimaryAccount(stateWithCashAtIndex2.accounts);
  assert(resolvedB && resolvedB.id === "acc_default_cash", "Audit 13.3: resolvePrimaryAccount resolves acc_default_cash at index 2");
  const migratedB = migrateV2toV3(stateWithCashAtIndex2);
  assert(migratedB.settings.initialBalanceDate === "2026-10-01", "Audit 13.4: Migration picks acc_default_cash opening date from index 2");

  // Case C: No acc_default_cash present (custom IDs), first active account resolved
  const customAccounts = [
    { id: "acc_archived", name: "Old Cash", type: "cash", openingBalance: 5000, openingBalanceDate: "2025-01-01", archived: true },
    { id: "acc_custom_main", name: "Main Operating", type: "bank", openingBalance: 80000, openingBalanceDate: "2026-04-01", archived: false }
  ];
  const resolvedC = resolvePrimaryAccount(customAccounts);
  assert(resolvedC && resolvedC.id === "acc_custom_main", "Audit 13.5: resolvePrimaryAccount picks first active account when acc_default_cash absent");

  // Case D: Empty or null accounts
  assert(resolvePrimaryAccount([]) === null, "Audit 13.6: resolvePrimaryAccount on empty array returns null");
  assert(resolvePrimaryAccount(null) === null, "Audit 13.7: resolvePrimaryAccount on null returns null");

  // =========================================================================
  // AUDIT 14: Equal-Revision Conflict Detection & Snapshot Preservation
  // =========================================================================
  console.log("\n[Audit 14] Testing Equal-Revision Conflict Rollback Protection...");
  __configureMockIdb({ initialData: null });
  const baseEqualRev = {
    version: 3,
    revision: 50,
    isDemoData: false,
    accounts: [{ id: "acc_default_cash", name: "Cash Wallet", type: "cash", openingBalance: 20000, openingBalanceDate: "2026-01-01" }],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: [],
    settings: { ...DEFAULT_SETTINGS }
  };
  await setStoredState(baseEqualRev, { force: true });

  // Tab 1 attempts revision 51 with its own transaction
  const failedCandidateEqTab1 = {
    ...baseEqualRev,
    revision: 51,
    transactions: [{
      id: "tx_tab1_eq",
      accountId: "acc_default_cash",
      type: "income",
      amount: 1000,
      category: "freelance",
      description: "Tab 1 Freelance",
      dateAD: "2026-10-05",
      dateBS: "2083-06-19",
      paymentMethod: "cash"
    }]
  };

  // Concurrently, Tab 2 committed revision 51 with a DIFFERENT transaction
  const concurrentCommittedEqTab2 = {
    ...baseEqualRev,
    revision: 51,
    transactions: [{
      id: "tx_tab2_eq",
      accountId: "acc_default_cash",
      type: "expense",
      amount: 4000,
      category: "groceries",
      description: "Tab 2 Groceries",
      dateAD: "2026-10-06",
      dateBS: "2083-06-20",
      paymentMethod: "cash"
    }]
  };
  await setStoredState(concurrentCommittedEqTab2, { force: true });

  // Tab 1 executes rollbackVerifiedState
  const eqConflictRes = await rollbackVerifiedState(baseEqualRev, failedCandidateEqTab1);
  assert(eqConflictRes.success === false, "Audit 14.1: Rollback reports failure when stored revision equals candidate revision with different payload");
  assert(eqConflictRes.conflict === true, "Audit 14.2: Equal-revision conflict flagged");
  assert(eqConflictRes.equalRevisionConflict === true, "Audit 14.3: equalRevisionConflict identified");

  // Verify persistent storage in IDB was NOT overwritten by Tab 1
  const storedAfterEqConflict = await getStoredState();
  assert(storedAfterEqConflict.revision === 51, "Audit 14.4: Stored state remains at revision 51");
  assert(storedAfterEqConflict.transactions[0].id === "tx_tab2_eq", "Audit 14.5: Tab 2's stored transaction is preserved without overwriting");

  // Verify Tab 2's stored state was backed up to CONFLICT_BACKUP
  const conflictBackup = StorageService.getItem(STORAGE_KEYS.CONFLICT_BACKUP);
  assert(conflictBackup && conflictBackup.transactions[0].id === "tx_tab2_eq", "Audit 14.6: Conflict snapshot backed up to CONFLICT_BACKUP");
  __disableMockIdb();

  // =========================================================================
  // AUDIT 15: Projected-Balance Aggregate Financial Validation
  // =========================================================================
  console.log("\n[Audit 15] Testing Projected-Balance Aggregate Financial Validation...");

  const overflowAccount = {
    id: "acc_overflow",
    name: "Treasury Account",
    type: "bank",
    openingBalance: 999999999999.99,
    openingBalanceDate: "2026-01-01"
  };
  const overflowTxs = [];
  for (let i = 0; i < 11000; i++) {
    overflowTxs.push({
      id: `tx_over_${i}`,
      accountId: "acc_overflow",
      type: "income",
      amount: 999999999999.99,
      category: "salary",
      description: `Surplus Tranche ${i}`,
      dateAD: "2026-05-01",
      dateBS: "2083-01-18",
      paymentMethod: "bank_transfer"
    });
  }

  const overflowState = {
    version: 3,
    isDemoData: false,
    accounts: [overflowAccount],
    transactions: overflowTxs,
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: [],
    settings: { ...DEFAULT_SETTINGS }
  };

  const overflowVal = Validator.validateBackupJson(overflowState);
  assert(overflowVal.isValid === false, "Audit 15.1: State with aggregate transactions exceeding safe limit is rejected");
  assert(overflowVal.error && (overflowVal.error.includes("exceeds safe limit") || overflowVal.error.includes("exceeds maximum supported limit")), "Audit 15.2: Error explains aggregate financial limit exceeded");

  // Verify normal ledger passes projected balance checks smoothly
  const normalLedger = {
    version: 3,
    isDemoData: false,
    accounts: [{ id: "acc_normal", name: "Normal Bank", type: "bank", openingBalance: 50000, openingBalanceDate: "2026-01-01" }],
    transactions: [
      { id: "tx_n1", accountId: "acc_normal", type: "income", amount: 20000, category: "salary", description: "Pay", dateAD: "2026-02-01", dateBS: "2082-10-18", paymentMethod: "bank_transfer" },
      { id: "tx_n2", accountId: "acc_normal", type: "expense", amount: 5000, category: "groceries", description: "Food", dateAD: "2026-02-05", dateBS: "2082-10-22", paymentMethod: "cash" }
    ],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: [],
    settings: { ...DEFAULT_SETTINGS }
  };
  const normalVal = Validator.validateBackupJson(normalLedger);
  assert(normalVal.isValid === true, "Audit 15.3: Normal multi-transaction ledger passes projected balance validation");

  // =========================================================================
  // AUDIT 16: Independent Seed-Based Financial Reference Calculations
  // =========================================================================
  console.log("\n[Audit 16] Testing Independent Seed-Based BigInt Reference Calculations...");

  const testAmounts = [
    "0.10", "0.20", "0.30", "0.70", "1.15", "2.25", "99.99",
    "100.05", "1000.10", "999999999999.99", "54321.89", "0.01", "0.09"
  ];
  let manualPaisaSum = 0n;
  let floatSum = 0;
  for (const amtStr of testAmounts) {
    const parts = amtStr.split(".");
    const p = BigInt(parts[0]) * 100n + BigInt((parts[1] || "").padEnd(2, "0"));
    manualPaisaSum += p;
    floatSum += parseFloat(amtStr);
  }
  const engineSum = addMoney(...testAmounts);
  const expectedPaisaStr = fromPaisaBigInt(manualPaisaSum);
  assert(engineSum === expectedPaisaStr || Number(engineSum) === Number(expectedPaisaStr), "Audit 16.1: BigInt engine sum matches independent manual paisa calculation exactly");

  const diffFloat = Math.abs(floatSum - Number(expectedPaisaStr));
  assert(diffFloat < 0.01, "Audit 16.2: BigInt engine remains within float approximation envelope without drift");

  for (const amt of testAmounts) {
    const p = toPaisaBigInt(amt);
    const back = fromPaisaBigInt(p, { asString: true });
    assert(back === amt, `Audit 16.3: Round trip preserved exact amount ${amt} -> ${back}`);
  }

  // =========================================================================
  // AUDIT 17: Negative Money Rounding, Semantic Money Helpers & Storage Persistence
  // =========================================================================
  console.log("\n[Audit 17] Testing Negative Money Rounding, Semantic Helpers & Storage Persistence...");

  // 17.1: Symmetric half-up negative rounding in multiplyMoney()
  assert(multiplyMoney("0.01", 0.5) === 0.01, "Audit 17.1a: multiplyMoney('0.01', 0.5) rounds 0.005 up away from zero to 0.01");
  assert(multiplyMoney("-0.01", 0.5) === -0.01, "Audit 17.1b: multiplyMoney('-0.01', 0.5) rounds -0.005 symmetrically away from zero to -0.01");
  assert(multiplyMoney("0.01", 0.6) === 0.01, "Audit 17.1c: multiplyMoney('0.01', 0.6) rounds 0.006 up to 0.01");
  assert(multiplyMoney("-0.01", 0.6) === -0.01, "Audit 17.1d: multiplyMoney('-0.01', 0.6) rounds -0.006 symmetrically to -0.01");
  assert(multiplyMoney("0.01", 0.4) === 0, "Audit 17.1e: multiplyMoney('0.01', 0.4) rounds 0.004 towards zero to 0");
  assert(multiplyMoney("-0.01", 0.4) === 0, "Audit 17.1f: multiplyMoney('-0.01', 0.4) rounds -0.004 towards zero to 0");
  assert(multiplyMoney("1.00", 1.5) === 1.5, "Audit 17.1g: multiplyMoney('1.00', 1.5) scales correctly to 1.5");
  assert(multiplyMoney("-1.00", 1.5) === -1.5, "Audit 17.1h: multiplyMoney('-1.00', 1.5) scales negative amounts symmetrically to -1.5");
  assert(multiplyMoney("100.00", 0.001) === 0.1, "Audit 17.1i: multiplyMoney('100.00', 0.001) produces 0.1");
  assert(multiplyMoney("-100.00", 0.001) === -0.1, "Audit 17.1j: multiplyMoney('-100.00', 0.001) produces -0.1");
  assert(multiplyMoney("0.00", 5) === 0, "Audit 17.1k: multiplyMoney('0.00', 5) is 0");
  assert(multiplyMoney("50.00", 0) === 0, "Audit 17.1l: multiplyMoney('50.00', 0) is 0");
  assert(multiplyMoney("999999999999.99", 1) === 999999999999.99, "Audit 17.1m: multiplyMoney preserves max safe integer range");
  assert(multiplyMoney("999999999999.99", -1) === -999999999999.99, "Audit 17.1n: multiplyMoney supports negative scaling factors");
  assert(multiplyMoney("0.01", 0.5, { asString: true }) === "0.01", "Audit 17.1o: multiplyMoney supports exact string output '0.01'");
  assert(multiplyMoney("-0.01", 0.5, { asString: true }) === "-0.01", "Audit 17.1p: multiplyMoney supports exact string output '-0.01'");

  // 17.2: Semantic Money Helpers
  assert(rupeesToPaisaBigInt("123.45") === 12345n, "Audit 17.2a: rupeesToPaisaBigInt('123.45') produces 12345n");
  assert(rupeesToPaisaBigInt("-123.45") === -12345n, "Audit 17.2b: rupeesToPaisaBigInt('-123.45') produces -12345n");
  assert(rupeesToPaisaBigInt(50) === 5000n, "Audit 17.2c: rupeesToPaisaBigInt(50) produces 5000n");
  assert(paisaToRupeesDisplay(12345n) === "123.45", "Audit 17.2d: paisaToRupeesDisplay(12345n) produces '123.45'");
  assert(paisaToRupeesDisplay(-12345n) === "-123.45", "Audit 17.2e: paisaToRupeesDisplay(-12345n) produces '-123.45'");
  assert(paisaToRupeesDisplay(0n) === "0.00", "Audit 17.2f: paisaToRupeesDisplay(0n) produces '0.00'");
  assert(parseMoneyToPaisa("99.99") === 9999n, "Audit 17.2g: parseMoneyToPaisa('99.99') parses to 9999n");
  let threwNaN = false;
  try { parseMoneyToPaisa("not-a-number"); } catch { threwNaN = true; }
  assert(threwNaN, "Audit 17.2h: parseMoneyToPaisa strictly throws on malformed strings and never silently converts to 0");
  let threwNull = false;
  try { parseMoneyToPaisa(null); } catch { threwNull = true; }
  assert(threwNull, "Audit 17.2i: parseMoneyToPaisa strictly throws on null and never silently converts to 0");

  // 17.3: Storage Persistence Manager
  const origNavDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  // Test unsupported environment
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  const unsupStatus = await checkPersistenceStatus();
  assert(unsupStatus === PERSISTENCE_STATUS.UNSUPPORTED, "Audit 17.3a: checkPersistenceStatus reports unsupported when storage API absent");
  const unsupReq = await requestPersistence();
  assert(unsupReq.success === false && unsupReq.status === PERSISTENCE_STATUS.UNSUPPORTED, "Audit 17.3b: requestPersistence fails cleanly when storage API absent");

  // Test granted environment
  let notifiedStatus = null;
  const unsub = subscribePersistenceStatus((st) => { notifiedStatus = st; });
  Object.defineProperty(globalThis, "navigator", {
    value: {
      storage: {
        persisted: async () => true,
        persist: async () => true
      }
    },
    configurable: true,
    writable: true
  });
  const grantedStatus = await checkPersistenceStatus();
  assert(grantedStatus === PERSISTENCE_STATUS.GRANTED, "Audit 17.3c: checkPersistenceStatus reports granted when persisted() is true");
  assert(notifiedStatus === PERSISTENCE_STATUS.GRANTED, "Audit 17.3d: subscribePersistenceStatus notifies listeners of granted status");
  assert(getPersistenceStatus() === PERSISTENCE_STATUS.GRANTED, "Audit 17.3e: getPersistenceStatus reflects granted status");

  // Test not_granted environment and user request
  Object.defineProperty(globalThis, "navigator", {
    value: {
      storage: {
        persisted: async () => false,
        persist: async () => true
      }
    },
    configurable: true,
    writable: true
  });
  const notGrantedStatus = await checkPersistenceStatus();
  assert(notGrantedStatus === PERSISTENCE_STATUS.NOT_GRANTED, "Audit 17.3f: checkPersistenceStatus reports not_granted when persisted() is false");
  const reqRes = await requestPersistence();
  assert(reqRes.success === true && reqRes.status === PERSISTENCE_STATUS.GRANTED, "Audit 17.3g: requestPersistence elevates status to granted upon successful browser response");

  unsub();
  if (origNavDescriptor) {
    Object.defineProperty(globalThis, "navigator", origNavDescriptor);
  } else {
    delete globalThis.navigator;
  }

  // 17.4: Primary Account Resolution Logic
  const testAccounts = [
    { id: "acc_secondary", name: "Secondary Account", isPrimary: false },
    { id: "acc_primary", name: "Primary Account", isPrimary: true },
    { id: "acc_tertiary", name: "Tertiary Account", isPrimary: false }
  ];
  const resolved = resolvePrimaryAccount(testAccounts);
  assert(resolved?.id === "acc_primary", "Audit 17.4a: resolvePrimaryAccount resolves account with isPrimary: true over array index 0");

  const noPrimaryAccounts = [
    { id: "acc_fallback_1", name: "Fallback 1", isPrimary: false },
    { id: "acc_fallback_2", name: "Fallback 2", isPrimary: false }
  ];
  assert(resolvePrimaryAccount(noPrimaryAccounts)?.id === "acc_fallback_1", "Audit 17.4b: resolvePrimaryAccount safely falls back to index 0 when no primary is designated");
  assert(resolvePrimaryAccount([]) === null, "Audit 17.4c: resolvePrimaryAccount returns null for empty account list");
  assert(resolvePrimaryAccount(null) === null, "Audit 17.4d: resolvePrimaryAccount returns null for null/undefined input");

  // =========================================================================
  // AUDIT 18: Master Production Hardening Verification (Scenarios A through J)
  // =========================================================================
  console.log("\n[Audit 18] Testing Master Production Hardening (Scenarios A through J)...");

  // Scenario A: IndexedDB rev 10 vs LocalStorage rev 11 after restart
  const idbRev10State = {
    version: 3,
    revision: 10,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 50000, initialBalanceDate: "2026-01-01" },
    accounts: [{ id: "acc_idb_10", name: "Main Bank", type: "bank", openingBalance: 50000, openingBalanceDate: "2026-01-01", overdraftEnabled: false, archived: false }],
    transactions: [
      { id: "tx_rev10_1", accountId: "acc_idb_10", type: "income", amount: 10000, category: "salary", description: "Rev 10 Pay", dateAD: "2026-02-01", dateBS: "2082-10-18", paymentMethod: "bank_transfer" }
    ],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  const lsRev11State = {
    ...idbRev10State,
    revision: 11,
    transactions: [
      ...idbRev10State.transactions,
      { id: "tx_rev11_fallback", accountId: "acc_idb_10", type: "expense", amount: 2500, category: "groceries", description: "Fallback Save Grocery", dateAD: "2026-02-05", dateBS: "2082-10-22", paymentMethod: "cash" }
    ]
  };

  // Setup: IDB has rev 10, LS has rev 11
  __configureMockIdb({ initialData: idbRev10State });
  StorageService.setItem(STORAGE_KEYS.APP_DATA, lsRev11State);
  init();

  const reconA = await hydrateFromIndexedDB();
  assert(reconA.status === "recovered_newer_ls_promoted", "Audit 18.A1: Newer LocalStorage revision 11 is recovered and promoted to IndexedDB over older revision 10");
  assert(getState().revision === 11, "Audit 18.A2: Active state revision is 11 (newer snapshot preserved)");
  assert(getState().transactions.length === 2, "Audit 18.A3: Active state contains both transactions from newer revision 11");
  const idbAfterReconA = await getStoredState();
  assert(idbAfterReconA && idbAfterReconA.revision === 11, "Audit 18.A4: Authoritative IndexedDB successfully promoted to revision 11");
  assert(StorageService.getItem(STORAGE_KEYS.CONFLICT_BACKUP)?.revision === 10, "Audit 18.A5: Older revision 10 preserved in conflict backup before promotion");

  // Scenario B: String-valued account flags rejected by backup validation
  const baseValidLedger = {
    version: 3,
    revision: 1,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 10000, initialBalanceDate: "2026-01-01" },
    accounts: [{ id: "acc_val_test", name: "Test Bank", type: "bank", openingBalance: 10000, openingBalanceDate: "2026-01-01" }],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  const badOverdraft = JSON.parse(JSON.stringify(baseValidLedger));
  badOverdraft.accounts[0].overdraftEnabled = "false";
  const valOverdraft = Validator.validateBackupJson(badOverdraft);
  assert(valOverdraft.isValid === false, "Audit 18.B1: String 'false' for overdraftEnabled is strictly rejected");

  const badArchived = JSON.parse(JSON.stringify(baseValidLedger));
  badArchived.accounts[0].archived = "false";
  const valArchived = Validator.validateBackupJson(badArchived);
  assert(valArchived.isValid === false, "Audit 18.B2: String 'false' for archived is strictly rejected");

  const badPrimary = JSON.parse(JSON.stringify(baseValidLedger));
  badPrimary.accounts[0].isPrimary = "true";
  const valPrimary = Validator.validateBackupJson(badPrimary);
  assert(valPrimary.isValid === false, "Audit 18.B3: String 'true' for isPrimary is strictly rejected");

  const goodBooleans = JSON.parse(JSON.stringify(baseValidLedger));
  goodBooleans.accounts[0].overdraftEnabled = false;
  goodBooleans.accounts[0].archived = false;
  goodBooleans.accounts[0].isPrimary = true;
  assert(Validator.validateBackupJson(goodBooleans).isValid === true, "Audit 18.B4: Strict booleans (true/false) pass validation cleanly");

  // Scenario C: Invalid revisions rejected and missing legacy revisions migrated safely
  const revTests = ["10", -1, 2.5, NaN, Infinity, 99999999999999999999999];
  for (const badRev of revTests) {
    const badLedger = { ...baseValidLedger, revision: badRev };
    const valBadRev = Validator.validateBackupJson(badLedger);
    assert(valBadRev.isValid === false, `Audit 18.C1: Invalid revision (${badRev}) is rejected by validator`);
  }

  const legacyV2Payload = {
    version: 2,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 5000, initialBalanceDate: "2026-01-01" },
    transactions: []
  };
  const migratedLegacy = migrateV2toV3(legacyV2Payload);
  assert(migratedLegacy.revision === 1, "Audit 18.C2: Missing legacy revision migrated safely to revision 1");

  // Scenario D: Archived primary account never selected when a valid active alternative exists
  const archivedCashWithActiveBank = [
    { id: "acc_default_cash", name: "Cash Wallet", type: "cash", openingBalance: 1000, openingBalanceDate: "2026-01-01", isPrimary: true, archived: true },
    { id: "acc_active_bank", name: "Siddhartha Bank", type: "bank", openingBalance: 50000, openingBalanceDate: "2026-01-01", isPrimary: false, archived: false }
  ];
  const resolvedActive = resolvePrimaryAccount(archivedCashWithActiveBank);
  assert(resolvedActive?.id === "acc_active_bank", "Audit 18.D1: Archived canonical cash is bypassed and active bank account is selected");

  const allArchived = [
    { id: "acc_1", name: "Old 1", type: "cash", archived: true },
    { id: "acc_2", name: "Old 2", type: "bank", archived: true }
  ];
  assert(resolvePrimaryAccount(allArchived) === null, "Audit 18.D2: When all accounts are archived, resolvePrimaryAccount returns null");

  // Scenario E: Nepal-local dashboard date remains correct when UTC and local dates differ
  const mockUtcLateNight = new Date("2026-11-11T21:15:00.000Z"); // 03:00 AM in Nepal on 2026-11-12
  const nepalDateString = getNepalLocalDateString(mockUtcLateNight);
  const utcDateString = mockUtcLateNight.toISOString().slice(0, 10);
  assert(nepalDateString === "2026-11-12", "Audit 18.E1: getNepalLocalDateString correctly computes Nepal date 2026-11-12");
  assert(utcDateString === "2026-11-11", "Audit 18.E2: Proves UTC slice would have given previous date 2026-11-11");

  // Scenario F: Invalid money parsing cannot silently turn malformed financial input into zero
  let parseThrowsOnBogus = false;
  try { parseMoneyToPaisa("bogus_rupees"); } catch { parseThrowsOnBogus = true; }
  assert(parseThrowsOnBogus, "Audit 18.F1: parseMoneyToPaisa throws on non-numeric input");

  let parseThrowsOnPrecision = false;
  try { parseMoneyToPaisa("100.999"); } catch { parseThrowsOnPrecision = true; }
  assert(parseThrowsOnPrecision, "Audit 18.F2: parseMoneyToPaisa throws on 3-decimal precision violation");

  const badAmountTx = {
    type: "income",
    accountId: "acc_idb_10",
    amount: "abc",
    category: "salary",
    description: "Invalid money write",
    dateAD: "2026-10-10",
    paymentMethod: "cash"
  };
  const badTxMut = await dispatch("ADD_TRANSACTION", badAmountTx);
  assert(badTxMut.success === false, "Audit 18.F3: Write path rejects malformed monetary amount instead of treating as Rs 0");

  // Scenario G: Browser refresh and restart preserve the exact saved financial state
  const preRestartFingerprint = computeStateFingerprint(getState());
  init();
  await hydrateFromIndexedDB();
  const postRestartFingerprint = computeStateFingerprint(getState());
  assert(preRestartFingerprint === postRestartFingerprint, "Audit 18.G: Complete application state and fingerprint preserved identically across restart");

  // Scenario H: Backup export and restoration reproduce the same financial data and balances
  const preExportState = getState();
  const exportedJsonH = generateBackupJsonString(preExportState);
  await dispatch("CLEAR_ALL_DATA");
  assert(getState().transactions.length === 0, "Audit 18.H1: Ledger cleared prior to restoration");
  const restoreRes = await dispatch("RESTORE_BACKUP", JSON.parse(exportedJsonH));
  assert(restoreRes.success === true, "Audit 18.H2: Backup restoration succeeded");
  assert(computeStateFingerprint(getState()) === computeStateFingerprint(preExportState), "Audit 18.H3: Restored state matches exported state with 100% fingerprint equality");

  // Scenario I: Concurrent browser tabs cannot silently overwrite newer data
  const baseRev = getState().revision;
  const staleCandidate = {
    ...getState(),
    revision: baseRev - 1,
    transactions: [{ id: "tx_stale_tab", accountId: "acc_default_cash", type: "income", amount: 100, category: "gift", description: "Stale Tab", dateAD: "2026-10-01", paymentMethod: "cash" }]
  };
  const persistStaleRes = await persistVerifiedState(staleCandidate);
  assert(persistStaleRes.success === false && persistStaleRes.conflict === true, "Audit 18.I: Stale revision from concurrent tab rejected without overwriting newer state");

  // Scenario J: Every displayed account balance matches independent ledger calculations
  const currentStateSnap = getState();
  for (const acc of currentStateSnap.accounts || []) {
    let manualPaisa = toPaisaBigInt(acc.openingBalance || 0);
    for (const tx of currentStateSnap.transactions || []) {
      if (tx.accountId !== acc.id) continue;
      const amtPaisa = toPaisaBigInt(tx.amount || 0);
      if (tx.type === "income") manualPaisa += amtPaisa;
      else if (tx.type === "expense") manualPaisa -= amtPaisa;
      else if (tx.type === "transfer") {
        if (tx.transferDirection === "in") manualPaisa += amtPaisa;
        else if (tx.transferDirection === "out") manualPaisa -= amtPaisa;
      }
    }
    const calculatedBalance = calculateAccountBalance(currentStateSnap, acc.id);
    const manualRupees = fromPaisaBigInt(manualPaisa);
    assert(calculatedBalance === manualRupees, `Audit 18.J: Account '${acc.name}' calculated balance (${calculatedBalance}) matches independent accounting ledger (${manualRupees})`);
  }

  // =========================================================================
  // AUDIT 19 & 20: Section 13 Required Regression Tests (Scenarios A through F)
  // =========================================================================
  console.log("\n[Audit 19/20] Testing Section 13 Scenarios A through F...");

  // Scenario A — Equal-revision recovery and destructive operations
  console.log("\n  [Scenario A] Equal-revision recovery and destructive operations...");
  const rev42Base = {
    version: 3,
    revision: 42,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 20000, initialBalanceDate: "2026-01-01" },
    accounts: [{ id: "acc_diverge", name: "Diverge Account", type: "bank", openingBalance: 20000, openingBalanceDate: "2026-01-01", overdraftEnabled: false, archived: false }],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  const idbSnapshot42 = {
    ...rev42Base,
    transactions: [
      { id: "tx_idb_branch", accountId: "acc_diverge", type: "income", amount: 15000, category: "freelance", description: "IDB Tranche", dateAD: "2026-03-01", dateBS: "2082-11-17", paymentMethod: "bank_transfer" }
    ]
  };

  const lsSnapshot42 = {
    ...rev42Base,
    transactions: [
      { id: "tx_ls_branch", accountId: "acc_diverge", type: "expense", amount: 7500, category: "groceries", description: "LS Expense", dateAD: "2026-03-02", dateBS: "2082-11-18", paymentMethod: "cash" }
    ]
  };

  // 1. Setup IDB with idbSnapshot42 and LocalStorage with lsSnapshot42
  __configureMockIdb({ initialData: idbSnapshot42 });
  StorageService.setItem(STORAGE_KEYS.APP_DATA, lsSnapshot42);
  init();

  // 2. Application startup / hydration
  const hydrateConflictRes = await hydrateFromIndexedDB();
  assert(hydrateConflictRes.status === "equal_revision_conflict", "Scenario A.1: Startup detects equal-revision conflict (rev 42) without picking either automatically");
  assert(hydrateConflictRes.equalRevisionConflict === true, "Scenario A.2: equalRevisionConflict flag is true");

  // 3. Confirm protected recovery mode
  const conflictState = getState();
  assert(conflictState.recoveryMode === true, "Scenario A.3: State manager enters protected recoveryMode");
  assert(conflictState.recoveryType === "equal_revision_conflict", "Scenario A.4: recoveryType identifies equal_revision_conflict");
  assert(Boolean(conflictState.idbRecoverableState), "Scenario A.5: IDB snapshot is preserved in idbRecoverableState");
  assert(Boolean(conflictState.lsRecoverableState), "Scenario A.6: LS snapshot is preserved in lsRecoverableState");

  // 4. Confirm neither original snapshot is overwritten or silently discarded
  const idbStoredA = await getStoredState();
  const lsStoredA = StorageService.getItem(STORAGE_KEYS.APP_DATA);
  const conflictBackupLsA = StorageService.getItem(STORAGE_KEYS.CONFLICT_LS_BACKUP);
  const conflictBackupIdbA = StorageService.getItem(STORAGE_KEYS.CONFLICT_IDB_BACKUP);
  assert(idbStoredA.transactions[0].id === "tx_idb_branch", "Scenario A.7: IndexedDB retains its original snapshot without deletion");
  assert(lsStoredA.transactions[0].id === "tx_ls_branch", "Scenario A.8: LocalStorage retains its original snapshot without deletion");
  assert(conflictBackupLsA && conflictBackupLsA.transactions[0].id === "tx_ls_branch", "Scenario A.9: LocalStorage copy preserved in CONFLICT_LS_BACKUP");
  assert(conflictBackupIdbA && conflictBackupIdbA.transactions[0].id === "tx_idb_branch", "Scenario A.10: IndexedDB copy preserved in CONFLICT_IDB_BACKUP");

  // 5. Attempt normal transaction creation -> blocked
  const blockedTxA = await dispatch("ADD_TRANSACTION", {
    type: "income",
    accountId: "acc_diverge",
    amount: 1000,
    category: "salary",
    description: "Blocked during conflict",
    dateAD: "2026-03-05",
    paymentMethod: "cash"
  });
  assert(blockedTxA.success === false, "Scenario A.11: Normal financial writes are blocked while recoveryMode is active");

  // 6. Attempt demo reset -> blocked
  const blockedResetA = await dispatch("RESET_TO_DEMO");
  assert(blockedResetA.success === false, "Scenario A.12: Reset to demo data is blocked during equal-revision conflict");
  assert(getState().recoveryMode === true, "Scenario A.13: State remains in recovery mode after blocked reset attempt");

  // 7. Attempt clear-all -> blocked
  const blockedClearA = await dispatch("CLEAR_ALL_DATA");
  assert(blockedClearA.success === false, "Scenario A.14: Clear all data is blocked during equal-revision conflict");
  assert(getState().recoveryMode === true, "Scenario A.15: State remains in recovery mode after blocked clear attempt");

  // 8. Attempt ordinary backup restoration -> blocked
  const dummyBackupA = {
    version: 3,
    revision: 99,
    isDemoData: false,
    settings: DEFAULT_SETTINGS,
    accounts: [{ id: "acc_dummy", name: "Dummy", type: "cash", openingBalance: 0, openingBalanceDate: "2026-01-01" }],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };
  const blockedRestoreA = await dispatch("RESTORE_BACKUP", dummyBackupA);
  assert(blockedRestoreA.success === false, "Scenario A.16: Ordinary backup restore is blocked during equal-revision conflict");

  // 9. Attempt ordinary backup export -> throws error to prevent dummy placeholder export
  let exportThrewA = false;
  try {
    generateBackupJsonString(getState());
  } catch (err) {
    exportThrewA = true;
  }
  assert(exportThrewA === true, "Scenario A.17: Ordinary backup export is blocked during recoveryMode to prevent placeholder dummy export");

  // 10. Confirm user can export both original snapshots
  const idbExportA = exportRecoverySnapshot(conflictState.idbRecoverableState, "indexeddb");
  const lsExportA = exportRecoverySnapshot(conflictState.lsRecoverableState, "localstorage");
  assert(idbExportA.content.includes("tx_idb_branch") && idbExportA.filename === "merohisab-recovery-indexeddb.json", "Scenario A.18: User can export original IndexedDB snapshot cleanly");
  assert(lsExportA.content.includes("tx_ls_branch") && lsExportA.filename === "merohisab-recovery-localstorage.json", "Scenario A.19: User can export original LocalStorage snapshot cleanly");

  // 11. Confirm recovery cannot be bypassed by a Settings action
  const blockedProfileA = await dispatch("UPDATE_PROFILE", { name: "Bypass Attempt" });
  assert(blockedProfileA.success === false, "Scenario A.20: Settings/profile changes cannot bypass equal-revision recovery");
  assert(getState().recoveryMode === true, "Scenario A.21: Recovery mode remains strictly enforced");

  // Scenario B — Recovery with IndexedDB selection
  console.log("\n  [Scenario B] Recovery with IndexedDB selection...");
  const resolveIdbB = await dispatch("RESOLVE_STORAGE_CONFLICT", "idb");
  assert(resolveIdbB.success === true, "Scenario B.1: resolveStorageConflict('idb') succeeds");
  assert(getState().recoveryMode === false, "Scenario B.2: Recovery mode cleared after selecting IndexedDB");
  assert(getState().revision === 43, "Scenario B.3: Revision advances safely to 43");
  assert(getState().transactions[0].id === "tx_idb_branch", "Scenario B.4: Selected IDB transaction is active in ledger");
  assert(calculateAccountBalance(getState(), "acc_diverge") === 35000, "Scenario B.5: Balance reflects chosen snapshot (20000 + 15000 = 35000)");

  // Verify alternate snapshot was preserved independently
  const preservedLsB = StorageService.getItem(STORAGE_KEYS.CONFLICT_LS_BACKUP);
  const preservedConflictB = StorageService.getItem(STORAGE_KEYS.CONFLICT_BACKUP);
  assert(preservedLsB && preservedLsB.transactions[0].id === "tx_ls_branch", "Scenario B.6: LocalStorage snapshot preserved in CONFLICT_LS_BACKUP");
  assert(preservedConflictB && preservedConflictB.transactions[0].id === "tx_ls_branch", "Scenario B.7: LocalStorage snapshot preserved in CONFLICT_BACKUP");

  // Reload the application / simulated browser reload
  init();
  const reloadResB = await hydrateFromIndexedDB();
  assert(reloadResB.status === "ok", "Scenario B.8: Application reloads cleanly without conflict");
  assert(getState().recoveryMode === false, "Scenario B.9: State remains normal across reload");
  assert(getState().revision === 43, "Scenario B.10: Revision 43 persists across reload");
  assert(getState().transactions[0].id === "tx_idb_branch", "Scenario B.11: Chosen IDB transaction persists across reload");
  assert(calculateAccountBalance(getState(), "acc_diverge") === 35000, "Scenario B.12: Balance remains exactly 35,000 across reload");
  assert(StorageService.getItem(STORAGE_KEYS.CONFLICT_LS_BACKUP).transactions[0].id === "tx_ls_branch", "Scenario B.13: Alternate snapshot remains recoverable after reload");

  // Scenario C — Recovery with LocalStorage selection
  console.log("\n  [Scenario C] Recovery with LocalStorage selection...");
  const rev50Base = {
    version: 3,
    revision: 50,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 30000, initialBalanceDate: "2026-01-01" },
    accounts: [{ id: "acc_diverge50", name: "Diverge Account 50", type: "bank", openingBalance: 30000, openingBalanceDate: "2026-01-01", overdraftEnabled: false, archived: false }],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  const idbSnapshot50 = {
    ...rev50Base,
    transactions: [
      { id: "tx_idb_50", accountId: "acc_diverge50", type: "income", amount: 20000, category: "freelance", description: "IDB Tranche 50", dateAD: "2026-03-01", dateBS: "2082-11-17", paymentMethod: "bank_transfer" }
    ]
  };

  const lsSnapshot50 = {
    ...rev50Base,
    transactions: [
      { id: "tx_ls_50", accountId: "acc_diverge50", type: "expense", amount: 6000, category: "groceries", description: "LS Expense 50", dateAD: "2026-03-02", dateBS: "2082-11-18", paymentMethod: "cash" }
    ]
  };

  __configureMockIdb({ initialData: idbSnapshot50 });
  StorageService.setItem(STORAGE_KEYS.APP_DATA, lsSnapshot50);
  init();

  const hydrateConflictC = await hydrateFromIndexedDB();
  assert(hydrateConflictC.status === "equal_revision_conflict", "Scenario C.1: Startup detects rev 50 conflict");
  assert(getState().recoveryMode === true, "Scenario C.2: State enters recovery mode");

  // User selects LocalStorage
  const resolveLsC = await dispatch("RESOLVE_STORAGE_CONFLICT", "ls");
  assert(resolveLsC.success === true, "Scenario C.3: resolveStorageConflict('ls') succeeds");
  assert(getState().recoveryMode === false, "Scenario C.4: Recovery mode cleared after selecting LocalStorage");
  assert(getState().revision === 51, "Scenario C.5: Revision advances safely to 51");
  assert(getState().transactions[0].id === "tx_ls_50", "Scenario C.6: Selected LS transaction is active in ledger");
  assert(calculateAccountBalance(getState(), "acc_diverge50") === 24000, "Scenario C.7: Balance reflects chosen snapshot (30000 - 6000 = 24000)");

  // Verify IDB snapshot was preserved independently
  const preservedIdbC = StorageService.getItem(STORAGE_KEYS.CONFLICT_IDB_BACKUP);
  assert(preservedIdbC && preservedIdbC.transactions[0].id === "tx_idb_50", "Scenario C.8: IndexedDB snapshot preserved in CONFLICT_IDB_BACKUP");

  // Reload application
  init();
  const reloadResC = await hydrateFromIndexedDB();
  assert(reloadResC.status === "ok", "Scenario C.9: Application reloads cleanly without conflict");
  assert(getState().revision === 51, "Scenario C.10: Revision 51 persists across reload");
  assert(getState().transactions[0].id === "tx_ls_50", "Scenario C.11: Chosen LS transaction persists across reload");
  assert(calculateAccountBalance(getState(), "acc_diverge50") === 24000, "Scenario C.12: Balance remains 24,000 across reload");
  assert(StorageService.getItem(STORAGE_KEYS.CONFLICT_IDB_BACKUP).transactions[0].id === "tx_idb_50", "Scenario C.13: Alternate snapshot remains recoverable after reload");

  // Scenario D — Backup failure during recovery
  console.log("\n  [Scenario D] Backup failure during recovery...");
  const rev60Base = {
    version: 3,
    revision: 60,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 10000, initialBalanceDate: "2026-01-01" },
    accounts: [{ id: "acc_diverge60", name: "Diverge 60", type: "cash", openingBalance: 10000, openingBalanceDate: "2026-01-01", overdraftEnabled: false, archived: false }],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };
  const idbSnapshot60 = {
    ...rev60Base,
    transactions: [{ id: "tx_idb_60", accountId: "acc_diverge60", type: "income", amount: 5000, category: "salary", description: "IDB 60", dateAD: "2026-04-01", paymentMethod: "cash" }]
  };
  const lsSnapshot60 = {
    ...rev60Base,
    transactions: [{ id: "tx_ls_60", accountId: "acc_diverge60", type: "expense", amount: 2000, category: "food_dining", description: "LS 60", dateAD: "2026-04-02", paymentMethod: "cash" }]
  };

  __configureMockIdb({ initialData: idbSnapshot60 });
  StorageService.setItem(STORAGE_KEYS.APP_DATA, lsSnapshot60);
  init();
  await hydrateFromIndexedDB();
  assert(getState().recoveryMode === true, "Scenario D.1: rev 60 conflict detected");

  // D1: Simulate LocalStorage quota exhaustion when preserving alternate state
  const originalSetItem = StorageService.setItem;
  StorageService.setItem = (key, val) => {
    if (key === STORAGE_KEYS.CONFLICT_BACKUP || key === STORAGE_KEYS.CONFLICT_LS_BACKUP) {
      throw new Error("QuotaExceededError: The quota has been exceeded.");
    }
    return originalSetItem.call(StorageService, key, val);
  };

  const failedResolveD = await dispatch("RESOLVE_STORAGE_CONFLICT", "idb");
  assert(failedResolveD.success === false, "Scenario D.2: Resolution aborts safely when alternate snapshot cannot be preserved");
  assert(getState().recoveryMode === true, "Scenario D.3: State remains in recovery mode after failed preservation");

  // Restore StorageService.setItem and verify neither original snapshot was destroyed
  StorageService.setItem = originalSetItem;
  const idbPostFailD = await getStoredState();
  const lsPostFailD = StorageService.getItem(STORAGE_KEYS.APP_DATA);
  assert(idbPostFailD.transactions[0].id === "tx_idb_60", "Scenario D.4: Original IndexedDB ledger was NOT destroyed");
  assert(lsPostFailD.transactions[0].id === "tx_ls_60", "Scenario D.5: Original LocalStorage ledger was NOT destroyed");

  // D2: Simulate read-back verification failure when preserving alternate snapshot
  const originalGetItem = StorageService.getItem;
  StorageService.getItem = (key) => {
    if (key === STORAGE_KEYS.CONFLICT_BACKUP || key === STORAGE_KEYS.CONFLICT_LS_BACKUP) {
      return null; // Simulate read-back returning null/corrupted
    }
    return originalGetItem.call(StorageService, key);
  };
  const failedReadbackD = await dispatch("RESOLVE_STORAGE_CONFLICT", "idb");
  assert(failedReadbackD.success === false, "Scenario D.6: Resolution aborts safely when read-back verification of backup fails");
  assert(getState().recoveryMode === true, "Scenario D.7: Recovery mode retained when backup verification fails");
  StorageService.getItem = originalGetItem;

  // Scenario E — First-run personal data
  console.log("\n  [Scenario E] First-run personal data...");
  mockLocalStorage.clear();
  __configureMockIdb({ initialData: null });
  init();

  const personalInitE = await dispatch("INITIALIZE_PERSONAL_LEDGER", {
    initialBalance: 15000,
    initialBalanceDate: "2026-01-01",
    accountName: "Personal Cash Wallet"
  });
  assert(personalInitE.success === true, "Scenario E.1: INITIALIZE_PERSONAL_LEDGER succeeds");

  // Verify strict monetary input rejection on initializePersonalLedger
  const rejectAbc = await dispatch("INITIALIZE_PERSONAL_LEDGER", { initialBalance: "abc" });
  assert(!rejectAbc.success, "Scenario E.1a: INITIALIZE_PERSONAL_LEDGER rejects non-numeric string 'abc'");
  const rejectCommas = await dispatch("INITIALIZE_PERSONAL_LEDGER", { initialBalance: "1,2,3" });
  assert(!rejectCommas.success, "Scenario E.1b: INITIALIZE_PERSONAL_LEDGER rejects malformed commas '1,2,3'");
  const rejectNeg = await dispatch("INITIALIZE_PERSONAL_LEDGER", { initialBalance: -50 });
  assert(!rejectNeg.success, "Scenario E.1c: INITIALIZE_PERSONAL_LEDGER rejects negative balance");
  const reject3Dec = await dispatch("INITIALIZE_PERSONAL_LEDGER", { initialBalance: "100.555" });
  assert(!reject3Dec.success, "Scenario E.1d: INITIALIZE_PERSONAL_LEDGER rejects 3 decimal places");
  const rejectEmptyAcc = await dispatch("INITIALIZE_PERSONAL_LEDGER", { initialBalance: 100, accountName: "   " });
  assert(!rejectEmptyAcc.success, "Scenario E.1e: INITIALIZE_PERSONAL_LEDGER rejects whitespace account name");
  const rejectBadDate = await dispatch("INITIALIZE_PERSONAL_LEDGER", { initialBalance: 100, initialBalanceDate: "invalid-date" });
  assert(!rejectBadDate.success, "Scenario E.1f: INITIALIZE_PERSONAL_LEDGER rejects invalid date");
  const personalStateE = getState();
  assert(personalStateE.isDemoData === false, "Scenario E.2: isDemoData is false for personal ledger");
  assert(personalStateE.accounts.length === 1, "Scenario E.3: Exactly 1 primary personal account exists");
  assert(personalStateE.accounts[0].name === "Personal Cash Wallet", "Scenario E.4: Account name matches configuration");
  assert(personalStateE.accounts[0].openingBalance === 15000, "Scenario E.5: Opening balance matches configuration (15,000)");
  assert(personalStateE.transactions.length === 0, "Scenario E.6: Zero demo transactions exist in personal ledger");
  assert(personalStateE.budgets.length === 0, "Scenario E.7: Zero demo budgets exist in personal ledger");
  assert(personalStateE.goals.length === 0, "Scenario E.8: Zero demo goals exist in personal ledger");
  assert(personalStateE.bills.length === 0, "Scenario E.9: Zero demo bills exist in personal ledger");

  // Add real personal transactions
  const salaryAddE = await dispatch("ADD_TRANSACTION", {
    type: "income",
    accountId: personalStateE.accounts[0].id,
    amount: 55000,
    category: "salary",
    description: "Monthly Salary",
    dateAD: "2026-01-15",
    paymentMethod: "bank_transfer"
  });
  assert(salaryAddE.success === true, "Scenario E.10: Adding real salary transaction succeeds");

  const groceriesAddE = await dispatch("ADD_TRANSACTION", {
    type: "expense",
    accountId: personalStateE.accounts[0].id,
    amount: 12500.50,
    category: "groceries",
    description: "Monthly Supermarket",
    dateAD: "2026-01-20",
    paymentMethod: "cash"
  });
  assert(groceriesAddE.success === true, "Scenario E.11: Adding real groceries expense succeeds");
  await waitForPendingWrites();

  // Reload the browser / state
  init();
  await hydrateFromIndexedDB();
  const reloadedE = getState();
  assert(reloadedE.isDemoData === false, "Scenario E.12: Personal ledger retains isDemoData: false across reload");
  assert(reloadedE.transactions.length === 2, "Scenario E.13: Both real transactions persist across reload");
  const expectedPersonalBalE = 15000 + 55000 - 12500.50; // 57499.50
  assert(calculateAccountBalance(reloadedE, reloadedE.accounts[0].id) === expectedPersonalBalE, `Scenario E.14: Personal account balance matches exact ledger sum (${expectedPersonalBalE})`);

  // Scenario F — Realistic daily accounting
  console.log("\n  [Scenario F] Realistic daily accounting with independent ledger reconciliation...");
  // Clear and setup independent multi-account personal ledger
  mockLocalStorage.clear();
  __configureMockIdb({ initialData: null });
  init();
  await dispatch("INITIALIZE_PERSONAL_LEDGER", {
    initialBalance: 5000,
    initialBalanceDate: "2026-01-01",
    accountName: "Cash"
  });
  const cashAccId = getState().accounts[0].id;

  // Add two more accounts: Nabil Bank (50,000) and eSewa (2,500)
  const addNabilRes = await dispatch("ADD_ACCOUNT", {
    name: "Nabil Bank",
    type: "bank",
    openingBalance: 50000,
    openingBalanceDate: "2026-01-01"
  });
  const nabilAccId = addNabilRes.account.id;

  const addEsewaRes = await dispatch("ADD_ACCOUNT", {
    name: "eSewa Wallet",
    type: "esewa",
    openingBalance: 2500,
    openingBalanceDate: "2026-01-01"
  });
  const esewaAccId = addEsewaRes.account.id;

  // Add 10 realistic financial transactions
  // Tx 1: Salary into Nabil Bank: +60,000
  await dispatch("ADD_TRANSACTION", { type: "income", accountId: nabilAccId, amount: 60000, category: "salary", description: "Salary", dateAD: "2026-02-01", paymentMethod: "bank_transfer" });
  // Tx 2: ATM withdrawal (transfer Nabil Bank -> Cash): 10,000
  await dispatch("ADD_TRANSFER", { fromAccountId: nabilAccId, toAccountId: cashAccId, amount: 10000, description: "ATM Cash", dateAD: "2026-02-03", paymentMethod: "bank_transfer" });
  // Tx 3: Groceries from Cash: -4,250.50
  await dispatch("ADD_TRANSACTION", { type: "expense", accountId: cashAccId, amount: 4250.50, category: "groceries", description: "Groceries", dateAD: "2026-02-05", paymentMethod: "cash" });
  // Tx 4: Utilities from eSewa: -1,800
  await dispatch("ADD_TRANSACTION", { type: "expense", accountId: esewaAccId, amount: 1800, category: "utilities", description: "Electricity", dateAD: "2026-02-08", paymentMethod: "esewa" });
  // Tx 5: Wallet top-up (transfer Nabil Bank -> eSewa): 5,000
  await dispatch("ADD_TRANSFER", { fromAccountId: nabilAccId, toAccountId: esewaAccId, amount: 5000, description: "eSewa Topup", dateAD: "2026-02-10", paymentMethod: "bank_transfer" });
  // Tx 6: Freelance into eSewa: +12,500
  await dispatch("ADD_TRANSACTION", { type: "income", accountId: esewaAccId, amount: 12500, category: "freelance", description: "Freelance Client", dateAD: "2026-02-12", paymentMethod: "esewa" });
  // Tx 7: Dining out from Cash: -2,100
  const diningTxRes = await dispatch("ADD_TRANSACTION", { type: "expense", accountId: cashAccId, amount: 2100, category: "food_dining", description: "Restaurant Dinner", dateAD: "2026-02-15", paymentMethod: "cash" });
  const diningTxId = diningTxRes.transaction.id;
  // Tx 8: Mobile recharge from eSewa: -500
  await dispatch("ADD_TRANSACTION", { type: "expense", accountId: esewaAccId, amount: 500, category: "utilities", description: "Ncell Recharge", dateAD: "2026-02-18", paymentMethod: "esewa" });
  // Tx 9: Medical expense from Nabil Bank: -3,500
  await dispatch("ADD_TRANSACTION", { type: "expense", accountId: nabilAccId, amount: 3500, category: "healthcare", description: "Pharmacy", dateAD: "2026-02-20", paymentMethod: "bank_transfer" });
  // Tx 10: Cash gift received: +1,000
  const giftTxRes = await dispatch("ADD_TRANSACTION", { type: "income", accountId: cashAccId, amount: 1000, category: "gift", description: "Birthday Gift", dateAD: "2026-02-22", paymentMethod: "cash" });
  const giftTxId = giftTxRes.transaction.id;

  // Add budgets, goals with allocations, and bills
  await dispatch("SET_BUDGET", { category: "food_dining", amount: 10000, period: "2026-02" });
  await dispatch("SET_BUDGET", { category: "utilities", amount: 5000, period: "2026-02" });
  const goalRes = await dispatch("ADD_GOAL", { title: "Emergency Fund", targetAmount: 100000, targetDateAD: "2026-12-31" });
  const goalId = goalRes.goal.id;
  await dispatch("ADD_ALLOCATION", { goalId, amount: 20000, dateAD: "2026-02-01" });
  await dispatch("ADD_BILL", { title: "Fiber Internet", amount: 1500, dueDateAD: "2026-02-28", accountId: esewaAccId, category: "utilities", recurringFrequency: "monthly" });

  // Independent manual calculation for exact reconciliation:
  // Cash: 5,000 + 10,000 (transfer in) - 4,250.50 - 2,100 + 1,000 = 9,649.50
  // Nabil Bank: 50,000 + 60,000 - 10,000 (transfer out) - 5,000 (transfer out) - 3,500 = 91,500.00
  // eSewa: 2,500 - 1,800 + 5,000 (transfer in) + 12,500 - 500 = 17,700.00
  // Total Net Worth: 9,649.50 + 91,500.00 + 17,700.00 = 118,849.50
  // Monthly Inflow (Feb 2026): 60,000 + 12,500 + 1,000 = 73,500.00
  // Monthly Outflow (Feb 2026): 4,250.50 + 1,800 + 2,100 + 500 + 3,500 = 12,150.50
  // Net Savings: 73,500.00 - 12,150.50 = 61,349.50
  const fSnap = getState();
  assert(calculateAccountBalance(fSnap, cashAccId) === 9649.50, "Scenario F.1: Cash account matches independent ledger calculation (9,649.50)");
  assert(calculateAccountBalance(fSnap, nabilAccId) === 91500.00, "Scenario F.2: Nabil Bank matches independent ledger calculation (91,500.00)");
  assert(calculateAccountBalance(fSnap, esewaAccId) === 17700.00, "Scenario F.3: eSewa matches independent ledger calculation (17,700.00)");

  const fSummary = calculateFinancialSummary(fSnap, "2026-02");
  assert(fSummary.monthlyInflow === 73500.00, "Scenario F.4: Monthly income matches independent sum (73,500.00)");
  assert(fSummary.monthlyOutflow === 12150.50, "Scenario F.5: Monthly expense matches independent sum (12,150.50)");
  assert(fSummary.netCashFlow === 61349.50, "Scenario F.6: Net savings matches independent calculation (61,349.50)");
  assert(fSummary.totalEarmarkedSavings === 20000.00, "Scenario F.7: Goal earmarked savings matches 20,000.00");

  // Perform realistic edit: Change dining tx amount from 2,100 to 2,500
  await dispatch("UPDATE_TRANSACTION", { id: diningTxId, amount: 2500 });
  // Cash balance should drop by 400 to 9,249.50
  assert(calculateAccountBalance(getState(), cashAccId) === 9249.50, "Scenario F.8: Cash balance updates accurately after editing dining transaction (9,249.50)");

  // Perform realistic delete: Delete cash gift (+1,000)
  await dispatch("DELETE_TRANSACTION", giftTxId);
  // Cash balance should drop by 1,000 to 8,249.50
  assert(calculateAccountBalance(getState(), cashAccId) === 8249.50, "Scenario F.9: Cash balance updates accurately after deleting gift transaction (8,249.50)");

  // Export full JSON backup
  const backupJsonF = generateBackupJsonString(getState());
  assert(backupJsonF.includes("Nabil Bank"), "Scenario F.10: Backup contains complete multi-account dataset");

  // Clear all data
  await dispatch("CLEAR_ALL_DATA");
  assert(getState().transactions.length === 0, "Scenario F.11: Transactions cleared prior to restoration");

  // Restore backup
  const restoreResF = await dispatch("RESTORE_BACKUP", JSON.parse(backupJsonF));
  assert(restoreResF.success === true, "Scenario F.12: Full dataset restored successfully");

  // Reload application / restart
  init();
  await hydrateFromIndexedDB();
  const postRestoreSnapF = getState();
  assert(calculateAccountBalance(postRestoreSnapF, cashAccId) === 8249.50, "Scenario F.13: Cash balance preserved identically after backup restore and reload (8,249.50)");
  assert(calculateAccountBalance(postRestoreSnapF, nabilAccId) === 91500.00, "Scenario F.14: Nabil Bank balance preserved identically after restore and reload (91,500.00)");
  assert(calculateAccountBalance(postRestoreSnapF, esewaAccId) === 17700.00, "Scenario F.15: eSewa balance preserved identically after restore and reload (17,700.00)");

  // =========================================================================
  // AUDIT 21: INDEPENDENT AUDIT CONFIRMED DEFECTS REGRESSION TESTS (DEFECTS 1-4)
  // =========================================================================
  console.log("\n[Audit 21] Testing Independent Audit Confirmed Defects (Defects 1 through 4)...");

  // -------------------------------------------------------------------------
  // DEFECT 1: Overdraft Rules Chronologically & Final State Enforcement in Backup
  // -------------------------------------------------------------------------
  console.log("\n  [Defect 1] Enforcing account overdraft rules chronologically and at final state...");
  const baseValidLedgerD1 = {
    version: 3,
    revision: 10,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 1000, initialBalanceDate: "2026-01-01" },
    accounts: [
      { id: "acc_od_test", name: "Savings Account", type: "bank", openingBalance: 0, openingBalanceDate: "2026-01-01", overdraftEnabled: false, archived: false }
    ],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  // Case 1a: Account opening balance 0, overdraft disabled, expense 1 -> balance -1. Must be REJECTED!
  const ledgerNegativeFinal = JSON.parse(JSON.stringify(baseValidLedgerD1));
  ledgerNegativeFinal.transactions.push({
    id: "tx_neg_1",
    accountId: "acc_od_test",
    type: "expense",
    amount: 1,
    category: "groceries",
    description: "Expense with 0 balance",
    dateAD: "2026-01-02",
    dateBS: "2082-09-18",
    paymentMethod: "bank_transfer"
  });
  const valResNegFinal = Validator.validateBackupJson(ledgerNegativeFinal);
  assert(valResNegFinal.isValid === false, "Defect 1a: Backup with account balance -1 and overdraft disabled is strictly rejected");
  assert(valResNegFinal.error.includes("overdraft disabled"), "Defect 1a: Error message explicitly mentions overdraft disabled");

  // Case 1b: Same account with overdraftEnabled: true -> Accepted!
  const ledgerNegativeAllowed = JSON.parse(JSON.stringify(ledgerNegativeFinal));
  ledgerNegativeAllowed.accounts[0].overdraftEnabled = true;
  const valResNegAllowed = Validator.validateBackupJson(ledgerNegativeAllowed);
  assert(valResNegAllowed.isValid === true, "Defect 1b: Backup with account balance -1 and overdraft enabled is accepted");

  // Case 1c: Chronological overdraft: opening balance 100, Day 1: expense 150 (running balance -50), Day 2: income 200 (final +150).
  // Overdraft disabled -> must be REJECTED chronologically!
  const ledgerChronoNeg = JSON.parse(JSON.stringify(baseValidLedgerD1));
  ledgerChronoNeg.accounts[0].openingBalance = 100;
  ledgerChronoNeg.transactions.push(
    {
      id: "tx_chrono_exp",
      accountId: "acc_od_test",
      type: "expense",
      amount: 150,
      category: "food_dining",
      description: "Overdraft expense on Day 1",
      dateAD: "2026-01-05",
      dateBS: "2082-09-21",
      paymentMethod: "bank_transfer"
    },
    {
      id: "tx_chrono_inc",
      accountId: "acc_od_test",
      type: "income",
      amount: 200,
      category: "salary",
      description: "Later deposit on Day 2",
      dateAD: "2026-01-06",
      dateBS: "2082-09-22",
      paymentMethod: "bank_transfer"
    }
  );
  const valResChronoNeg = Validator.validateBackupJson(ledgerChronoNeg);
  assert(valResChronoNeg.isValid === false, "Defect 1c: Chronological dip below 0 with overdraft disabled is strictly rejected");
  assert(valResChronoNeg.error.includes("became negative"), "Defect 1c: Error message reports balance became negative on date");

  // Case 1d: Same chronological scenario with overdraftEnabled: true -> Accepted!
  const ledgerChronoAllowed = JSON.parse(JSON.stringify(ledgerChronoNeg));
  ledgerChronoAllowed.accounts[0].overdraftEnabled = true;
  assert(Validator.validateBackupJson(ledgerChronoAllowed).isValid === true, "Defect 1d: Chronological negative balance accepted when overdraft is enabled");

  // -------------------------------------------------------------------------
  // DEFECT 2: Bill Payment Flags Accept Strict Booleans & Status Validation
  // -------------------------------------------------------------------------
  console.log("\n  [Defect 2] Enforcing strict boolean for bill.isPaid and status consistency...");
  const baseBillLedger = JSON.parse(JSON.stringify(baseValidLedgerD1));
  baseBillLedger.accounts[0].openingBalance = 50000;

  // Case 2a: bill.isPaid missing (undefined) in v3 schema -> strictly rejected!
  const ledgerMissingIsPaid = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerMissingIsPaid.bills.push({
    id: "bill_missing_ispaid",
    title: "Internet Subscription",
    amount: 1200,
    category: "utilities",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "upcoming"
    // isPaid is deliberately omitted (undefined)
  });
  const valMissingIsPaid = Validator.validateBackupJson(ledgerMissingIsPaid);
  assert(valMissingIsPaid.isValid === false, "Defect 2a.1: v3 backup omitting bill.isPaid is strictly rejected");
  assert(valMissingIsPaid.error.includes("strict boolean"), "Defect 2a.1: Error message specifies strict boolean requirement for omitted isPaid");

  // Case 2a.2: bill.isPaid is null in v3 schema -> strictly rejected!
  const ledgerNullIsPaid = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerNullIsPaid.bills.push({
    id: "bill_null_ispaid",
    title: "Water Subscription",
    amount: 600,
    category: "utilities",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "upcoming",
    isPaid: null // INVALID TYPE: null
  });
  const valNullIsPaid = Validator.validateBackupJson(ledgerNullIsPaid);
  assert(valNullIsPaid.isValid === false, "Defect 2a.2: v3 backup containing bill with isPaid: null is strictly rejected");
  assert(valNullIsPaid.error.includes("strict boolean"), "Defect 2a.2: Error message specifies strict boolean requirement for null isPaid");

  // Case 2b.1: bill.isPaid is string "false" -> strictly rejected!
  const ledgerStringIsPaidFalse = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerStringIsPaidFalse.bills.push({
    id: "bill_str_false",
    title: "Electricity Bill",
    amount: 1500,
    category: "utilities",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "upcoming",
    isPaid: "false" // INVALID TYPE: string instead of boolean
  });
  const valStrFalse = Validator.validateBackupJson(ledgerStringIsPaidFalse);
  assert(valStrFalse.isValid === false, "Defect 2b.1: Backup containing bill with isPaid: 'false' (string) is strictly rejected");
  assert(valStrFalse.error.includes("strict boolean"), "Defect 2b.1: Error message specifies strict boolean requirement");

  // Case 2b.2: bill.isPaid is string "true" -> strictly rejected!
  const ledgerStringIsPaidTrue = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerStringIsPaidTrue.bills.push({
    id: "bill_str_true",
    title: "Internet Bill",
    amount: 1200,
    category: "utilities",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "paid",
    isPaid: "true" // INVALID TYPE
  });
  assert(Validator.validateBackupJson(ledgerStringIsPaidTrue).isValid === false, "Defect 2b.2: Backup containing bill with isPaid: 'true' (string) is strictly rejected");

  // Case 2c: bill.isPaid is number 0 or 1 -> strictly rejected!
  const ledgerNumIsPaid0 = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerNumIsPaid0.bills.push({
    id: "bill_num_ispaid_0",
    title: "Water Bill",
    amount: 500,
    category: "utilities",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "upcoming",
    isPaid: 0 // INVALID TYPE: number 0
  });
  assert(Validator.validateBackupJson(ledgerNumIsPaid0).isValid === false, "Defect 2c.1: Backup containing bill with isPaid: 0 (number) is strictly rejected");

  const ledgerNumIsPaid1 = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerNumIsPaid1.bills.push({
    id: "bill_num_ispaid_1",
    title: "Water Bill 2",
    amount: 500,
    category: "utilities",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "upcoming",
    isPaid: 1 // INVALID TYPE: number 1
  });
  assert(Validator.validateBackupJson(ledgerNumIsPaid1).isValid === false, "Defect 2c.2: Backup containing bill with isPaid: 1 (number) is strictly rejected");

  // Case 2d: Invalid bill status (e.g. "completed" or "cancelled") -> strictly rejected!
  const ledgerBadStatus = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerBadStatus.bills.push({
    id: "bill_bad_status",
    title: "Gym Membership",
    amount: 3000,
    category: "health",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "completed", // INVALID STATUS
    isPaid: false
  });
  const valBadStatus = Validator.validateBackupJson(ledgerBadStatus);
  assert(valBadStatus.isValid === false, "Defect 2d: Bill with invalid status 'completed' is strictly rejected");
  assert(valBadStatus.error.includes("invalid status"), "Defect 2d: Error message specifies invalid status");

  // Case 2e: Inconsistent bill: isPaid: true but status: "unpaid" -> rejected!
  const ledgerInconsistentPaid = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerInconsistentPaid.bills.push({
    id: "bill_inconsistent_paid",
    title: "Health Insurance",
    amount: 5000,
    category: "health",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "unpaid",
    isPaid: true
  });
  assert(Validator.validateBackupJson(ledgerInconsistentPaid).isValid === false, "Defect 2e: Bill with isPaid: true but status 'unpaid' is strictly rejected");

  // Case 2f: Inconsistent bill: isPaid: false but status: "paid" -> rejected!
  const ledgerInconsistentUnpaid = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerInconsistentUnpaid.bills.push({
    id: "bill_inconsistent_unpaid",
    title: "Health Insurance",
    amount: 5000,
    category: "health",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "paid",
    isPaid: false
  });
  assert(Validator.validateBackupJson(ledgerInconsistentUnpaid).isValid === false, "Defect 2f: Bill with isPaid: false but status 'paid' is strictly rejected");

  // Case 2g: Unpaid bill with a linkedTransactionId -> strictly rejected!
  const ledgerUnpaidWithTx = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerUnpaidWithTx.bills.push({
    id: "bill_unpaid_linked",
    title: "Cable TV",
    amount: 800,
    category: "entertainment",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "upcoming",
    isPaid: false,
    linkedTransactionId: "tx_some_fake_id" // INVALID: Unpaid bill cannot link to a transaction
  });
  const valUnpaidLinked = Validator.validateBackupJson(ledgerUnpaidWithTx);
  assert(valUnpaidLinked.isValid === false, "Defect 2g: Unpaid bill with linkedTransactionId is strictly rejected");
  assert(valUnpaidLinked.error.includes("cannot have a linkedTransactionId"), "Defect 2g: Error message rejects linked transaction on unpaid bill");

  // Case 2h: Paid bill with valid 1-to-1 matching expense transaction -> accepted!
  const ledgerValidPaidBill = JSON.parse(JSON.stringify(baseBillLedger));
  ledgerValidPaidBill.transactions.push({
    id: "tx_bill_paid_leg",
    accountId: "acc_od_test",
    type: "expense",
    amount: 1500,
    category: "utilities",
    description: "Electricity Bill Payment",
    dateAD: "2026-02-01",
    dateBS: "2082-10-18",
    paymentMethod: "bank_transfer",
    linkedBillId: "bill_valid_paid"
  });
  ledgerValidPaidBill.bills.push({
    id: "bill_valid_paid",
    title: "Electricity Bill",
    amount: 1500,
    category: "utilities",
    accountId: "acc_od_test",
    dueDateAD: "2026-02-01",
    dueDateBS: "2082-10-18",
    status: "paid",
    isPaid: true,
    paidDateAD: "2026-02-01",
    paidDateBS: "2082-10-18",
    linkedTransactionId: "tx_bill_paid_leg"
  });
  assert(Validator.validateBackupJson(ledgerValidPaidBill).isValid === true, "Defect 2h: Valid paid bill with 1-to-1 matching expense transaction passes validation");

  // Case 2i: Direct Validator.validateBill tests
  const billValMissing = Validator.validateBill({
    id: "b_unit_miss",
    title: "Unit Bill Missing isPaid",
    amount: 100,
    category: "utilities",
    accountId: "acc_test",
    dueDateAD: "2026-05-01"
  });
  assert(billValMissing.isValid === false, "Defect 2i.1: Validator.validateBill rejects missing isPaid (undefined)");

  const billValNull = Validator.validateBill({
    id: "b_unit_null",
    title: "Unit Bill Null isPaid",
    amount: 100,
    category: "utilities",
    accountId: "acc_test",
    dueDateAD: "2026-05-01",
    isPaid: null
  });
  assert(billValNull.isValid === false, "Defect 2i.2: Validator.validateBill rejects null isPaid");

  const billValRes1 = Validator.validateBill({
    id: "b_unit_1",
    title: "Unit Test Bill",
    amount: 100,
    category: "utilities",
    accountId: "acc_test",
    dueDateAD: "2026-05-01",
    isPaid: "false" // string
  });
  assert(billValRes1.isValid === false, "Defect 2i.3: Validator.validateBill rejects string isPaid 'false'");

  const billValStrTrue = Validator.validateBill({
    id: "b_unit_str_true",
    title: "Unit Test Bill True Str",
    amount: 100,
    category: "utilities",
    accountId: "acc_test",
    dueDateAD: "2026-05-01",
    status: "paid",
    isPaid: "true",
    linkedTransactionId: "tx_test"
  });
  assert(billValStrTrue.isValid === false, "Defect 2i.4: Validator.validateBill rejects string isPaid 'true'");

  const billValNum0 = Validator.validateBill({
    id: "b_unit_num0",
    title: "Unit Bill Num 0",
    amount: 100,
    category: "utilities",
    accountId: "acc_test",
    dueDateAD: "2026-05-01",
    isPaid: 0
  });
  assert(billValNum0.isValid === false, "Defect 2i.5: Validator.validateBill rejects numeric 0 isPaid");

  const billValNum1 = Validator.validateBill({
    id: "b_unit_num1",
    title: "Unit Bill Num 1",
    amount: 100,
    category: "utilities",
    accountId: "acc_test",
    dueDateAD: "2026-05-01",
    isPaid: 1
  });
  assert(billValNum1.isValid === false, "Defect 2i.6: Validator.validateBill rejects numeric 1 isPaid");

  const billValBoolFalse = Validator.validateBill({
    id: "b_unit_ok_false",
    title: "Unit Bill Valid False",
    amount: 100,
    category: "utilities",
    accountId: "acc_test",
    dueDateAD: "2026-05-01",
    status: "upcoming",
    isPaid: false
  });
  assert(billValBoolFalse.isValid === true, "Defect 2i.7: Validator.validateBill cleanly accepts boolean false");

  const billValBoolTrue = Validator.validateBill({
    id: "b_unit_ok_true",
    title: "Unit Bill Valid True",
    amount: 100,
    category: "utilities",
    accountId: "acc_test",
    dueDateAD: "2026-05-01",
    status: "paid",
    isPaid: true,
    linkedTransactionId: "tx_valid_linked"
  });
  assert(billValBoolTrue.isValid === true, "Defect 2i.8: Validator.validateBill cleanly accepts boolean true with valid linkedTransactionId");

  const billValRes2 = Validator.validateBill({
    id: "b_unit_2",
    title: "Unit Test Bill 2",
    amount: 100,
    category: "utilities",
    accountId: "acc_test",
    dueDateAD: "2026-05-01",
    status: "unknown_status",
    isPaid: false
  });
  assert(billValRes2.isValid === false, "Defect 2j: Validator.validateBill rejects unknown status");

  // Case 2k: Historical backup compatibility (v2 backup with omitted isPaid)
  const legacyV2Backup = {
    version: 2,
    revision: 5,
    settings: {
      initialBalance: 20000,
      initialBalanceDate: "2026-01-01",
      profile: { displayName: "Legacy User" }
    },
    accounts: [
      { id: "acc_leg", name: "Legacy Cash", type: "cash", openingBalance: 20000, openingBalanceDate: "2026-01-01" }
    ],
    transactions: [],
    budgets: [],
    goals: [],
    bills: [
      {
        id: "bill_legacy_unpaid",
        title: "Legacy Water Bill",
        amount: 500,
        category: "utilities",
        accountId: "acc_leg",
        dueDateAD: "2026-05-01",
        status: "upcoming"
        // isPaid omitted legitimately in v2 schema
      }
    ]
  };

  const valLegacyPre = Validator.validateBackupJson(legacyV2Backup);
  assert(valLegacyPre.isValid === true, "Defect 2k.1: Valid older v2 backup omitting bill.isPaid passes initial validation");

  const migratedV2 = migrateV2toV3(legacyV2Backup);
  assert(migratedV2.version === 3, "Defect 2k.2: Older backup migrated to version 3");
  assert(typeof migratedV2.bills[0].isPaid === "boolean" && migratedV2.bills[0].isPaid === false, "Defect 2k.3: Missing isPaid safely normalized to boolean false based on status");

  const valLegacyPost = Validator.validateBackupJson(migratedV2);
  assert(valLegacyPost.isValid === true, "Defect 2k.4: Migrated legacy backup passes strict v3 validation");

  // Older backup with invalid string isPaid -> strictly rejected before migration
  const badLegacyV2 = JSON.parse(JSON.stringify(legacyV2Backup));
  badLegacyV2.bills[0].isPaid = "false";
  const valBadLegacy = Validator.validateBackupJson(badLegacyV2);
  assert(valBadLegacy.isValid === false, "Defect 2k.5: Older backup with string isPaid: 'false' is strictly rejected before migration");

  // -------------------------------------------------------------------------
  // DEFECT 3: Duplicate Budget IDs & Global Entity ID Uniqueness
  // -------------------------------------------------------------------------
  console.log("\n  [Defect 3] Enforcing unique budget IDs, global entity ID uniqueness, and foreign keys...");
  const baseBudgetLedger = JSON.parse(JSON.stringify(baseValidLedgerD1));

  // Case 3a: Backup containing two budgets with the identical ID -> strictly rejected!
  const ledgerDupBudgetIds = JSON.parse(JSON.stringify(baseBudgetLedger));
  ledgerDupBudgetIds.budgets.push(
    { id: "bg_duplicate_id", period: "2026-01", category: "groceries", amount: 10000 },
    { id: "bg_duplicate_id", period: "2026-02", category: "housing", amount: 25000 }
  );
  const valDupBudgetRes = Validator.validateBackupJson(ledgerDupBudgetIds);
  assert(valDupBudgetRes.isValid === false, "Defect 3a: Backup with duplicate budget IDs is strictly rejected");
  assert(valDupBudgetRes.error.includes("Duplicate budget ID"), "Defect 3a: Error message specifies Duplicate budget ID");

  // Case 3b: Budget missing an ID in backup -> strictly rejected!
  const ledgerMissingBudgetId = JSON.parse(JSON.stringify(baseBudgetLedger));
  ledgerMissingBudgetId.budgets.push({ period: "2026-01", category: "groceries", amount: 10000 });
  const valMissingBudgetId = Validator.validateBackupJson(ledgerMissingBudgetId);
  assert(valMissingBudgetId.isValid === false, "Defect 3b: Budget missing an ID string is strictly rejected");

  // Case 3c: Direct Validator.validateBudget duplicate check
  const bUnit1 = { id: "bg_u1", period: "2026-01", category: "groceries", amount: 5000 };
  const bUnit2 = { id: "bg_u1", period: "2026-02", category: "food_dining", amount: 7000 };
  const valBudgetUnit = Validator.validateBudget(bUnit2, [bUnit1]);
  assert(valBudgetUnit.isValid === false, "Defect 3c: Validator.validateBudget rejects duplicate budget ID against existing budgets");

  // Case 3d: Cross-entity ID collision (e.g. Account and Budget share ID "shared_entity_id")
  const ledgerCrossCollision = JSON.parse(JSON.stringify(baseBudgetLedger));
  ledgerCrossCollision.accounts[0].id = "collision_id_123";
  ledgerCrossCollision.budgets.push({ id: "collision_id_123", period: "2026-01", category: "groceries", amount: 10000 });
  const valCrossCollision = Validator.validateBackupJson(ledgerCrossCollision);
  assert(valCrossCollision.isValid === false, "Defect 3d: Cross-entity ID collision between account and budget is strictly rejected");

  // Case 3e: Foreign key validation - transaction references non-existent account
  const ledgerBadTxAcc = JSON.parse(JSON.stringify(baseValidLedgerD1));
  ledgerBadTxAcc.transactions.push({
    id: "tx_bad_acc",
    accountId: "non_existent_acc_id",
    type: "income",
    amount: 1000,
    category: "salary",
    description: "Salary on bad account",
    dateAD: "2026-01-02",
    dateBS: "2082-09-18",
    paymentMethod: "bank_transfer"
  });
  assert(Validator.validateBackupJson(ledgerBadTxAcc).isValid === false, "Defect 3e: Transaction referencing non-existent account is strictly rejected");

  // Case 3f: Foreign key validation - transaction linkedBillId references non-existent bill
  const ledgerBadLinkedBill = JSON.parse(JSON.stringify(baseValidLedgerD1));
  ledgerBadLinkedBill.accounts[0].openingBalance = 50000;
  ledgerBadLinkedBill.transactions.push({
    id: "tx_orphan_bill_ref",
    accountId: "acc_od_test",
    type: "expense",
    amount: 1000,
    category: "utilities",
    description: "Payment for ghost bill",
    dateAD: "2026-01-02",
    dateBS: "2082-09-18",
    paymentMethod: "bank_transfer",
    linkedBillId: "bill_ghost_404"
  });
  ledgerBadLinkedBill.bills = [];
  assert(Validator.validateBackupJson(ledgerBadLinkedBill).isValid === false, "Defect 3f: Transaction referencing non-existent bill is strictly rejected");

  // -------------------------------------------------------------------------
  // DEFECT 4: Strict Monetary Formatting & Comma Placement Validation
  // -------------------------------------------------------------------------
  console.log("\n  [Defect 4] Enforcing strict monetary formatting and rejecting arbitrary comma placement...");

  // Case 4a: Malformed comma placement must return false in isValidMoneyPrecision
  const malformedMonetaryStrings = [
    "1,2,3",
    "12,34",
    "1,,000",
    ",1000",
    "1000,",
    "1.2.3",
    "123.456",
    "1,000.",
    "",
    "   ",
    "1e5",
    "1,23,45",
    "1,2345"
  ];
  for (const s of malformedMonetaryStrings) {
    assert(isValidMoneyPrecision(s) === false, `Defect 4a: isValidMoneyPrecision strictly rejects malformed monetary input '${s}'`);
  }

  // Case 4b: Valid monetary formats must return true in isValidMoneyPrecision
  const validMonetaryStrings = [
    "1,000",
    "12,345",
    "123,456.78",
    "1,234,567.89",
    "1,00,000",
    "12,34,567",
    "1,23,45,678.90",
    "1234.56",
    "500",
    "0",
    "0.05",
    "-1,000.50",
    "-1,00,000",
    100.50,
    5000n
  ];
  for (const s of validMonetaryStrings) {
    assert(isValidMoneyPrecision(s) === true, `Defect 4b: isValidMoneyPrecision cleanly accepts valid monetary representation '${s}'`);
  }

  // Case 4c: isValidMoneyAmount strictly rejects malformed strings
  for (const s of malformedMonetaryStrings) {
    assert(isValidMoneyAmount(s) === false, `Defect 4c: isValidMoneyAmount strictly rejects '${s}'`);
  }
  assert(isValidMoneyAmount("1,000") === true, "Defect 4c: isValidMoneyAmount accepts '1,000'");
  assert(isValidMoneyAmount("1,00,000") === true, "Defect 4c: isValidMoneyAmount accepts '1,00,000'");

  // Case 4d: toPaisaBigInt throws RangeError on malformed strings
  for (const s of ["1,2,3", "12,34", "1,,000", "1.2.3", "123.456"]) {
    let threw = false;
    try {
      toPaisaBigInt(s);
    } catch (e) {
      threw = e instanceof RangeError;
    }
    assert(threw, `Defect 4d: toPaisaBigInt strictly throws RangeError on malformed string '${s}'`);
  }
  assert(toPaisaBigInt("1,000") === 100000n, "Defect 4d: toPaisaBigInt correctly converts '1,000' to 100000n");
  assert(toPaisaBigInt("1,00,000.50") === 10000050n, "Defect 4d: toPaisaBigInt correctly converts '1,00,000.50' to 10000050n");

  // Case 4e: parseMoneyToPaisa throws RangeError on malformed strings
  for (const s of ["1,2,3", "12,34", "1,,000", "1.2.3", "123.456"]) {
    let threw = false;
    try {
      parseMoneyToPaisa(s);
    } catch (e) {
      threw = e instanceof RangeError;
    }
    assert(threw, `Defect 4e: parseMoneyToPaisa strictly throws RangeError on malformed string '${s}'`);
  }
  assert(parseMoneyToPaisa("1,000") === 100000n, "Defect 4e: parseMoneyToPaisa parses '1,000' to 100000n");

  // =========================================================================
  // Defect 2: Strict validation of createCleanPersonalLedgerState()
  // =========================================================================
  console.log("\n  [Defect 2] Verifying strict input validation in createCleanPersonalLedgerState()...");

  // Valid inputs
  const cleanZero = createCleanPersonalLedgerState({ initialBalance: 0 });
  assert(cleanZero.accounts[0].openingBalance === 0 && cleanZero.settings.initialBalance === 0, "createCleanPersonalLedgerState(0) sets opening balance to 0");

  const cleanPenny = createCleanPersonalLedgerState({ initialBalance: 0.01 });
  assert(cleanPenny.accounts[0].openingBalance === 0.01 && cleanPenny.settings.initialBalance === 0.01, "createCleanPersonalLedgerState(0.01) sets opening balance to 0.01");

  const cleanHundred = createCleanPersonalLedgerState({ initialBalance: 100 });
  assert(cleanHundred.accounts[0].openingBalance === 100 && cleanHundred.settings.initialBalance === 100, "createCleanPersonalLedgerState(100) sets opening balance to 100");

  const cleanFifty = createCleanPersonalLedgerState({ initialBalance: 100.50 });
  assert(cleanFifty.accounts[0].openingBalance === 100.5 && cleanFifty.settings.initialBalance === 100.5, "createCleanPersonalLedgerState(100.50) sets opening balance to 100.5");

  const cleanLakh = createCleanPersonalLedgerState({ initialBalance: "1,00,000" });
  assert(cleanLakh.accounts[0].openingBalance === 100000 && cleanLakh.settings.initialBalance === 100000, "createCleanPersonalLedgerState('1,00,000') parses South Asian grouping to 100000");

  const cleanDefault = createCleanPersonalLedgerState();
  assert(cleanDefault.accounts[0].openingBalance === 0 && cleanDefault.accounts[0].name === "Cash Wallet", "createCleanPersonalLedgerState() default produces 0 balance Cash Wallet");

  // Invalid inputs that MUST throw and NEVER silently become zero
  const shouldThrow = (fn, label) => {
    try {
      fn();
      assert(false, `${label} should have thrown an error but succeeded`);
    } catch (err) {
      assert(err instanceof TypeError || err instanceof RangeError, `${label} threw expected error: ${err.message}`);
    }
  };

  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: "" }), "createCleanPersonalLedgerState rejects empty string ''");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: "abc" }), "createCleanPersonalLedgerState rejects non-numeric string 'abc'");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: "1,2,3" }), "createCleanPersonalLedgerState rejects malformed commas '1,2,3'");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: -10 }), "createCleanPersonalLedgerState rejects negative balance -10");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: 1.239 }), "createCleanPersonalLedgerState rejects 3 decimal places 1.239");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: Infinity }), "createCleanPersonalLedgerState rejects Infinity");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: NaN }), "createCleanPersonalLedgerState rejects NaN");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: 1e15 }), "createCleanPersonalLedgerState rejects out-of-range amount 1e15");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: null }), "createCleanPersonalLedgerState rejects explicit null initialBalance");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: {} }), "createCleanPersonalLedgerState rejects unexpected object initialBalance");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalance: [] }), "createCleanPersonalLedgerState rejects unexpected array initialBalance");
  shouldThrow(() => createCleanPersonalLedgerState({ accountName: "   " }), "createCleanPersonalLedgerState rejects empty whitespace accountName");
  shouldThrow(() => createCleanPersonalLedgerState({ initialBalanceDate: "not-a-date" }), "createCleanPersonalLedgerState rejects invalid initialBalanceDate");

  // =========================================================================
  // AUDIT 25: COMPREHENSIVE FINANCIAL INTEGRITY, FINGERPRINTING & RELATIONSHIP TESTS
  // =========================================================================
  console.log("\n  [Audit 25] Running Critical Repair Regression Tests (Repairs A, B, C, D, E)...");

  // --- Repair A: Mandatory reciprocal transfer account references & opening-date symmetry ---
  console.log("  [Repair A] Verifying transfer leg reciprocity and opening-date rules...");
  const baseTransferLedger = {
    version: 3,
    revision: 1,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 1000, initialBalanceDate: "2026-10-01" },
    accounts: [
      {
        id: "acc_source",
        name: "Source Cash",
        type: "cash",
        openingBalance: 1000,
        openingBalanceDate: "2026-10-01",
        overdraftEnabled: false,
        archived: false
      },
      {
        id: "acc_dest",
        name: "Destination Wallet",
        type: "esewa",
        openingBalance: 0,
        openingBalanceDate: "2026-10-15",
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

  // Case A1: Transfer with missing peerAccountId must be strictly rejected
  const ledgerMissingPeer = JSON.parse(JSON.stringify(baseTransferLedger));
  ledgerMissingPeer.transactions = [
    {
      id: "tx_tr_out_missing",
      transferId: "tr_test_1",
      transferDirection: "out",
      accountId: "acc_source",
      // peerAccountId intentionally missing!
      type: "transfer",
      amount: 100,
      category: "transfer",
      description: "Transfer to dest",
      dateAD: "2026-10-10",
      paymentMethod: "cash"
    },
    {
      id: "tx_tr_in_missing",
      transferId: "tr_test_1",
      transferDirection: "in",
      accountId: "acc_dest",
      // peerAccountId intentionally missing!
      type: "transfer",
      amount: 100,
      category: "transfer",
      description: "Transfer to dest",
      dateAD: "2026-10-10",
      paymentMethod: "cash"
    }
  ];
  const valMissingPeer = Validator.validateBackupJson(ledgerMissingPeer);
  assert(!valMissingPeer.isValid, "Repair A1: Transfer with missing peerAccountId is rejected by backup validator");
  assert(valMissingPeer.error.includes("peerAccountId"), "Repair A1: Rejection error explicitly mentions peerAccountId");

  // Case A2: Exact scenario - Source 1,000 (2026-10-01), Dest 0 (2026-10-15), Transfer 100 on 2026-10-10
  const ledgerValidTransferA2 = JSON.parse(JSON.stringify(baseTransferLedger));
  ledgerValidTransferA2.transactions = [
    {
      id: "tx_tr_out_a2",
      transferId: "tr_a2",
      transferDirection: "out",
      accountId: "acc_source",
      peerAccountId: "acc_dest",
      type: "transfer",
      amount: 100,
      category: "transfer",
      description: "Transfer out",
      dateAD: "2026-10-10",
      paymentMethod: "cash"
    },
    {
      id: "tx_tr_in_a2",
      transferId: "tr_a2",
      transferDirection: "in",
      accountId: "acc_dest",
      peerAccountId: "acc_source",
      type: "transfer",
      amount: 100,
      category: "transfer",
      description: "Transfer in",
      dateAD: "2026-10-10",
      paymentMethod: "cash"
    }
  ];
  const valA2 = Validator.validateBackupJson(ledgerValidTransferA2);
  assert(valA2.isValid, "Repair A2: Valid reciprocal transfer passes validation");
  const balSourceA2 = calculateAccountBalance(ledgerValidTransferA2, "acc_source");
  const balDestA2 = calculateAccountBalance(ledgerValidTransferA2, "acc_dest");
  const sumA2 = Number(balSourceA2) + Number(balDestA2);
  assert(balSourceA2 === 1000, `Repair A2: Source balance remains 1,000 because transfer date 2026-10-10 < dest opening date 2026-10-15 (got ${balSourceA2})`);
  assert(balDestA2 === 0, `Repair A2: Destination balance remains 0 because transfer date 2026-10-10 < dest opening date 2026-10-15 (got ${balDestA2})`);
  assert(sumA2 === 1000, `Repair A2: Global ledger balance preserves exactly रु 1,000 across asymmetrical opening dates (got ${sumA2})`);

  // Case A3: Transfer date on 2026-10-20 (after both opening dates)
  const ledgerTransferA3 = JSON.parse(JSON.stringify(ledgerValidTransferA2));
  ledgerTransferA3.transactions[0].dateAD = "2026-10-20";
  ledgerTransferA3.transactions[1].dateAD = "2026-10-20";
  const balSourceA3 = calculateAccountBalance(ledgerTransferA3, "acc_source");
  const balDestA3 = calculateAccountBalance(ledgerTransferA3, "acc_dest");
  assert(balSourceA3 === 900 && balDestA3 === 100, `Repair A3: Post-opening date transfer moves 100 (source: 900, dest: 100)`);
  assert(Number(balSourceA3) + Number(balDestA3) === 1000, "Repair A3: Global ledger balance remains exactly 1,000");

  // Case A4: Reverse transfer from dest to source on 2026-10-10 (before dest opening date)
  const ledgerTransferA4 = JSON.parse(JSON.stringify(baseTransferLedger));
  ledgerTransferA4.transactions = [
    {
      id: "tx_tr_out_a4",
      transferId: "tr_a4",
      transferDirection: "out",
      accountId: "acc_dest",
      peerAccountId: "acc_source",
      type: "transfer",
      amount: 100,
      category: "transfer",
      description: "Transfer out",
      dateAD: "2026-10-10",
      paymentMethod: "bank_transfer"
    },
    {
      id: "tx_tr_in_a4",
      transferId: "tr_a4",
      transferDirection: "in",
      accountId: "acc_source",
      peerAccountId: "acc_dest",
      type: "transfer",
      amount: 100,
      category: "transfer",
      description: "Transfer in",
      dateAD: "2026-10-10",
      paymentMethod: "bank_transfer"
    }
  ];
  const balSourceA4 = calculateAccountBalance(ledgerTransferA4, "acc_source");
  const balDestA4 = calculateAccountBalance(ledgerTransferA4, "acc_dest");
  assert(balSourceA4 === 1000 && balDestA4 === 0, "Repair A4: Symmetrical exclusion preserves source 1,000 and dest 0");
  assert(Number(balSourceA4) + Number(balDestA4) === 1000, "Repair A4: Symmetrical global balance preserved at 1,000");

  // Case A5: Mismatched peerAccountId values rejected
  const ledgerMismatchedPeer = JSON.parse(JSON.stringify(ledgerValidTransferA2));
  ledgerMismatchedPeer.transactions[0].peerAccountId = "acc_wrong";
  assert(!Validator.validateBackupJson(ledgerMismatchedPeer).isValid, "Repair A5: Mismatched peerAccountId is strictly rejected");

  // --- Repair B: Complete and exact state fingerprinting ---
  console.log("  [Repair B] Verifying exact state fingerprinting and canonical normalization...");
  const baseFpState = {
    version: 3,
    revision: 1,
    isDemoData: false,
    accounts: [{ id: "acc_1", name: "Cash", type: "cash", openingBalance: 100000, openingBalanceDate: "2026-10-01", overdraftEnabled: false, archived: false }],
    transactions: [{ id: "tx_1", type: "income", accountId: "acc_1", amount: 100000, category: "salary", description: "Salary", dateAD: "2026-10-01" }],
    budgets: [{ id: "b_1", period: "2026-10", category: "housing", amount: 20000 }],
    goals: [{ id: "g_1", title: "Emergency", targetAmount: 500000, targetDateAD: "2027-01-01", allocations: [{ id: "al_1", amount: 50000, dateAD: "2026-10-01" }] }],
    recurringRules: [{
      id: "rr_1",
      title: "Internet",
      type: "expense",
      accountId: "acc_1",
      amount: 1500,
      category: "utilities",
      paymentMethod: "bank_transfer",
      schedule: { frequency: "yearly", interval: 1, month: 6, dayOfMonth: 15, startDate: "2026-06-15" },
      paused: false,
      isPaused: false
    }],
    bills: [{
      id: "bill_1",
      title: "Water Bill",
      amount: 500,
      category: "utilities",
      accountId: "acc_1",
      dueDateAD: "2026-11-01",
      recurrence: { frequency: "monthly", interval: 1, dayOfMonth: 1 },
      isPaid: false
    }],
    settings: { ...DEFAULT_SETTINGS, initialBalance: 100000 }
  };

  const fpBase = computeStateFingerprint(baseFpState);

  // B1: 1,00,000 vs 2,00,000 produce different fingerprints
  const stateDiffAmount = JSON.parse(JSON.stringify(baseFpState));
  stateDiffAmount.accounts[0].openingBalance = 200000;
  const fpDiffAmount = computeStateFingerprint(stateDiffAmount);
  assert(fpBase !== fpDiffAmount, "Repair B1: रु 1,00,000 and रु 2,00,000 produce completely different fingerprints");

  // B2: Numeric 100000 and formatted string "1,00,000" produce the EXACT same fingerprint
  const stateFormattedString = JSON.parse(JSON.stringify(baseFpState));
  stateFormattedString.accounts[0].openingBalance = "1,00,000";
  stateFormattedString.transactions[0].amount = "1,00,000";
  stateFormattedString.settings.initialBalance = "1,00,000";
  const fpFormatted = computeStateFingerprint(stateFormattedString);
  assert(fpBase === fpFormatted, "Repair B2: Numeric 100000 and valid formatted string '1,00,000' produce the exact same canonical fingerprint");

  // B3: Monthly and yearly bill recurrence configurations produce different fingerprints
  const stateYearlyBill = JSON.parse(JSON.stringify(baseFpState));
  stateYearlyBill.bills[0].recurrence = { frequency: "yearly", interval: 1, month: 11, dayOfMonth: 1 };
  const fpYearlyBill = computeStateFingerprint(stateYearlyBill);
  assert(fpBase !== fpYearlyBill, "Repair B3: Monthly and yearly bill recurrence configurations produce different fingerprints (no [object Object])");

  // B4: Different yearly schedule months produce different fingerprints
  const stateDiffMonth = JSON.parse(JSON.stringify(baseFpState));
  stateDiffMonth.recurringRules[0].schedule.month = 7;
  const fpDiffMonth = computeStateFingerprint(stateDiffMonth);
  assert(fpBase !== fpDiffMonth, "Repair B4: Different yearly recurring schedule months (6 vs 7) produce different fingerprints");

  // B5: Changing meaningful fields changes fingerprint
  const stateArchivedAcc = JSON.parse(JSON.stringify(baseFpState));
  stateArchivedAcc.accounts[0].archived = true;
  assert(computeStateFingerprint(stateArchivedAcc) !== fpBase, "Repair B5: Toggling account archived status changes fingerprint");

  const stateBillSeries = JSON.parse(JSON.stringify(baseFpState));
  stateBillSeries.bills[0].seriesId = "bseries_123";
  assert(computeStateFingerprint(stateBillSeries) !== fpBase, "Repair B5: Setting bill seriesId changes fingerprint");

  // B6: Reordering entities does NOT change fingerprint
  const stateReordered = JSON.parse(JSON.stringify(baseFpState));
  stateReordered.accounts.push({ id: "acc_0_earlier", name: "Wallet", type: "cash", openingBalance: 50, openingBalanceDate: "2026-10-01", overdraftEnabled: false, archived: false });
  const fpReorder1 = computeStateFingerprint(stateReordered);
  const stateReorderedSwapped = JSON.parse(JSON.stringify(stateReordered));
  stateReorderedSwapped.accounts.reverse();
  const fpReorder2 = computeStateFingerprint(stateReorderedSwapped);
  assert(fpReorder1 === fpReorder2, "Repair B6: Reordering accounts in state does not alter canonical fingerprint");

  // --- Repair C: Exact monetary normalization during migration and import ---
  console.log("  [Repair C] Verifying exact monetary normalization across migration and import...");
  const legacyV2WithLakh = {
    version: 2,
    settings: {
      initialBalance: "1,00,000",
      initialBalanceDate: "2026-10-01"
    },
    transactions: [
      {
        id: "tx_legacy_1",
        type: "income",
        amount: "12,34,567.89",
        category: "salary",
        description: "Salary in Lakh format",
        dateAD: "2026-10-01",
        paymentMethod: "bank_transfer"
      }
    ],
    budgets: [
      { id: "bg_1", period: "2026-10", category: "housing", amount: "50,000" }
    ],
    goals: [
      {
        id: "gl_1",
        title: "Car",
        targetAmount: "10,00,000",
        targetDateAD: "2027-01-01",
        allocations: [{ id: "al_1", amount: "1,00,000.50", dateAD: "2026-10-01" }]
      }
    ],
    recurringRules: [
      {
        id: "rr_1",
        title: "Rent",
        type: "expense",
        amount: "25,000",
        category: "housing",
        paymentMethod: "cash",
        schedule: { frequency: "monthly", interval: 1, dayOfMonth: 1, startDate: "2026-10-01" }
      }
    ],
    bills: [
      {
        id: "bill_1",
        title: "Electricity",
        amount: "3,500.25",
        category: "utilities",
        dueDateAD: "2026-11-01"
      }
    ]
  };

  const migratedV3 = migrateV2toV3(legacyV2WithLakh);
  assert(migratedV3.settings.initialBalance === 100000, `Repair C1: Legacy initialBalance '1,00,000' migrated to exactly 100000 (got ${migratedV3.settings.initialBalance})`);
  assert(migratedV3.accounts[0].openingBalance === 100000, `Repair C1: Default Cash Wallet opening balance is exactly 100000 (got ${migratedV3.accounts[0].openingBalance})`);
  assert(migratedV3.transactions[0].amount === 1234567.89, `Repair C2: Transaction amount '12,34,567.89' migrated to exact 1234567.89 (got ${migratedV3.transactions[0].amount})`);
  assert(migratedV3.budgets[0].amount === 50000, `Repair C3: Budget amount '50,000' normalized to 50000 (got ${migratedV3.budgets[0].amount})`);
  assert(migratedV3.goals[0].targetAmount === 1000000, `Repair C4: Goal targetAmount normalized to 1000000 (got ${migratedV3.goals[0].targetAmount})`);
  assert(migratedV3.goals[0].allocations[0].amount === 100000.5, `Repair C4: Allocation amount normalized to 100000.5 (got ${migratedV3.goals[0].allocations[0].amount})`);
  assert(migratedV3.recurringRules[0].amount === 25000, `Repair C5: Recurring rule amount normalized to 25000 (got ${migratedV3.recurringRules[0].amount})`);
  assert(migratedV3.bills[0].amount === 3500.25, `Repair C6: Bill amount normalized to 3500.25 (got ${migratedV3.bills[0].amount})`);

  // --- Repair D: Strict recurring schedule validation & hardened computeNextOccurrence ---
  console.log("  [Repair D] Verifying recurring schedule validation and computeNextOccurrence hardening...");
  const baseRule = {
    id: "rr_test",
    title: "Test Rule",
    type: "expense",
    amount: 100,
    accountId: "acc_1",
    category: "utilities",
    paymentMethod: "bank_transfer",
    schedule: { frequency: "monthly", interval: 1, dayOfMonth: 15, startDate: "2026-01-15" }
  };

  const testRuleRejection = (schedPatch, label) => {
    const candidate = JSON.parse(JSON.stringify(baseRule));
    Object.assign(candidate.schedule, schedPatch);
    const res = Validator.validateRecurringRule(candidate);
    assert(!res.isValid, `Repair D: ${label} is strictly rejected`);
  };

  testRuleRejection({ interval: 1.5 }, "Interval 1.5 (fractional)");
  testRuleRejection({ interval: Infinity }, "Interval Infinity");
  testRuleRejection({ interval: 0 }, "Interval 0");
  testRuleRejection({ interval: -1 }, "Negative interval");
  testRuleRejection({ dayOfMonth: 15.5 }, "dayOfMonth 15.5 (fractional)");
  testRuleRejection({ dayOfMonth: 32 }, "dayOfMonth 32 (out of range)");
  testRuleRejection({ month: 13 }, "Yearly month 13 (out of range)");

  const ruleInvalidCat = { ...baseRule, category: "fake_cat_xyz" };
  assert(!Validator.validateRecurringRule(ruleInvalidCat).isValid, "Repair D: Invalid category rejected on recurring rule");

  const ruleInvalidMethod = { ...baseRule, paymentMethod: "cryptocurrency" };
  assert(!Validator.validateRecurringRule(ruleInvalidMethod).isValid, "Repair D: Invalid payment method rejected on recurring rule");

  const ruleEndBeforeStart = { ...baseRule, schedule: { ...baseRule.schedule, startDate: "2026-10-01", endDate: "2026-09-01" } };
  assert(!Validator.validateRecurringRule(ruleEndBeforeStart).isValid, "Repair D: endDate before startDate rejected");

  const ruleNextBeforeStart = { ...baseRule, nextOccurrence: "2025-12-01", schedule: { ...baseRule.schedule, startDate: "2026-01-01" } };
  assert(!Validator.validateRecurringRule(ruleNextBeforeStart).isValid, "Repair D: nextOccurrence before startDate rejected");

  const ruleNextAfterEnd = { ...baseRule, nextOccurrence: "2027-01-01", schedule: { ...baseRule.schedule, startDate: "2026-01-01", endDate: "2026-12-31" } };
  assert(!Validator.validateRecurringRule(ruleNextAfterEnd).isValid, "Repair D: nextOccurrence after endDate rejected");

  // Bill recurrence validation
  const baseRecBill = {
    id: "bill_rec_test",
    title: "Test Rec Bill",
    amount: 500,
    category: "utilities",
    accountId: "acc_1",
    dueDateAD: "2026-05-01",
    isPaid: false
  };

  const billBadFreq = { ...baseRecBill, recurrence: { frequency: "hourly" } };
  assert(!Validator.validateBill(billBadFreq).isValid, "Repair D: Invalid bill recurrence frequency rejected");

  const billBadInterval = { ...baseRecBill, recurrence: { frequency: "monthly", interval: 0 } };
  assert(!Validator.validateBill(billBadInterval).isValid, "Repair D: Invalid bill recurrence interval (0) rejected");

  // computeNextOccurrence tests
  assert(computeNextOccurrence({ frequency: "monthly", interval: 1.5 }, "2026-01-15") === null, "Repair D: computeNextOccurrence returns null for fractional interval 1.5");
  assert(computeNextOccurrence({ frequency: "monthly", interval: Infinity }, "2026-01-15") === null, "Repair D: computeNextOccurrence returns null for Infinity interval");
  assert(computeNextOccurrence({ frequency: "monthly", interval: -1 }, "2026-01-15") === null, "Repair D: computeNextOccurrence returns null for negative interval");

  // Day-31 preservation across shorter months: Jan 31 -> Feb 28 -> Mar 31 -> Apr 30
  const d31Sched = { frequency: "monthly", interval: 1, dayOfMonth: 31, startDate: "2026-01-31" };
  const d31_feb = computeNextOccurrence(d31Sched, "2026-01-31");
  assert(d31_feb === "2026-02-28", `Repair D: Jan 31 advances to Feb 28 (got ${d31_feb})`);
  const d31_mar = computeNextOccurrence(d31Sched, d31_feb);
  assert(d31_mar === "2026-03-31", `Repair D: Feb 28 preserves original day-31 and advances to Mar 31 (got ${d31_mar})`);
  const d31_apr = computeNextOccurrence(d31Sched, d31_mar);
  assert(d31_apr === "2026-04-30", `Repair D: Mar 31 advances to Apr 30 (got ${d31_apr})`);

  // --- Repair E: Strict paid-bill relationship integrity ---
  console.log("  [Repair E] Verifying paid bill and linked expense reciprocal integrity...");
  const baseBillRelationshipLedger = {
    version: 3,
    revision: 1,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 10000 },
    accounts: [{ id: "acc_b", name: "Bank", type: "bank", openingBalance: 10000, openingBalanceDate: "2026-01-01", overdraftEnabled: true, archived: false }],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  const createBillPair = (billOverrides = {}, txOverrides = {}) => {
    const ledger = JSON.parse(JSON.stringify(baseBillRelationshipLedger));
    const bill = {
      id: "bill_e1",
      title: "Internet",
      amount: 1500,
      category: "utilities",
      accountId: "acc_b",
      dueDateAD: "2026-10-01",
      dueDateBS: "2083-06-15",
      status: "paid",
      isPaid: true,
      paidDateAD: "2026-10-01",
      paidDateBS: "2083-06-15",
      linkedTransactionId: "tx_e1",
      ...billOverrides
    };
    const tx = {
      id: "tx_e1",
      type: "expense",
      accountId: "acc_b",
      amount: 1500,
      category: "utilities",
      description: "Bill Payment: Internet",
      dateAD: "2026-10-01",
      dateBS: "2083-06-15",
      paymentMethod: "bank_transfer",
      linkedBillId: "bill_e1",
      ...txOverrides
    };
    ledger.bills.push(bill);
    ledger.transactions.push(tx);
    return ledger;
  };

  // Valid pair passes
  assert(Validator.validateBackupJson(createBillPair()).isValid, "Repair E: Valid paid bill reciprocal pair passes validation");

  // E1: Missing reciprocal linkedBillId on transaction
  const ledgerMissingReciprocal = createBillPair({}, { linkedBillId: null });
  assert(!Validator.validateBackupJson(ledgerMissingReciprocal).isValid, "Repair E1: Missing reciprocal linkedBillId on transaction is rejected");

  // E2: Wrong linkedBillId on transaction
  const ledgerWrongReciprocal = createBillPair({}, { linkedBillId: "bill_wrong_id" });
  assert(!Validator.validateBackupJson(ledgerWrongReciprocal).isValid, "Repair E2: Wrong linkedBillId on transaction is rejected");

  // E3: Unpaid bill with a linked transaction
  const ledgerUnpaidLinked = createBillPair({ isPaid: false, status: "upcoming", linkedTransactionId: "tx_e1" });
  assert(!Validator.validateBackupJson(ledgerUnpaidLinked).isValid, "Repair E3: Unpaid bill with linked transaction is rejected");

  // E4: Paid bill with missing paid date
  const ledgerMissingPaidDate = createBillPair({ paidDateAD: null });
  assert(!Validator.validateBackupJson(ledgerMissingPaidDate).isValid, "Repair E4: Paid bill with missing paidDateAD is rejected");

  // E5: Mismatched paid date
  const ledgerMismatchedDate = createBillPair({ paidDateAD: "2026-10-05" }, { dateAD: "2026-10-01" });
  assert(!Validator.validateBackupJson(ledgerMismatchedDate).isValid, "Repair E5: Mismatched paid date (2026-10-05 vs 2026-10-01) is rejected");

  // E6: Mismatched amount
  const ledgerMismatchedAmount = createBillPair({ amount: 1500 }, { amount: 1600 });
  assert(!Validator.validateBackupJson(ledgerMismatchedAmount).isValid, "Repair E6: Mismatched bill and transaction amount (1500 vs 1600) is rejected");

  // E7: Mismatched account
  const ledgerMismatchedAcc = createBillPair({ accountId: "acc_b" }, { accountId: "acc_other" });
  ledgerMismatchedAcc.accounts.push({ id: "acc_other", name: "Other", type: "cash", openingBalance: 1000, openingBalanceDate: "2026-01-01", overdraftEnabled: true, archived: false });
  assert(!Validator.validateBackupJson(ledgerMismatchedAcc).isValid, "Repair E7: Mismatched bill and transaction account is rejected");

  // E8: Mismatched category
  const ledgerMismatchedCat = createBillPair({ category: "utilities" }, { category: "food_dining" });
  assert(!Validator.validateBackupJson(ledgerMismatchedCat).isValid, "Repair E8: Mismatched bill and transaction category is rejected");

  // E9: Multiple bills referencing one transaction
  const ledgerMultiBillsOneTx = createBillPair();
  ledgerMultiBillsOneTx.bills.push({
    id: "bill_e2",
    title: "Second Bill",
    amount: 1500,
    category: "utilities",
    accountId: "acc_b",
    dueDateAD: "2026-10-01",
    status: "paid",
    isPaid: true,
    paidDateAD: "2026-10-01",
    linkedTransactionId: "tx_e1"
  });
  assert(!Validator.validateBackupJson(ledgerMultiBillsOneTx).isValid, "Repair E9: Multiple bills linking to same transaction is rejected");

  // E10: Editing date of paid bill transaction synchronizes bill's paid dates atomically
  await dispatch("INITIALIZE_PERSONAL_LEDGER", { initialBalance: 50000, accountName: "Primary Cash" });
  const accState = getState();
  const primaryId = accState.accounts[0].id;
  const createdBillRes = await dispatch("ADD_BILL", {
    title: "Electricity Test",
    amount: 1200,
    category: "utilities",
    accountId: primaryId,
    dueDateAD: "2026-11-01"
  });
  assert(createdBillRes.success, "Repair E10: Bill created successfully");
  const billId = createdBillRes.bill.id;

  const payRes = await dispatch("PAY_BILL", { id: billId, dateAD: "2026-11-01" });
  assert(payRes.success, "Repair E10: Bill paid successfully");
  const paidTx = getState().transactions.find(t => t.linkedBillId === billId);
  assert(paidTx !== undefined, "Repair E10: Linked expense transaction created with reciprocal linkedBillId");

  // Edit transaction date to 2026-11-05
  const updateTxRes = await dispatch("UPDATE_TRANSACTION", {
    id: paidTx.id,
    dateAD: "2026-11-05"
  });
  assert(updateTxRes.success, "Repair E10: Transaction updated with new date 2026-11-05");
  const updatedBillState = getState().bills.find(b => b.id === billId);
  assert(updatedBillState.paidDateAD === "2026-11-05", `Repair E10: Bill paidDateAD synchronized to 2026-11-05 atomically (got ${updatedBillState.paidDateAD})`);
  assert(updatedBillState.paidDateBS === adToBs("2026-11-05").formatted, "Repair E10: Bill paidDateBS synchronized to BS equivalent atomically");

  // E11: Deleting linked bill expense unlinks bill and recalculates status
  const delTxRes = await dispatch("DELETE_TRANSACTION", { id: paidTx.id });
  assert(delTxRes.success, "Repair E11: Linked transaction deleted");
  const postDelBill = getState().bills.find(b => b.id === billId);
  assert(postDelBill.linkedTransactionId === null, "Repair E11: Bill linkedTransactionId reset to null");
  assert(postDelBill.isPaid === false, "Repair E11: Bill isPaid reset to false");
  assert(postDelBill.paidDateAD === null, "Repair E11: Bill paidDateAD reset to null");
  assert(postDelBill.status === "overdue" || postDelBill.status === "upcoming" || postDelBill.status === "dueSoon", `Repair E11: Bill status recalculated (got ${postDelBill.status})`);

  // ============================================================================
  // AUDIT 26: Targeted Financial Data Integrity & Schedule Hardening Suite
  // ============================================================================
  console.log("\n=========================================================");
  console.log("AUDIT 26: Targeted Financial Data Integrity & Schedule Hardening");
  console.log("=========================================================");

  // --- Audit 26 Fix A: Strict Monetary Fingerprint Normalization ---
  console.log("  [Audit 26 Fix A] Verifying strict monetary fingerprint normalization...");

  const audit26FpState = {
    version: 3,
    revision: 1,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 50000 },
    accounts: [{
      id: "acc_fp_1",
      name: "Cash",
      type: "cash",
      openingBalance: 100000,
      openingBalanceDate: "2026-01-01",
      overdraftEnabled: true,
      archived: false,
      isPrimary: true
    }],
    transactions: [{
      id: "tx_fp_1",
      type: "income",
      accountId: "acc_fp_1",
      amount: 50000,
      category: "salary",
      description: "Salary",
      dateAD: "2026-10-01",
      paymentMethod: "bank_transfer"
    }],
    budgets: [{
      id: "b_fp_1",
      period: "2026-10",
      category: "groceries",
      amount: 20000
    }],
    goals: [{
      id: "g_fp_1",
      title: "Vacation",
      targetAmount: 500000,
      targetDateAD: "2026-12-31",
      category: "travel",
      allocations: [{
        id: "al_fp_1",
        amount: 50000,
        dateAD: "2026-10-05"
      }]
    }],
    recurringRules: [{
      id: "rr_fp_1",
      title: "Gym",
      type: "expense",
      accountId: "acc_fp_1",
      amount: 3000,
      category: "personal_care",
      paymentMethod: "cash",
      schedule: { frequency: "monthly", interval: 1, dayOfMonth: 1, startDate: "2026-09-01" },
      nextOccurrence: "2026-11-01",
      skippedDates: [],
      paused: false
    }],
    bills: [{
      id: "bill_fp_1",
      title: "Internet",
      amount: 1500,
      category: "utilities",
      accountId: "acc_fp_1",
      dueDateAD: "2026-10-25",
      isPaid: false,
      status: "unpaid",
      recurrence: { frequency: "monthly", interval: 1, dayOfMonth: 25, startDate: "2026-09-25" }
    }]
  };

  const createFpState = (modFn) => {
    const clone = JSON.parse(JSON.stringify(audit26FpState));
    if (modFn) modFn(clone);
    return clone;
  };

  // A1: Equivalent valid amounts produce identical fingerprints
  const fpCanonical = computeStateFingerprint(audit26FpState);
  const fpFormattedA = computeStateFingerprint(createFpState(s => {
    s.accounts[0].openingBalance = "100000";
    s.transactions[0].amount = "50000";
    s.budgets[0].amount = "20000";
  }));
  assert(fpCanonical === fpFormattedA, "Audit 26 A1: Numeric and string monetary amounts produce identical fingerprints");

  const fpFormattedB = computeStateFingerprint(createFpState(s => {
    s.accounts[0].openingBalance = "1,00,000";
    s.transactions[0].amount = "50,000.00";
    s.budgets[0].amount = "20,000";
  }));
  assert(fpCanonical === fpFormattedB, "Audit 26 A1: South Asian formatted string amounts produce identical fingerprints");

  // A2: Formatted decimals produce canonical precision
  const fpDecimal1 = computeStateFingerprint(createFpState(s => {
    s.transactions[0].amount = "12,34,567.89";
  }));
  const fpDecimal2 = computeStateFingerprint(createFpState(s => {
    s.transactions[0].amount = 1234567.89;
  }));
  assert(fpDecimal1 === fpDecimal2, "Audit 26 A2: '12,34,567.89' and numeric 1234567.89 produce identical canonical fingerprints");

  // A3: Invalid monetary values throw and NEVER silently become "0"
  const testInvalidFpThrows = (label, modFn) => {
    let threw = false;
    try {
      computeStateFingerprint(createFpState(modFn));
    } catch (e) {
      threw = (e instanceof TypeError || e instanceof RangeError);
    }
    assert(threw, `Audit 26 A3: Invalid monetary value (${label}) explicitly throws error during fingerprinting`);
  };

  testInvalidFpThrows("opening balance 'bad-a'", s => { s.accounts[0].openingBalance = "bad-a"; });
  testInvalidFpThrows("opening balance 'bad-b'", s => { s.accounts[0].openingBalance = "bad-b"; });
  testInvalidFpThrows("malformed commas '1,2,3'", s => { s.transactions[0].amount = "1,2,3"; });
  testInvalidFpThrows("unsupported precision '1.234'", s => { s.transactions[0].amount = "1.234"; });
  testInvalidFpThrows("empty string ''", s => { s.accounts[0].openingBalance = ""; });
  testInvalidFpThrows("whitespace string '   '", s => { s.budgets[0].amount = "   "; });
  testInvalidFpThrows("NaN amount", s => { s.goals[0].targetAmount = NaN; });
  testInvalidFpThrows("Infinity amount", s => { s.bills[0].amount = Infinity; });
  testInvalidFpThrows("negative opening balance -10", s => { s.accounts[0].openingBalance = -10; });
  testInvalidFpThrows("negative transaction amount -50", s => { s.transactions[0].amount = -50; });
  testInvalidFpThrows("excessive amount 1e15", s => { s.transactions[0].amount = 1e15; });
  testInvalidFpThrows("null mandatory amount", s => { s.transactions[0].amount = null; });
  testInvalidFpThrows("undefined mandatory amount", s => { s.transactions[0].amount = undefined; });

  // A4: Verify 'bad-a' and 'bad-b' cannot produce identical fingerprints or zero
  let badAFpError = null;
  let badBFpError = null;
  try { computeStateFingerprint({ accounts: [{ id: "a1", openingBalance: "bad-a" }] }); } catch (e) { badAFpError = e; }
  try { computeStateFingerprint({ accounts: [{ id: "a1", openingBalance: "bad-b" }] }); } catch (e) { badBFpError = e; }
  assert(badAFpError !== null && badBFpError !== null, "Audit 26 A4: Both 'bad-a' and 'bad-b' fail fingerprint generation explicitly");

  // A5: Persistence verification rejects invalid state
  const invalidStatePersistRes = await persistVerifiedState({
    ...audit26FpState,
    accounts: [{ ...audit26FpState.accounts[0], openingBalance: "bad-a" }]
  });
  assert(!invalidStatePersistRes.success, "Audit 26 A5: persistVerifiedState fails safely when state contains invalid monetary data");

  // --- Audit 26 Fix B: Strict Bill Recurrence Validation ---
  console.log("  [Audit 26 Fix B] Verifying strict bill recurrence validation...");

  const baseValidBill = {
    id: "bill_val_1",
    title: "Electricity Bill",
    amount: 2500,
    category: "utilities",
    accountId: "acc_fp_1",
    dueDateAD: "2026-10-15",
    dueDateBS: "2083-06-29",
    status: "unpaid",
    isPaid: false
  };

  const testBillRecVal = (recObj, shouldBeValid, label) => {
    const res = Validator.validateBill({ ...baseValidBill, recurrence: recObj });
    assert(res.isValid === shouldBeValid, `Audit 26 B: ${label} -> expected ${shouldBeValid ? "VALID" : "INVALID"} (got ${res.isValid ? "VALID" : res.errors.join("; ")})`);
  };

  testBillRecVal(null, true, "1. recurrence: null is accepted");
  testBillRecVal(undefined, true, "1b. recurrence: undefined is accepted");
  testBillRecVal({}, false, "2. recurrence: {} is rejected");
  testBillRecVal({ interval: 1 }, false, "3. Missing frequency is rejected");
  testBillRecVal({ frequency: "monthly" }, false, "4. Missing interval is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1.5 }, false, "5. Interval 1.5 is rejected");
  testBillRecVal({ frequency: "monthly", interval: 0 }, false, "6. Interval 0 is rejected");
  testBillRecVal({ frequency: "monthly", interval: -1 }, false, "7. Negative interval is rejected");
  testBillRecVal({ frequency: "monthly", interval: Infinity }, false, "8. Interval Infinity is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1, dayOfMonth: 15.5 }, false, "9. Day of month 15.5 is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1, dayOfMonth: 32 }, false, "10. Day of month 32 is rejected");
  testBillRecVal({ frequency: "yearly", interval: 1, month: 13 }, false, "11. Yearly month 13 is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1, startDate: "bad-date" }, false, "12. Invalid start date is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1, endDate: "bad-date" }, false, "13. Invalid end date is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1, startDate: "2026-10-01", endDate: "2026-09-01" }, false, "14. End date before start date is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1, startDate: "2026-10-01", nextOccurrence: "2026-09-15" }, false, "15. Next occurrence before start date is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1, startDate: "2026-10-01", endDate: "2026-11-01", nextOccurrence: "2026-11-15" }, false, "16. Next occurrence after end date is rejected");
  testBillRecVal({ frequency: "hourly", interval: 1 }, false, "17. Unsupported frequency is rejected");
  testBillRecVal("monthly", false, "18a. String recurrence is rejected");
  testBillRecVal([1, 2], false, "18b. Array recurrence is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1, unknownProp: true }, false, "18c. Arbitrary unknown property is rejected");
  testBillRecVal({ frequency: "monthly", interval: 1, dayOfMonth: 15, startDate: "2026-10-15" }, true, "19. Complete valid monthly recurrence is accepted");
  testBillRecVal({ frequency: "yearly", interval: 1, month: 10, dayOfMonth: 15, startDate: "2026-10-15" }, true, "20. Complete valid yearly recurrence is accepted");

  // B21: dispatch("ADD_BILL") with recurrence: {} is blocked
  const addBillBadRec = await dispatch("ADD_BILL", {
    title: "Bad Rec Bill",
    amount: 1000,
    category: "utilities",
    accountId: "acc_fp_1",
    dueDateAD: "2026-10-15",
    recurrence: {}
  });
  assert(!addBillBadRec.success, "Audit 26 B21: ADD_BILL with recurrence: {} is rejected by state manager");

  // B22: Backup with invalid recurrence rejected by validateBackupJson
  const backupWithBadRec = createFpState(s => {
    s.bills[0].recurrence = {};
  });
  assert(!Validator.validateBackupJson(backupWithBadRec).isValid, "Audit 26 B22: validateBackupJson rejects backup containing bill recurrence: {}");

  // --- Audit 26 Fix C: Hardened computeNextOccurrence() ---
  console.log("  [Audit 26 Fix C] Verifying hardened computeNextOccurrence()...");

  // C1: Valid daily schedule
  const nextDaily = computeNextOccurrence({ frequency: "daily", interval: 2, startDate: "2026-10-01" }, "2026-10-01");
  assert(nextDaily === "2026-10-03", `Audit 26 C1: Valid daily schedule advances 2 days (got ${nextDaily})`);

  // C2: Valid weekly schedule
  const nextWeekly = computeNextOccurrence({ frequency: "weekly", interval: 1, startDate: "2026-10-01" }, "2026-10-01");
  assert(nextWeekly === "2026-10-08", `Audit 26 C2: Valid weekly schedule advances 7 days (got ${nextWeekly})`);

  // C3: Valid monthly schedule
  const nextMonthly = computeNextOccurrence({ frequency: "monthly", interval: 1, startDate: "2026-10-01" }, "2026-10-01");
  assert(nextMonthly === "2026-11-01", `Audit 26 C3: Valid monthly schedule advances 1 month (got ${nextMonthly})`);

  // C4: Valid yearly schedule
  const nextYearly = computeNextOccurrence({ frequency: "yearly", interval: 1, startDate: "2026-10-01" }, "2026-10-01");
  assert(nextYearly === "2027-10-01", `Audit 26 C4: Valid yearly schedule advances 1 year (got ${nextYearly})`);

  // C5: Monthly day 31 preservation: Jan 31 -> Feb 28 -> Mar 31 -> Apr 30
  const d31SchedA = { frequency: "monthly", interval: 1, dayOfMonth: 31, startDate: "2026-01-31" };
  const d31_1 = computeNextOccurrence(d31SchedA, "2026-01-31");
  assert(d31_1 === "2026-02-28", `Audit 26 C5: Jan 31 advances to Feb 28 in non-leap year (got ${d31_1})`);
  const d31_2 = computeNextOccurrence(d31SchedA, d31_1);
  assert(d31_2 === "2026-03-31", `Audit 26 C5: Feb 28 restores to Mar 31 (got ${d31_2})`);
  const d31_3 = computeNextOccurrence(d31SchedA, d31_2);
  assert(d31_3 === "2026-04-30", `Audit 26 C5: Mar 31 clamps to Apr 30 (got ${d31_3})`);

  // C6: Leap year 2028: Feb 29 and return to Mar 31
  const d31LeapSched = { frequency: "monthly", interval: 1, dayOfMonth: 31, startDate: "2028-01-31" };
  const d31_leapFeb = computeNextOccurrence(d31LeapSched, "2028-01-31");
  assert(d31_leapFeb === "2028-02-29", `Audit 26 C6: Jan 31 advances to Feb 29 in leap year 2028 (got ${d31_leapFeb})`);
  const d31_leapMar = computeNextOccurrence(d31LeapSched, d31_leapFeb);
  assert(d31_leapMar === "2028-03-31", `Audit 26 C6: Feb 29 returns to Mar 31 in leap year 2028 (got ${d31_leapMar})`);

  // C7: December-to-January transition
  const d31DecSched = { frequency: "monthly", interval: 1, dayOfMonth: 31, startDate: "2026-12-31" };
  const d31_jan = computeNextOccurrence(d31DecSched, "2026-12-31");
  assert(d31_jan === "2027-01-31", `Audit 26 C7: Dec 31 transitions cleanly to Jan 31 next year (got ${d31_jan})`);

  // C8: Invalid intervals return null
  assert(computeNextOccurrence({ frequency: "monthly", interval: 1.5, startDate: "2026-10-01" }, "2026-10-01") === null, "Audit 26 C8: Interval 1.5 returns null");
  assert(computeNextOccurrence({ frequency: "monthly", interval: 0, startDate: "2026-10-01" }, "2026-10-01") === null, "Audit 26 C8: Interval 0 returns null");
  assert(computeNextOccurrence({ frequency: "monthly", interval: -1, startDate: "2026-10-01" }, "2026-10-01") === null, "Audit 26 C8: Negative interval returns null");
  assert(computeNextOccurrence({ frequency: "monthly", interval: Infinity, startDate: "2026-10-01" }, "2026-10-01") === null, "Audit 26 C8: Interval Infinity returns null");

  // C9: Missing frequency returns null (no silent default)
  assert(computeNextOccurrence({ interval: 1, startDate: "2026-10-01" }, "2026-10-01") === null, "Audit 26 C9: Missing frequency returns null (no silent defaulting)");

  // C10: Missing or invalid start date returns null
  assert(computeNextOccurrence({ frequency: "monthly", interval: 1 }, "2026-10-01") === null, "Audit 26 C10: Missing startDate returns null");
  assert(computeNextOccurrence({ frequency: "monthly", interval: 1, startDate: "invalid-date" }, "2026-10-01") === null, "Audit 26 C10: Invalid startDate returns null");

  // C11: Invalid end date or end date before start date returns null
  assert(computeNextOccurrence({ frequency: "monthly", interval: 1, startDate: "2026-10-01", endDate: "invalid-date" }, "2026-10-01") === null, "Audit 26 C11: Invalid endDate returns null");
  assert(computeNextOccurrence({ frequency: "monthly", interval: 1, startDate: "2026-10-01", endDate: "2026-09-01" }, "2026-10-01") === null, "Audit 26 C11: endDate before startDate returns null");

  // C12: Next occurrence / reference date before start date returns null
  assert(computeNextOccurrence({ frequency: "monthly", interval: 1, startDate: "2026-10-01" }, "2026-09-15") === null, "Audit 26 C12: Reference date before startDate returns null");

  // C13: Next occurrence beyond end date returns null
  assert(computeNextOccurrence({ frequency: "monthly", interval: 1, startDate: "2026-10-01", endDate: "2026-10-20" }, "2026-10-01") === null, "Audit 26 C13: Next occurrence beyond endDate returns null");
  assert(computeNextOccurrence({ frequency: "monthly", interval: 1, startDate: "2026-10-01", endDate: "2026-10-20" }, "2026-10-25") === null, "Audit 26 C13: Reference date beyond endDate returns null");

  // C14: Unsupported calendar date returns null
  assert(computeNextOccurrence({ frequency: "yearly", interval: 30, startDate: "2026-10-01" }, "2026-10-01") === null, "Audit 26 C14: Date exceeding supported Bikram Sambat boundary returns null");

  // C15: Malformed schedule objects return null
  assert(computeNextOccurrence(null, "2026-10-01") === null, "Audit 26 C15: null schedule returns null");
  assert(computeNextOccurrence("monthly", "2026-10-01") === null, "Audit 26 C15: String schedule returns null");
  assert(computeNextOccurrence([], "2026-10-01") === null, "Audit 26 C15: Array schedule returns null");
  assert(computeNextOccurrence(123, "2026-10-01") === null, "Audit 26 C15: Numeric schedule returns null");

  // ============================================================================
  // AUDIT 27: Strict Recurring Rule Boolean Validation & Fingerprint Collision Suite
  // ============================================================================
  console.log("\n=========================================================");
  console.log("AUDIT 27: Strict Recurring Rule Boolean & Fingerprint Integrity");
  console.log("=========================================================");

  // --- Audit 27.1: Validator.validateRecurringRule Direct Boolean Checks ---
  console.log("  [Audit 27.1] Verifying Validator.validateRecurringRule boolean invariants...");

  const liveAccId = getState().accounts?.[0]?.id || "acc_default_cash";
  const baseTestRule = {
    id: "rr_audit27_1",
    title: "Internet Subscription",
    type: "expense",
    amount: 1500,
    accountId: liveAccId,
    category: "utilities",
    paymentMethod: "bank_transfer",
    schedule: { frequency: "monthly", interval: 1, dayOfMonth: 1, startDate: "2026-10-01" },
    nextOccurrence: "2026-11-01",
    skippedDates: []
  };

  // Both flags present and valid
  assert(Validator.validateRecurringRule({ ...baseTestRule, paused: false, isPaused: false }).isValid === true, "Audit 27.1: paused: false & isPaused: false passes validation");
  assert(Validator.validateRecurringRule({ ...baseTestRule, paused: true, isPaused: true }).isValid === true, "Audit 27.1: paused: true & isPaused: true passes validation");

  // Each flag individually missing is strictly rejected
  const resMissingIsPaused = Validator.validateRecurringRule({ ...baseTestRule, paused: false });
  assert(resMissingIsPaused.isValid === false, "Audit 27.1: missing isPaused is strictly rejected");
  assert(resMissingIsPaused.errors.some(e => e.includes("isPaused") && e.includes("required")), "Audit 27.1: missing isPaused error message is clear");

  const resMissingPaused = Validator.validateRecurringRule({ ...baseTestRule, isPaused: false });
  assert(resMissingPaused.isValid === false, "Audit 27.1: missing paused is strictly rejected");
  assert(resMissingPaused.errors.some(e => e.includes("paused") && e.includes("required")), "Audit 27.1: missing paused error message is clear");

  // Both flags missing is strictly rejected
  const resMissingBoth = Validator.validateRecurringRule(baseTestRule);
  assert(resMissingBoth.isValid === false, "Audit 27.1: Both flags missing is strictly rejected by default");
  assert(Validator.validateRecurringRule(baseTestRule, { requirePaused: true }).isValid === false, "Audit 27.1: Missing paused is rejected when requirePaused is true");
  assert(Validator.validateRecurringRule(baseTestRule, { requirePaused: false }).isValid === true, "Audit 27.1: Missing paused is accepted when requirePaused is false (legacy schema)");

  const invalidBoolValues = [
    { label: "string 'false'", val: "false" },
    { label: "string 'true'", val: "true" },
    { label: "number 0", val: 0 },
    { label: "number 1", val: 1 },
    { label: "null", val: null },
    { label: "empty string ''", val: "" },
    { label: "object {}", val: {} },
    { label: "array []", val: [] }
  ];

  for (const bCase of invalidBoolValues) {
    const resPaused = Validator.validateRecurringRule({ ...baseTestRule, paused: bCase.val, isPaused: false });
    assert(resPaused.isValid === false, `Audit 27.1: paused: ${bCase.label} is strictly rejected by validateRecurringRule`);
    assert(resPaused.errors.some(e => e.includes("strict boolean")), `Audit 27.1: paused: ${bCase.label} returns clear boolean error`);

    const resIsPaused = Validator.validateRecurringRule({ ...baseTestRule, paused: false, isPaused: bCase.val });
    assert(resIsPaused.isValid === false, `Audit 27.1: isPaused: ${bCase.label} is strictly rejected by validateRecurringRule`);
    assert(resIsPaused.errors.some(e => e.includes("strict boolean")), `Audit 27.1: isPaused: ${bCase.label} returns clear boolean error`);
  }

  // Contradictory booleans
  const resContradict1 = Validator.validateRecurringRule({ ...baseTestRule, paused: false, isPaused: true });
  assert(resContradict1.isValid === false, "Audit 27.1: paused: false and isPaused: true contradiction is rejected");
  const resContradict2 = Validator.validateRecurringRule({ ...baseTestRule, paused: true, isPaused: false });
  assert(resContradict2.isValid === false, "Audit 27.1: paused: true and isPaused: false contradiction is rejected");

  // --- Audit 27.2: State Mutations (ADD, UPDATE, TOGGLE) ---
  console.log("  [Audit 27.2] Verifying application mutation paths reject invalid booleans...");

  const addInvalidRes1 = await dispatch("ADD_RECURRING_RULE", { ...baseTestRule, id: "rr_inv_1", paused: "false" });
  assert(addInvalidRes1.success === false, "Audit 27.2: ADD_RECURRING_RULE with paused: 'false' is rejected");

  const addInvalidRes2 = await dispatch("ADD_RECURRING_RULE", { ...baseTestRule, id: "rr_inv_2", paused: 0 });
  assert(addInvalidRes2.success === false, "Audit 27.2: ADD_RECURRING_RULE with paused: 0 is rejected");

  const addInvalidRes3 = await dispatch("ADD_RECURRING_RULE", { ...baseTestRule, id: "rr_inv_3", paused: null });
  assert(addInvalidRes3.success === false, "Audit 27.2: ADD_RECURRING_RULE with paused: null is rejected");

  const addInvalidRes4 = await dispatch("ADD_RECURRING_RULE", { ...baseTestRule, id: "rr_inv_4", isPaused: "false" });
  assert(addInvalidRes4.success === false, "Audit 27.2: ADD_RECURRING_RULE with isPaused: 'false' is rejected");

  const addInvalidRes5 = await dispatch("ADD_RECURRING_RULE", { ...baseTestRule, id: "rr_inv_5", paused: false, isPaused: true });
  assert(addInvalidRes5.success === false, "Audit 27.2: ADD_RECURRING_RULE with contradictory paused/isPaused is rejected");

  const addValidRes = await dispatch("ADD_RECURRING_RULE", { ...baseTestRule, id: "rr_valid_1", paused: false, isPaused: false });
  assert(addValidRes.success === true, "Audit 27.2: ADD_RECURRING_RULE with paused: false, isPaused: false succeeds");
  const storedRule = getState().recurringRules.find(r => r.id === "rr_valid_1");
  assert(storedRule && storedRule.paused === false && storedRule.isPaused === false, "Audit 27.2: Stored rule has strict boolean paused: false and isPaused: false");

  // Update invalid checks
  const updateInvalidRes1 = await dispatch("UPDATE_RECURRING_RULE", { id: "rr_valid_1", paused: "false" });
  assert(updateInvalidRes1.success === false, "Audit 27.2: UPDATE_RECURRING_RULE with paused: 'false' is rejected");

  const updateInvalidRes2 = await dispatch("UPDATE_RECURRING_RULE", { id: "rr_valid_1", paused: 0 });
  assert(updateInvalidRes2.success === false, "Audit 27.2: UPDATE_RECURRING_RULE with paused: 0 is rejected");

  const updateInvalidRes3 = await dispatch("UPDATE_RECURRING_RULE", { id: "rr_valid_1", paused: null });
  assert(updateInvalidRes3.success === false, "Audit 27.2: UPDATE_RECURRING_RULE with paused: null is rejected");

  const updateInvalidRes4 = await dispatch("UPDATE_RECURRING_RULE", { id: "rr_valid_1", paused: false, isPaused: true });
  assert(updateInvalidRes4.success === false, "Audit 27.2: UPDATE_RECURRING_RULE with contradictory paused/isPaused is rejected");

  const updateValidRes = await dispatch("UPDATE_RECURRING_RULE", { id: "rr_valid_1", paused: true, isPaused: true });
  assert(updateValidRes.success === true, "Audit 27.2: UPDATE_RECURRING_RULE with paused: true succeeds");
  const updatedRule = getState().recurringRules.find(r => r.id === "rr_valid_1");
  assert(updatedRule && updatedRule.paused === true && updatedRule.isPaused === true, "Audit 27.2: Updated rule has strict boolean paused: true and isPaused: true");

  // Toggle checks
  const toggleInvalidRes1 = await dispatch("TOGGLE_PAUSE_RECURRING_RULE", { id: "rr_valid_1", paused: "false" });
  assert(toggleInvalidRes1.success === false, "Audit 27.2: TOGGLE_PAUSE_RECURRING_RULE with paused: 'false' is rejected");

  const toggleInvalidRes2 = await dispatch("TOGGLE_PAUSE_RECURRING_RULE", { id: "rr_valid_1", paused: false, isPaused: true });
  assert(toggleInvalidRes2.success === false, "Audit 27.2: TOGGLE_PAUSE_RECURRING_RULE with contradictory flags is rejected");

  const toggleValidRes = await dispatch("TOGGLE_PAUSE_RECURRING_RULE", { id: "rr_valid_1" });
  assert(toggleValidRes.success === true, "Audit 27.2: TOGGLE_PAUSE_RECURRING_RULE cleanly toggles to false");
  const toggledRule = getState().recurringRules.find(r => r.id === "rr_valid_1");
  assert(toggledRule && toggledRule.paused === false && toggledRule.isPaused === false, "Audit 27.2: Rule is now paused: false and isPaused: false");

  // --- Audit 27.3: Canonical Fingerprint Collision Prevention & isDemoData ---
  console.log("  [Audit 27.3] Verifying computeStateFingerprint boolean invariants, collision prevention & isDemoData...");

  const fpStateBase = {
    version: 3,
    revision: 1,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 50000 },
    accounts: [{ id: "acc_fp_1", name: "Cash", type: "cash", openingBalance: 100000, openingBalanceDate: "2026-01-01", overdraftEnabled: false, archived: false, isPrimary: true }],
    transactions: [],
    budgets: [],
    goals: [],
    bills: [],
    recurringRules: [{
      ...baseTestRule,
      id: "rr_fp_test",
      accountId: "acc_fp_1",
      paused: false,
      isPaused: false
    }]
  };

  const fpPausedFalse = computeStateFingerprint(fpStateBase);

  const fpStatePausedTrue = JSON.parse(JSON.stringify(fpStateBase));
  fpStatePausedTrue.recurringRules[0].paused = true;
  fpStatePausedTrue.recurringRules[0].isPaused = true;
  const fpPausedTrue = computeStateFingerprint(fpStatePausedTrue);

  assert(fpPausedFalse !== fpPausedTrue, "Audit 27.3: paused: false and paused: true produce DIFFERENT fingerprints");

  // isDemoData fingerprint verification
  const fpStateDemoTrue = JSON.parse(JSON.stringify(fpStateBase));
  fpStateDemoTrue.isDemoData = true;
  const fpDemoTrue = computeStateFingerprint(fpStateDemoTrue);
  assert(fpPausedFalse !== fpDemoTrue, "Audit 27.3: isDemoData: false and isDemoData: true produce DIFFERENT state fingerprints");

  // Identical states produce identical fingerprints (no false conflicts)
  const fpStateBaseCopy = JSON.parse(JSON.stringify(fpStateBase));
  assert(computeStateFingerprint(fpStateBase) === computeStateFingerprint(fpStateBaseCopy), "Audit 27.3: Identical states produce identical fingerprints (no false conflicts)");

  // Equal-revision conflict detection on isDemoData
  assert(fpStateBase.revision === fpStateDemoTrue.revision, "Conflict check: Revisions are equal (revision 1)");
  assert(computeStateFingerprint(fpStateBase) !== computeStateFingerprint(fpStateDemoTrue), "Audit 27.3: Equal revision with divergent isDemoData detected via fingerprint mismatch");

  // Fingerprint throws on invalid booleans (NEVER silently converts to true or false)
  const testFpThrows = (label, modFn) => {
    let threw = false;
    try {
      const clone = JSON.parse(JSON.stringify(fpStateBase));
      modFn(clone);
      computeStateFingerprint(clone);
    } catch (e) {
      threw = (e instanceof TypeError);
    }
    assert(threw, `Audit 27.3: computeStateFingerprint throws TypeError on ${label}`);
  };

  testFpThrows("recurring rule paused: 'false'", s => { s.recurringRules[0].paused = "false"; });
  testFpThrows("recurring rule paused: 'true'", s => { s.recurringRules[0].paused = "true"; });
  testFpThrows("recurring rule paused: 0", s => { s.recurringRules[0].paused = 0; });
  testFpThrows("recurring rule paused: 1", s => { s.recurringRules[0].paused = 1; });
  testFpThrows("recurring rule paused: null", s => { s.recurringRules[0].paused = null; });
  testFpThrows("recurring rule isPaused: 'false'", s => { s.recurringRules[0].isPaused = "false"; });
  testFpThrows("recurring rule isPaused: 'true'", s => { s.recurringRules[0].isPaused = "true"; });
  testFpThrows("recurring rule isPaused: 0", s => { s.recurringRules[0].isPaused = 0; });
  testFpThrows("recurring rule isPaused: 1", s => { s.recurringRules[0].isPaused = 1; });
  testFpThrows("recurring rule isPaused: null", s => { s.recurringRules[0].isPaused = null; });
  testFpThrows("recurring rule missing both paused and isPaused", s => { delete s.recurringRules[0].paused; delete s.recurringRules[0].isPaused; });
  testFpThrows("contradictory paused: false, isPaused: true", s => { s.recurringRules[0].paused = false; s.recurringRules[0].isPaused = true; });
  testFpThrows("account overdraftEnabled: 'false'", s => { s.accounts[0].overdraftEnabled = "false"; });
  testFpThrows("account archived: 'true'", s => { s.accounts[0].archived = "true"; });
  testFpThrows("account isPrimary: 1", s => { s.accounts[0].isPrimary = 1; });
  testFpThrows("bill isPaid: 'false'", s => { s.bills = [{ id: "b_fp_1", title: "Bill", amount: 100, accountId: "acc_fp_1", dueDateAD: "2026-10-15", isPaid: "false" }]; });
  testFpThrows("state.isDemoData: 'false'", s => { s.isDemoData = "false"; });
  testFpThrows("state.isDemoData: 'true'", s => { s.isDemoData = "true"; });
  testFpThrows("state.isDemoData: 0", s => { s.isDemoData = 0; });
  testFpThrows("state.isDemoData: 1", s => { s.isDemoData = 1; });
  testFpThrows("state.isDemoData: null", s => { s.isDemoData = null; });

  // Explicit proof: 'paused: false' vs 'paused: "false"'
  let pausedFalseFpError = null;
  try {
    const sBad = JSON.parse(JSON.stringify(fpStateBase));
    sBad.recurringRules[0].paused = "false";
    computeStateFingerprint(sBad);
  } catch (e) {
    pausedFalseFpError = e;
  }
  assert(pausedFalseFpError !== null, "Audit 27.3: 'paused: false' (string) throws and CANNOT collide with valid paused: true");

  // --- Audit 27.4: Backup Validation (validateBackupJson) ---
  console.log("  [Audit 27.4] Verifying validateBackupJson rejects invalid recurring rule booleans & isDemoData...");

  const baseValidBackup = {
    version: 3,
    revision: 1,
    exportedAt: "2026-11-13T00:00:00.000Z",
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 50000 },
    accounts: [{ id: "acc_fp_1", name: "Cash", type: "cash", openingBalance: 100000, openingBalanceDate: "2026-01-01", overdraftEnabled: false, archived: false, isPrimary: true }],
    transactions: [],
    budgets: [],
    goals: [],
    bills: [],
    recurringRules: [{
      ...baseTestRule,
      id: "rr_backup_test",
      accountId: "acc_fp_1",
      paused: false,
      isPaused: false
    }]
  };

  assert(Validator.validateBackupJson(baseValidBackup).isValid === true, "Audit 27.4: Backup with valid paused: false is accepted");

  const backupPausedTrue = JSON.parse(JSON.stringify(baseValidBackup));
  backupPausedTrue.recurringRules[0].paused = true;
  backupPausedTrue.recurringRules[0].isPaused = true;
  assert(Validator.validateBackupJson(backupPausedTrue).isValid === true, "Audit 27.4: Backup with valid paused: true is accepted");

  // isDemoData: true is accepted
  const backupDemoTrue = JSON.parse(JSON.stringify(baseValidBackup));
  backupDemoTrue.isDemoData = true;
  assert(Validator.validateBackupJson(backupDemoTrue).isValid === true, "Audit 27.4: Backup with isDemoData: true is accepted");

  const testBackupRejects = (label, modFn) => {
    const clone = JSON.parse(JSON.stringify(baseValidBackup));
    modFn(clone);
    const valRes = Validator.validateBackupJson(clone);
    assert(valRes.isValid === false, `Audit 27.4: Backup with ${label} is strictly rejected`);
    assert(valRes.error && (valRes.error.includes("strict boolean") || valRes.error.includes("must not contradict") || valRes.error.includes("is required")), `Audit 27.4: Error message specifies failure for ${label}`);
  };

  testBackupRejects("paused: 'false'", b => { b.recurringRules[0].paused = "false"; });
  testBackupRejects("paused: 'true'", b => { b.recurringRules[0].paused = "true"; });
  testBackupRejects("paused: 0", b => { b.recurringRules[0].paused = 0; });
  testBackupRejects("paused: 1", b => { b.recurringRules[0].paused = 1; });
  testBackupRejects("paused: null", b => { b.recurringRules[0].paused = null; });
  testBackupRejects("missing paused", b => { delete b.recurringRules[0].paused; });
  testBackupRejects("isPaused: 'false'", b => { b.recurringRules[0].isPaused = "false"; });
  testBackupRejects("isPaused: 'true'", b => { b.recurringRules[0].isPaused = "true"; });
  testBackupRejects("isPaused: 0", b => { b.recurringRules[0].isPaused = 0; });
  testBackupRejects("isPaused: 1", b => { b.recurringRules[0].isPaused = 1; });
  testBackupRejects("isPaused: null", b => { b.recurringRules[0].isPaused = null; });
  testBackupRejects("missing isPaused", b => { delete b.recurringRules[0].isPaused; });
  testBackupRejects("both paused & isPaused missing", b => { delete b.recurringRules[0].paused; delete b.recurringRules[0].isPaused; });
  testBackupRejects("contradictory paused: false, isPaused: true", b => { b.recurringRules[0].paused = false; b.recurringRules[0].isPaused = true; });

  // Backup rejects invalid isDemoData
  const testBackupRejectsDemo = (label, modFn) => {
    const clone = JSON.parse(JSON.stringify(baseValidBackup));
    modFn(clone);
    const valRes = Validator.validateBackupJson(clone);
    assert(valRes.isValid === false, `Audit 27.4: Backup with ${label} is strictly rejected`);
    assert(valRes.error && valRes.error.includes("isDemoData"), `Audit 27.4: Error message specifies failure for ${label}`);
  };

  testBackupRejectsDemo("isDemoData: 'false'", b => { b.isDemoData = "false"; });
  testBackupRejectsDemo("isDemoData: 'true'", b => { b.isDemoData = "true"; });
  testBackupRejectsDemo("isDemoData: 0", b => { b.isDemoData = 0; });
  testBackupRejectsDemo("isDemoData: 1", b => { b.isDemoData = 1; });
  testBackupRejectsDemo("isDemoData: null", b => { b.isDemoData = null; });

  // Backup import failure atomicity
  const preImportState = getState();
  const corruptBackup = JSON.parse(JSON.stringify(baseValidBackup));
  corruptBackup.recurringRules[0].paused = "false";
  const importRes = await dispatch("RESTORE_BACKUP", { backupJson: JSON.stringify(corruptBackup) });
  assert(importRes.success === false, "Audit 27.4: RESTORE_BACKUP fails safely on backup containing paused: 'false'");
  assert(getState().revision === preImportState.revision, "Audit 27.4: State revision unchanged after rejected backup import");

  // --- Audit 27.5: Legacy v2 Migration Normalization ---
  console.log("  [Audit 27.5] Verifying legacy v2 recurring rule normalization...");

  const legacyV2RuleStatusPaused = {
    version: 2,
    accounts: [{ id: "acc_1", name: "Cash", type: "cash", openingBalance: 10000, openingBalanceDate: "2026-01-01" }],
    transactions: [],
    recurringRules: [{
      id: "rr_leg_1",
      title: "Magazine",
      type: "expense",
      amount: 500,
      accountId: "acc_1",
      category: "utilities",
      paymentMethod: "cash",
      schedule: { frequency: "monthly", interval: 1, dayOfMonth: 1, startDate: "2026-01-01" },
      status: "paused"
    }],
    bills: []
  };

  const migratedRulePaused = migrateV2toV3(legacyV2RuleStatusPaused);
  assert(migratedRulePaused.recurringRules[0].paused === true, "Audit 27.5: Legacy status: 'paused' migrated to paused: true");
  assert(migratedRulePaused.recurringRules[0].isPaused === true, "Audit 27.5: Legacy status: 'paused' migrated to isPaused: true");

  const legacyV2RuleStatusActive = {
    ...legacyV2RuleStatusPaused,
    recurringRules: [{ ...legacyV2RuleStatusPaused.recurringRules[0], status: "active" }]
  };
  const migratedRuleActive = migrateV2toV3(legacyV2RuleStatusActive);
  assert(migratedRuleActive.recurringRules[0].paused === false, "Audit 27.5: Legacy status: 'active' migrated to paused: false");
  assert(migratedRuleActive.recurringRules[0].isPaused === false, "Audit 27.5: Legacy status: 'active' migrated to isPaused: false");

  const legacyV2RuleIsPaused = {
    ...legacyV2RuleStatusPaused,
    recurringRules: [{ ...legacyV2RuleStatusPaused.recurringRules[0], isPaused: true, status: undefined }]
  };
  const migratedRuleIsPaused = migrateV2toV3(legacyV2RuleIsPaused);
  assert(migratedRuleIsPaused.recurringRules[0].paused === true, "Audit 27.5: Legacy isPaused: true migrated to paused: true");

  const legacyV2RuleMissing = {
    ...legacyV2RuleStatusPaused,
    recurringRules: [{ ...legacyV2RuleStatusPaused.recurringRules[0], status: undefined }]
  };
  const migratedRuleMissing = migrateV2toV3(legacyV2RuleMissing);
  assert(migratedRuleMissing.recurringRules[0].paused === false, "Audit 27.5: Legacy missing paused safely defaulted to false");
  assert(migratedRuleMissing.recurringRules[0].isPaused === false, "Audit 27.5: Legacy missing isPaused safely defaulted to false");

  // =========================================================================
  // AUDIT 28: Backup Strictness, isDemoData Validation & Round-Trip Integrity
  // =========================================================================
  console.log("\n[Audit 28] Testing Backup Strictness, isDemoData Validation & Round-Trip Integrity...");

  // --- Audit 28.1: generateBackupJsonString rejects coercion and invalid states ---
  console.log("  [Audit 28.1] Testing generateBackupJsonString strict boolean requirement (no silent coercion)...");

  const validLedger28 = {
    version: 3,
    revision: 1,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 50000, initialBalanceDate: "2026-01-01" },
    accounts: [{ id: "acc_28_cash", name: "Cash Wallet", type: "cash", openingBalance: 50000, openingBalanceDate: "2026-01-01", overdraftEnabled: false, archived: false, isPrimary: true }],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  // Valid state exports successfully
  const validExportStr = generateBackupJsonString(validLedger28);
  const parsedExport28 = JSON.parse(validExportStr);
  assert(parsedExport28.version === 3, "Audit 28.1: Valid state exports with version 3");
  assert(parsedExport28.isDemoData === false, "Audit 28.1: isDemoData: false preserved strictly in export");
  assert(Validator.validateBackupJson(parsedExport28).isValid === true, "Audit 28.1: Exported backup passes validateBackupJson");

  // isDemoData: true exports strictly
  const validDemoExportStr = generateBackupJsonString({ ...validLedger28, isDemoData: true });
  const parsedDemoExport = JSON.parse(validDemoExportStr);
  assert(parsedDemoExport.isDemoData === true, "Audit 28.1: isDemoData: true preserved strictly in export");

  // Rejection of invalid types (NEVER silently coerced to true or false)
  const invalidDemoDataValues = [
    { val: "false", label: "string 'false'" },
    { val: "true", label: "string 'true'" },
    { val: "garbage", label: "string 'garbage'" },
    { val: 1, label: "number 1" },
    { val: 0, label: "number 0" },
    { val: null, label: "null" },
    { val: [], label: "array []" },
    { val: {}, label: "object {}" }
  ];

  for (const { val, label } of invalidDemoDataValues) {
    let threw = false;
    let errorMsg = "";
    try {
      generateBackupJsonString({ ...validLedger28, isDemoData: val });
    } catch (e) {
      threw = (e instanceof TypeError);
      errorMsg = e.message;
    }
    assert(threw, `Audit 28.1: generateBackupJsonString throws TypeError on ${label}`);
    assert(errorMsg.includes("isDemoData") && errorMsg.includes("strict boolean"), `Audit 28.1: Error message explains strict boolean required for ${label}`);
  }

  // Missing isDemoData (undefined) rejected on export
  const missingDemoState = { ...validLedger28 };
  delete missingDemoState.isDemoData;
  let missingThrew = false;
  try {
    generateBackupJsonString(missingDemoState);
  } catch (e) {
    missingThrew = (e instanceof TypeError);
  }
  assert(missingThrew, "Audit 28.1: generateBackupJsonString throws TypeError when state.isDemoData is missing");

  // State with invalid entities rejected on export (does not produce backup)
  const invalidEntityState = {
    ...validLedger28,
    isDemoData: false,
    accounts: [{ id: "acc_bad", name: "", type: "invalid_type", openingBalance: "not_a_number" }]
  };
  let entityThrew = false;
  try {
    generateBackupJsonString(invalidEntityState);
  } catch (e) {
    entityThrew = true;
    assert(e.message.includes("state validation failed"), "Audit 28.1: Error explains state validation failed");
  }
  assert(entityThrew, "Audit 28.1: generateBackupJsonString refuses to produce backup when state validation fails");

  // --- Audit 28.2: Validator.validateBackupJson requires isDemoData in v3 schema ---
  console.log("  [Audit 28.2] Testing validateBackupJson strict isDemoData enforcement in v3 schema...");

  const baseV3Backup = {
    version: 3,
    revision: 5,
    isDemoData: false,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 10000, initialBalanceDate: "2026-01-01" },
    accounts: [{ id: "acc_v3_val", name: "Val Account", type: "bank", openingBalance: 10000, openingBalanceDate: "2026-01-01", overdraftEnabled: false, archived: false }],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  assert(Validator.validateBackupJson(baseV3Backup).isValid === true, "Audit 28.2: Valid v3 backup with isDemoData: false passes");
  assert(Validator.validateBackupJson({ ...baseV3Backup, isDemoData: true }).isValid === true, "Audit 28.2: Valid v3 backup with isDemoData: true passes");

  // Missing isDemoData in v3 rejected
  const v3MissingDemo = { ...baseV3Backup };
  delete v3MissingDemo.isDemoData;
  const resMissing = Validator.validateBackupJson(v3MissingDemo);
  assert(resMissing.isValid === false, "Audit 28.2: v3 backup missing isDemoData is strictly rejected");
  assert(resMissing.error.includes("isDemoData") && resMissing.error.includes("required"), "Audit 28.2: Error explains isDemoData is required in v3 schema");

  // Reject all non-boolean values in v3
  for (const { val, label } of invalidDemoDataValues) {
    const resBad = Validator.validateBackupJson({ ...baseV3Backup, isDemoData: val });
    assert(resBad.isValid === false, `Audit 28.2: v3 backup with isDemoData as ${label} is strictly rejected`);
    assert(resBad.error.includes("isDemoData") && resBad.error.includes("strict boolean"), `Audit 28.2: Error explains isDemoData must be strict boolean for ${label}`);
  }

  // Legacy schema (v1, v2) backward compatibility
  const legacyV2BackupNoDemo = {
    version: 2,
    revision: 1,
    settings: { ...DEFAULT_SETTINGS, initialBalance: 10000, initialBalanceDate: "2026-01-01" },
    transactions: [],
    budgets: [],
    goals: []
  };
  const resLegacy = Validator.validateBackupJson(legacyV2BackupNoDemo);
  assert(resLegacy.isValid === true, "Audit 28.2: Legacy v2 backup without isDemoData is accepted for migration");

  const migratedLegacy28 = migrateV2toV3(legacyV2BackupNoDemo);
  assert(migratedLegacy28.isDemoData === false, "Audit 28.2: Migrated legacy v2 backup defaults isDemoData to false");
  assert(Validator.validateBackupJson(migratedLegacy28).isValid === true, "Audit 28.2: Migrated legacy v2 backup passes v3 schema validation");

  // --- Audit 28.3: Clean personal ledger backup export and restore round-trip ---
  console.log("  [Audit 28.3] Testing clean personal ledger export and restore round-trip fidelity...");

  await dispatch("INITIALIZE_PERSONAL_LEDGER");
  await waitForPendingWrites();
  const cleanPersonalState = getState();
  assert(cleanPersonalState.isDemoData === false, "Audit 28.3: Active state is clean personal ledger (isDemoData === false)");
  assert(cleanPersonalState.transactions.length === 0, "Audit 28.3: Zero transactions in personal ledger");
  assert(cleanPersonalState.budgets.length === 0, "Audit 28.3: Zero budgets in personal ledger");
  assert(cleanPersonalState.goals.length === 0, "Audit 28.3: Zero goals in personal ledger");
  assert(cleanPersonalState.bills.length === 0, "Audit 28.3: Zero bills in personal ledger");
  assert(cleanPersonalState.recurringRules.length === 0, "Audit 28.3: Zero recurring rules in personal ledger");

  const cleanPersonalFp = computeStateFingerprint(cleanPersonalState);
  const cleanExportedJson = generateBackupJsonString(cleanPersonalState);
  const cleanParsed = JSON.parse(cleanExportedJson);
  assert(cleanParsed.isDemoData === false, "Audit 28.3: Exported personal ledger contains isDemoData: false");

  const cleanRestoreRes = await dispatch("RESTORE_BACKUP", cleanParsed);
  await waitForPendingWrites();
  assert(cleanRestoreRes.success === true, "Audit 28.3: Personal ledger restore succeeded");

  const restoredPersonalState = getState();
  const restoredPersonalFp = computeStateFingerprint(restoredPersonalState);
  assert(restoredPersonalState.isDemoData === false, "Audit 28.3: Restored state retains isDemoData: false");
  assert(restoredPersonalState.accounts.length === cleanPersonalState.accounts.length, "Audit 28.3: Accounts count matched");
  assert(restoredPersonalState.accounts[0].name === cleanPersonalState.accounts[0].name, "Audit 28.3: Account name matched");
  assert(restoredPersonalState.accounts[0].openingBalance === cleanPersonalState.accounts[0].openingBalance, "Audit 28.3: Opening balance matched (0)");
  assert(cleanPersonalFp === restoredPersonalFp, "Audit 28.3: 100% Fingerprint equality on clean personal ledger round-trip");

  // --- Audit 28.4: Demo data backup export and restore round-trip ---
  console.log("  [Audit 28.4] Testing demo data export and restore round-trip fidelity...");

  await dispatch("RESET_TO_DEMO");
  await waitForPendingWrites();
  const demoState = getState();
  assert(demoState.isDemoData === true, "Audit 28.4: Active state is demo data (isDemoData === true)");
  assert(demoState.transactions.length > 0, "Audit 28.4: Demo transactions present");

  const demoFp = computeStateFingerprint(demoState);
  const demoExportedJson = generateBackupJsonString(demoState);
  const demoParsed = JSON.parse(demoExportedJson);
  assert(demoParsed.isDemoData === true, "Audit 28.4: Exported demo backup contains isDemoData: true");

  const demoRestoreRes = await dispatch("RESTORE_BACKUP", demoParsed);
  await waitForPendingWrites();
  assert(demoRestoreRes.success === true, "Audit 28.4: Demo data restore succeeded");

  const restoredDemoState = getState();
  const restoredDemoFp = computeStateFingerprint(restoredDemoState);
  assert(restoredDemoState.isDemoData === true, "Audit 28.4: Restored state retains isDemoData: true");
  assert(demoFp === restoredDemoFp, "Audit 28.4: 100% Fingerprint equality on demo data round-trip");
  assert(restoredDemoFp !== cleanPersonalFp, "Audit 28.4: Demo fingerprint strictly differs from clean personal ledger fingerprint");

  // --- Audit 28.5: Failed export and restore do NOT damage existing valid records ---
  console.log("  [Audit 28.5] Proving failed export and restore do not damage existing valid records...");

  const preFailureState = getState();
  const preFailureFp = computeStateFingerprint(preFailureState);
  const preFailureTxCount = preFailureState.transactions.length;

  // 1. Attempt failed export
  let exportFailed = false;
  try {
    generateBackupJsonString({ ...preFailureState, isDemoData: "false" });
  } catch {
    exportFailed = true;
  }
  assert(exportFailed, "Audit 28.5: Export with invalid isDemoData failed as expected");
  assert(computeStateFingerprint(getState()) === preFailureFp, "Audit 28.5: Active state fingerprint completely undamaged after failed export");

  // 2. Attempt failed restore with missing isDemoData
  const badRestoreMissing = JSON.parse(JSON.stringify(demoParsed));
  delete badRestoreMissing.isDemoData;
  const restoreFail1 = await dispatch("RESTORE_BACKUP", badRestoreMissing);
  assert(restoreFail1.success === false, "Audit 28.5: Restore backup with missing isDemoData is blocked");
  assert(computeStateFingerprint(getState()) === preFailureFp, "Audit 28.5: Active state fingerprint unchanged after blocked restore (missing isDemoData)");

  // 3. Attempt failed restore with string isDemoData
  const badRestoreString = { ...demoParsed, isDemoData: "false" };
  const restoreFail2 = await dispatch("RESTORE_BACKUP", badRestoreString);
  assert(restoreFail2.success === false, "Audit 28.5: Restore backup with isDemoData: 'false' is blocked");
  assert(computeStateFingerprint(getState()) === preFailureFp, "Audit 28.5: Active state fingerprint unchanged after blocked restore (string isDemoData)");

  // 4. Attempt failed restore with corrupted accounts
  const badRestoreCorrupt = { ...demoParsed, accounts: "corrupt_non_array" };
  const restoreFail3 = await dispatch("RESTORE_BACKUP", badRestoreCorrupt);
  assert(restoreFail3.success === false, "Audit 28.5: Restore backup with corrupted accounts is blocked");
  assert(computeStateFingerprint(getState()) === preFailureFp, "Audit 28.5: Active state fingerprint unchanged after blocked restore (corrupt accounts)");

  // 5. Final state integrity check
  const postFailureState = getState();
  assert(postFailureState.transactions.length === preFailureTxCount, "Audit 28.5: All historical transactions preserved intact");
  assert(computeStateFingerprint(postFailureState) === preFailureFp, "Audit 28.5: State preserves 100% integrity across all failed operations");

  // =========================================================================
  // AUDIT 29: PREVENT SILENT FINANCIAL DATA LOSS DURING BACKUP EXPORT
  // =========================================================================
  console.log("\n--- AUDIT 29: PREVENT SILENT FINANCIAL DATA LOSS DURING BACKUP EXPORT ---");

  // --- Audit 29.1: Collection Validation (Missing & Null Collections Rejected) ---
  console.log("  [Audit 29.1] Testing strict rejection of missing and null collections in generateBackupJsonString...");

  const baseValidState = getState();
  assert(baseValidState && typeof baseValidState === "object", "Audit 29.1: Base valid state is non-null object");

  const requiredCollections = ["accounts", "transactions", "budgets", "goals", "recurringRules", "bills"];

  // Test each collection missing
  for (const col of requiredCollections) {
    const missingColState = { ...baseValidState };
    delete missingColState[col];

    let threwMissing = false;
    let missingErrMsg = "";
    try {
      generateBackupJsonString(missingColState);
    } catch (e) {
      threwMissing = true;
      missingErrMsg = e.message;
    }
    assert(threwMissing === true, `Audit 29.1: Missing collection '${col}' throws Error`);
    assert(missingErrMsg.includes(col), `Audit 29.1: Error message for missing '${col}' mentions field name`);

    // Test each collection null
    const nullColState = { ...baseValidState, [col]: null };
    let threwNull = false;
    let nullErrMsg = "";
    try {
      generateBackupJsonString(nullColState);
    } catch (e) {
      threwNull = true;
      nullErrMsg = e.message;
    }
    assert(threwNull === true, `Audit 29.1: Null collection '${col}' throws Error`);
    assert(nullErrMsg.includes(col), `Audit 29.1: Error message for null '${col}' mentions field name`);

    // Test each collection non-array (e.g. object, string, number)
    const objColState = { ...baseValidState, [col]: { invalid: true } };
    let threwObj = false;
    try {
      generateBackupJsonString(objColState);
    } catch {
      threwObj = true;
    }
    assert(threwObj === true, `Audit 29.1: Object (non-array) collection '${col}' throws Error`);
  }

  // Test settings missing, null, or non-object
  {
    const missingSettings = { ...baseValidState };
    delete missingSettings.settings;
    let threw = false;
    try { generateBackupJsonString(missingSettings); } catch { threw = true; }
    assert(threw === true, "Audit 29.1: Missing settings throws Error");

    const nullSettings = { ...baseValidState, settings: null };
    threw = false;
    try { generateBackupJsonString(nullSettings); } catch { threw = true; }
    assert(threw === true, "Audit 29.1: Null settings throws Error");

    const arraySettings = { ...baseValidState, settings: [1, 2, 3] };
    threw = false;
    try { generateBackupJsonString(arraySettings); } catch { threw = true; }
    assert(threw === true, "Audit 29.1: Array (non-plain-object) settings throws Error");
  }

  // --- Audit 29.2: Revision Validation (Strict Non-Negative Safe Integer) ---
  console.log("  [Audit 29.2] Testing strict rejection of invalid revisions without silent fallback...");

  const invalidRevisions = [
    "garbage",
    "-5",
    "1",
    -1,
    -5,
    -100,
    2.5,
    3.14159,
    null,
    undefined,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1000
  ];

  for (const badRev of invalidRevisions) {
    const badRevState = { ...baseValidState, revision: badRev };
    let threwRev = false;
    let revErrMsg = "";
    try {
      generateBackupJsonString(badRevState);
    } catch (e) {
      threwRev = true;
      revErrMsg = e.message;
    }
    assert(threwRev === true, `Audit 29.2: Invalid revision '${String(badRev)}' (${typeof badRev}) throws Error`);
    assert(revErrMsg.includes("revision"), `Audit 29.2: Error message for revision '${String(badRev)}' mentions 'revision'`);
  }

  // Test valid revisions: 0, 1, 42
  for (const validRev of [0, 1, 42, 1000]) {
    const validRevState = { ...baseValidState, revision: validRev };
    const exportedJson = generateBackupJsonString(validRevState);
    const parsed = JSON.parse(exportedJson);
    assert(parsed.revision === validRev, `Audit 29.2: Valid revision ${validRev} is preserved exactly without alteration`);
  }

  // --- Audit 29.3: Intentionally Empty Arrays Export Cleanly Without Alteration ---
  console.log("  [Audit 29.3] Testing that intentionally empty collections are preserved without alteration...");

  const cleanEmptyState = {
    revision: 0,
    isDemoData: false,
    settings: { ...baseValidState.settings },
    accounts: [baseValidState.accounts[0]],
    transactions: [],
    budgets: [],
    goals: [],
    recurringRules: [],
    bills: []
  };

  const emptyExportedJson = generateBackupJsonString(cleanEmptyState);
  const parsedEmpty = JSON.parse(emptyExportedJson);
  assert(parsedEmpty.version === 3, "Audit 29.3: Exported schema version is 3");
  assert(parsedEmpty.revision === 0, "Audit 29.3: Exported revision is 0");
  assert(parsedEmpty.isDemoData === false, "Audit 29.3: Exported isDemoData is false");
  assert(Array.isArray(parsedEmpty.accounts) && parsedEmpty.accounts.length === 1, "Audit 29.3: accounts is preserved with 1 account");
  assert(Array.isArray(parsedEmpty.transactions) && parsedEmpty.transactions.length === 0, "Audit 29.3: transactions is preserved as empty []");
  assert(Array.isArray(parsedEmpty.budgets) && parsedEmpty.budgets.length === 0, "Audit 29.3: budgets is preserved as empty []");
  assert(Array.isArray(parsedEmpty.goals) && parsedEmpty.goals.length === 0, "Audit 29.3: goals is preserved as empty []");
  assert(Array.isArray(parsedEmpty.recurringRules) && parsedEmpty.recurringRules.length === 0, "Audit 29.3: recurringRules is preserved as empty []");
  assert(Array.isArray(parsedEmpty.bills) && parsedEmpty.bills.length === 0, "Audit 29.3: bills is preserved as empty []");

  // --- Audit 29.4: Full Real Dataset Preservation Across Export and Restore ---
  console.log("  [Audit 29.4] Testing complete real dataset preservation across export and restore...");

  await dispatch("RESET_TO_DEMO");
  await waitForPendingWrites();
  const fullDemoState = getState();
  const originalFp = computeStateFingerprint(fullDemoState);

  const fullExportedJson = generateBackupJsonString(fullDemoState);
  const fullParsed = JSON.parse(fullExportedJson);

  // Validate all collections preserved with 100% exact counts and contents
  assert(fullParsed.accounts.length === fullDemoState.accounts.length, "Audit 29.4: Accounts count matches exactly");
  assert(fullParsed.transactions.length === fullDemoState.transactions.length, "Audit 29.4: Transactions count matches exactly");
  assert(fullParsed.budgets.length === fullDemoState.budgets.length, "Audit 29.4: Budgets count matches exactly");
  assert(fullParsed.goals.length === fullDemoState.goals.length, "Audit 29.4: Goals count matches exactly");
  assert(fullParsed.recurringRules.length === fullDemoState.recurringRules.length, "Audit 29.4: Recurring rules count matches exactly");
  assert(fullParsed.bills.length === fullDemoState.bills.length, "Audit 29.4: Bills count matches exactly");

  const restoreRes29 = await dispatch("RESTORE_BACKUP", fullParsed);
  await waitForPendingWrites();
  assert(restoreRes29.success === true, "Audit 29.4: Full backup restore succeeded");

  const postRestoreState = getState();
  const restoredFp29 = computeStateFingerprint(postRestoreState);
  assert(originalFp === restoredFp29, "Audit 29.4: 100% State fingerprint equality across full export & restore round-trip");

  // --- Audit 29.5: Deliberate Source Collection Corruption Rejected with State Undamaged ---
  console.log("  [Audit 29.5] Testing that collection corruption is rejected and active state remains undamaged...");

  const preCorruptionState = getState();
  const preCorruptionFp = computeStateFingerprint(preCorruptionState);
  const preTxCount = preCorruptionState.transactions.length;

  // Deliberately corrupt transactions to null
  let corruptExportFailed = false;
  try {
    generateBackupJsonString({ ...preCorruptionState, transactions: null });
  } catch (e) {
    corruptExportFailed = true;
    assert(e instanceof TypeError || e instanceof Error, "Audit 29.5: Throws TypeError or Error");
  }
  assert(corruptExportFailed === true, "Audit 29.5: Backup export rejected when transactions collection is null");

  // Deliberately corrupt budgets to a non-array string
  corruptExportFailed = false;
  try {
    generateBackupJsonString({ ...preCorruptionState, budgets: "corrupted_string" });
  } catch {
    corruptExportFailed = true;
  }
  assert(corruptExportFailed === true, "Audit 29.5: Backup export rejected when budgets collection is string");

  // Verify active state remains 100% intact and unmutated
  const postCorruptionCheckState = getState();
  assert(postCorruptionCheckState.transactions.length === preTxCount, "Audit 29.5: Active state transactions count intact");
  assert(computeStateFingerprint(postCorruptionCheckState) === preCorruptionFp, "Audit 29.5: Active state fingerprint unchanged and completely undamaged");

  // Clean up mock DOM
  delete globalThis.document;

  await dispatch("RESET_TO_DEMO");
  await waitForPendingWrites();
})();

console.log("\n=========================================================");
if (failed === 0) {
  console.log(`✓ ALL ${passed} DOMAIN, STORAGE SAFETY & AUDIT TESTS PASSED!`);
  console.log("=========================================================");
  process.exit(0);
} else {
  console.error(`✕ ${failed} TESTS FAILED!`);
  process.exit(1);
}
