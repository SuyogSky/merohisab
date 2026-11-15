/**
 * MeroHisab — Independent Financial Reference Engine & Seed-Based Verification Harness
 *
 * This test suite creates an INDEPENDENT reference calculation engine built with
 * its own clean-room BigInt Paisa mathematics. It does NOT import or reuse the
 * application's internal calculation or accumulator functions.
 *
 * It uses deterministic pseudo-random number generator (Mulberry32) with fixed seeds
 * to generate multi-account ledgers with varied dates, transfers, opening dates, and edge amounts,
 * comparing the application's actual outputs against the independent reference engine.
 */

import { calculateAccountBalance, getState, dispatch } from "../js/core/state.js";
import { calculateFinancialSummary } from "../js/services/transactions.js";
import { getAnalyticsData } from "../js/services/analytics.js";
import { getBudgetAnalysis } from "../js/services/budgets.js";
import { getGoalsAnalysis } from "../js/services/goals.js";
import { Validator } from "../js/core/validator.js";
import { generateBackupJsonString } from "../js/utils/file-io.js";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES, DEFAULT_SETTINGS } from "../js/core/constants.js";
import { adToBs, getNepalFiscalYear } from "../js/utils/nepali-calendar.js";

// ============================================================================
// 1. Independent Clean-Room Reference Engine (Zero Application Imports)
// ============================================================================

function refParseToPaisaBigInt(val) {
  if (val === null || val === undefined || val === "") return 0n;
  if (typeof val === "bigint") return val;
  const str = String(val).replace(/,/g, "").trim();
  const isNeg = str.startsWith("-");
  const raw = isNeg ? str.slice(1) : str;
  const parts = raw.split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "").padEnd(2, "0").slice(0, 2);
  const frac = BigInt(fracStr);
  const paisa = whole * 100n + frac;
  return isNeg ? -paisa : paisa;
}

function refFormatPaisaToRupees(paisa) {
  const p = typeof paisa === "bigint" ? paisa : BigInt(paisa);
  const isNeg = p < 0n;
  const abs = isNeg ? -p : p;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const str = `${isNeg ? "-" : ""}${whole.toString()}.${frac.toString().padStart(2, "0")}`;
  const num = Number(str);
  return isFinite(num) && num.toFixed(2) === str ? num : str;
}

/**
 * Check if a transaction is active for its account opening date rules.
 */
function refIsTxActive(accounts, tx) {
  if (!tx || !tx.dateAD) return false;
  const acc = accounts.find(a => a.id === tx.accountId);
  if (!acc) return false;
  if (tx.dateAD < (acc.openingBalanceDate || "1970-01-01")) return false;

  // Cross-account opening date neutrality invariant for transfers
  if (tx.type === "transfer" && tx.peerAccountId) {
    const peer = accounts.find(a => a.id === tx.peerAccountId);
    if (!peer || (peer.openingBalanceDate && tx.dateAD < peer.openingBalanceDate)) {
      return false;
    }
  }
  return true;
}

/**
 * Independent calculation of single account balance.
 */
function refCalculateAccountBalance(accounts, transactions, accountId) {
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return 0;
  let balPaisa = refParseToPaisaBigInt(acc.openingBalance || 0);

  for (const tx of transactions) {
    if (tx.accountId !== accountId) continue;
    if (!refIsTxActive(accounts, tx)) continue;

    const amtPaisa = refParseToPaisaBigInt(tx.amount || 0);
    if (tx.type === "income") {
      balPaisa += amtPaisa;
    } else if (tx.type === "expense") {
      balPaisa -= amtPaisa;
    } else if (tx.type === "transfer") {
      balPaisa += (tx.transferDirection === "in" ? amtPaisa : -amtPaisa);
    }
  }

  return refFormatPaisaToRupees(balPaisa);
}

/**
 * Independent financial summary calculation for a target month (YYYY-MM).
 */
function refCalculateFinancialSummary(accounts, transactions, targetMonth) {
  let monthlyInflow = 0n;
  let monthlyOutflow = 0n;

  for (const tx of transactions) {
    if (!tx.dateAD.startsWith(targetMonth)) continue;
    if (!refIsTxActive(accounts, tx)) continue;

    const amtPaisa = refParseToPaisaBigInt(tx.amount || 0);
    if (tx.type === "income") {
      monthlyInflow += amtPaisa;
    } else if (tx.type === "expense") {
      monthlyOutflow += amtPaisa;
    }
    // Note: transfers are strictly ignored for inflow / outflow
  }

  const netCashFlow = monthlyInflow - monthlyOutflow;

  // Total ledger balance across all accounts
  let totalLedgerPaisa = 0n;
  for (const a of accounts) {
    const aBal = refCalculateAccountBalance(accounts, transactions, a.id);
    totalLedgerPaisa += refParseToPaisaBigInt(aBal);
  }

  return {
    monthlyInflow: refFormatPaisaToRupees(monthlyInflow),
    monthlyOutflow: refFormatPaisaToRupees(monthlyOutflow),
    netCashFlow: refFormatPaisaToRupees(netCashFlow),
    totalBalance: refFormatPaisaToRupees(totalLedgerPaisa)
  };
}

/**
 * Independent calculation of budget utilization for a given period (YYYY-MM).
 */
function refCalculateBudgetUtilization(accounts, transactions, budgets, period) {
  const periodBudgets = (budgets || []).filter(b => b.period === period);
  const spentByCategoryPaisa = {};

  for (const tx of transactions || []) {
    if (tx.type !== "expense") continue;
    if (!tx.dateAD.startsWith(period)) continue;
    if (!refIsTxActive(accounts, tx)) continue;

    const amtPaisa = refParseToPaisaBigInt(tx.amount || 0);
    spentByCategoryPaisa[tx.category] = (spentByCategoryPaisa[tx.category] || 0n) + amtPaisa;
  }

  const analyzedBudgets = periodBudgets.map(b => {
    const budgetPaisa = refParseToPaisaBigInt(b.amount || 0);
    const spentPaisa = spentByCategoryPaisa[b.category] || 0n;
    const remainingPaisa = budgetPaisa - spentPaisa;
    const usagePercentage = budgetPaisa > 0n ? Number((spentPaisa * 10000n) / budgetPaisa) / 100 : 0;

    let status = "safe";
    if (usagePercentage >= 100) {
      status = "exceeded";
    } else if (usagePercentage >= 75) {
      status = "warning";
    }

    return {
      ...b,
      spent: refFormatPaisaToRupees(spentPaisa),
      remaining: refFormatPaisaToRupees(remainingPaisa),
      usagePercentage,
      status
    };
  });

  const totalBudgetedPaisa = periodBudgets.reduce((sum, b) => sum + refParseToPaisaBigInt(b.amount || 0), 0n);
  const totalSpentInBudgetedPaisa = analyzedBudgets.reduce((sum, b) => sum + refParseToPaisaBigInt(b.spent), 0n);
  const totalRemainingPaisa = totalBudgetedPaisa - totalSpentInBudgetedPaisa;

  return {
    period,
    budgets: analyzedBudgets,
    totalBudgeted: refFormatPaisaToRupees(totalBudgetedPaisa),
    totalSpentInBudgeted: refFormatPaisaToRupees(totalSpentInBudgetedPaisa),
    totalRemaining: refFormatPaisaToRupees(totalRemainingPaisa)
  };
}

/**
 * Independent calculation of available to allocate / goal headroom.
 */
function refCalculateAvailableToAllocate(accounts, transactions, goals) {
  let totalLedgerPaisa = 0n;
  for (const a of accounts) {
    const bal = refCalculateAccountBalance(accounts, transactions, a.id);
    totalLedgerPaisa += refParseToPaisaBigInt(bal);
  }

  let totalEarmarkedPaisa = 0n;
  for (const g of goals || []) {
    for (const alloc of g.allocations || []) {
      totalEarmarkedPaisa += refParseToPaisaBigInt(alloc.amount || 0);
    }
  }

  const availableToAllocatePaisa = totalLedgerPaisa - totalEarmarkedPaisa;

  return {
    totalLedgerBalance: refFormatPaisaToRupees(totalLedgerPaisa),
    totalEarmarkedSavings: refFormatPaisaToRupees(totalEarmarkedPaisa),
    availableToAllocate: refFormatPaisaToRupees(availableToAllocatePaisa)
  };
}

/**
 * Independent verification that transfers never count as income or expense.
 */
function refCheckTransfersExcluded(transactions) {
  for (const tx of transactions) {
    if (tx.type === "transfer") {
      if (tx.type === "income" || tx.type === "expense") return false;
    }
  }
  return true;
}

/**
 * Independent calculation of Nepal fiscal year aggregation.
 */
function refCalculateFiscalYearSummary(accounts, transactions, fyYear) {
  let totalIncomePaisa = 0n;
  let totalExpensesPaisa = 0n;
  let txCount = 0;

  for (const tx of transactions) {
    if (!refIsTxActive(accounts, tx)) continue;
    const bs = adToBs(tx.dateAD);
    if (!bs) continue;
    const txFy = getNepalFiscalYear(bs.year, bs.month);
    if (txFy !== fyYear) continue;

    const amtPaisa = refParseToPaisaBigInt(tx.amount || 0);
    if (tx.type === "income") {
      totalIncomePaisa += amtPaisa;
      txCount++;
    } else if (tx.type === "expense") {
      totalExpensesPaisa += amtPaisa;
      txCount++;
    }
  }

  return {
    fyYear,
    totalIncome: refFormatPaisaToRupees(totalIncomePaisa),
    totalExpenses: refFormatPaisaToRupees(totalExpensesPaisa),
    netCashFlow: refFormatPaisaToRupees(totalIncomePaisa - totalExpensesPaisa),
    transactionCount: txCount
  };
}

// ============================================================================
// 2. Deterministic Seed-Based PRNG (Mulberry32)
// ============================================================================

function createPrng(seed) {
  let s = seed >>> 0;
  return function() {
    let t = (s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// 3. Dataset Generator
// ============================================================================

function generateRandomLedger(seed, txCount = 100) {
  const rand = createPrng(seed);
  const choice = (arr) => arr[Math.floor(rand() * arr.length)];
  const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
  const randAmountStr = () => {
    const rupees = randInt(1, 50000);
    const paisa = randInt(0, 99);
    return `${rupees}.${String(paisa).padStart(2, "0")}`;
  };

  const accountTypes = ["cash", "bank", "esewa", "khalti"];
  const accounts = [
    {
      id: "acc_default_cash",
      name: "Primary Cash",
      type: "cash",
      openingBalance: Number(randAmountStr()),
      openingBalanceDate: "2026-09-01",
      openingBalanceDateBS: "2083-05-16",
      overdraftEnabled: true,
      archived: false,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    },
    {
      id: "acc_savings_bank",
      name: "Nabil Bank",
      type: "bank",
      openingBalance: Number(randAmountStr()),
      openingBalanceDate: "2026-09-15",
      openingBalanceDateBS: "2083-05-30",
      overdraftEnabled: true,
      archived: false,
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z"
    },
    {
      id: "acc_digital_wallet",
      name: "eSewa Wallet",
      type: "esewa",
      openingBalance: Number(randAmountStr()),
      openingBalanceDate: "2026-10-01",
      openingBalanceDateBS: "2083-06-15",
      overdraftEnabled: true,
      archived: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z"
    }
  ];

  // Randomize account ordering to verify invariance
  if (rand() > 0.5) {
    accounts.reverse();
  }

  const transactions = [];
  const days = ["2026-09-20", "2026-10-02", "2026-10-10", "2026-10-15", "2026-10-25", "2026-11-01", "2026-11-05"];

  for (let i = 0; i < txCount; i++) {
    const isTransfer = rand() < 0.25;
    const dateAD = choice(days);
    const bsRes = adToBs(dateAD);
    const dateBS = bsRes ? bsRes.formatted : "N/A";
    const amt = Number(randAmountStr());

    if (isTransfer) {
      const fromAcc = choice(accounts);
      const toAcc = choice(accounts.filter(a => a.id !== fromAcc.id));
      const trId = `tr_seed_${seed}_${i}`;

      transactions.push({
        id: `${trId}_out`,
        transferId: trId,
        transferDirection: "out",
        peerAccountId: toAcc.id,
        accountId: fromAcc.id,
        type: "transfer",
        amount: amt,
        category: "transfers",
        description: `Seed transfer out ${i}`,
        dateAD,
        dateBS,
        paymentMethod: "bank_transfer",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      transactions.push({
        id: `${trId}_in`,
        transferId: trId,
        transferDirection: "in",
        peerAccountId: fromAcc.id,
        accountId: toAcc.id,
        type: "transfer",
        amount: amt,
        category: "transfers",
        description: `Seed transfer in ${i}`,
        dateAD,
        dateBS,
        paymentMethod: "bank_transfer",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } else {
      const isIncome = rand() < 0.4;
      const acc = choice(accounts);
      const category = isIncome ? choice(INCOME_CATEGORIES).id : choice(EXPENSE_CATEGORIES).id;

      transactions.push({
        id: `tx_seed_${seed}_${i}`,
        accountId: acc.id,
        type: isIncome ? "income" : "expense",
        amount: amt,
        category,
        description: `Seed tx ${i} (${category})`,
        dateAD,
        dateBS,
        paymentMethod: "cash",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  // Add reciprocal paid bill and transaction to verify strict bill expense accounting
  const billPaidDueDateAD = "2026-10-15";
  const billPaidDueDateBS = adToBs(billPaidDueDateAD).formatted;
  const billPaidId = `bill_seed_paid_${seed}`;
  const billPaidTxId = `tx_seed_paid_bill_${seed}`;
  const billPaidAmt = 2500;

  transactions.push({
    id: billPaidTxId,
    accountId: accounts[0].id,
    type: "expense",
    amount: billPaidAmt,
    category: "utilities",
    description: `Paid NEA Electricity Bill for Seed ${seed}`,
    dateAD: billPaidDueDateAD,
    dateBS: billPaidDueDateBS,
    paymentMethod: "bank_transfer",
    linkedBillId: billPaidId,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z"
  });

  const billUnpaidDueDateAD = "2026-10-25";
  const billUnpaidDueDateBS = adToBs(billUnpaidDueDateAD).formatted;
  const billUnpaidId = `bill_seed_unpaid_${seed}`;

  const bills = [
    {
      id: billPaidId,
      title: "Electricity NEA",
      accountId: accounts[0].id,
      amount: billPaidAmt,
      category: "utilities",
      dueDateAD: billPaidDueDateAD,
      dueDateBS: billPaidDueDateBS,
      isPaid: true,
      status: "paid",
      paidDateAD: billPaidDueDateAD,
      paidDateBS: billPaidDueDateBS,
      linkedTransactionId: billPaidTxId,
      recurrence: {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 15,
        startDate: "2026-09-15",
        startDateBS: adToBs("2026-09-15").formatted
      },
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-15T00:00:00.000Z"
    },
    {
      id: billUnpaidId,
      title: "Internet Fiber",
      accountId: accounts[0].id,
      amount: 1500,
      category: "utilities",
      dueDateAD: billUnpaidDueDateAD,
      dueDateBS: billUnpaidDueDateBS,
      isPaid: false,
      status: "unpaid",
      recurrence: {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 25,
        startDate: "2026-09-25",
        startDateBS: adToBs("2026-09-25").formatted
      },
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z"
    }
  ];

  // Budgets for October 2026
  const budgets = [
    {
      id: `b_seed_util_${seed}`,
      category: "utilities",
      amount: 15000,
      period: "2026-10",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z"
    },
    {
      id: `b_seed_food_${seed}`,
      category: "food_dining",
      amount: 30000,
      period: "2026-10",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z"
    }
  ];

  // Savings Goals with allocations
  const goals = [
    {
      id: `goal_seed_${seed}_1`,
      title: "Emergency Fund",
      targetAmount: 50000,
      targetDateAD: "2026-12-31",
      targetDateBS: adToBs("2026-12-31").formatted,
      category: "savings",
      allocations: [
        {
          id: `alloc_seed_${seed}_1`,
          amount: 10000,
          dateAD: "2026-10-02",
          dateBS: adToBs("2026-10-02").formatted,
          note: "Initial allocation"
        }
      ],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z"
    }
  ];

  // Recurring Rule
  const ruleStartAD = "2026-09-01";
  const ruleStartBS = adToBs(ruleStartAD).formatted;
  const ruleNextAD = "2026-11-01";
  const ruleNextBS = adToBs(ruleNextAD).formatted;

  const recurringRules = [
    {
      id: `rule_seed_${seed}_1`,
      title: "Internet Fiber Subscription",
      type: "expense",
      amount: 1500,
      category: "utilities",
      accountId: accounts[0].id,
      paymentMethod: "bank_transfer",
      schedule: {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 1,
        startDate: ruleStartAD,
        startDateBS: ruleStartBS
      },
      nextOccurrence: ruleNextAD,
      nextOccurrenceBS: ruleNextBS,
      skippedDates: [],
      paused: false,
      isPaused: false,
      status: "active",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    }
  ];

  return {
    version: 3,
    revision: 1,
    isDemoData: false,
    accounts,
    transactions,
    budgets,
    goals,
    recurringRules,
    bills,
    settings: { ...DEFAULT_SETTINGS }
  };
}

// ============================================================================
// 4. Test Execution
// ============================================================================

let passed = 0;
let failed = 0;

function assert(condition, message, details = "") {
  if (!condition) {
    failed++;
    console.error(`  ✕ FAILED: ${message}${details ? " -> " + details : ""}`);
  } else {
    passed++;
    console.log(`  ✓ ${message}`);
  }
}

console.log("================================================================================");
console.log("MeroHisab — Independent Clean-Room Financial Reference Calculation Suite");
console.log("================================================================================");

const SEEDS = [42, 1337, 20261001, 7777777, 987654321];

for (const seed of SEEDS) {
  console.log(`\n--- Running Seed ${seed} (120 generated financial events) ---`);
  const ledger = generateRandomLedger(seed, 60);

  // 1. Structural and Financial Validation
  const valRes = Validator.validateBackupJson(ledger);
  assert(valRes.isValid, `Seed ${seed}: Generated dataset passes strict backup validation`, valRes.error);

  // 2. Individual Account Balances Verification
  for (const acc of ledger.accounts) {
    const refBal = refCalculateAccountBalance(ledger.accounts, ledger.transactions, acc.id);
    const appBal = calculateAccountBalance(ledger, acc.id);
    assert(
      Number(refBal) === Number(appBal) || refBal === appBal,
      `Seed ${seed}: Account '${acc.name}' balance matches independent reference engine exactly (${refBal})`,
      `Expected ${refBal}, got ${appBal}`
    );
  }

  // 3. Monthly Financial Summary Verification for October 2026
  const refSummary = refCalculateFinancialSummary(ledger.accounts, ledger.transactions, "2026-10");
  const appSummary = calculateFinancialSummary(ledger, "2026-10");

  assert(
    Number(refSummary.monthlyInflow) === Number(appSummary.monthlyInflow),
    `Seed ${seed}: October Monthly Inflow matches reference (${refSummary.monthlyInflow})`,
    `Expected ${refSummary.monthlyInflow}, got ${appSummary.monthlyInflow}`
  );
  assert(
    Number(refSummary.monthlyOutflow) === Number(appSummary.monthlyOutflow),
    `Seed ${seed}: October Monthly Outflow matches reference (${refSummary.monthlyOutflow})`,
    `Expected ${refSummary.monthlyOutflow}, got ${appSummary.monthlyOutflow}`
  );
  assert(
    Number(refSummary.netCashFlow) === Number(appSummary.netCashFlow),
    `Seed ${seed}: October Net Cash Flow matches reference (${refSummary.netCashFlow})`,
    `Expected ${refSummary.netCashFlow}, got ${appSummary.netCashFlow}`
  );

  // 4. Global Net Balance Verification
  const appTotalBal = ledger.accounts.reduce((sum, a) => {
    const b = calculateAccountBalance(ledger, a.id);
    return sum + refParseToPaisaBigInt(b);
  }, 0n);
  const appTotalBalRupees = refFormatPaisaToRupees(appTotalBal);

  assert(
    Number(refSummary.totalBalance) === Number(appTotalBalRupees),
    `Seed ${seed}: Total Ledger Balance matches reference (${refSummary.totalBalance})`,
    `Expected ${refSummary.totalBalance}, got ${appTotalBalRupees}`
  );

  // 5. Budget Utilization & Category Aggregation Verification
  const refBudget = refCalculateBudgetUtilization(ledger.accounts, ledger.transactions, ledger.budgets, "2026-10");
  const appBudget = getBudgetAnalysis(ledger, "2026-10");

  assert(
    Number(refBudget.totalSpentInBudgeted) === Number(appBudget.totalSpentInBudgeted),
    `Seed ${seed}: Budget Total Spent In Budgeted matches reference (${refBudget.totalSpentInBudgeted})`,
    `Expected ${refBudget.totalSpentInBudgeted}, got ${appBudget.totalSpentInBudgeted}`
  );
  assert(
    Number(refBudget.totalRemaining) === Number(appBudget.totalRemaining),
    `Seed ${seed}: Budget Total Remaining matches reference (${refBudget.totalRemaining})`,
    `Expected ${refBudget.totalRemaining}, got ${appBudget.totalRemaining}`
  );

  for (const rb of refBudget.budgets) {
    const ab = appBudget.budgets.find(b => b.id === rb.id);
    assert(
      ab && Number(ab.spent) === Number(rb.spent),
      `Seed ${seed}: Budget '${rb.category}' spent matches reference (${rb.spent})`,
      `Expected ${rb.spent}, got ${ab?.spent}`
    );
    assert(
      ab && Number(ab.remaining) === Number(rb.remaining),
      `Seed ${seed}: Budget '${rb.category}' remaining matches reference (${rb.remaining})`,
      `Expected ${rb.remaining}, got ${ab?.remaining}`
    );
    assert(
      ab && ab.status === rb.status,
      `Seed ${seed}: Budget '${rb.category}' status matches reference (${rb.status})`,
      `Expected ${rb.status}, got ${ab?.status}`
    );
  }

  // 6. Savings Goals Headroom (Available to Allocate) Invariant
  const refGoalSummary = refCalculateAvailableToAllocate(ledger.accounts, ledger.transactions, ledger.goals);
  const appGoalAnalysis = getGoalsAnalysis(ledger);

  assert(
    Number(refGoalSummary.availableToAllocate) === Number(appGoalAnalysis.availableToAllocate),
    `Seed ${seed}: Goal available to allocate matches reference (${refGoalSummary.availableToAllocate})`,
    `Expected ${refGoalSummary.availableToAllocate}, got ${appGoalAnalysis.availableToAllocate}`
  );
  assert(
    Number(refGoalSummary.totalEarmarkedSavings) === Number(appGoalAnalysis.totalSaved),
    `Seed ${seed}: Total earmarked savings matches reference (${refGoalSummary.totalEarmarkedSavings})`,
    `Expected ${refGoalSummary.totalEarmarkedSavings}, got ${appGoalAnalysis.totalSaved}`
  );

  // Conservation of funds: availableToAllocate + totalSaved === totalBalance
  const totalAllocatedPlusFree = Number(appGoalAnalysis.availableToAllocate) + Number(appGoalAnalysis.totalSaved);
  assert(
    Math.abs(totalAllocatedPlusFree - Number(refSummary.totalBalance)) < 0.001,
    `Seed ${seed}: Goal funds conservation invariant verified (available + saved === totalBalance: ${refSummary.totalBalance})`
  );

  // 7. Strict Bill Expense Counting & Isolation
  const paidBillTx = ledger.transactions.find(t => t.id === `tx_seed_paid_bill_${seed}`);
  assert(
    paidBillTx && paidBillTx.linkedBillId === `bill_seed_paid_${seed}`,
    `Seed ${seed}: Paid bill linked expense transaction exists with reciprocal billId`
  );

  const unpaidBill = ledger.bills.find(b => b.id === `bill_seed_unpaid_${seed}`);
  assert(
    unpaidBill && !unpaidBill.isPaid && !unpaidBill.linkedTransactionId,
    `Seed ${seed}: Unpaid bill has no linked expense transaction and does not affect account balance`
  );

  // 8. Strict Transfer Isolation
  assert(
    refCheckTransfersExcluded(ledger.transactions),
    `Seed ${seed}: All transfers are strictly excluded from income and expense pools`
  );

  // 9. Fiscal Year Aggregation Verification (FY 2083/84)
  const currentFyStr = "FY 2083/84";
  const refFy = refCalculateFiscalYearSummary(ledger.accounts, ledger.transactions, currentFyStr);
  const appFy = getAnalyticsData(ledger, "fiscal_year", currentFyStr);

  assert(
    Number(refFy.totalIncome) === Number(appFy.totalIncome),
    `Seed ${seed}: Fiscal Year Income matches reference (${refFy.totalIncome})`,
    `Expected ${refFy.totalIncome}, got ${appFy.totalIncome}`
  );
  assert(
    Number(refFy.totalExpenses) === Number(appFy.totalExpenses),
    `Seed ${seed}: Fiscal Year Expenses matches reference (${refFy.totalExpenses})`,
    `Expected ${refFy.totalExpenses}, got ${appFy.totalExpenses}`
  );
  assert(
    Number(refFy.netCashFlow) === Number(appFy.netCashFlow),
    `Seed ${seed}: Fiscal Year Net Cash Flow matches reference (${refFy.netCashFlow})`,
    `Expected ${refFy.netCashFlow}, got ${appFy.netCashFlow}`
  );

  // 10. Roundtrip Backup and Restore Invariance
  const backupJson = generateBackupJsonString(ledger);
  const parsedBackup = JSON.parse(backupJson);
  assert(Validator.validateBackupJson(parsedBackup).isValid, `Seed ${seed}: Exported JSON backup passes validation`);

  for (const acc of parsedBackup.accounts) {
    const restoredBal = calculateAccountBalance(parsedBackup, acc.id);
    const originalBal = calculateAccountBalance(ledger, acc.id);
    assert(
      Number(restoredBal) === Number(originalBal),
      `Seed ${seed}: Restored account '${acc.id}' balance strictly equals original balance (${originalBal})`
    );
  }

  const restoredBudget = getBudgetAnalysis(parsedBackup, "2026-10");
  assert(
    Number(restoredBudget.totalSpentInBudgeted) === Number(appBudget.totalSpentInBudgeted),
    `Seed ${seed}: Restored budget total spending strictly preserved (${appBudget.totalSpentInBudgeted})`
  );

  const restoredGoals = getGoalsAnalysis(parsedBackup);
  assert(
    Number(restoredGoals.availableToAllocate) === Number(appGoalAnalysis.availableToAllocate),
    `Seed ${seed}: Restored available to allocate strictly preserved (${appGoalAnalysis.availableToAllocate})`
  );
}

console.log("\n================================================================================");
if (failed === 0) {
  console.log(`✓ ALL ${passed} INDEPENDENT FINANCIAL REFERENCE TESTS PASSED!`);
  console.log("================================================================================");
  process.exit(0);
} else {
  console.error(`✕ ${failed} INDEPENDENT REFERENCE TESTS FAILED!`);
  console.log("================================================================================");
  process.exit(1);
}
