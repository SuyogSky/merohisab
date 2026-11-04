/**
 * MeroHisab — Bills & Payment Tracking View (v3)
 */
import { formatCurrency } from "../utils/formatters.js";
import { EXPENSE_CATEGORIES } from "../core/constants.js";
import { getState, dispatch, computeBillStatus } from "../core/state.js";
import { openModal } from "../components/modal.js";
import { showConfirmDialog } from "../components/confirm-dialog.js";
import { showToast } from "../components/toast.js";
import { getTodayLocalDateString } from "../utils/nepali-calendar.js";

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
    btn.addEventListener("click", () => {
      const res = dispatch("PAY_BILL", { id: btn.dataset.id });
      if (res.success) showToast("Bill marked as paid and expense recorded!", "success");
      else showToast(res.error, "error");
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
        dispatch("DELETE_BILL", { id: btn.dataset.id });
        showToast("Bill deleted.", "info");
      }
    });
  });
}

function openBillModal() {
  const state = getState();
  const accounts = (state.accounts || []).filter(a => !a.archived);
  const today = getTodayLocalDateString();
  const formHtml = `
    <form id="bill-form" onsubmit="return false;">
      <div class="form-group">
        <label class="form-label">Bill Title *</label>
        <input type="text" id="bill-title" class="form-input" placeholder="e.g. NEA Electricity Bill or Worldlink Internet" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Amount (NPR) *</label>
          <input type="number" id="bill-amount" class="form-input" min="1" step="0.01" required />
        </div>
        <div class="form-group">
          <label class="form-label">Due Date (AD) *</label>
          <input type="date" id="bill-due" class="form-input" value="${today}" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Category *</label>
          <select id="bill-category" class="form-select">
            ${EXPENSE_CATEGORIES.map(c => `<option value="${c.id}" ${c.id === "utilities" ? "selected" : ""}>${c.label}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Pay From Account *</label>
          <select id="bill-account" class="form-select">
            ${accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Repeat / Recurrence</label>
        <select id="bill-recurrence" class="form-select">
          <option value="none">One-time Bill (Does not repeat)</option>
          <option value="monthly">Monthly Bill</option>
          <option value="yearly">Yearly Bill</option>
        </select>
      </div>
      <div id="bill-modal-error" class="form-error" style="display: none;"></div>
    </form>
  `;

  openModal({
    title: "Add New Bill",
    contentHtml: formHtml,
    saveLabel: "Save Bill",
    onSave: modalBody => {
      const recVal = modalBody.querySelector("#bill-recurrence").value;
      const dueDateAD = modalBody.querySelector("#bill-due").value;
      const payload = {
        title: modalBody.querySelector("#bill-title").value,
        amount: Number(modalBody.querySelector("#bill-amount").value),
        dueDateAD,
        category: modalBody.querySelector("#bill-category").value,
        accountId: modalBody.querySelector("#bill-account").value,
        recurrence: recVal === "none" ? null : {
          frequency: recVal,
          interval: 1,
          dayOfMonth: Number(dueDateAD.split("-")[2]),
          startDate: dueDateAD
        }
      };
      const res = dispatch("ADD_BILL", payload);
      if (!res.success) {
        const err = modalBody.querySelector("#bill-modal-error");
        err.textContent = res.error;
        err.style.display = "block";
        return false;
      }
      showToast("Bill added!", "success");
      return true;
    }
  });
}
