/**
 * MeroHisab — Accounts & Wallets Management View (v3)
 */
import { formatCurrency } from "../utils/formatters.js";
import { getState, dispatch, calculateAccountBalance, resolvePrimaryAccount } from "../core/state.js";
import { toPaisaBigInt, fromPaisaBigInt, isValidMoneyAmount } from "../utils/money.js";
import { openModal } from "../components/modal.js";
import { showConfirmDialog } from "../components/confirm-dialog.js";
import { showToast } from "../components/toast.js";
import { getTodayLocalDateString } from "../utils/nepali-calendar.js";
import { PAYMENT_METHODS } from "../core/constants.js";

const ACCOUNT_TYPES = [
  { id: "cash", label: "Cash Wallet (नगद)", icon: "💵" },
  { id: "bank", label: "Bank Account (बैंक खाता)", icon: "🏦" },
  { id: "esewa", label: "eSewa Wallet (ईसेवा)", icon: "🟢" },
  { id: "khalti", label: "Khalti Wallet (खल्ती)", icon: "🟣" },
  { id: "ime_khalti", label: "IME Pay / Khalti", icon: "🔴" },
  { id: "custom", label: "Custom Account (अन्य)", icon: "💳" }
];

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderAccounts(container, state) {
  const accounts = state.accounts || [];
  const activeAccounts = accounts.filter(a => !a.archived);
  const totalBalancePaisa = accounts.reduce(
    (sumPaisa, a) => sumPaisa + toPaisaBigInt(calculateAccountBalance(state, a.id)),
    0n
  );
  const totalBalance = fromPaisaBigInt(totalBalancePaisa);

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-6);">
      <div>
        <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--text-primary);">
          Wallets & Financial Accounts
        </h2>
        <span style="font-size: var(--font-size-xs); color: var(--text-muted);">
          Track Cash, Bank, eSewa, and Khalti balances separately and transfer funds between wallets.
        </span>
      </div>
      <div style="display: flex; gap: var(--space-3); flex-wrap: wrap;">
        <button id="btn-transfer-funds" class="btn btn-secondary">
          ⇄ Transfer Funds
        </button>
        <button id="btn-add-account" class="btn btn-primary">
          + Add Account
        </button>
      </div>
    </div>

    <div class="kpi-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: var(--space-6);">
      <div class="kpi-card balance">
        <div class="kpi-header"><span class="kpi-label">Combined Wallet Balance</span></div>
        <div class="kpi-amount">${formatCurrency(totalBalance)}</div>
        <div class="kpi-subtext">Across ${accounts.length} total accounts</div>
      </div>
      <div class="kpi-card income">
        <div class="kpi-header"><span class="kpi-label">Active Wallets</span></div>
        <div class="kpi-amount">${activeAccounts.length}</div>
        <div class="kpi-subtext">${accounts.length - activeAccounts.length} archived</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: var(--space-5);">
      ${accounts.map(acc => {
        const bal = calculateAccountBalance(state, acc.id);
        const tMeta = ACCOUNT_TYPES.find(t => t.id === acc.type) || ACCOUNT_TYPES[5];
        const txCount = (state.transactions || []).filter(t => t.accountId === acc.id).length;
        return `
          <div class="content-card" style="opacity: ${acc.archived ? "0.65" : "1"};">
            <div class="content-card-body" style="padding: var(--space-5);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-3);">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                  <div class="tx-category-icon" style="font-size: 1.2rem;">${tMeta.icon}</div>
                  <div>
                    <div style="font-weight: var(--font-weight-bold); color: var(--text-primary); font-size: var(--font-size-base);">
                      ${escapeHtml(acc.name)}
                    </div>
                    <div style="font-size: var(--font-size-xs); color: var(--text-muted);">${tMeta.label}</div>
                  </div>
                </div>
                <span class="badge ${acc.archived ? "badge-warning" : "badge-safe"}">${acc.archived ? "Archived" : "Active"}</span>
              </div>

              <div style="margin: var(--space-4) 0;">
                <div style="font-size: var(--font-size-xs); color: var(--text-secondary);">Current Balance</div>
                <div style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); color: ${bal >= 0 ? "var(--color-primary)" : "var(--color-expense)"};">
                  ${formatCurrency(bal)}
                </div>
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">
                  Opening: ${formatCurrency(acc.openingBalance)} (as of ${acc.openingBalanceDate}) • ${txCount} records
                </div>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--border-subtle);">
                <button class="btn btn-secondary btn-edit-acc" data-id="${acc.id}" style="padding: 4px 10px; font-size: 0.75rem;">Edit</button>
                <button class="btn btn-secondary btn-archive-acc" data-id="${acc.id}" style="padding: 4px 10px; font-size: 0.75rem;">
                  ${acc.archived ? "Unarchive" : "Archive"}
                </button>
                <button class="btn btn-secondary btn-delete-acc" data-id="${acc.id}" style="padding: 4px 10px; font-size: 0.75rem; color: var(--color-expense);">Delete</button>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  container.querySelector("#btn-add-account")?.addEventListener("click", () => openAccountModal());
  container.querySelector("#btn-transfer-funds")?.addEventListener("click", () => openTransferModal());

  container.querySelectorAll(".btn-edit-acc").forEach(btn => {
    btn.addEventListener("click", () => {
      const acc = state.accounts.find(a => a.id === btn.dataset.id);
      if (acc) openAccountModal(acc);
    });
  });

  container.querySelectorAll(".btn-archive-acc").forEach(btn => {
    btn.addEventListener("click", async () => {
      const acc = state.accounts.find(a => a.id === btn.dataset.id);
      if (!acc) return;
      const res = await dispatch("ARCHIVE_ACCOUNT", { id: acc.id, archive: !acc.archived });
      if (res && res.success) showToast(`Account ${!acc.archived ? "archived" : "unarchived"}.`, "info");
      else showToast(res?.error || "Failed to update account.", "error");
    });
  });

  container.querySelectorAll(".btn-delete-acc").forEach(btn => {
    btn.addEventListener("click", async () => {
      const acc = state.accounts.find(a => a.id === btn.dataset.id);
      if (!acc) return;
      const confirmed = await showConfirmDialog({
        title: "Delete Account",
        message: `Delete "${acc.name}"? Accounts with existing transactions cannot be deleted and should be archived instead.`,
        confirmLabel: "Delete Account",
        isDestructive: true
      });
      if (confirmed) {
        const res = await dispatch("DELETE_ACCOUNT", { id: acc.id });
        if (res && res.success) showToast("Account deleted.", "info");
        else showToast(res?.error || "Failed to delete account.", "error");
      }
    });
  });
}

export function openAccountModal(existingAcc = null) {
  const isEditing = Boolean(existingAcc && existingAcc.id);
  const today = getTodayLocalDateString();
  const formHtml = `
    <form id="account-form" onsubmit="return false;">
      <div class="form-group">
        <label class="form-label">Account / Wallet Name *</label>
        <input type="text" id="acc-name" class="form-input" placeholder="e.g. Nabil Bank, eSewa, Cash" value="${escapeHtml(existingAcc?.name || "")}" required />
      </div>
      <div class="form-group">
        <label class="form-label">Account Type *</label>
        <select id="acc-type" class="form-select">
          ${ACCOUNT_TYPES.map(t => `<option value="${t.id}" ${existingAcc?.type === t.id ? "selected" : ""}>${t.label}</option>`).join("")}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Opening Balance (NPR) *</label>
          <input type="number" id="acc-balance" class="form-input" min="0" step="0.01" value="${existingAcc?.openingBalance ?? 0}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Opening Date (AD) *</label>
          <input type="date" id="acc-date" class="form-input" value="${existingAcc?.openingBalanceDate || today}" required />
        </div>
      </div>
      <div class="form-group">
        <label style="display: flex; align-items: center; gap: 8px; font-size: var(--font-size-sm); cursor: pointer;">
          <input type="checkbox" id="acc-overdraft" ${existingAcc?.overdraftEnabled ? "checked" : ""} style="width: 16px; height: 16px; accent-color: var(--color-primary);" />
          <span>Allow overdraft (negative balance on transfers)</span>
        </label>
      </div>
      <div id="acc-modal-error" class="form-error" style="display: none;"></div>
    </form>
  `;

  openModal({
    title: isEditing ? "Edit Account" : "Create New Account",
    contentHtml: formHtml,
    saveLabel: isEditing ? "Save Changes" : "Create Account",
    onSave: async modalBody => {
      const rawBalance = modalBody.querySelector("#acc-balance")?.value;
      if (!isValidMoneyAmount(rawBalance, true)) {
        const errEl = modalBody.querySelector("#acc-modal-error");
        errEl.textContent = "Opening balance must be a valid non-negative amount with at most 2 decimal places.";
        errEl.style.display = "block";
        return false;
      }
      const payload = {
        id: isEditing ? existingAcc.id : undefined,
        name: modalBody.querySelector("#acc-name").value,
        type: modalBody.querySelector("#acc-type").value,
        openingBalance: fromPaisaBigInt(toPaisaBigInt(rawBalance)),
        openingBalanceDate: modalBody.querySelector("#acc-date").value,
        overdraftEnabled: modalBody.querySelector("#acc-overdraft").checked
      };
      const res = await dispatch(isEditing ? "UPDATE_ACCOUNT" : "ADD_ACCOUNT", payload);
      if (!res || !res.success) {
        const errEl = modalBody.querySelector("#acc-modal-error");
        errEl.textContent = (res?.errors || [res?.error || "Failed to save account."]).join(" ");
        errEl.style.display = "block";
        return false;
      }
      showToast(isEditing ? "Account updated!" : "Account created!", "success");
      return true;
    }
  });
}

export function openTransferModal(existingTransfer = null) {
  const state = getState();
  const activeAccounts = (state.accounts || []).filter(a => !a.archived);
  if (activeAccounts.length < 2) {
    showToast("Create at least 2 active accounts to transfer funds between them.", "warning");
    return;
  }
  const isEditing = Boolean(existingTransfer && existingTransfer.transferId);
  const today = getTodayLocalDateString();
  const primaryAcc = resolvePrimaryAccount(activeAccounts);
  const initialFrom = isEditing ? existingTransfer.fromAccountId : (primaryAcc?.id || activeAccounts[0]?.id);
  const initialTo = isEditing ? existingTransfer.toAccountId : (activeAccounts.find(a => a.id !== initialFrom)?.id || activeAccounts[1]?.id);
  const initialAmount = isEditing ? existingTransfer.amount : "";
  const initialDate = isEditing ? existingTransfer.dateAD : today;
  const initialDesc = isEditing ? (existingTransfer.description || "") : "";
  const initialMethod = isEditing ? (existingTransfer.paymentMethod || "bank_transfer") : "bank_transfer";

  const formHtml = `
    <form id="transfer-form" onsubmit="return false;">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">From Account (Source) *</label>
          <select id="tr-from" class="form-select" required>
            ${activeAccounts.map((a, i) => `<option value="${a.id}" ${a.id === initialFrom ? "selected" : ""}>${escapeHtml(a.name)} (${formatCurrency(calculateAccountBalance(state, a.id))})</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">To Account (Destination) *</label>
          <select id="tr-to" class="form-select" required>
            ${activeAccounts.map((a, i) => `<option value="${a.id}" ${a.id === initialTo ? "selected" : ""}>${escapeHtml(a.name)} (${formatCurrency(calculateAccountBalance(state, a.id))})</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Amount (NPR) *</label>
          <input type="number" id="tr-amount" class="form-input" min="1" step="0.01" placeholder="e.g. 5000" value="${initialAmount}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Transfer Date (AD) *</label>
          <input type="date" id="tr-date" class="form-input" value="${initialDate}" required />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Description / Note</label>
        <input type="text" id="tr-desc" class="form-input" placeholder="e.g. ATM Withdrawal or eSewa Load" value="${escapeHtml(initialDesc)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Channel</label>
        <select id="tr-method" class="form-select">
          ${PAYMENT_METHODS.map(m => `<option value="${m.id}" ${m.id === initialMethod ? "selected" : ""}>${m.label}</option>`).join("")}
        </select>
      </div>
      <div id="tr-modal-error" class="form-error" style="display: none;"></div>
    </form>
  `;

  openModal({
    title: isEditing ? "Edit Transfer" : "Transfer Funds Between Wallets",
    contentHtml: formHtml,
    saveLabel: isEditing ? "Save Changes" : "Complete Transfer",
    onSave: async modalBody => {
      const payload = {
        transferId: isEditing ? existingTransfer.transferId : undefined,
        fromAccountId: modalBody.querySelector("#tr-from").value,
        toAccountId: modalBody.querySelector("#tr-to").value,
        amount: Number(modalBody.querySelector("#tr-amount").value),
        dateAD: modalBody.querySelector("#tr-date").value,
        description: modalBody.querySelector("#tr-desc").value,
        paymentMethod: modalBody.querySelector("#tr-method").value
      };
      const res = await dispatch(isEditing ? "UPDATE_TRANSFER" : "ADD_TRANSFER", payload);
      if (!res || !res.success) {
        const errEl = modalBody.querySelector("#tr-modal-error");
        errEl.textContent = (res?.errors || [res?.error || (isEditing ? "Transfer update failed." : "Transfer failed.")]).join(" ");
        errEl.style.display = "block";
        return false;
      }
      showToast(isEditing ? "Transfer updated! Account balances updated." : "Transfer completed! Account balances updated.", "success");
      return true;
    }
  });
}
