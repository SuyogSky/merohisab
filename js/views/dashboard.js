/**
 * MeroHisab — Complete Dashboard View Controller
 * Features 6 financial KPI cards, native Canvas charts, quick actions,
 * recent transactions, budget overview, savings goals, and deterministic insights.
 */

import { formatCurrency, formatPercentage, formatTransactionDate } from "../utils/formatters.js";
import { calculateFinancialSummary, getCategoryIcon } from "../services/transactions.js";
import { getBudgetAnalysis } from "../services/budgets.js";
import { getGoalsAnalysis } from "../services/goals.js";
import { getAnalyticsData } from "../services/analytics.js";
import { generateFinancialInsights } from "../services/insights.js";
import { renderGroupedBarChart, renderDonutChart } from "../utils/canvas-charts.js";
import { openTransactionModal } from "./transactions.js";
import { openBudgetModal } from "./budgets.js";
import { openGoalModal } from "./goals.js";
import { computeBillStatus } from "../core/state.js";

export function renderDashboard(container, state) {
  const summary = calculateFinancialSummary(state);
  const selectedMonth = summary.selectedMonth;

  const budgetData = getBudgetAnalysis(state, selectedMonth);
  const goalsData = getGoalsAnalysis(state);
  const analyticsData = getAnalyticsData(state, "month", selectedMonth);
  const insights = generateFinancialInsights(state, selectedMonth);

  // Recent 5 transactions
  const recentTransactions = [...state.transactions]
    .sort((a, b) => new Date(b.dateAD) - new Date(a.dateAD) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  // --- Bills & Recurring reminder ---
  const todayAD = new Date().toISOString().slice(0, 10);
  const bills = state.bills || [];
  const urgentBills = bills.filter(b => {
    const status = computeBillStatus(b, todayAD);
    return status === "overdue" || status === "dueSoon";
  });

  const recurringRules = state.recurringRules || [];
  const dueRecurring = recurringRules.filter(r => {
    if (r.isPaused) return false;
    if (!r.nextOccurrence) return false;
    return r.nextOccurrence <= todayAD;
  });

  const hasReminders = urgentBills.length > 0 || dueRecurring.length > 0;
  const reminderParts = [];
  if (urgentBills.length > 0) {
    const overdueCount = urgentBills.filter(b => computeBillStatus(b, todayAD) === "overdue").length;
    const dueSoonCount = urgentBills.filter(b => computeBillStatus(b, todayAD) === "dueSoon").length;
    if (overdueCount > 0) reminderParts.push(`<strong>${overdueCount}</strong> overdue bill${overdueCount !== 1 ? "s" : ""}`);
    if (dueSoonCount > 0) reminderParts.push(`<strong>${dueSoonCount}</strong> bill${dueSoonCount !== 1 ? "s" : ""} due soon`);
  }
  if (dueRecurring.length > 0) {
    reminderParts.push(`<strong>${dueRecurring.length}</strong> recurring transaction${dueRecurring.length !== 1 ? "s" : ""} ready to process`);
  }

  const reminderBannerHtml = hasReminders ? `
    <div style="
      display: flex; align-items: flex-start; gap: var(--space-3);
      padding: var(--space-4); margin-bottom: var(--space-6);
      background-color: var(--color-warning-light, rgba(245,158,11,0.12));
      border: 1px solid var(--color-warning, #f59e0b);
      border-radius: var(--radius-md);
    ">
      <span style="font-size: 1.25rem; flex-shrink: 0;">⚠️</span>
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: var(--font-weight-semibold); color: var(--text-primary); margin-bottom: var(--space-1);">
          Action Required
        </div>
        <div style="font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.5;">
          You have ${reminderParts.join(" and ")}.
        </div>
        <div style="display: flex; gap: var(--space-2); margin-top: var(--space-3); flex-wrap: wrap;">
          ${urgentBills.length > 0 ? `<a href="#bills" data-route="bills" class="btn btn-secondary" style="padding: 4px 12px; font-size: var(--font-size-xs);">View Bills →</a>` : ""}
          ${dueRecurring.length > 0 ? `<a href="#recurring" data-route="recurring" class="btn btn-secondary" style="padding: 4px 12px; font-size: var(--font-size-xs);">View Recurring →</a>` : ""}
        </div>
      </div>
    </div>
  ` : "";

  container.innerHTML = `
    ${reminderBannerHtml}
    <!-- Quick Action Bar -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-6);">
      <div style="display: flex; align-items: center; gap: var(--space-2);">
        <span style="font-size: var(--font-size-sm); color: var(--text-secondary); font-weight: var(--font-weight-medium);">Active Period:</span>
        <span class="badge badge-method" style="font-size: var(--font-size-xs); font-weight: var(--font-weight-bold);">${selectedMonth}</span>
      </div>

      <div style="display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;">
        <button id="btn-quick-income" class="btn btn-primary" style="background-color: var(--color-income);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Add Income</span>
        </button>

        <button id="btn-quick-expense" class="btn btn-primary" style="background-color: var(--color-expense);">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Add Expense</span>
        </button>

        <button id="btn-quick-budget" class="btn btn-secondary">
          <span>+ Budget</span>
        </button>

        <button id="btn-quick-goal" class="btn btn-secondary">
          <span>+ Savings Goal</span>
        </button>
      </div>
    </div>

    <!-- Top 6 Financial Summary Cards -->
    <div class="kpi-grid">
      <!-- 1. Estimated Ledger Balance -->
      <div class="kpi-card balance">
        <div class="kpi-header">
          <div class="kpi-title-wrap">
            <span class="kpi-label">Estimated Ledger Balance</span>
            <span class="info-tip" data-tooltip="Calculated from opening balance as of ${summary.initialBalanceDate} plus active income minus expenses. Not connected to live bank accounts.">ℹ️</span>
          </div>
          <div class="kpi-icon-wrap">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="4" width="20" height="16" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
          </div>
        </div>
        <div class="kpi-amount">${formatCurrency(summary.estimatedLedgerBalance)}</div>
        <div class="kpi-subtext">
          <span>Opening: ${formatCurrency(summary.initialBalance, false)}</span>
          <span>•</span>
          <span style="color: var(--color-primary);">Active Ledger</span>
        </div>
      </div>

      <!-- 2. Monthly Inflow -->
      <div class="kpi-card income">
        <div class="kpi-header">
          <div class="kpi-title-wrap">
            <span class="kpi-label">Monthly Inflow</span>
          </div>
          <div class="kpi-icon-wrap">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="19" x2="12" y2="5"></line>
              <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
          </div>
        </div>
        <div class="kpi-amount" style="color: var(--color-income);">${formatCurrency(summary.monthlyInflow)}</div>
        <div class="kpi-subtext">
          <span>Income received this month</span>
        </div>
      </div>

      <!-- 3. Monthly Outflow -->
      <div class="kpi-card expense">
        <div class="kpi-header">
          <div class="kpi-title-wrap">
            <span class="kpi-label">Monthly Outflow</span>
          </div>
          <div class="kpi-icon-wrap">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <polyline points="19 12 12 19 5 12"></polyline>
            </svg>
          </div>
        </div>
        <div class="kpi-amount" style="color: var(--color-expense);">${formatCurrency(summary.monthlyOutflow)}</div>
        <div class="kpi-subtext">
          <span>Expenses spent this month</span>
        </div>
      </div>

      <!-- 4. Net Cash Flow -->
      <div class="kpi-card cashflow">
        <div class="kpi-header">
          <div class="kpi-title-wrap">
            <span class="kpi-label">Net Cash Flow</span>
          </div>
          <div class="kpi-icon-wrap">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
        </div>
        <div class="kpi-amount" style="color: ${summary.netCashFlow >= 0 ? "var(--color-primary)" : "var(--color-expense)"};">
          ${summary.netCashFlow >= 0 ? "+" : ""}${formatCurrency(summary.netCashFlow)}
        </div>
        <div class="kpi-subtext">
          <span>${summary.netCashFlow >= 0 ? "Net Surplus" : "Net Deficit"}</span>
        </div>
      </div>

      <!-- 5. Savings Rate -->
      <div class="kpi-card">
        <div class="kpi-header">
          <div class="kpi-title-wrap">
            <span class="kpi-label">Savings Rate</span>
          </div>
          <div class="kpi-icon-wrap" style="background-color: var(--color-primary-light); color: var(--color-primary);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
        </div>
        <div class="kpi-amount" style="color: var(--color-primary);">${formatPercentage(summary.savingsRate)}</div>
        <div class="kpi-subtext">
          <span>Target baseline: 20%+</span>
        </div>
      </div>

      <!-- 6. Available to Allocate -->
      <div class="kpi-card" style="border-left: 3px solid var(--color-info);">
        <div class="kpi-header">
          <div class="kpi-title-wrap">
            <span class="kpi-label">Available to Allocate</span>
            <span class="info-tip" data-tooltip="Estimated ledger balance minus funds earmarked for savings goals. Represents uncommitted cash.">ℹ️</span>
          </div>
          <div class="kpi-icon-wrap" style="background-color: var(--color-info-light); color: var(--color-info);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </div>
        </div>
        <div class="kpi-amount" style="color: ${summary.availableToAllocate >= 0 ? "var(--text-primary)" : "var(--color-expense)"};">
          ${formatCurrency(summary.availableToAllocate)}
        </div>
        <div class="kpi-subtext">
          <span>Earmarked: ${formatCurrency(summary.totalEarmarkedSavings, false)}</span>
        </div>
      </div>
    </div>

    <!-- Row 2: Native Canvas Charts -->
    <div class="dashboard-grid-2">
      <!-- Income vs Expense Bar Chart -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
            <span>Monthly Cash Flow (Income vs Expenses)</span>
          </div>
          <div style="display: flex; gap: var(--space-3); font-size: var(--font-size-xs);">
            <span style="display: flex; align-items: center; gap: 4px;">
              <span style="width: 10px; height: 10px; border-radius: 2px; background-color: var(--color-income);"></span>
              <span>Income</span>
            </span>
            <span style="display: flex; align-items: center; gap: 4px;">
              <span style="width: 10px; height: 10px; border-radius: 2px; background-color: var(--color-expense);"></span>
              <span>Expenses</span>
            </span>
          </div>
        </div>
        <div class="content-card-body" style="height: 280px; position: relative;">
          <canvas id="dashboard-bar-chart" style="width: 100%; height: 100%;"></canvas>
        </div>
      </div>

      <!-- Expense Category Breakdown Donut Chart -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
              <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
            </svg>
            <span>Expense Distribution</span>
          </div>
          <span class="badge badge-method">${selectedMonth}</span>
        </div>
        <div class="content-card-body" style="height: 280px; position: relative;">
          <canvas id="dashboard-donut-chart" style="width: 100%; height: 100%;"></canvas>
        </div>
      </div>
    </div>

    <!-- Row 3: Recent Activity, Active Budgets, Savings Goals & Insights -->
    <div class="dashboard-grid-3">
      <!-- 1. Recent Activity -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span>Recent Activity</span>
          </div>
          <a href="#transactions" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" data-route="transactions">View All</a>
        </div>
        <div class="content-card-body" style="padding-top: var(--space-2); padding-bottom: var(--space-2);">
          ${
            recentTransactions.length === 0
              ? `<div style="padding: var(--space-8); text-align: center; color: var(--text-muted); font-size: var(--font-size-sm);">No transactions recorded yet.</div>`
              : `<div class="tx-list">
                  ${recentTransactions
                    .map(
                      tx => `
                    <div class="tx-item">
                      <div class="tx-left">
                        <div class="tx-category-icon">
                          ${getCategoryIcon(tx.category)}
                        </div>
                        <div class="tx-details">
                          <span class="tx-title">${escapeHtml(tx.description)}</span>
                          <span class="tx-meta">
                            <span>${formatTransactionDate(tx.dateAD, tx.dateBS).inline}</span>
                          </span>
                        </div>
                      </div>
                      <div class="tx-right">
                        <span class="tx-amount ${tx.type}">
                          ${tx.type === "income" ? "+" : "-"}${formatCurrency(tx.amount)}
                        </span>
                        <span class="tx-method">${escapeHtml(tx.paymentMethod)}</span>
                      </div>
                    </div>
                  `
                    )
                    .join("")}
                </div>`
          }
        </div>
      </div>

      <!-- 2. Active Monthly Budgets -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
            <span>Budgets (${selectedMonth})</span>
          </div>
          <a href="#budgets" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" data-route="budgets">Manage</a>
        </div>
        <div class="content-card-body">
          ${
            budgetData.budgets.length === 0
              ? `<div style="padding: var(--space-6); text-align: center; color: var(--text-muted); font-size: var(--font-size-sm);">No budgets created for ${selectedMonth}.</div>`
              : budgetData.budgets
                  .slice(0, 4)
                  .map(
                    b => `
                <div class="budget-item">
                  <div class="budget-info">
                    <div style="display: flex; align-items: center; gap: var(--space-2);">
                      <span class="budget-cat-name">${escapeHtml(b.categoryLabel)}</span>
                      <span class="badge badge-${b.status}">${b.statusLabel}</span>
                    </div>
                    <span class="budget-values">
                      ${formatCurrency(b.spent, false)} / ${formatCurrency(b.amount, false)} (${Math.round(b.usagePercentage)}%)
                    </span>
                  </div>
                  <div class="progress-bar-track">
                    <div class="progress-bar-fill ${b.status}" style="width: ${Math.min(100, Math.round(b.usagePercentage))}%;"></div>
                  </div>
                </div>
              `
                  )
                  .join("")
          }
        </div>
      </div>

      <!-- 3. Savings Goals & Insights -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <span>Goals & Insights</span>
          </div>
          <a href="#goals" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" data-route="goals">Goals</a>
        </div>
        <div class="content-card-body">
          <!-- Savings Goals Section -->
          <div style="margin-bottom: var(--space-5);">
            <div style="font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); color: var(--text-secondary); text-transform: uppercase; margin-bottom: var(--space-2);">
              Savings Targets
            </div>
            ${
              goalsData.goals.length === 0
                ? `<div style="color: var(--text-muted); font-size: var(--font-size-xs);">No savings goals created yet.</div>`
                : goalsData.goals
                    .slice(0, 2)
                    .map(
                      g => `
                  <div class="goal-mini-item">
                    <div class="goal-mini-header">
                      <span class="goal-mini-title">${escapeHtml(g.title)}</span>
                      <span class="goal-mini-pct">${Math.round(g.progressPercentage)}%</span>
                    </div>
                    <div class="progress-bar-track">
                      <div class="progress-bar-fill safe" style="width: ${Math.round(g.progressPercentage)}%;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.6875rem; color: var(--text-muted); margin-top: 4px;">
                      <span>Saved: ${formatCurrency(g.savedAmount, false)}</span>
                      <span>Target: ${formatCurrency(g.targetAmount, false)}</span>
                    </div>
                  </div>
                `
                    )
                    .join("")
            }
          </div>

          <!-- Financial Insights -->
          <div>
            <div style="font-size: var(--font-size-xs); font-weight: var(--font-weight-bold); color: var(--text-secondary); text-transform: uppercase; margin-bottom: var(--space-2);">
              Automated Financial Insights
            </div>
            ${insights
              .slice(0, 2)
              .map(
                ins => `
              <div class="insight-item ${ins.type === "warning" ? "warning" : ""}">
                <span class="insight-icon">${ins.icon}</span>
                <div class="insight-text">
                  <strong>${escapeHtml(ins.title)}:</strong> ${escapeHtml(ins.message)}
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind Quick Actions
  const btnIncome = container.querySelector("#btn-quick-income");
  if (btnIncome) {
    btnIncome.addEventListener("click", () => openTransactionModal({ type: "income" }));
  }

  const btnExpense = container.querySelector("#btn-quick-expense");
  if (btnExpense) {
    btnExpense.addEventListener("click", () => openTransactionModal({ type: "expense" }));
  }

  const btnBudget = container.querySelector("#btn-quick-budget");
  if (btnBudget) {
    btnBudget.addEventListener("click", () => openBudgetModal({ period: selectedMonth }));
  }

  const btnGoal = container.querySelector("#btn-quick-goal");
  if (btnGoal) {
    btnGoal.addEventListener("click", () => openGoalModal());
  }

  // Render Charts after DOM mount
  requestAnimationFrame(() => {
    // 1. Grouped Bar Chart
    const barCanvas = container.querySelector("#dashboard-bar-chart");
    if (barCanvas) {
      const labels = analyticsData.monthlyTrends.map(m => m.month.slice(5)); // e.g. "09", "10"
      const incomeData = analyticsData.monthlyTrends.map(m => m.income);
      const expenseData = analyticsData.monthlyTrends.map(m => m.expense);

      renderGroupedBarChart(barCanvas, {
        labels: labels.length > 0 ? labels : [selectedMonth.slice(5)],
        series: [
          { name: "Income", data: incomeData.length > 0 ? incomeData : [summary.monthlyInflow], color: "#10b981" },
          { name: "Expenses", data: expenseData.length > 0 ? expenseData : [summary.monthlyOutflow], color: "#f43f5e" }
        ]
      });
    }

    // 2. Donut Chart
    const donutCanvas = container.querySelector("#dashboard-donut-chart");
    if (donutCanvas) {
      const donutData = analyticsData.categoryBreakdown.map(c => ({
        label: c.label,
        value: c.amount,
        color: c.color
      }));
      renderDonutChart(donutCanvas, { data: donutData });
    }
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
