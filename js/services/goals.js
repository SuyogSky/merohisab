/**
 * MeroHisab — Savings Goals Service
 * Manages earmarked fund calculations, progress tracking, and allocation limits.
 */

import { calculateFinancialSummary } from "./transactions.js";

/**
 * Analyze savings goals with current progress and financial health
 */
export function getGoalsAnalysis(state) {
  const summary = calculateFinancialSummary(state);
  const rawGoals = state.goals || [];

  const analyzedGoals = rawGoals.map(g => {
    const allocations = g.allocations || [];
    const savedAmount = allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
    const targetAmount = Number(g.targetAmount) || 0;
    const remainingAmount = Math.max(0, targetAmount - savedAmount);
    const progressPercentage = targetAmount > 0 ? Math.min(100, (savedAmount / targetAmount) * 100) : 0;
    const isCompleted = savedAmount >= targetAmount;

    // Calculate days remaining if target date exists (comparing pure date-only values)
    let daysRemaining = null;
    let isOverdue = false;
    if (g.targetDateAD && /^\d{4}-\d{2}-\d{2}$/.test(g.targetDateAD)) {
      const now = new Date();
      const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

      const [tY, tM, tD] = g.targetDateAD.split("-").map(Number);
      const targetUtc = Date.UTC(tY, tM - 1, tD);

      daysRemaining = Math.round((targetUtc - todayUtc) / 86400000);
      if (daysRemaining < 0 && !isCompleted) {
        isOverdue = true;
      }
    }

    return {
      ...g,
      savedAmount,
      targetAmount,
      remainingAmount,
      progressPercentage,
      isCompleted,
      daysRemaining,
      isOverdue,
      allocations: [...allocations].sort((a, b) => (b.dateAD || "").localeCompare(a.dateAD || ""))
    };
  });

  const activeGoals = analyzedGoals.filter(g => !g.isCompleted);
  const completedGoals = analyzedGoals.filter(g => g.isCompleted);

  const totalTarget = analyzedGoals.reduce((sum, g) => sum + g.targetAmount, 0);
  const totalSaved = analyzedGoals.reduce((sum, g) => sum + g.savedAmount, 0);
  const overallProgress = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;

  return {
    goals: analyzedGoals,
    activeGoals,
    completedGoals,
    totalTarget,
    totalSaved,
    overallProgress,
    availableToAllocate: summary.availableToAllocate,
    estimatedLedgerBalance: summary.estimatedLedgerBalance
  };
}
