/**
 * MeroHisab — Recurring Transactions View (v3)
 */
import { formatCurrency } from "../utils/formatters.js";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "../core/constants.js";
import { getState, dispatch, resolvePrimaryAccount } from "../core/state.js";
import { openModal } from "../components/modal.js";
import { showConfirmDialog } from "../components/confirm-dialog.js";
import { showToast } from "../components/toast.js";
import { adToBs, getTodayLocalDateString } from "../utils/nepali-calendar.js";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderRecurring(container, state) {
  const rules = state.recurringRules || [];
  const activeRules = rules.filter(r => !r.paused && r.nextOccurrence);
  const today = getTodayLocalDateString();
  const dueRules = activeRules.filter(r => r.nextOccurrence <= today);

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-6);">
      <div>
        <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--text-primary);">
          Recurring Transactions
        </h2>
        <span style="font-size: var(--font-size-xs); color: var(--text-muted);">
          Automate repeating salary, rent, internet, and subscription schedules with confirmation before posting.
        </span>
      </div>
      <button id="btn-add-recurring" class="btn btn-primary">+ New Recurring Rule</button>
    </div>

    <div class="kpi-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: var(--space-6);">
      <div class="kpi-card balance">
        <div class="kpi-header"><span class="kpi-label">Active Schedules</span></div>
        <div class="kpi-amount">${activeRules.length}</div>
        <div class="kpi-subtext">${rules.length} total configured</div>
      </div>
      <div class="kpi-card ${dueRules.length > 0 ? "expense" : "income"}">
        <div class="kpi-header"><span class="kpi-label">Ready to Post Today</span></div>
        <div class="kpi-amount">${dueRules.length}</div>
        <div class="kpi-subtext">Requires your 1-click confirmation</div>
      </div>
    </div>

    ${rules.length === 0 ? `
      <div class="content-card">
        <div class="content-card-body">
          <div class="placeholder-box">
            <div style="font-size: 2.2rem;">🔁</div>
            <div class="placeholder-title">No Recurring Schedules Yet</div>
            <div class="placeholder-desc">Add monthly salary, house rent, or ISP subscriptions to track upcoming occurrences.</div>
          </div>
        </div>
      </div>
    ` : `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: var(--space-5);">
        ${rules.map(rule => {
          const acc = (state.accounts || []).find(a => a.id === rule.accountId);
          const bsNext = rule.nextOccurrence ? adToBs(rule.nextOccurrence) : null;
          const isDue = !rule.paused && rule.nextOccurrence && rule.nextOccurrence <= today;
          return `
            <div class="content-card" style="border-top: 3px solid ${rule.type === "income" ? "var(--color-income)" : "var(--color-expense)"};">
              <div class="content-card-body" style="padding: var(--space-5);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-3);">
                  <div>
                    <div style="font-weight: var(--font-weight-bold); color: var(--text-primary);">${escapeHtml(rule.title)}</div>
                    <div style="font-size: var(--font-size-xs); color: var(--text-muted);">
                      ${(rule.schedule?.frequency || "monthly").toUpperCase()} • ${escapeHtml(acc?.name || "Cash Wallet")}
                    </div>
                  </div>
                  <span class="badge ${rule.paused ? "badge-warning" : isDue ? "badge-exceeded" : "badge-safe"}">
                    ${rule.paused ? "Paused" : isDue ? "Due Now" : "Active"}
                  </span>
                </div>

                <div style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: ${rule.type === "income" ? "var(--color-income)" : "var(--color-expense)"}; margin-bottom: var(--space-2);">
                  ${rule.type === "income" ? "+" : "-"}${formatCurrency(rule.amount)}
                </div>

                <div style="font-size: var(--font-size-xs); color: var(--text-secondary); margin-bottom: var(--space-4);">
                  Next Occurrence: <strong>${rule.nextOccurrence || "Completed"}</strong> ${bsNext ? `(${bsNext.formatted} BS)` : ""}
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--border-subtle);">
                  ${!rule.paused && rule.nextOccurrence ? `
                    <button class="btn btn-primary btn-post-rr" data-id="${rule.id}" style="padding: 4px 10px; font-size: 0.75rem;">✓ Confirm & Post</button>
                    <button class="btn btn-secondary btn-skip-rr" data-id="${rule.id}" style="padding: 4px 10px; font-size: 0.75rem;">Skip Next</button>
                  ` : ""}
                  <button class="btn btn-secondary btn-edit-rr" data-id="${rule.id}" style="padding: 4px 10px; font-size: 0.75rem;">Edit</button>
                  <button class="btn btn-secondary btn-pause-rr" data-id="${rule.id}" style="padding: 4px 10px; font-size: 0.75rem;">${rule.paused ? "Resume" : "Pause"}</button>
                  <button class="btn btn-secondary btn-delete-rr" data-id="${rule.id}" style="padding: 4px 10px; font-size: 0.75rem; color: var(--color-expense);">Delete</button>
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `}
  `;

  container.querySelector("#btn-add-recurring")?.addEventListener("click", () => openRecurringModal());

  container.querySelectorAll(".btn-post-rr").forEach(btn => {
    btn.addEventListener("click", async () => {
      const res = await dispatch("PROCESS_RECURRING_OCCURRENCE", { id: btn.dataset.id });
      if (res && res.success) showToast("Occurrence posted to transactions!", "success");
      else showToast(res?.error || "Failed to process recurring occurrence.", "error");
    });
  });

  container.querySelectorAll(".btn-skip-rr").forEach(btn => {
    btn.addEventListener("click", async () => {
      const res = await dispatch("SKIP_RECURRING_OCCURRENCE", { id: btn.dataset.id });
      if (res && res.success) showToast(`Skipped ${res.skippedDate}. Advanced to ${res.nextOccurrence || "end"}.`, "info");
      else showToast(res?.error || "Failed to skip occurrence.", "error");
    });
  });

  container.querySelectorAll(".btn-edit-rr").forEach(btn => {
    btn.addEventListener("click", () => {
      const rule = (state.recurringRules || []).find(r => r.id === btn.dataset.id);
      if (rule) openRecurringModal(rule);
    });
  });

  container.querySelectorAll(".btn-pause-rr").forEach(btn => {
    btn.addEventListener("click", async () => {
      const res = await dispatch("TOGGLE_PAUSE_RECURRING_RULE", { id: btn.dataset.id });
      if (res && res.success) showToast("Schedule updated.", "info");
      else showToast(res?.error || "Failed to update schedule.", "error");
    });
  });

  container.querySelectorAll(".btn-delete-rr").forEach(btn => {
    btn.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog({
        title: "Delete Recurring Schedule",
        message: "Delete this recurring rule? Past posted transactions will remain untouched.",
        confirmLabel: "Delete Rule",
        isDestructive: true
      });
      if (confirmed) {
        const res = await dispatch("DELETE_RECURRING_RULE", { id: btn.dataset.id });
        if (res && res.success) {
          showToast("Recurring schedule deleted.", "info");
        } else {
          showToast(res?.error || "Failed to delete recurring schedule.", "error");
        }
      }
    });
  });
}

export function openRecurringModal(existingRule = null) {
  const state = getState();
  const activeAccounts = (state.accounts || []).filter(a => !a.archived);
  let accounts = [...activeAccounts];
  if (existingRule?.accountId && !accounts.some(a => a.id === existingRule.accountId)) {
    const existingAcc = (state.accounts || []).find(a => a.id === existingRule.accountId);
    if (existingAcc) {
      accounts.unshift({ ...existingAcc, name: `${existingAcc.name} (Archived)` });
    }
  }

  const primaryAcc = resolvePrimaryAccount(activeAccounts);
  const today = getTodayLocalDateString();
  const isEditing = Boolean(existingRule);

  const initialTitle = existingRule ? existingRule.title : "";
  const initialType = existingRule ? existingRule.type : "expense";
  const initialAccountId = existingRule ? existingRule.accountId : (primaryAcc?.id || (accounts[0]?.id || ""));
  const initialAmount = existingRule ? existingRule.amount : "";
  const initialCategory = existingRule ? existingRule.category : (initialType === "income" ? "salary" : "utilities");
  const initialFreq = existingRule ? (existingRule.schedule?.frequency || "monthly") : "monthly";
  const initialStart = existingRule ? (existingRule.schedule?.startDate || existingRule.nextOccurrence || today) : today;

  const cats = initialType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const formHtml = `
    <form id="rr-form" onsubmit="return false;">
      <div class="form-group">
        <label class="form-label">Title / Description *</label>
        <input type="text" id="rr-title" class="form-input" placeholder="e.g. Monthly Salary or Apartment Rent" value="${escapeHtml(initialTitle)}" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Type *</label>
          <select id="rr-type" class="form-select">
            <option value="expense" ${initialType === "expense" ? "selected" : ""}>Expense (खर्च)</option>
            <option value="income" ${initialType === "income" ? "selected" : ""}>Income (आम्दानी)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Account / Wallet *</label>
          <select id="rr-account" class="form-select">
            ${accounts.map(a => `<option value="${a.id}" ${a.id === initialAccountId ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Amount (NPR) *</label>
          <input type="number" id="rr-amount" class="form-input" min="1" step="0.01" value="${initialAmount}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Category *</label>
          <select id="rr-category" class="form-select">
            ${cats.map(c => `<option value="${c.id}" ${c.id === initialCategory ? "selected" : ""}>${c.label}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Frequency *</label>
          <select id="rr-freq" class="form-select">
            <option value="monthly" ${initialFreq === "monthly" ? "selected" : ""}>Monthly</option>
            <option value="weekly" ${initialFreq === "weekly" ? "selected" : ""}>Weekly</option>
            <option value="daily" ${initialFreq === "daily" ? "selected" : ""}>Daily</option>
            <option value="yearly" ${initialFreq === "yearly" ? "selected" : ""}>Yearly</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Start Date (AD) *</label>
          <input type="date" id="rr-start" class="form-input" value="${initialStart}" required />
        </div>
      </div>
      <div id="rr-modal-error" class="form-error" style="display: none;"></div>
    </form>
  `;

  openModal({
    title: isEditing ? "Edit Recurring Schedule" : "Create Recurring Schedule",
    contentHtml: formHtml,
    saveLabel: isEditing ? "Update Schedule" : "Create Schedule",
    onOpen: modalBody => {
      const typeSel = modalBody.querySelector("#rr-type");
      const catSel = modalBody.querySelector("#rr-category");
      typeSel.addEventListener("change", () => {
        const newCats = typeSel.value === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
        catSel.innerHTML = newCats.map(c => `<option value="${c.id}">${c.label}</option>`).join("");
      });
    },
    onSave: async modalBody => {
      const startDate = modalBody.querySelector("#rr-start").value;
      const dom = Number(startDate.split("-")[2]);
      const accountId = modalBody.querySelector("#rr-account").value;
      if (!accountId || !state.accounts?.some(a => a.id === accountId)) {
        const err = modalBody.querySelector("#rr-modal-error");
        err.textContent = "Please select a valid account.";
        err.style.display = "block";
        return false;
      }
      const payload = {
        title: modalBody.querySelector("#rr-title").value,
        type: modalBody.querySelector("#rr-type").value,
        accountId,
        amount: Number(modalBody.querySelector("#rr-amount").value),
        category: modalBody.querySelector("#rr-category").value,
        paymentMethod: existingRule?.paymentMethod || state.settings?.defaultPaymentMethod || "fonepay",
        schedule: {
          frequency: modalBody.querySelector("#rr-freq").value,
          interval: 1,
          dayOfMonth: dom,
          startDate
        },
        paused: existingRule ? Boolean(existingRule.paused) : false,
        isPaused: existingRule ? Boolean(existingRule.isPaused) : false
      };

      const res = await (isEditing
        ? dispatch("UPDATE_RECURRING_RULE", { id: existingRule.id, ...payload })
        : dispatch("ADD_RECURRING_RULE", payload));

      if (!res || !res.success) {
        const err = modalBody.querySelector("#rr-modal-error");
        err.textContent = (res?.errors || [res?.error || "Failed to save recurring schedule."]).join(" ");
        err.style.display = "block";
        return false;
      }
      showToast(isEditing ? "Recurring schedule updated!" : "Recurring schedule created!", "success");
      return true;
    }
  });
}
