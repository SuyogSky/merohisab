/**
 * MeroHisab — Complete Monthly Budget Management View
 * Features Period Selectors (YYYY-MM), Category Allocation Cards,
 * Progress Meters with Safe/Warning/Exceeded Thresholds, and Overall Period Summaries.
 */

import { formatCurrency, formatPercentage } from "../utils/formatters.js";
import { EXPENSE_CATEGORIES } from "../core/constants.js";
import { getBudgetAnalysis } from "../services/budgets.js";
import { setBudget, deleteBudget } from "../core/state.js";
import { openModal } from "../components/modal.js";
import { showConfirmDialog } from "../components/confirm-dialog.js";
import { showToast } from "../components/toast.js";

// Active selected budget month
let selectedPeriod = "2026-10";

export function renderBudgets(container, state) {
  // If state has transactions and selectedPeriod has no transactions or budgets, try latest month
  const allMonths = Array.from(
    new Set([
      ...(state.budgets || []).map(b => b.period),
      ...(state.transactions || []).map(t => t.dateAD.slice(0, 7))
    ])
  ).sort();

  if (allMonths.length > 0 && !allMonths.includes(selectedPeriod)) {
    selectedPeriod = allMonths[allMonths.length - 1];
  }

  const analysis = getBudgetAnalysis(state, selectedPeriod);

  container.innerHTML = `
    <!-- Budgets Header & Controls -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-6);">
      <div>
        <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--text-primary); margin-bottom: 2px;">
          Monthly Budget Planning
        </h2>
        <span style="font-size: var(--font-size-xs); color: var(--text-muted);">
          Set limits per expense category and prevent overspending.
        </span>
      </div>

      <div style="display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;">
        <!-- Period Selector -->
        <div style="display: flex; align-items: center; gap: var(--space-2);">
          <label for="budget-period-select" style="font-size: var(--font-size-xs); color: var(--text-secondary); font-weight: var(--font-weight-medium);">Month:</label>
          <input
            type="month"
            id="budget-period-select"
            class="form-input"
            style="padding: 6px 10px; font-size: var(--font-size-sm); width: auto;"
            value="${selectedPeriod}"
          />
        </div>

        <button id="btn-add-budget" class="btn btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Create Budget</span>
        </button>
      </div>
    </div>

    <!-- Overall Monthly Budget Summary Card -->
    <div class="content-card" style="margin-bottom: var(--space-6);">
      <div class="content-card-body" style="padding: var(--space-5) var(--space-6);">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-6); align-items: center;">
          <div>
            <div style="font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-secondary); text-transform: uppercase;">
              Total Monthly Budget
            </div>
            <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--text-primary); margin-top: 2px;">
              ${formatCurrency(analysis.totalBudgeted)}
            </div>
          </div>

          <div>
            <div style="font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-secondary); text-transform: uppercase;">
              Total Spent in Budgeted
            </div>
            <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: ${analysis.overallUsagePct >= 100 ? "var(--color-expense)" : "var(--text-primary)"}; margin-top: 2px;">
              ${formatCurrency(analysis.totalSpentInBudgeted)}
            </div>
          </div>

          <div>
            <div style="font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-secondary); text-transform: uppercase;">
              Remaining Unspent
            </div>
            <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: ${analysis.totalRemaining >= 0 ? "var(--color-primary)" : "var(--color-expense)"}; margin-top: 2px;">
              ${analysis.totalRemaining >= 0 ? "" : "-"}${formatCurrency(Math.abs(analysis.totalRemaining))}
            </div>
          </div>

          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <span style="font-size: var(--font-size-xs); color: var(--text-secondary);">Overall Utilization</span>
              <span class="badge badge-${analysis.overallStatus}">${analysis.overallStatusLabel} (${formatPercentage(analysis.overallUsagePct)})</span>
            </div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill ${analysis.overallStatus}" style="width: ${Math.min(100, Math.round(analysis.overallUsagePct))}%;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Category Budgets Grid -->
    <div style="margin-bottom: var(--space-4); display: flex; align-items: center; justify-content: space-between;">
      <h3 style="font-size: var(--font-size-base); font-weight: var(--font-weight-bold); color: var(--text-primary);">
        Category Limits for ${selectedPeriod}
      </h3>
      <span style="font-size: var(--font-size-xs); color: var(--text-muted);">
        ${analysis.budgets.length} Category Budgets Configured
      </span>
    </div>

    ${
      analysis.budgets.length === 0
        ? `
      <div class="content-card">
        <div class="content-card-body">
          <div class="placeholder-box" style="padding: var(--space-10) var(--space-6);">
            <div style="font-size: 2.5rem; margin-bottom: var(--space-2);">🎯</div>
            <div class="placeholder-title" style="font-size: var(--font-size-base);">No Budgets Configured for ${selectedPeriod}</div>
            <div class="placeholder-desc">
              Create category budgets to establish spending guardrails for this month and receive visual alert notifications.
            </div>
            <button id="btn-empty-add-budget" class="btn btn-primary" style="margin-top: var(--space-4);">
              + Set First Budget for ${selectedPeriod}
            </button>
          </div>
        </div>
      </div>
    `
        : `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: var(--space-5);">
        ${analysis.budgets
          .map(
            b => `
          <div class="content-card" style="border-top: 3px solid ${b.categoryColor};">
            <div class="content-card-body" style="padding: var(--space-5);">
              <!-- Card Header -->
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-4);">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                  <div class="tx-category-icon" style="background-color: ${b.categoryColor}18; border-color: ${b.categoryColor}40;">
                    ${b.categoryIcon}
                  </div>
                  <div>
                    <div style="font-weight: var(--font-weight-semibold); color: var(--text-primary);">
                      ${escapeHtml(b.categoryLabel)}
                    </div>
                    <div style="font-size: var(--font-size-xs); color: var(--text-muted);">
                      Limit: ${formatCurrency(b.amount)}
                    </div>
                  </div>
                </div>

                <span class="badge badge-${b.status}">${b.statusLabel}</span>
              </div>

              <!-- Meter Bar -->
              <div style="margin-bottom: var(--space-3);">
                <div style="display: flex; justify-content: space-between; font-size: var(--font-size-xs); margin-bottom: 6px;">
                  <span style="color: var(--text-secondary);">Spent: <strong>${formatCurrency(b.spent)}</strong></span>
                  <span style="font-weight: var(--font-weight-bold); color: var(--text-primary);">${formatPercentage(b.usagePercentage)}</span>
                </div>
                <div class="progress-bar-track">
                  <div class="progress-bar-fill ${b.status}" style="width: ${Math.min(100, Math.round(b.usagePercentage))}%;"></div>
                </div>
              </div>

              <!-- Remaining / Overspent Note & Actions -->
              <div style="display: flex; align-items: center; justify-content: space-between; padding-top: var(--space-3); border-top: 1px solid var(--border-subtle); font-size: var(--font-size-xs);">
                <div>
                  ${
                    b.remaining >= 0
                      ? `<span style="color: var(--text-muted);">Remaining: <strong style="color: var(--color-primary);">${formatCurrency(b.remaining)}</strong></span>`
                      : `<span style="color: var(--color-expense); font-weight: var(--font-weight-semibold);">Over by ${formatCurrency(Math.abs(b.remaining))}</span>`
                  }
                </div>

                <div style="display: flex; gap: var(--space-1);">
                  <button class="btn-icon btn-edit-budget" data-id="${b.id}" title="Edit Budget Amount" style="width: 28px; height: 28px; font-size: 0.75rem;">
                    ✏️
                  </button>
                  <button class="btn-icon btn-delete-budget" data-id="${b.id}" title="Delete Budget" style="width: 28px; height: 28px; font-size: 0.75rem; color: var(--color-expense);">
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `
    }
  `;

  // Bind Events
  const periodSelect = container.querySelector("#budget-period-select");
  if (periodSelect) {
    periodSelect.addEventListener("change", e => {
      if (e.target.value) {
        selectedPeriod = e.target.value;
        renderBudgets(container, state);
      }
    });
  }

  const addBtn = container.querySelector("#btn-add-budget");
  if (addBtn) {
    addBtn.addEventListener("click", () => openBudgetModal(null, selectedPeriod));
  }

  const emptyAddBtn = container.querySelector("#btn-empty-add-budget");
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener("click", () => openBudgetModal(null, selectedPeriod));
  }

  container.querySelectorAll(".btn-edit-budget").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const budget = state.budgets.find(b => b.id === id);
      if (budget) openBudgetModal(budget, selectedPeriod);
    });
  });

  container.querySelectorAll(".btn-delete-budget").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const budget = state.budgets.find(b => b.id === id);
      if (!budget) return;

      const confirmed = await showConfirmDialog({
        title: "Delete Budget",
        message: `Are you sure you want to delete the ${budget.category} budget for ${budget.period}? Tracked transactions will not be deleted.`,
        confirmLabel: "Delete Budget",
        isDestructive: true
      });

      if (confirmed) {
        deleteBudget(id);
        showToast("Budget deleted successfully.", "info");
      }
    });
  });
}

/**
 * Open Modal to Create or Edit a Monthly Category Budget
 * @param {object} [existingBudget=null]
 * @param {string} [defaultPeriod="2026-10"]
 */
export function openBudgetModal(existingBudget = null, defaultPeriod = "2026-10") {
  const isEditing = Boolean(existingBudget && existingBudget.id);
  const period = existingBudget ? existingBudget.period : defaultPeriod;
  const initialCategory = existingBudget ? existingBudget.category : "";
  const initialAmount = existingBudget ? existingBudget.amount : "";

  const formHtml = `
    <form id="budget-form" onsubmit="return false;">
      <div class="form-group">
        <label class="form-label">Budget Period (Month) *</label>
        <input
          type="month"
          id="budget-modal-period"
          class="form-input"
          value="${period}"
          ${isEditing ? "readonly style='background-color: var(--bg-card-subtle);'" : ""}
          required
        />
      </div>

      <div class="form-group">
        <label class="form-label">Expense Category *</label>
        <select id="budget-modal-category" class="form-select" ${isEditing ? "disabled" : ""} required>
          ${EXPENSE_CATEGORIES.map(
            c => `<option value="${c.id}" ${initialCategory === c.id ? "selected" : ""}>${c.label} (${c.nepaliLabel})</option>`
          ).join("")}
        </select>
        ${isEditing ? "<span class='input-help'>Category cannot be changed while editing.</span>" : ""}
      </div>

      <div class="form-group">
        <label class="form-label">Spending Limit (NPR / रुपैयाँ) *</label>
        <input
          type="number"
          id="budget-modal-amount"
          class="form-input"
          placeholder="e.g. 15000"
          min="1"
          step="100"
          value="${initialAmount}"
          required
        />
        <span class="input-help">Thresholds: &lt;75% Safe (Emerald), 75-99% Warning (Amber), 100%+ Exceeded (Crimson).</span>
      </div>

      <div id="budget-modal-error" class="form-error" style="display: none;"></div>
    </form>
  `;

  openModal({
    title: isEditing ? "Edit Budget Limit" : "Create Category Budget",
    contentHtml: formHtml,
    saveLabel: isEditing ? "Save Budget" : "Create Budget",
    onSave: modalBody => {
      const budgetPeriod = modalBody.querySelector("#budget-modal-period").value;
      const category = modalBody.querySelector("#budget-modal-category").value;
      const amount = modalBody.querySelector("#budget-modal-amount").value;
      const errorDiv = modalBody.querySelector("#budget-modal-error");

      const payload = {
        id: isEditing ? existingBudget.id : undefined,
        period: budgetPeriod,
        category,
        amount: Number(amount)
      };

      const result = setBudget(payload);
      if (!result.success) {
        errorDiv.textContent = result.errors.join(" ");
        errorDiv.style.display = "block";
        return false;
      }

      showToast(isEditing ? "Budget updated successfully!" : "Budget created successfully!", "success");
      return true;
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
