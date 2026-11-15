/**
 * MeroHisab — Complete Savings Goals Management View
 * Features Goal Creation, Target Progress Tracking, Milestone Badges,
 * and Allocation Protection (Validating against Available Unallocated Balance).
 */

import { formatCurrency, formatPercentage } from "../utils/formatters.js";
import { getGoalsAnalysis } from "../services/goals.js";
import { addGoal, updateGoal, deleteGoal, addGoalAllocation, removeGoalAllocation } from "../core/state.js";
import { openModal } from "../components/modal.js";
import { showConfirmDialog } from "../components/confirm-dialog.js";
import { showToast } from "../components/toast.js";
import { adToBs, getTodayLocalDateString } from "../utils/nepali-calendar.js";

export function renderGoals(container, state) {
  const analysis = getGoalsAnalysis(state);

  container.innerHTML = `
    <!-- Goals Header -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-6);">
      <div>
        <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--text-primary); margin-bottom: 2px;">
          Savings Goals & Earmarks
        </h2>
        <span style="font-size: var(--font-size-xs); color: var(--text-muted);">
          Allocate liquid funds into dedicated goal buckets without distorting operational expenses.
        </span>
      </div>

      <button id="btn-add-goal" class="btn btn-primary">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Create Savings Goal</span>
      </button>
    </div>

    <!-- Earmarked Balance Summary Card -->
    <div class="content-card" style="margin-bottom: var(--space-6); border-left: 4px solid var(--color-info);">
      <div class="content-card-body" style="padding: var(--space-5) var(--space-6);">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-6); align-items: center;">
          <div>
            <div style="font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-secondary); text-transform: uppercase;">
              Available to Allocate
            </div>
            <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--color-primary); margin-top: 2px;">
              ${formatCurrency(analysis.availableToAllocate)}
            </div>
            <div style="font-size: 0.6875rem; color: var(--text-muted); margin-top: 2px;">
              Ledger Balance: ${formatCurrency(analysis.estimatedLedgerBalance, false)}
            </div>
          </div>

          <div>
            <div style="font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-secondary); text-transform: uppercase;">
              Total Earmarked in Goals
            </div>
            <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--text-primary); margin-top: 2px;">
              ${formatCurrency(analysis.totalSaved)}
            </div>
            <div style="font-size: 0.6875rem; color: var(--text-muted); margin-top: 2px;">
              Across ${analysis.goals.length} Savings Goals
            </div>
          </div>

          <div>
            <div style="font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--text-secondary); text-transform: uppercase;">
              Aggregate Target
            </div>
            <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: var(--text-primary); margin-top: 2px;">
              ${formatCurrency(analysis.totalTarget)}
            </div>
            <div style="font-size: 0.6875rem; color: var(--text-muted); margin-top: 2px;">
              Overall Progress: ${formatPercentage(analysis.overallProgress)}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Active Goals Section -->
    <div style="margin-bottom: var(--space-8);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-4);">
        <h3 style="font-size: var(--font-size-base); font-weight: var(--font-weight-bold); color: var(--text-primary);">
          Active Goals (${analysis.activeGoals.length})
        </h3>
      </div>

      ${
        analysis.activeGoals.length === 0
          ? `
        <div class="content-card">
          <div class="content-card-body">
            <div class="placeholder-box" style="padding: var(--space-10) var(--space-6);">
              <div style="font-size: 2.5rem; margin-bottom: var(--space-2);">🌟</div>
              <div class="placeholder-title" style="font-size: var(--font-size-base);">No Active Savings Goals</div>
              <div class="placeholder-desc">
                Set a milestone for emergencies, festivals (Dashain/Tihar), travel, or equipment to protect your savings.
              </div>
              <button id="btn-empty-goal" class="btn btn-primary" style="margin-top: var(--space-4);">
                + Create Your First Goal
              </button>
            </div>
          </div>
        </div>
      `
          : `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: var(--space-6);">
          ${analysis.activeGoals.map(g => renderGoalCard(g, analysis.availableToAllocate)).join("")}
        </div>
      `
      }
    </div>

    <!-- Completed Goals Section (if any) -->
    ${
      analysis.completedGoals.length > 0
        ? `
      <div>
        <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-4);">
          <h3 style="font-size: var(--font-size-base); font-weight: var(--font-weight-bold); color: var(--text-primary);">
            🎉 Completed Goals (${analysis.completedGoals.length})
          </h3>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: var(--space-6);">
          ${analysis.completedGoals.map(g => renderGoalCard(g, analysis.availableToAllocate)).join("")}
        </div>
      </div>
    `
        : ""
    }
  `;

  // Bind Events
  bindGoalEvents(container, state, analysis.availableToAllocate);
}

function renderGoalCard(goal, availableToAllocate) {
  const isComplete = goal.isCompleted;

  return `
    <div class="content-card" style="border-top: 3px solid ${isComplete ? "var(--color-income)" : "var(--color-primary)"};">
      <div class="content-card-body" style="padding: var(--space-6);">
        <!-- Title & Category Header -->
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-3);">
          <div>
            <h4 style="font-size: var(--font-size-base); font-weight: var(--font-weight-bold); color: var(--text-primary);">
              ${escapeHtml(goal.title)}
            </h4>
            ${
              goal.description
                ? `<p style="font-size: var(--font-size-xs); color: var(--text-muted); margin-top: 2px;">${escapeHtml(goal.description)}</p>`
                : ""
            }
          </div>
          <span class="badge ${isComplete ? "badge-safe" : "badge-method"}">
            ${isComplete ? "Completed" : goal.category || "General"}
          </span>
        </div>

        <!-- Target Date -->
        ${
          goal.targetDateAD
            ? `
          <div style="display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-xs); color: var(--text-secondary); margin-bottom: var(--space-4);">
            <span>📅 Target: <strong>${goal.targetDateAD}</strong> (${goal.targetDateBS} BS)</span>
            ${
              goal.daysRemaining !== null
                ? `<span class="badge ${goal.isOverdue ? "badge-exceeded" : "badge-method"}" style="font-size: 0.6875rem;">
                    ${goal.isOverdue ? "Overdue" : `${goal.daysRemaining} days left`}
                  </span>`
                : ""
            }
          </div>
        `
            : ""
        }

        <!-- Progress Meter -->
        <div style="margin-bottom: var(--space-4);">
          <div style="display: flex; justify-content: space-between; font-size: var(--font-size-xs); margin-bottom: 6px;">
            <span style="color: var(--text-secondary);">Saved: <strong>${formatCurrency(goal.savedAmount)}</strong></span>
            <span style="font-weight: var(--font-weight-bold); color: var(--color-primary);">${Math.round(goal.progressPercentage)}%</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill safe" style="width: ${Math.round(goal.progressPercentage)}%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.6875rem; color: var(--text-muted); margin-top: 4px;">
            <span>Target: ${formatCurrency(goal.targetAmount)}</span>
            <span>${goal.remainingAmount > 0 ? `Remaining: ${formatCurrency(goal.remainingAmount)}` : "Goal Achieved!"}</span>
          </div>
        </div>

        <!-- Allocation History Preview -->
        <div style="background-color: var(--bg-card-subtle); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-bottom: var(--space-4);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2);">
            <span style="font-size: 0.6875rem; font-weight: var(--font-weight-bold); color: var(--text-secondary); text-transform: uppercase;">
              Allocations (${goal.allocations.length})
            </span>
            ${
              !isComplete
                ? `<button class="btn btn-secondary btn-add-allocation" data-id="${goal.id}" style="padding: 2px 8px; font-size: 0.6875rem;">
                    + Deposit Funds
                  </button>`
                : ""
            }
          </div>

          ${
            goal.allocations.length === 0
              ? `<div style="font-size: var(--font-size-xs); color: var(--text-muted);">No funds allocated yet. Click 'Deposit Funds'.</div>`
              : `
              <div style="max-height: 110px; overflow-y: auto;">
                ${goal.allocations
                  .map(
                    al => `
                  <div style="display: flex; align-items: center; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-size-xs);">
                    <div>
                      <span style="font-weight: var(--font-weight-medium); color: var(--text-primary);">${formatCurrency(al.amount)}</span>
                      <span style="color: var(--text-muted); font-size: 0.6875rem;">(${al.dateAD || "N/A"})</span>
                      ${al.note ? `<div style="color: var(--text-muted); font-size: 0.6875rem;">${escapeHtml(al.note)}</div>` : ""}
                    </div>
                    <button class="btn-icon btn-remove-alloc" data-goal-id="${goal.id}" data-alloc-id="${al.id}" title="Remove allocation" style="width: 22px; height: 22px; font-size: 0.6875rem; color: var(--color-expense);">
                      ✕
                    </button>
                  </div>
                `
                  )
                  .join("")}
              </div>
            `
          }
        </div>

        <!-- Card Footer Actions -->
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--border-subtle);">
          <button class="btn-icon btn-edit-goal" data-id="${goal.id}" title="Edit Goal Details" style="width: 32px; height: 32px; font-size: 0.8rem;">
            ✏️
          </button>
          <button class="btn-icon btn-delete-goal" data-id="${goal.id}" title="Delete Goal" style="width: 32px; height: 32px; font-size: 0.8rem; color: var(--color-expense);">
            🗑️
          </button>
        </div>
      </div>
    </div>
  `;
}

function bindGoalEvents(container, state, availableToAllocate) {
  const addBtn = container.querySelector("#btn-add-goal");
  if (addBtn) addBtn.addEventListener("click", () => openGoalModal());

  const emptyAddBtn = container.querySelector("#btn-empty-goal");
  if (emptyAddBtn) emptyAddBtn.addEventListener("click", () => openGoalModal());

  // Add allocation button
  container.querySelectorAll(".btn-add-allocation").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const goal = state.goals.find(g => g.id === id);
      if (goal) openAllocationModal(goal, availableToAllocate);
    });
  });

  // Remove allocation button
  container.querySelectorAll(".btn-remove-alloc").forEach(btn => {
    btn.addEventListener("click", async () => {
      const goalId = btn.getAttribute("data-goal-id");
      const allocId = btn.getAttribute("data-alloc-id");

      const confirmed = await showConfirmDialog({
        title: "Remove Allocation",
        message: "Removing this allocation will return the funds back into your available unallocated balance. Confirm?",
        confirmLabel: "Return Funds",
        isDestructive: false
      });

      if (confirmed) {
        const res = await removeGoalAllocation(goalId, allocId);
        if (res && res.success) {
          showToast("Allocation returned to available balance.", "info");
        } else {
          showToast(res?.error || "Failed to remove allocation.", "error");
        }
      }
    });
  });

  // Edit goal
  container.querySelectorAll(".btn-edit-goal").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const goal = state.goals.find(g => g.id === id);
      if (goal) openGoalModal(goal);
    });
  });

  // Delete goal
  container.querySelectorAll(".btn-delete-goal").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const goal = state.goals.find(g => g.id === id);
      if (!goal) return;

      const confirmed = await showConfirmDialog({
        title: "Delete Savings Goal",
        message: `Are you sure you want to delete "${goal.title}"? Any allocated funds will be released back into your available unallocated balance.`,
        confirmLabel: "Delete Goal",
        isDestructive: true
      });

      if (confirmed) {
        const res = await deleteGoal(id);
        if (res && res.success) {
          showToast("Goal deleted and funds released.", "info");
        } else {
          showToast(res?.error || "Failed to delete goal.", "error");
        }
      }
    });
  });
}

/**
 * Open Modal to Create or Edit a Savings Goal
 */
export function openGoalModal(existingGoal = null) {
  const isEditing = Boolean(existingGoal && existingGoal.id);
  const initialTitle = existingGoal ? existingGoal.title : "";
  const initialDesc = existingGoal ? existingGoal.description || "" : "";
  const initialTarget = existingGoal ? existingGoal.targetAmount : "";
  const initialDate = existingGoal ? existingGoal.targetDateAD || "" : "";
  const initialCat = existingGoal ? existingGoal.category || "General" : "General";

  const formHtml = `
    <form id="goal-form" onsubmit="return false;">
      <div class="form-group">
        <label class="form-label">Goal Name *</label>
        <input
          type="text"
          id="goal-modal-title"
          class="form-input"
          placeholder="e.g. Emergency Fund (6 Months)"
          value="${escapeHtml(initialTitle)}"
          required
        />
      </div>

      <div class="form-group">
        <label class="form-label">Category / Purpose</label>
        <input
          type="text"
          id="goal-modal-cat"
          class="form-input"
          placeholder="e.g. Emergency, Travel, Vehicle, Festival"
          value="${escapeHtml(initialCat)}"
        />
      </div>

      <div class="form-group">
        <label class="form-label">Target Amount (NPR / रुपैयाँ) *</label>
        <input
          type="number"
          id="goal-modal-target"
          class="form-input"
          placeholder="e.g. 150000"
          min="1"
          step="100"
          value="${initialTarget}"
          required
        />
      </div>

      <div class="form-group">
        <label class="form-label">Target Date (AD)</label>
        <input
          type="date"
          id="goal-modal-date"
          class="form-input"
          value="${initialDate}"
        />
        <span class="input-help">Optional milestone date. Will automatically display corresponding Nepali BS date.</span>
      </div>

      <div class="form-group">
        <label class="form-label">Description / Motivation</label>
        <textarea
          id="goal-modal-desc"
          class="form-textarea"
          rows="2"
          placeholder="Why are you saving for this?"
        >${escapeHtml(initialDesc)}</textarea>
      </div>

      <div id="goal-modal-error" class="form-error" style="display: none;"></div>
    </form>
  `;

  openModal({
    title: isEditing ? "Edit Savings Goal" : "Create New Savings Goal",
    contentHtml: formHtml,
    saveLabel: isEditing ? "Save Goal" : "Create Goal",
    onSave: async modalBody => {
      const title = modalBody.querySelector("#goal-modal-title").value;
      const category = modalBody.querySelector("#goal-modal-cat").value;
      const targetAmount = modalBody.querySelector("#goal-modal-target").value;
      const targetDateAD = modalBody.querySelector("#goal-modal-date").value;
      const description = modalBody.querySelector("#goal-modal-desc").value;
      const errorDiv = modalBody.querySelector("#goal-modal-error");

      const payload = {
        id: isEditing ? existingGoal.id : undefined,
        title,
        category,
        targetAmount: Number(targetAmount),
        targetDateAD,
        description
      };

      const result = await (isEditing ? updateGoal(payload) : addGoal(payload));
      if (!result || !result.success) {
        errorDiv.textContent = (result?.errors || [result?.error || "Failed to save goal."]).join(" ");
        errorDiv.style.display = "block";
        return false;
      }

      showToast(isEditing ? "Goal updated successfully!" : "Goal created successfully!", "success");
      return true;
    }
  });
}

/**
 * Open Modal to Deposit / Allocate Funds to a Goal
 */
function openAllocationModal(goal, maxAvailable) {
  const todayStr = getTodayLocalDateString();

  const formHtml = `
    <form id="alloc-form" onsubmit="return false;">
      <div style="background-color: var(--bg-card-subtle); padding: var(--space-4); border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-bottom: var(--space-4);">
        <div style="font-size: var(--font-size-xs); color: var(--text-secondary); margin-bottom: 2px;">
          Available Unallocated Balance:
        </div>
        <div style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-primary);">
          ${formatCurrency(maxAvailable)}
        </div>
        <div style="font-size: 0.6875rem; color: var(--text-muted); margin-top: 2px;">
          Allocations earmark your existing funds and will not reduce your ledger balance twice.
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Deposit Amount (NPR / रुपैयाँ) *</label>
        <input
          type="number"
          id="alloc-modal-amount"
          class="form-input"
          placeholder="e.g. 10000"
          min="1"
          max="${maxAvailable}"
          step="100"
          required
        />
      </div>

      <div class="form-group">
        <label class="form-label">Deposit Date (AD) *</label>
        <input
          type="date"
          id="alloc-modal-date"
          class="form-input"
          value="${todayStr}"
          required
        />
      </div>

      <div class="form-group">
        <label class="form-label">Optional Note</label>
        <input
          type="text"
          id="alloc-modal-note"
          class="form-input"
          placeholder="e.g. October bonus contribution"
        />
      </div>

      <div id="alloc-modal-error" class="form-error" style="display: none;"></div>
    </form>
  `;

  openModal({
    title: `Deposit to "${goal.title}"`,
    contentHtml: formHtml,
    saveLabel: "Deposit Funds",
    onSave: async modalBody => {
      const amount = modalBody.querySelector("#alloc-modal-amount").value;
      const dateAD = modalBody.querySelector("#alloc-modal-date").value;
      const note = modalBody.querySelector("#alloc-modal-note").value;
      const errorDiv = modalBody.querySelector("#alloc-modal-error");

      const payload = {
        amount: Number(amount),
        dateAD,
        note
      };

      const result = await addGoalAllocation(goal.id, payload, maxAvailable);
      if (!result || !result.success) {
        errorDiv.textContent = (result?.errors || [result?.error || "Failed to allocate funds."]).join(" ");
        errorDiv.style.display = "block";
        return false;
      }

      showToast(`Successfully deposited ${formatCurrency(amount)} into "${goal.title}"!`, "success");
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
