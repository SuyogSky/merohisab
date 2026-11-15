/**
 * MeroHisab — Bills & Payment Tracking View (v3)
 */
import { formatCurrency } from "../utils/formatters.js";
import { EXPENSE_CATEGORIES } from "../core/constants.js";
import { getState, dispatch, computeBillStatus, resolvePrimaryAccount } from "../core/state.js";
import { openModal } from "../components/modal.js";
import { showConfirmDialog } from "../components/confirm-dialog.js";
import { showToast } from "../components/toast.js";
import { getTodayLocalDateString } from "../utils/nepali-calendar.js";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderBills(container, state) {
  const today = getTodayLocalDateString();
  const bills = (state.bills || []).map(b => ({
    ...b,
    computedStatus: computeBillStatus(b, today)
  }));

  const overdueCount = bills.filter(b => b.computedStatus === "overdue").length;
  const dueSoonCount = bills.filter(b => b.computedStatus === "dueSoon").length;
  const paidCount = bills.filter(b => b.computedStatus === "paid").length;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-6);">
      <div>
        <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--text-primary);">
          Bills & Due Payments
        </h2>
        <span style="font-size: var(--font-size-xs); color: var(--text-muted);">
          Track electricity, water, internet, and rent bills. Marking a bill paid records the expense once.
        </span>
      </div>
      <button id="btn-add-bill" class="btn btn-primary">+ Add Bill</button>
    </div>

    <div class="kpi-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: var(--space-6);">
      <div class="kpi-card expense">
        <div class="kpi-header"><span class="kpi-label">Overdue Bills</span></div>
        <div class="kpi-amount" style="color: var(--color-expense);">${overdueCount}</div>
        <div class="kpi-subtext">Past due date</div>
      </div>
      <div class="kpi-card cashflow">
        <div class="kpi-header"><span class="kpi-label">Due Within 7 Days</span></div>
        <div class="kpi-amount" style="color: var(--color-warning);">${dueSoonCount}</div>
        <div class="kpi-subtext">Upcoming soon</div>
      </div>
      <div class="kpi-card income">
        <div class="kpi-header"><span class="kpi-label">Paid Bills</span></div>
        <div class="kpi-amount" style="color: var(--color-income);">${paidCount}</div>
        <div class="kpi-subtext">Linked to ledger expenses</div>
      </div>
    </div>

    ${bills.length === 0 ? `
      <div class="content-card">
        <div class="content-card-body">
          <div class="placeholder-box">
            <div style="font-size: 2.2rem;">🧾</div>
            <div class="placeholder-title">No Bills Tracked Yet</div>
            <div class="placeholder-desc">Add upcoming utility, rent, or credit bills to get reminders and 1-click expense logging.</div>
          </div>
        </div>
      </div>
    ` : `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: var(--space-5);">
        ${bills.map(bill => {
          const acc = (state.accounts || []).find(a => a.id === bill.accountId);
          const badgeClass =
            bill.computedStatus === "paid" ? "badge-safe" :
            bill.computedStatus === "overdue" ? "badge-exceeded" :
            bill.computedStatus === "dueSoon" ? "badge-warning" : "badge-method";
          return `
            <div class="content-card">
              <div class="content-card-body" style="padding: var(--space-5);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-3);">
                  <div>
                    <div style="font-weight: var(--font-weight-bold); color: var(--text-primary);">${escapeHtml(bill.title)}</div>
                    <div style="font-size: var(--font-size-xs); color: var(--text-muted);">
                      Due: ${bill.dueDateAD} (${bill.dueDateBS} BS) • ${escapeHtml(acc?.name || "Cash Wallet")}
                    </div>
                  </div>
                  <span class="badge ${badgeClass}">${bill.computedStatus.toUpperCase()}</span>
                </div>

                <div style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--text-primary); margin-bottom: var(--space-3);">
                  ${formatCurrency(bill.amount)}
                  ${bill.recurrence ? `<span class="badge badge-method" style="margin-left: 8px;">↻ ${bill.recurrence.frequency || "monthly"}</span>` : ""}
                </div>

                <div style="display: flex; justify-content: flex-end; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--border-subtle);">
                  ${bill.computedStatus !== "paid" ? `
                    <button class="btn btn-primary btn-pay-bill" data-id="${bill.id}" style="padding: 4px 10px; font-size: 0.75rem;">✓ Mark as Paid</button>
                  ` : `<span style="font-size: var(--font-size-xs); color: var(--color-income); align-self: center; margin-right: auto;">✓ Paid & Linked</span>`}
                  <button class="btn btn-secondary btn-edit-bill" data-id="${bill.id}" style="padding: 4px 10px; font-size: 0.75rem;">Edit</button>
                  <button class="btn btn-secondary btn-delete-bill" data-id="${bill.id}" style="padding: 4px 10px; font-size: 0.75rem; color: var(--color-expense);">Delete</button>
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `}
  `;

  container.querySelector("#btn-add-bill")?.addEventListener("click", () => openBillModal());

  container.querySelectorAll(".btn-pay-bill").forEach(btn => {
    btn.addEventListener("click", async () => {
      const res = await dispatch("PAY_BILL", { id: btn.dataset.id });
      if (res && res.success) showToast("Bill marked as paid and expense recorded!", "success");
      else showToast(res?.error || "Failed to process bill payment.", "error");
    });
  });

  container.querySelectorAll(".btn-edit-bill").forEach(btn => {
    btn.addEventListener("click", () => {
      const bill = (state.bills || []).find(b => b.id === btn.dataset.id);
      if (bill) openBillModal(bill);
    });
  });

  container.querySelectorAll(".btn-delete-bill").forEach(btn => {
    btn.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog({
        title: "Delete Bill",
        message: "Are you sure you want to delete this bill?",
        confirmLabel: "Delete Bill",
        isDestructive: true
      });
      if (confirmed) {
        const res = await dispatch("DELETE_BILL", { id: btn.dataset.id });
        if (res && res.success) {
          showToast("Bill deleted.", "info");
        } else {
          showToast(res?.error || "Failed to delete bill.", "error");
        }
      }
    });
  });
}

export function openBillModal(existingBill = null) {
  const state = getState();
  const activeAccounts = (state.accounts || []).filter(a => !a.archived);
  let accounts = [...activeAccounts];
  if (existingBill?.accountId && !accounts.some(a => a.id === existingBill.accountId)) {
    const existingAcc = (state.accounts || []).find(a => a.id === existingBill.accountId);
    if (existingAcc) {
      accounts.unshift({ ...existingAcc, name: `${existingAcc.name} (Archived)` });
    }
  }

  const primaryAcc = resolvePrimaryAccount(activeAccounts);
  const today = getTodayLocalDateString();
  const isEditing = Boolean(existingBill);

  const initialTitle = existingBill ? existingBill.title : "";
  const initialAmount = existingBill ? existingBill.amount : "";
  const initialDue = existingBill ? existingBill.dueDateAD : today;
  const initialCategory = existingBill ? existingBill.category : "utilities";
  const initialAccountId = existingBill ? existingBill.accountId : (primaryAcc?.id || (accounts[0]?.id || ""));
  const initialRecurrence = existingBill ? (existingBill.recurrence?.frequency || "none") : "none";

  const formHtml = `
    <form id="bill-form" onsubmit="return false;">
      <div class="form-group">
        <label class="form-label">Bill Title *</label>
        <input type="text" id="bill-title" class="form-input" placeholder="e.g. NEA Electricity Bill or Worldlink Internet" value="${escapeHtml(initialTitle)}" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Amount (NPR) *</label>
          <input type="number" id="bill-amount" class="form-input" min="1" step="0.01" value="${initialAmount}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Due Date (AD) *</label>
          <input type="date" id="bill-due" class="form-input" value="${initialDue}" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Category *</label>
          <select id="bill-category" class="form-select">
            ${EXPENSE_CATEGORIES.map(c => `<option value="${c.id}" ${c.id === initialCategory ? "selected" : ""}>${c.label}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Pay From Account *</label>
          <select id="bill-account" class="form-select">
            ${accounts.map(a => `<option value="${a.id}" ${a.id === initialAccountId ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Repeat / Recurrence</label>
        <select id="bill-recurrence" class="form-select">
          <option value="none" ${initialRecurrence === "none" ? "selected" : ""}>One-time Bill (Does not repeat)</option>
          <option value="monthly" ${initialRecurrence === "monthly" ? "selected" : ""}>Monthly Bill</option>
          <option value="yearly" ${initialRecurrence === "yearly" ? "selected" : ""}>Yearly Bill</option>
        </select>
      </div>
      <div id="bill-modal-error" class="form-error" style="display: none;"></div>
    </form>
  `;

  openModal({
    title: isEditing ? "Edit Bill" : "Add New Bill",
    contentHtml: formHtml,
    saveLabel: isEditing ? "Update Bill" : "Save Bill",
    onSave: async modalBody => {
      const recVal = modalBody.querySelector("#bill-recurrence").value;
      const dueDateAD = modalBody.querySelector("#bill-due").value;
      const accountId = modalBody.querySelector("#bill-account").value;
      if (!accountId || !state.accounts?.some(a => a.id === accountId)) {
        const err = modalBody.querySelector("#bill-modal-error");
        err.textContent = "Please select a valid account.";
        err.style.display = "block";
        return false;
      }
      const payload = {
        title: modalBody.querySelector("#bill-title").value,
        amount: Number(modalBody.querySelector("#bill-amount").value),
        dueDateAD,
        category: modalBody.querySelector("#bill-category").value,
        accountId,
        recurrence: recVal === "none" ? null : {
          frequency: recVal,
          interval: 1,
          dayOfMonth: Number(dueDateAD.split("-")[2]),
          startDate: dueDateAD
        }
      };

      const res = await (isEditing
        ? dispatch("UPDATE_BILL", { id: existingBill.id, ...payload })
        : dispatch("ADD_BILL", payload));

      if (!res || !res.success) {
        const err = modalBody.querySelector("#bill-modal-error");
        err.textContent = (res?.errors || [res?.error || "Failed to save bill."]).join(" ");
        err.style.display = "block";
        return false;
      }
      showToast(isEditing ? "Bill updated!" : "Bill added!", "success");
      return true;
    }
  });
}
