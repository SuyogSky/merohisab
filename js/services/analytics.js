/**
 * MeroHisab — Analytics & Nepal Fiscal Year Aggregator (Integer Paisa Engine)
 * Generates exact data for Canvas charts, comparisons, and fiscal-year reporting.
 * All accumulations, subtractions, and percentages use exact integer Paisa arithmetic.
 */

import { TRANSACTION_TYPES } from "../core/constants.js";
import { getCategoryLabel, getCategoryColor, getCategoryIcon, isTransactionActiveForAccount } from "./transactions.js";
import { toPaisaBigInt, fromPaisaBigInt } from "../utils/money.js";
import { adToBs, getNepalFiscalYear } from "../utils/nepali-calendar.js";

/**
 * Get comprehensive analytics for a specific period or fiscal year
 * @param {object} state
 * @param {string} periodType - 'month' or 'fiscal_year'
 * @param {string} periodValue - e.g. "2026-10" or "FY 2083/84"
 * @returns {object}
 */
export function getAnalyticsData(state, periodType = "month", periodValue = "2026-10") {
  const transactions = state.transactions || [];

  // 1. Filter transactions matching period and active for their account opening date
  let periodTransactions = [];
  let previousTransactions = [];

  if (periodType === "fiscal_year") {
    // Group by Nepal Fiscal Year
    periodTransactions = transactions.filter(t => {
      if (!isTransactionActiveForAccount(state, t)) return false;
      const bs = adToBs(t.dateAD);
      return bs && getNepalFiscalYear(bs.year, bs.month) === periodValue;
    });

    // Calculate previous fiscal year string for comparison
    const match = periodValue.match(/FY\s+(\d{4})\/(\d{2})/);
    if (match) {
      const startYear = parseInt(match[1], 10);
      const prevYear = startYear - 1;
      const prevFyStr = `FY ${prevYear}/${String(startYear).slice(-2)}`;
      previousTransactions = transactions.filter(t => {
        if (!isTransactionActiveForAccount(state, t)) return false;
        const bs = adToBs(t.dateAD);
        return bs && getNepalFiscalYear(bs.year, bs.month) === prevFyStr;
      });
    }
  } else {
    // Monthly (YYYY-MM)
    periodTransactions = transactions.filter(t => t.dateAD.startsWith(periodValue) && isTransactionActiveForAccount(state, t));

    // Calculate previous month string for comparison
    const [y, m] = periodValue.split("-").map(Number);
    const prevDate = new Date(Date.UTC(y, m - 2, 1));
    const prevMonthStr = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;
    previousTransactions = transactions.filter(t => t.dateAD.startsWith(prevMonthStr) && isTransactionActiveForAccount(state, t));
  }

  // 2. Financial totals in exact integer Paisa
  let totalIncomePaisa = 0n;
  let totalExpensesPaisa = 0n;

  for (const t of periodTransactions) {
    if (t.type === TRANSACTION_TYPES.INCOME) {
      totalIncomePaisa += toPaisaBigInt(t.amount);
    } else if (t.type === TRANSACTION_TYPES.EXPENSE) {
      totalExpensesPaisa += toPaisaBigInt(t.amount);
    }
  }

  const netCashFlowPaisa = totalIncomePaisa - totalExpensesPaisa;
  const totalIncome = fromPaisaBigInt(totalIncomePaisa);
  const totalExpenses = fromPaisaBigInt(totalExpensesPaisa);
  const netCashFlow = fromPaisaBigInt(netCashFlowPaisa);

  let savingsRate = 0;
  if (totalIncomePaisa > 0n && netCashFlowPaisa > 0n) {
    savingsRate = Number((netCashFlowPaisa * 10000n) / totalIncomePaisa) / 100;
  }

  // Previous period totals for comparison in exact integer Paisa
  let prevTotalExpensesPaisa = 0n;
  let prevTotalIncomePaisa = 0n;
  for (const t of previousTransactions) {
    if (t.type === TRANSACTION_TYPES.INCOME) prevTotalIncomePaisa += toPaisaBigInt(t.amount);
    if (t.type === TRANSACTION_TYPES.EXPENSE) prevTotalExpensesPaisa += toPaisaBigInt(t.amount);
  }

  let expenseChangePct = null;
  if (prevTotalExpensesPaisa > 0n) {
    const diffPaisa = totalExpensesPaisa - prevTotalExpensesPaisa;
    expenseChangePct = Number((diffPaisa * 10000n) / prevTotalExpensesPaisa) / 100;
  }

  // 3. Category Breakdown (Expenses) in exact integer Paisa
  const categoryTotalsPaisa = {};
  for (const t of periodTransactions) {
    if (t.type === TRANSACTION_TYPES.EXPENSE) {
      categoryTotalsPaisa[t.category] = (categoryTotalsPaisa[t.category] || 0n) + toPaisaBigInt(t.amount);
    }
  }

  const categoryBreakdown = Object.entries(categoryTotalsPaisa)
    .map(([catId, catPaisa]) => {
      const amount = fromPaisaBigInt(catPaisa);
      const percentage = totalExpensesPaisa > 0n ? Number((catPaisa * 10000n) / totalExpensesPaisa) / 100 : 0;
      return {
        id: catId,
        label: getCategoryLabel(catId, "expense"),
        icon: getCategoryIcon(catId),
        color: getCategoryColor(catId),
        amount,
        percentage
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const highestExpenseCategory = categoryBreakdown.length > 0 ? categoryBreakdown[0] : null;
  const lowestExpenseCategory =
    categoryBreakdown.length > 1 ? categoryBreakdown[categoryBreakdown.length - 1] : null;

  // 4. Monthly Trend Series (Last 6 distinct months) in exact integer Paisa
  const allMonths = Array.from(
    new Set(transactions.map(t => t.dateAD.slice(0, 7)))
  ).sort();

  const trendMonths = allMonths.slice(-6);
  const monthlyTrends = trendMonths.map(mon => {
    let incPaisa = 0n;
    let expPaisa = 0n;
    for (const t of transactions) {
      if (t.dateAD.startsWith(mon) && isTransactionActiveForAccount(state, t)) {
        if (t.type === TRANSACTION_TYPES.INCOME) incPaisa += toPaisaBigInt(t.amount);
        if (t.type === TRANSACTION_TYPES.EXPENSE) expPaisa += toPaisaBigInt(t.amount);
      }
    }
    return {
      month: mon,
      income: fromPaisaBigInt(incPaisa),
      expense: fromPaisaBigInt(expPaisa),
      net: fromPaisaBigInt(incPaisa - expPaisa)
    };
  });

  return {
    periodType,
    periodValue,
    totalIncome,
    totalExpenses,
    netCashFlow,
    savingsRate,
    expenseChangePct,
    categoryBreakdown,
    highestExpenseCategory,
    lowestExpenseCategory,
    monthlyTrends,
    transactionCount: periodTransactions.length,
    periodTransactions
  };
}
