/**
 * MeroHisab — Savings Goals Service (Integer Paisa Engine)
 * Manages earmarked fund calculations, progress tracking, and allocation limits with exact integer Paisa arithmetic.
 */

import { calculateFinancialSummary } from "./transactions.js";
import { toPaisaBigInt, fromPaisaBigInt } from "../utils/money.js";
import { getTodayLocalDateString } from "../utils/nepali-calendar.js";

/**
 * Analyze savings goals with current progress and financial health
 */
export function getGoalsAnalysis(state) {
  const summary = calculateFinancialSummary(state);
  const rawGoals = state.goals || [];

  const analyzedGoals = rawGoals.map(g => {
    const allocations = g.allocations || [];
    const savedPaisa = allocations.reduce((sum, a) => sum + toPaisaBigInt(a.amount || 0), 0n);
    const targetPaisa = toPaisaBigInt(g.targetAmount || 0);
    const savedAmount = fromPaisaBigInt(savedPaisa);
    const targetAmount = fromPaisaBigInt(targetPaisa);
    const remPaisa = targetPaisa > savedPaisa ? targetPaisa - savedPaisa : 0n;
    const remainingAmount = fromPaisaBigInt(remPaisa);
    const progressPercentage = targetPaisa > 0n ? Math.min(100, Number((savedPaisa * 10000n) / targetPaisa) / 100) : 0;
    const isCompleted = savedPaisa >= targetPaisa;

    // Calculate days remaining using authoritative Nepal local date
    let daysRemaining = null;
    let isOverdue = false;
    if (g.targetDateAD && /^\d{4}-\d{2}-\d{2}$/.test(g.targetDateAD)) {
      const todayStr = getTodayLocalDateString();
      const [nowY, nowM, nowD] = todayStr.split("-").map(Number);
      const todayUtc = Date.UTC(nowY, nowM - 1, nowD);

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

  const totalTargetPaisa = analyzedGoals.reduce((sum, g) => sum + toPaisaBigInt(g.targetAmount), 0n);
  const totalSavedPaisa = analyzedGoals.reduce((sum, g) => sum + toPaisaBigInt(g.savedAmount), 0n);
  const totalTarget = fromPaisaBigInt(totalTargetPaisa);
  const totalSaved = fromPaisaBigInt(totalSavedPaisa);
  const overallProgress = totalTargetPaisa > 0n ? Number((totalSavedPaisa * 10000n) / totalTargetPaisa) / 100 : 0;

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
