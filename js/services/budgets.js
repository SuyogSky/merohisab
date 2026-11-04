/**
 * MeroHisab — Budget Management Service
 * Calculates category-specific and overall period budget utilization.
 */

import { BUDGET_THRESHOLDS, EXPENSE_CATEGORIES } from "../core/constants.js";
import { getCategoryLabel, getCategoryIcon, getCategoryColor } from "./transactions.js";

/**
 * Calculate budget utilization and status for a given period
 * @param {object} state - Application state
 * @param {string} period - "YYYY-MM"
 * @returns {object}
 */
export function getBudgetAnalysis(state, period) {
  const budgets = (state.budgets || []).filter(b => b.period === period);
  const transactions = (state.transactions || []).filter(
    t => t.type === "expense" && t.dateAD.startsWith(period)
  );

  // Group expenses by category
  const spentByCategory = {};
  for (const t of transactions) {
    spentByCategory[t.category] = (spentByCategory[t.category] || 0) + t.amount;
  }

  // Calculate stats for each budget
  const analyzedBudgets = budgets.map(b => {
    const spent = spentByCategory[b.category] || 0;
    const remaining = b.amount - spent;
    const usagePercentage = b.amount > 0 ? (spent / b.amount) * 100 : 0;

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

  // Calculate overall summary
  const totalBudgeted = budgets.reduce((sum, b) => sum + b.amount, 0);
  const totalSpentInBudgeted = analyzedBudgets.reduce((sum, b) => sum + b.spent, 0);
  const totalRemaining = totalBudgeted - totalSpentInBudgeted;
  const overallUsagePct = totalBudgeted > 0 ? (totalSpentInBudgeted / totalBudgeted) * 100 : 0;

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
