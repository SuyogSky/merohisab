/**
 * MeroHisab — Complete Transaction Management View (v3)
 * Features Account/Wallet Selection, Transfers, Add, View, Edit, Delete,
 * Real-time Search, Multi-Filter Toolbar, Sorting, CSV Export, and Lakh/Crore Previews.
 */

import { formatCurrency, formatNepaliNumber, formatTransactionDate } from "../utils/formatters.js";
import {
  TRANSACTION_TYPES,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS
} from "../core/constants.js";
import {
  filterAndSortTransactions,
  getCategoryLabel,
  getCategoryIcon,
  getCategoryColor,
  getPaymentMethodLabel
} from "../services/transactions.js";
import { addTransaction, updateTransaction, deleteTransaction, getState } from "../core/state.js";
import { openTransferModal } from "./accounts.js";
import { openModal } from "../components/modal.js";
import { showConfirmDialog } from "../components/confirm-dialog.js";
import { showToast } from "../components/toast.js";
import { adToBs, getTodayLocalDateString } from "../utils/nepali-calendar.js";
import { exportTransactionsToCsv } from "../utils/file-io.js";

let filterOptions = {
  searchQuery: "",
  accountId: "all",
  type: "all",
  category: "all",
  paymentMethod: "all",
  startDate: "",
  endDate: "",
  sortBy: "newest"
};

export function renderTransactions(container, state) {
  const transactions = state.transactions || [];
  const accounts = state.accounts || [];
  let filtered = filterAndSortTransactions(transactions, filterOptions);
  if (filterOptions.accountId !== "all") {
    filtered = filtered.filter(t => t.accountId === filterOptions.accountId);
  }

  const getAccName = (accId) => {
    const found = accounts.find(a => a.id === accId);
    return found ? found.name : "Cash Wallet";
  };

  container.innerHTML = `
    <!-- Transactions Header & Quick Action Bar -->
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-6);">
      <div style="display: flex; align-items: center; gap: var(--space-3);">
        <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--text-primary);">
          Transaction Ledger
        </h2>
        <span class="badge badge-method">${filtered.length} of ${transactions.length} Records</span>
      </div>

      <div style="display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;">
        <button id="btn-export-csv" class="btn btn-secondary" title="Export transactions to RFC-compliant CSV">
          <span>Export CSV</span>
        </button>

        <button id="btn-tx-transfer" class="btn btn-secondary">
          <span>⇄ Transfer Funds</span>
        </button>

        <button id="btn-add-tx" class="btn btn-primary">
          <span>+ Add Transaction</span>
        </button>
      </div>
    </div>

    <!-- Filter & Search Toolbar Card -->
    <div class="content-card" style="margin-bottom: var(--space-6);">
      <div class="content-card-body" style="padding: var(--space-4);">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--space-3); align-items: center;">
          <!-- Search Input -->
          <div style="position: relative;">
            <input
              type="text"
              id="tx-search"
              class="form-input"
              placeholder="Search description, category..."
              value="${escapeHtml(filterOptions.searchQuery)}"
              style="padding-left: 2.2rem;"
            />
            <span style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none;">🔍</span>
          </div>

          <!-- Account Filter -->
          <select id="tx-filter-account" class="form-select">
            <option value="all" ${filterOptions.accountId === "all" ? "selected" : ""}>All Accounts / Wallets</option>
            ${accounts.map(a => `<option value="${a.id}" ${filterOptions.accountId === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}
          </select>

          <!-- Type Filter -->
          <select id="tx-filter-type" class="form-select">
            <option value="all" ${filterOptions.type === "all" ? "selected" : ""}>All Types (आय / खर्च / रकमान्तर)</option>
            <option value="income" ${filterOptions.type === "income" ? "selected" : ""}>Income Only (आम्दानी)</option>
            <option value="expense" ${filterOptions.type === "expense" ? "selected" : ""}>Expense Only (खर्च)</option>
            <option value="transfer" ${filterOptions.type === "transfer" ? "selected" : ""}>Transfers Only (रकमान्तर)</option>
          </select>

          <!-- Category Filter -->
          <select id="tx-filter-category" class="form-select">
            <option value="all">All Categories</option>
            <optgroup label="Income Categories">
              ${INCOME_CATEGORIES.map(c => `<option value="${c.id}" ${filterOptions.category === c.id ? "selected" : ""}>${c.label}</option>`).join("")}
            </optgroup>
            <optgroup label="Expense Categories">
              ${EXPENSE_CATEGORIES.map(c => `<option value="${c.id}" ${filterOptions.category === c.id ? "selected" : ""}>${c.label}</option>`).join("")}
            </optgroup>
          </select>

          <!-- Sort Order -->
          <select id="tx-sort" class="form-select">
            <option value="newest" ${filterOptions.sortBy === "newest" ? "selected" : ""}>Sort: Newest First</option>
            <option value="oldest" ${filterOptions.sortBy === "oldest" ? "selected" : ""}>Sort: Oldest First</option>
            <option value="highest" ${filterOptions.sortBy === "highest" ? "selected" : ""}>Sort: Highest Amount</option>
            <option value="lowest" ${filterOptions.sortBy === "lowest" ? "selected" : ""}>Sort: Lowest Amount</option>
          </select>
        </div>

        <!-- Date Range Filter Row -->
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--border-subtle);">
          <div style="display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;">
            <span style="font-size: var(--font-size-xs); color: var(--text-secondary); font-weight: var(--font-weight-medium);">Date Range:</span>
            <input type="date" id="tx-start-date" class="form-input" style="width: auto; padding: 4px 8px; font-size: var(--font-size-xs);" value="${filterOptions.startDate}" />
            <span style="font-size: var(--font-size-xs); color: var(--text-muted);">&mdash;</span>
            <input type="date" id="tx-end-date" class="form-input" style="width: auto; padding: 4px 8px; font-size: var(--font-size-xs);" value="${filterOptions.endDate}" />
          </div>

          ${hasActiveFilters()
            ? `<button id="btn-clear-filters" class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem; color: var(--color-expense);">✕ Clear Filters</button>`
            : ""}
        </div>
      </div>
    </div>

    <!-- Transactions Data Table -->
    <div class="content-card">
      <div class="content-card-body" style="padding: 0; overflow-x: auto;">
        ${filtered.length === 0
          ? `<div style="padding: var(--space-12) var(--space-6); text-align: center; color: var(--text-muted);">
              <div style="font-size: 2.5rem; margin-bottom: var(--space-2);">📄</div>
              <div style="font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--text-primary); margin-bottom: var(--space-1);">
                No transactions found
              </div>
              <div style="font-size: var(--font-size-sm); max-width: 380px; margin: 0 auto var(--space-4);">
                ${hasActiveFilters() ? "Try clearing your search query or adjusting your filters." : "You have not recorded any transactions yet. Click 'Add Transaction' to get started."}
              </div>
              ${hasActiveFilters() ? `<button id="btn-empty-clear" class="btn btn-secondary">Clear Filters</button>` : `<button id="btn-empty-add" class="btn btn-primary">+ Add First Transaction</button>`}
            </div>`
          : `
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: var(--font-size-sm);">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-subtle); background-color: var(--bg-card-subtle); color: var(--text-secondary); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.05em;">
                  <th style="padding: var(--space-4) var(--space-6);">Description & Category</th>
                  <th style="padding: var(--space-4);">Account / Wallet</th>
                  <th style="padding: var(--space-4);">Date (AD / BS)</th>
                  <th style="padding: var(--space-4);">Channel</th>
                  <th style="padding: var(--space-4); text-align: right;">Amount (NPR)</th>
                  <th style="padding: var(--space-4) var(--space-6); text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(tx => {
                  const isTransfer = tx.type === "transfer";
                  const sign = isTransfer
                    ? (tx.transferDirection === "in" ? "+" : "-")
                    : (tx.type === "income" ? "+" : "-");
                  const amountClass = isTransfer
                    ? (tx.transferDirection === "in" ? "income" : "expense")
                    : tx.type;
                  return `
                    <tr style="border-bottom: 1px solid var(--border-subtle);">
                      <td style="padding: var(--space-4) var(--space-6);">
                        <div style="display: flex; align-items: center; gap: var(--space-3);">
                          <div class="tx-category-icon" style="background-color: ${getCategoryColor(tx.category)}18; border-color: ${getCategoryColor(tx.category)}40;">
                            ${isTransfer ? "⇄" : getCategoryIcon(tx.category)}
                          </div>
                          <div>
                            <div style="font-weight: var(--font-weight-medium); color: var(--text-primary);">
                              ${escapeHtml(tx.description)}
                            </div>
                            <div style="font-size: var(--font-size-xs); color: var(--text-muted);">
                              ${isTransfer ? `Transfer (${tx.transferDirection === "in" ? "Incoming" : "Outgoing"})` : getCategoryLabel(tx.category, tx.type)}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td style="padding: var(--space-4); white-space: nowrap;">
                        <span class="badge badge-method">${escapeHtml(getAccName(tx.accountId))}</span>
                      </td>

                      <td style="padding: var(--space-4); white-space: nowrap;">
                        ${(() => {
                          const dateFmt = formatTransactionDate(tx.dateAD, tx.dateBS);
                          return `
                            <div style="color: var(--text-primary); font-weight: var(--font-weight-medium);">${dateFmt.primary}</div>
                            ${dateFmt.secondary ? `<div style="font-size: var(--font-size-xs); color: var(--text-muted);">${dateFmt.secondary}</div>` : ""}
                          `;
                        })()}
                      </td>

                      <td style="padding: var(--space-4); white-space: nowrap;">
                        <span class="badge badge-method">${escapeHtml(getPaymentMethodLabel(tx.paymentMethod))}</span>
                      </td>

                      <td style="padding: var(--space-4); text-align: right; white-space: nowrap;">
                        <div class="tx-amount ${amountClass}" style="font-size: var(--font-size-base);">
                          ${sign}${formatCurrency(tx.amount)}
                        </div>
                      </td>

                      <td style="padding: var(--space-4) var(--space-6); text-align: right; white-space: nowrap;">
                        ${!isTransfer ? `
                          <button class="btn-icon btn-edit-tx" data-id="${tx.id}" title="Edit Transaction" style="width: 32px; height: 32px; margin-right: 4px;">✏️</button>
                        ` : ""}
                        <button class="btn-icon btn-delete-tx" data-id="${tx.id}" title="Delete Transaction" style="width: 32px; height: 32px; color: var(--color-expense);">🗑️</button>
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          `
        }
      </div>
    </div>
  `;

  bindFilterEvents(container, state);
}

function hasActiveFilters() {
  return (
    filterOptions.searchQuery !== "" ||
    filterOptions.accountId !== "all" ||
    filterOptions.type !== "all" ||
    filterOptions.category !== "all" ||
    filterOptions.paymentMethod !== "all" ||
    filterOptions.startDate !== "" ||
    filterOptions.endDate !== "" ||
    filterOptions.sortBy !== "newest"
  );
}

function bindFilterEvents(container, state) {
  container.querySelector("#btn-add-tx")?.addEventListener("click", () => openTransactionModal());
  container.querySelector("#btn-tx-transfer")?.addEventListener("click", () => openTransferModal());
  container.querySelector("#btn-export-csv")?.addEventListener("click", () => {
    try {
      exportTransactionsToCsv(state.transactions);
      showToast("Transactions exported to CSV!", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  container.querySelector("#tx-search")?.addEventListener("input", e => {
    filterOptions.searchQuery = e.target.value;
    renderTransactions(container, state);
  });

  container.querySelector("#tx-filter-account")?.addEventListener("change", e => {
    filterOptions.accountId = e.target.value;
    renderTransactions(container, state);
  });

  container.querySelector("#tx-filter-type")?.addEventListener("change", e => {
    filterOptions.type = e.target.value;
    renderTransactions(container, state);
  });

  container.querySelector("#tx-filter-category")?.addEventListener("change", e => {
    filterOptions.category = e.target.value;
    renderTransactions(container, state);
  });

  container.querySelector("#tx-sort")?.addEventListener("change", e => {
    filterOptions.sortBy = e.target.value;
    renderTransactions(container, state);
  });

  container.querySelector("#tx-start-date")?.addEventListener("change", e => {
    filterOptions.startDate = e.target.value;
    renderTransactions(container, state);
  });

  container.querySelector("#tx-end-date")?.addEventListener("change", e => {
    filterOptions.endDate = e.target.value;
    renderTransactions(container, state);
  });

  container.querySelector("#btn-clear-filters")?.addEventListener("click", () => {
    resetFilters();
    renderTransactions(container, state);
  });

  container.querySelector("#btn-empty-clear")?.addEventListener("click", () => {
    resetFilters();
    renderTransactions(container, state);
  });

  container.querySelector("#btn-empty-add")?.addEventListener("click", () => openTransactionModal());

  container.querySelectorAll(".btn-edit-tx").forEach(btn => {
    btn.addEventListener("click", () => {
      const tx = state.transactions.find(t => t.id === btn.dataset.id);
      if (tx) openTransactionModal(tx);
    });
  });

  container.querySelectorAll(".btn-delete-tx").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tx = state.transactions.find(t => t.id === btn.dataset.id);
      if (!tx) return;
      const confirmed = await showConfirmDialog({
        title: tx.transferId ? "Delete Transfer" : "Delete Transaction",
        message: tx.transferId
          ? `Delete both legs of this transfer ("${tx.description}", ${formatCurrency(tx.amount)})?`
          : `Permanently delete "${tx.description}" (${formatCurrency(tx.amount)})?`,
        confirmLabel: "Delete",
        isDestructive: true
      });
      if (confirmed) {
        deleteTransaction(tx.id);
        showToast("Deleted successfully.", "info");
      }
    });
  });
}

function resetFilters() {
  filterOptions = {
    searchQuery: "",
    accountId: "all",
    type: "all",
    category: "all",
    paymentMethod: "all",
    startDate: "",
    endDate: "",
    sortBy: "newest"
  };
}

export function openTransactionModal(existingTx = null) {
  const isEditing = Boolean(existingTx && existingTx.id);
  let activeType = existingTx?.type === TRANSACTION_TYPES.INCOME ? TRANSACTION_TYPES.INCOME : TRANSACTION_TYPES.EXPENSE;
  const state = getState();
  const activeAccounts = (state.accounts || []).filter(a => !a.archived);
  const defaultMethod = state.settings?.defaultPaymentMethod || "fonepay";

  const todayStr = getTodayLocalDateString();
  const initialDate = isEditing ? (existingTx.dateAD || todayStr) : todayStr;
  const initialAmount = isEditing ? existingTx.amount : "";
  const initialDesc = isEditing ? existingTx.description : "";
  const initialCat = isEditing ? existingTx.category : "";
  const initialMethod = isEditing ? existingTx.paymentMethod : defaultMethod;
  const initialAccId = isEditing ? existingTx.accountId : (activeAccounts[0]?.id || "acc_default_cash");

  const getCategoryOptions = type => {
    const categories = type === TRANSACTION_TYPES.INCOME ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    return categories
      .map(c => `<option value="${c.id}" ${initialCat === c.id ? "selected" : ""}>${c.label} (${c.nepaliLabel})</option>`)
      .join("");
  };

  const initialBs = adToBs(initialDate);

  const formHtml = `
    <form id="tx-form" onsubmit="return false;">
      <div class="form-group">
        <label class="form-label">Transaction Type</label>
        <div class="radio-pill-group">
          <button type="button" class="radio-pill-btn ${activeType === TRANSACTION_TYPES.EXPENSE ? "active expense" : ""}" id="btn-type-expense">
            Expense (खर्च)
          </button>
          <button type="button" class="radio-pill-btn ${activeType === TRANSACTION_TYPES.INCOME ? "active" : ""}" id="btn-type-income">
            Income (आम्दानी)
          </button>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Account / Wallet *</label>
          <select id="tx-modal-account" class="form-select" required>
            ${activeAccounts.map(a => `<option value="${a.id}" ${a.id === initialAccId ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">
            <span>Amount (NPR) *</span>
            <span id="amount-lakh-preview" style="color: var(--color-primary); font-weight: var(--font-weight-normal);"></span>
          </label>
          <input type="number" id="tx-modal-amount" class="form-input" placeholder="e.g. 5000" min="1" step="0.01" value="${initialAmount}" required />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Category *</label>
        <select id="tx-modal-category" class="form-select" required>
          ${getCategoryOptions(activeType)}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Description / Remarks *</label>
        <input type="text" id="tx-modal-desc" class="form-input" placeholder="e.g. Weekly Groceries at Bhatbhateni" value="${escapeHtml(initialDesc)}" maxlength="200" required />
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Date (AD) *</label>
          <input type="date" id="tx-modal-date" class="form-input" value="${initialDate}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Nepali Date (BS)</label>
          <input type="text" id="tx-modal-bs-display" class="form-input" value="${initialBs ? initialBs.formatted + " BS" : "N/A"}" readonly style="background-color: var(--bg-card-subtle); color: var(--text-secondary);" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Payment Method *</label>
        <select id="tx-modal-method" class="form-select" required>
          ${PAYMENT_METHODS.map(m => `<option value="${m.id}" ${initialMethod === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
        </select>
      </div>

      <div id="tx-modal-error" class="form-error" style="display: none;"></div>
    </form>
  `;

  openModal({
    title: isEditing ? "Edit Transaction" : "Record New Transaction",
    contentHtml: formHtml,
    saveLabel: isEditing ? "Save Changes" : "Record Transaction",
    onOpen: modalBody => {
      const typeExpenseBtn = modalBody.querySelector("#btn-type-expense");
      const typeIncomeBtn = modalBody.querySelector("#btn-type-income");
      const categorySelect = modalBody.querySelector("#tx-modal-category");
      const amountInput = modalBody.querySelector("#tx-modal-amount");
      const previewSpan = modalBody.querySelector("#amount-lakh-preview");
      const dateInput = modalBody.querySelector("#tx-modal-date");
      const bsDisplay = modalBody.querySelector("#tx-modal-bs-display");

      const updateLakh = val => {
        const n = Number(val);
        previewSpan.textContent = (!isNaN(n) && n > 0) ? `रु ${formatNepaliNumber(n, 2)}` : "";
      };
      if (initialAmount) updateLakh(initialAmount);
      amountInput.addEventListener("input", e => updateLakh(e.target.value));

      dateInput.addEventListener("change", e => {
        const bs = adToBs(e.target.value);
        bsDisplay.value = bs ? `${bs.formatted} BS (${bs.monthName})` : "Outside BS 2070-2090";
      });

      typeExpenseBtn.addEventListener("click", () => {
        activeType = TRANSACTION_TYPES.EXPENSE;
        typeExpenseBtn.className = "radio-pill-btn active expense";
        typeIncomeBtn.className = "radio-pill-btn";
        categorySelect.innerHTML = getCategoryOptions(TRANSACTION_TYPES.EXPENSE);
      });

      typeIncomeBtn.addEventListener("click", () => {
        activeType = TRANSACTION_TYPES.INCOME;
        typeIncomeBtn.className = "radio-pill-btn active";
        typeExpenseBtn.className = "radio-pill-btn";
        categorySelect.innerHTML = getCategoryOptions(TRANSACTION_TYPES.INCOME);
      });
    },
    onSave: modalBody => {
      const accountId = modalBody.querySelector("#tx-modal-account").value;
      const amount = modalBody.querySelector("#tx-modal-amount").value;
      const category = modalBody.querySelector("#tx-modal-category").value;
      const description = modalBody.querySelector("#tx-modal-desc").value;
      const dateAD = modalBody.querySelector("#tx-modal-date").value;
      const paymentMethod = modalBody.querySelector("#tx-modal-method").value;
      const errorDiv = modalBody.querySelector("#tx-modal-error");

      const txPayload = {
        id: isEditing ? existingTx.id : undefined,
        type: activeType,
        accountId,
        amount: Number(amount),
        category,
        description,
        dateAD,
        paymentMethod
      };

      const result = isEditing ? updateTransaction(txPayload) : addTransaction(txPayload);
      if (!result.success) {
        errorDiv.textContent = (result.errors || [result.error]).join(" ");
        errorDiv.style.display = "block";
        return false;
      }
      showToast(isEditing ? "Transaction updated!" : "Transaction recorded!", "success");
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
