/**
 * MeroHisab — Domain Logic, Storage Safety & Accounting Invariants Suite (v3 Audited)
 */
import { getDemoData } from "../js/core/demo-data.js";
import { calculateFinancialSummary } from "../js/services/transactions.js";
import { getBudgetAnalysis } from "../js/services/budgets.js";
import { getGoalsAnalysis } from "../js/services/goals.js";
import { Validator } from "../js/core/validator.js";
import { StorageService } from "../js/core/storage.js";
import { STORAGE_KEYS } from "../js/core/constants.js";
import {
  __configureMockIdb,
  __disableMockIdb,
  getStoredState
} from "../js/utils/indexed-db.js";
import {
  init,
  hydrateFromIndexedDB,
  getState,
  dispatch,
  calculateAccountBalance,
  computeNextOccurrence,
  getMissedOccurrences,
  computeBillStatus
} from "../js/core/state.js";

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

dispatch("RESET_TO_DEMO");
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
const addAccRes = dispatch("ADD_ACCOUNT", {
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
const overdraftExp = dispatch("ADD_TRANSACTION", {
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
dispatch("ADD_TRANSACTION", {
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
const sumAccountBalances = stateMulti.accounts.reduce((s, a) => s + calculateAccountBalance(stateMulti, a.id), 0);
const multiSummary = calculateFinancialSummary(stateMulti, "2026-10");
assert(
  multiSummary.estimatedLedgerBalance === sumAccountBalances,
  `Audit 1C: Global Ledger (${multiSummary.estimatedLedgerBalance}) matches exact sum of account balances (${sumAccountBalances}) across different opening dates`
);
dispatch("DELETE_TRANSACTION", "tx_pre_open_esewa");

// Valid transfer of 5000 from Cash Wallet to eSewa
const validTr = dispatch("ADD_TRANSFER", {
  fromAccountId: cashId,
  toAccountId: esewaId,
  amount: 5000,
  dateAD: "2026-10-28",
  description: "Load eSewa from Cash"
});
assert(validTr.success, "Valid transfer of रु 5,000 from Cash to eSewa succeeded");

// Edit transfer atomically
const editTr = dispatch("UPDATE_TRANSFER", {
  transferId: validTr.transferId,
  amount: 6000
});
assert(editTr.success && calculateAccountBalance(getState(), esewaId) === 6000, "Atomic transfer edit updated both legs to रु 6,000");

// Delete transfer atomically
const delTr = dispatch("DELETE_TRANSACTION", validTr.outLeg.id);
assert(delTr.success, "Deleting one leg of a transfer succeeded");
assert(calculateAccountBalance(getState(), cashId) === 102450 && calculateAccountBalance(getState(), esewaId) === 0, "Both transfer legs deleted atomically and balances restored");

// Historic / Archived account opening balance restriction
dispatch("ARCHIVE_ACCOUNT", { id: esewaId, archive: true });
const editArchivedBal = dispatch("UPDATE_ACCOUNT", { id: esewaId, openingBalance: 9999 });
assert(!editArchivedBal.success, "Archived account openingBalance modification is blocked");
dispatch("ARCHIVE_ACCOUNT", { id: esewaId, archive: false });
dispatch("DELETE_ACCOUNT", esewaId);

console.log("\n[5] Testing Recurring Transactions, Day-31 Preservation & Backlog Catch-Up...");
const sched31 = { frequency: "monthly", interval: 1, dayOfMonth: 31, startDate: "2026-01-31" };
const occ1 = computeNextOccurrence(sched31, "2026-01-31");
const occ2 = computeNextOccurrence(sched31, occ1);
const occ3 = computeNextOccurrence(sched31, occ2);
assert(occ1 === "2026-02-28" && occ2 === "2026-03-31" && occ3 === "2026-04-30", `Day-31 schedule preserves day across months: Jan 31 -> ${occ1} -> ${occ2} -> ${occ3}`);

const addRr = dispatch("ADD_RECURRING_RULE", {
  title: "Worldlink ISP",
  type: "expense",
  accountId: cashId,
  amount: 1500,
  category: "internet_mobile",
  schedule: { frequency: "monthly", interval: 1, dayOfMonth: 15, startDate: "2026-08-15" }
});
const missed = getMissedOccurrences(addRr.rule, "2026-10-20");
assert(missed.length === 3 && missed[0] === "2026-08-15" && missed[2] === "2026-10-15", `Backlog catch-up identified 3 missed occurrences (${missed.join(", ")})`);
const postRr = dispatch("PROCESS_RECURRING_OCCURRENCE", { id: addRr.rule.id });
assert(postRr.success && postRr.nextOccurrence === "2026-09-15", "Confirming recurring occurrence creates transaction and advances nextOccurrence atomically");

console.log("\n[6] Testing Bills, Atomic Payment & Status Recalculation (Audit 1E)...");
const addBillRes = dispatch("ADD_BILL", {
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

const payRes1 = dispatch("PAY_BILL", { id: billId, dateAD: "2026-10-20" });
assert(payRes1.success && payRes1.nextBill && payRes1.nextBill.dueDateAD === "2026-11-05", "Paying recurring bill atomically records expense and spawns next month's unpaid bill");

const payRes2 = dispatch("PAY_BILL", { id: billId, dateAD: "2026-10-20" });
assert(!payRes2.success, "Paying an already-paid bill a second time is blocked (idempotent)");

dispatch("DELETE_TRANSACTION", payRes1.transaction.id);
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
const blockedMut = dispatch("ADD_ACCOUNT", { name: "Blocked", type: "cash", openingBalance: 0, openingBalanceDate: "2026-10-01" });
assert(!blockedMut.success, "Audit 1A: Mutations are blocked while in recoveryMode to prevent overwriting corrupted storage");

// Restore clean demo state after corruption test
dispatch("RESET_TO_DEMO");

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
  // Prepare a real user v3 ledger (non-demo) with रु 77,777 in Nabil Bank
  const realUserLedger = {
    version: 3,
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

  // Scenario D: Both stores are genuinely empty -> first-run demo initialization occurs once
  StorageService.clear();
  __configureMockIdb({ initialData: null });
  init();
  const resD = await hydrateFromIndexedDB();
  assert(resD.status === "initialized_first_run_demo" && getState().isDemoData === true, "Scenario D: First-run demo data initialized only after both IDB and LS confirmed empty");

  // Scenario E: LocalStorage contains corrupted JSON; IndexedDB contains valid data
  const corruptRaw = "{broken_json_payload_do_not_overwrite";
  StorageService.setRawItem(STORAGE_KEYS.APP_DATA, corruptRaw);
  __configureMockIdb({ initialData: realUserLedger });
  init();
  const resE = await hydrateFromIndexedDB();
  assert(resE.status === "corrupt" && getState().recoveryMode === true && StorageService.getRawItem(STORAGE_KEYS.APP_DATA) === corruptRaw, "Scenario E: Corrupted LocalStorage enters explicit recoveryMode, preserves raw LS string, and exposes IDB recoverable state");

  // Scenario F: IndexedDB has valid real data; LocalStorage contains stale/divergent data (with newer timestamp!)
  const staleLsData = JSON.parse(JSON.stringify(realUserLedger));
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
  const mutG = dispatch("ADD_TRANSACTION", { type: "income", accountId: "acc_real_bank", amount: 500, category: "gift", description: "Fallback write", dateAD: "2026-10-12", paymentMethod: "cash" });
  assert(mutG.success && StorageService.getItem(STORAGE_KEYS.APP_DATA).transactions.length === 2, "Scenario G: When IndexedDB write fails, verified LocalStorage fallback preserves state");

  // Scenario H: Application reload after a successful real-data session
  __configureMockIdb({ initialData: getState(), writeFailure: false });
  init();
  await hydrateFromIndexedDB();
  assert(getState().isDemoData === false && getState().transactions.length === 2 && calculateAccountBalance(getState(), "acc_real_bank") === 88277, "Scenario H: Application reload after real-data session preserves all records (रु 88,277)");

  __disableMockIdb();
  dispatch("RESET_TO_DEMO");
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
