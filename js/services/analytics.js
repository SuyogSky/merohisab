/**
 * MeroHisab — Analytics & Nepal Fiscal Year Aggregator
 * Generates data for Canvas charts, comparisons, and fiscal-year reporting.
 */

import { TRANSACTION_TYPES } from "../core/constants.js";
import { getCategoryLabel, getCategoryColor, getCategoryIcon } from "./transactions.js";
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

  // 1. Filter transactions matching period
  let periodTransactions = [];
  let previousTransactions = [];

  if (periodType === "fiscal_year") {
    // Group by Nepal Fiscal Year
    periodTransactions = transactions.filter(t => {
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
        const bs = adToBs(t.dateAD);
        return bs && getNepalFiscalYear(bs.year, bs.month) === prevFyStr;
      });
    }
  } else {
    // Monthly (YYYY-MM)
    periodTransactions = transactions.filter(t => t.dateAD.startsWith(periodValue));

    // Calculate previous month string for comparison
    const [y, m] = periodValue.split("-").map(Number);
    const prevDate = new Date(Date.UTC(y, m - 2, 1));
    const prevMonthStr = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;
    previousTransactions = transactions.filter(t => t.dateAD.startsWith(prevMonthStr));
  }

  // 2. Financial totals
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const t of periodTransactions) {
    if (t.type === TRANSACTION_TYPES.INCOME) {
      totalIncome += t.amount;
    } else if (t.type === TRANSACTION_TYPES.EXPENSE) {
      totalExpenses += t.amount;
    }
  }

  const netCashFlow = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 && netCashFlow > 0 ? (netCashFlow / totalIncome) * 100 : 0;

  // Previous period totals for comparison
  let prevTotalExpenses = 0;
  let prevTotalIncome = 0;
  for (const t of previousTransactions) {
    if (t.type === TRANSACTION_TYPES.INCOME) prevTotalIncome += t.amount;
    if (t.type === TRANSACTION_TYPES.EXPENSE) prevTotalExpenses += t.amount;
  }

  const expenseChangePct =
    prevTotalExpenses > 0
      ? ((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100
      : null;

  // 3. Category Breakdown (Expenses)
  const categoryTotals = {};
  for (const t of periodTransactions) {
    if (t.type === TRANSACTION_TYPES.EXPENSE) {
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
    }
  }

  const categoryBreakdown = Object.entries(categoryTotals)
    .map(([catId, amount]) => {
      const percentage = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
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

  // 4. Monthly Trend Series (Last 6 distinct months)
  const allMonths = Array.from(
    new Set(transactions.map(t => t.dateAD.slice(0, 7)))
  ).sort();

  const trendMonths = allMonths.slice(-6);
  const monthlyTrends = trendMonths.map(mon => {
    let inc = 0;
    let exp = 0;
    for (const t of transactions) {
      if (t.dateAD.startsWith(mon)) {
        if (t.type === TRANSACTION_TYPES.INCOME) inc += t.amount;
        if (t.type === TRANSACTION_TYPES.EXPENSE) exp += t.amount;
      }
    }
    return {
      month: mon,
      income: inc,
      expense: exp,
      net: inc - exp
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
