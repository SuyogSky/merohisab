/**
 * MeroHisab — Budget Management Service (Integer Paisa Engine)
 * Calculates category-specific and overall period budget utilization with exact integer Paisa precision.
 */

import { BUDGET_THRESHOLDS, EXPENSE_CATEGORIES } from "../core/constants.js";
import { getCategoryLabel, getCategoryIcon, getCategoryColor, isTransactionActiveForAccount } from "./transactions.js";
import { toPaisaBigInt, fromPaisaBigInt } from "../utils/money.js";

/**
 * Calculate budget utilization and status for a given period
 * @param {object} state - Application state
 * @param {string} period - "YYYY-MM"
 * @returns {object}
 */
export function getBudgetAnalysis(state, period) {
  const budgets = (state.budgets || []).filter(b => b.period === period);
  const transactions = (state.transactions || []).filter(
    t => t.type === "expense" && t.dateAD.startsWith(period) && isTransactionActiveForAccount(state, t)
  );

  // Group expenses by category in exact integer Paisa
  const spentByCategoryPaisa = {};
  for (const t of transactions) {
    spentByCategoryPaisa[t.category] = (spentByCategoryPaisa[t.category] || 0n) + toPaisaBigInt(t.amount);
  }

  // Calculate stats for each budget in exact integer Paisa
  const analyzedBudgets = budgets.map(b => {
    const budgetPaisa = toPaisaBigInt(b.amount);
    const spentPaisa = spentByCategoryPaisa[b.category] || 0n;
    const remainingPaisa = budgetPaisa - spentPaisa;
    const spent = fromPaisaBigInt(spentPaisa);
    const remaining = fromPaisaBigInt(remainingPaisa);
    const usagePercentage = budgetPaisa > 0n ? Number((spentPaisa * 10000n) / budgetPaisa) / 100 : 0;

    let status = "safe";
    let statusLabel = "Safe";
    if (usagePercentage >= BUDGET_THRESHOLDS.EXCEEDED_MIN) {
      status = "exceeded";
      statusLabel = "Exceeded";
    } else if (usagePercentage >= 75) {
      status = "warning";
      statusLabel = "Approaching Limit";
    }

    return {
      ...b,
      categoryLabel: getCategoryLabel(b.category, "expense"),
      categoryIcon: getCategoryIcon(b.category),
      categoryColor: getCategoryColor(b.category),
      spent,
      remaining,
      usagePercentage,
      status,
      statusLabel
    };
  });

  // Calculate overall summary in exact integer Paisa
  const totalBudgetedPaisa = budgets.reduce((sum, b) => sum + toPaisaBigInt(b.amount), 0n);
  const totalSpentInBudgetedPaisa = analyzedBudgets.reduce((sum, b) => sum + toPaisaBigInt(b.spent), 0n);
  const totalRemainingPaisa = totalBudgetedPaisa - totalSpentInBudgetedPaisa;

  const totalBudgeted = fromPaisaBigInt(totalBudgetedPaisa);
  const totalSpentInBudgeted = fromPaisaBigInt(totalSpentInBudgetedPaisa);
  const totalRemaining = fromPaisaBigInt(totalRemainingPaisa);
  const overallUsagePct = totalBudgetedPaisa > 0n ? Number((totalSpentInBudgetedPaisa * 10000n) / totalBudgetedPaisa) / 100 : 0;

  let overallStatus = "safe";
  let overallStatusLabel = "Safe";
  if (overallUsagePct >= BUDGET_THRESHOLDS.EXCEEDED_MIN) {
    overallStatus = "exceeded";
    overallStatusLabel = "Over Budget";
  } else if (overallUsagePct >= 75) {
    overallStatus = "warning";
    overallStatusLabel = "Warning";
  }

  // List categories that do NOT yet have a budget in this period
  const budgetedCategoryIds = budgets.map(b => b.category);
  const availableCategories = EXPENSE_CATEGORIES.filter(c => !budgetedCategoryIds.includes(c.id));

  return {
    period,
    budgets: analyzedBudgets,
    totalBudgeted,
    totalSpentInBudgeted,
    totalRemaining,
    overallUsagePct,
    overallStatus,
    overallStatusLabel,
    availableCategories
  };
}
