/**
 * MeroHisab — Deterministic Financial Insights Engine
 * Evaluates rule-based heuristics on actual user financial data. Zero external AI dependencies.
 */

import { formatPercentage, formatCurrency } from "../utils/formatters.js";
import { getAnalyticsData } from "./analytics.js";
import { getBudgetAnalysis } from "./budgets.js";
import { getGoalsAnalysis } from "./goals.js";

/**
 * Generate heuristic insights for the active period
 * @param {object} state
 * @param {string} period - "YYYY-MM"
 * @returns {Array<{ type: "success"|"warning"|"info", icon: string, title: string, message: string }>}
 */
export function generateFinancialInsights(state, period = "2026-10") {
  const insights = [];
  const analytics = getAnalyticsData(state, "month", period);
  const budgetData = getBudgetAnalysis(state, period);
  const goalsData = getGoalsAnalysis(state);

  // Rule 1: Deficit Warning (Expenses > Income)
  if (analytics.totalExpenses > analytics.totalIncome && analytics.totalIncome > 0) {
    insights.push({
      type: "warning",
      icon: "⚠️",
      title: "Negative Cash Flow",
      message: `Your monthly expenses (${formatCurrency(analytics.totalExpenses)}) exceed your income (${formatCurrency(analytics.totalIncome)}) by ${formatCurrency(Math.abs(analytics.netCashFlow))}.`
    });
  }

  // Rule 2: Strong Savings Rate
  if (analytics.savingsRate >= 20) {
    insights.push({
      type: "success",
      icon: "🎯",
      title: "Healthy Savings Velocity",
      message: `Great discipline! You are saving ${formatPercentage(analytics.savingsRate)} of your income this month.`
    });
  } else if (analytics.totalIncome > 0 && analytics.savingsRate < 10 && analytics.savingsRate > 0) {
    insights.push({
      type: "info",
      icon: "💡",
      title: "Savings Tip",
      message: `Your savings rate is currently ${formatPercentage(analytics.savingsRate)}. Financial experts recommend aiming for at least 20%.`
    });
  }

  // Rule 3: Spending Increase vs Previous Month
  if (analytics.expenseChangePct !== null) {
    if (analytics.expenseChangePct > 15) {
      insights.push({
        type: "warning",
        icon: "📈",
        title: "Spending Increase",
        message: `Your total spending increased by ${formatPercentage(analytics.expenseChangePct)} compared to last month.`
      });
    } else if (analytics.expenseChangePct < -10) {
      insights.push({
        type: "success",
        icon: "📉",
        title: "Reduced Spending",
        message: `Excellent! Your spending decreased by ${formatPercentage(Math.abs(analytics.expenseChangePct))} compared to last month.`
      });
    }
  }

  // Rule 4: Largest Expense Category
  if (analytics.highestExpenseCategory && analytics.highestExpenseCategory.percentage > 25) {
    insights.push({
      type: "info",
      icon: "🏷️",
      title: `Top Spending: ${analytics.highestExpenseCategory.label}`,
      message: `${analytics.highestExpenseCategory.label} accounts for ${formatPercentage(analytics.highestExpenseCategory.percentage)} of your total monthly expenditures.`
    });
  }

  // Rule 5: Budget Status Alert (Exceeded or Warning)
  const exceededBudget = budgetData.budgets.find(b => b.status === "exceeded");
  if (exceededBudget) {
    insights.push({
      type: "warning",
      icon: "🚨",
      title: "Budget Exceeded",
      message: `You have exceeded your ${exceededBudget.categoryLabel} budget by ${formatCurrency(Math.abs(exceededBudget.remaining))}.`
    });
  } else {
    const warningBudget = budgetData.budgets.find(b => b.status === "warning");
    if (warningBudget) {
      insights.push({
        type: "warning",
        icon: "⚡",
        title: "Approaching Budget Limit",
        message: `You have used ${formatPercentage(warningBudget.usagePercentage)} of your ${warningBudget.categoryLabel} budget.`
      });
    }
  }

  // Rule 6: Savings Goal Milestone
  const nearlyDoneGoal = goalsData.activeGoals.find(g => g.progressPercentage >= 70);
  if (nearlyDoneGoal) {
    insights.push({
      type: "success",
      icon: "🌟",
      title: "Goal Milestone in Sight",
      message: `You are ${formatPercentage(nearlyDoneGoal.progressPercentage)} of the way toward reaching your "${nearlyDoneGoal.title}" goal!`
    });
  }

  // Fallback if no specific triggers
  if (insights.length === 0) {
    insights.push({
      type: "info",
      icon: "✨",
      title: "Balanced Finances",
      message: "Your financial activities are running smoothly this month. Keep maintaining your daily ledger."
    });
  }

  return insights;
}
