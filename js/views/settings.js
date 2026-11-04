/**
 * MeroHisab — Settings View
 * Complete financial baseline configuration, preferences, backup/restore, and data reset.
 */

import { formatCurrency } from "../utils/formatters.js";
import { dispatch, getState } from "../core/state.js";
import { showToast } from "../components/toast.js";
import { showConfirmDialog } from "../components/confirm-dialog.js";
import { exportTransactionsToCsv, exportBackupToJson, readAndValidateBackupFile } from "../utils/file-io.js";
import { PAYMENT_METHODS } from "../core/constants.js";

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderSettings(container, state) {
  const settings = state.settings || {};
  const currentTheme = settings.theme || "dark";
  const defaultPaymentMethod = settings.defaultPaymentMethod || "fonepay";
  const currencyFormat = settings.currencyFormat || settings.currencyDisplay || "symbol";
  const dateDisplay = settings.dateDisplay || "both";

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: var(--space-6);">
      
      <!-- 1. Financial Baseline & Ledger Settings -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="5" width="20" height="14" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
            <span>Opening Balance & Baseline Date</span>
          </div>
          <span class="badge badge-safe">Verified Baseline</span>
        </div>
        <div class="content-card-body">
          <form id="ledger-baseline-form" style="display: flex; flex-direction: column; gap: var(--space-4);">
            <p style="font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.5;">
              The opening balance represents your verified liquid bank and cash balance prior to recording transactions in MeroHisab.
              Only transactions occurring on or after the baseline date affect your estimated ledger balance.
            </p>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-4);">
              <div class="form-group">
                <label class="form-label" for="setting-initial-balance">Opening Balance (NPR रु) *</label>
                <input
                  type="number"
                  id="setting-initial-balance"
                  class="form-input"
                  min="0"
                  step="0.01"
                  value="${settings.initialBalance !== undefined ? settings.initialBalance : 50000}"
                  required
                />
                <span class="form-hint">Baseline amount in liquid funds</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="setting-initial-date">Baseline Effective Date (AD) *</label>
                <input
                  type="date"
                  id="setting-initial-date"
                  class="form-input"
                  value="${settings.initialBalanceDate || "2026-10-01"}"
                  required
                />
                <span class="form-hint">Transactions on or after this date calculate into ledger</span>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end; margin-top: var(--space-2);">
              <button type="submit" class="btn btn-primary">
                💾 Save Ledger Baseline
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- 2. Application & Regional Preferences -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span>Application Preferences & Appearance</span>
          </div>
        </div>
        <div class="content-card-body">
          <form id="preferences-form" style="display: flex; flex-direction: column; gap: var(--space-5);">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-5);">
              
              <!-- Theme Selection -->
              <div class="form-group">
                <label class="form-label">Theme Mode</label>
                <div style="display: flex; gap: var(--space-2); margin-top: var(--space-1);">
                  <button type="button" class="btn btn-secondary theme-select-btn ${currentTheme === "dark" ? "btn-primary" : ""}" data-theme-val="dark">
                    🌙 Dark Navy
                  </button>
                  <button type="button" class="btn btn-secondary theme-select-btn ${currentTheme === "light" ? "btn-primary" : ""}" data-theme-val="light">
                    ☀️ Crisp Light
                  </button>
                </div>
                <span class="form-hint">Switches instantly and persists locally</span>
              </div>

              <!-- Default Payment Method -->
              <div class="form-group">
                <label class="form-label" for="setting-default-method">Default Payment Method</label>
                <select id="setting-default-method" class="form-select">
                  ${PAYMENT_METHODS.map(
                    pm => `
                    <option value="${pm.id}" ${pm.id === defaultPaymentMethod ? "selected" : ""}>
                      ${escapeHtml(pm.label)}
                    </option>
                  `
                  ).join("")}
                </select>
                <span class="form-hint">Pre-selected method for quick transaction logging</span>
              </div>

              <!-- Currency Display -->
              <div class="form-group">
                <label class="form-label" for="setting-currency-format">Currency Format</label>
                <select id="setting-currency-format" class="form-select">
                  <option value="symbol" ${currencyFormat === "symbol" ? "selected" : ""}>Nepali Rupee Symbol (रु 1,00,000.00)</option>
                  <option value="code" ${currencyFormat === "code" ? "selected" : ""}>ISO Code (NPR 1,00,000.00)</option>
                </select>
                <span class="form-hint">Used across tables, cards and summaries</span>
              </div>

              <!-- Date Display Mode -->
              <div class="form-group">
                <label class="form-label" for="setting-date-display">Date Display Preference</label>
                <select id="setting-date-display" class="form-select">
                  <option value="both" ${dateDisplay === "both" ? "selected" : ""}>Dual Dates (2026-10-15 AD • 2083-06-29 BS)</option>
                  <option value="ad" ${dateDisplay === "ad" ? "selected" : ""}>Gregorian Primary (AD)</option>
                  <option value="bs" ${dateDisplay === "bs" ? "selected" : ""}>Bikram Sambat Primary (BS)</option>
                </select>
                <span class="form-hint">Determines date display in transaction ledgers</span>
              </div>

            </div>

            <div style="display: flex; justify-content: flex-end; margin-top: var(--space-2);">
              <button type="submit" class="btn btn-primary">
                💾 Save Preferences
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- 3. Backup, Portability & Data Export -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Backup & Data Portability</span>
          </div>
          <span class="badge badge-method">JSON & CSV</span>
        </div>
        <div class="content-card-body">
          <p style="font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.5; margin-bottom: var(--space-4);">
            Your data is 100% private and stored locally. You can export complete backups in plain JSON, download CSV transaction ledgers for Excel/Sheets, or restore from a previously exported backup file.
          </p>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-4);">
            
            <!-- Export Transactions CSV -->
            <div style="padding: var(--space-4); background-color: var(--bg-card-subtle); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); display: flex; flex-direction: column; justify-content: space-between; gap: var(--space-3);">
              <div>
                <div style="font-weight: var(--font-weight-semibold); color: var(--text-primary); margin-bottom: var(--space-1);">
                  📊 Export Transactions (CSV)
                </div>
                <div style="font-size: var(--font-size-xs); color: var(--text-muted); line-height: 1.4;">
                  Includes UTF-8 BOM for Microsoft Excel. Exports all ${state.transactions.length} transactions with AD and BS dates.
                </div>
              </div>
              <button id="btn-export-csv" class="btn btn-secondary" style="width: 100%;">
                ⬇️ Download CSV File
              </button>
            </div>

            <!-- Export Full JSON Backup -->
            <div style="padding: var(--space-4); background-color: var(--bg-card-subtle); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); display: flex; flex-direction: column; justify-content: space-between; gap: var(--space-3);">
              <div>
                <div style="font-weight: var(--font-weight-semibold); color: var(--text-primary); margin-bottom: var(--space-1);">
                  📦 Export Full Snapshot (JSON)
                </div>
                <div style="font-size: var(--font-size-xs); color: var(--text-muted); line-height: 1.4;">
                  Complete schema backup including settings, transactions, budgets, and savings allocations.
                </div>
              </div>
              <button id="btn-export-json" class="btn btn-secondary" style="width: 100%;">
                ⬇️ Download JSON Backup
              </button>
            </div>

            <!-- Restore JSON Backup -->
            <div style="padding: var(--space-4); background-color: var(--bg-card-subtle); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); display: flex; flex-direction: column; justify-content: space-between; gap: var(--space-3);">
              <div>
                <div style="font-weight: var(--font-weight-semibold); color: var(--text-primary); margin-bottom: var(--space-1);">
                  📥 Restore Backup (JSON)
                </div>
                <div style="font-size: var(--font-size-xs); color: var(--text-muted); line-height: 1.4;">
                  Upload and validate an existing MeroHisab backup file to restore your finances.
                </div>
              </div>
              <input type="file" id="backup-file-input" accept=".json" style="display: none;" />
              <button id="btn-trigger-upload" class="btn btn-secondary" style="width: 100%;">
                📂 Select JSON File...
              </button>
            </div>

          </div>
        </div>
      </div>

      <!-- 4. Demo Data & Storage Reset -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path>
              <path d="M16 21h5v-5"></path>
            </svg>
            <span>Storage Maintenance & Data Reset</span>
          </div>
          <span class="badge badge-warning">Caution</span>
        </div>
        <div class="content-card-body">
          <div style="display: flex; flex-direction: column; gap: var(--space-4);">
            <p style="font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.5;">
              You can restore the realistic Nepal demo dataset anytime (useful for presentations and testing) or reset your local storage to a blank slate.
            </p>
            <div style="display: flex; gap: var(--space-3); flex-wrap: wrap;">
              <button id="btn-reset-demo" class="btn btn-secondary">
                🔄 Reload Realistic Demo Dataset
              </button>
              <button id="btn-clear-data" class="btn btn-secondary" style="color: var(--color-expense);">
                🗑️ Clear All Data (Blank Ledger)
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  `;

  // Attach Event Handlers

  // 1. Ledger Baseline Form Submit
  const baselineForm = container.querySelector("#ledger-baseline-form");
  if (baselineForm) {
    baselineForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const initialBalance = parseFloat(container.querySelector("#setting-initial-balance").value);
      const initialBalanceDate = container.querySelector("#setting-initial-date").value;

      if (isNaN(initialBalance) || initialBalance < 0) {
        showToast("Opening balance must be a valid non-negative number.", "error");
        return;
      }
      if (!initialBalanceDate) {
        showToast("Please select a valid baseline effective date.", "error");
        return;
      }

      dispatch("UPDATE_SETTINGS", {
        initialBalance,
        initialBalanceDate
      });

      showToast(`Ledger baseline updated: ${formatCurrency(initialBalance)} effective ${initialBalanceDate}`, "success");
    });
  }

  // 2. Preferences Form Submit
  const prefForm = container.querySelector("#preferences-form");
  if (prefForm) {
    prefForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const defaultPaymentMethod = container.querySelector("#setting-default-method").value;
      const currencyFormat = container.querySelector("#setting-currency-format").value;
      const dateDisplay = container.querySelector("#setting-date-display").value;

      const res = dispatch("UPDATE_SETTINGS", {
        defaultPaymentMethod,
        currencyFormat,
        currencyDisplay: currencyFormat,
        dateDisplay
      });

      if (res && res.success === false) {
        showToast(res.error || "Failed to save preferences.", "error");
      } else {
        showToast("Preferences saved successfully!", "success");
      }
    });
  }

  // Theme switch buttons
  const themeBtns = container.querySelectorAll(".theme-select-btn");
  themeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const selectedTheme = btn.getAttribute("data-theme-val");
      dispatch("SET_THEME", selectedTheme);
      document.documentElement.setAttribute("data-theme", selectedTheme);
      showToast(`Theme switched to ${selectedTheme === "dark" ? "Dark Navy" : "Crisp Light"}`, "info");
      renderSettings(container, getState());
    });
  });

  // 3. Export CSV
  const exportCsvBtn = container.querySelector("#btn-export-csv");
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      try {
        if (!state.transactions || state.transactions.length === 0) {
          showToast("No transactions to export.", "warning");
          return;
        }
        exportTransactionsToCsv(state.transactions);
        showToast("Transactions CSV downloaded successfully!", "success");
      } catch (err) {
        showToast(err.message || "Failed to export CSV.", "error");
      }
    });
  }

  // 4. Export JSON
  const exportJsonBtn = container.querySelector("#btn-export-json");
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener("click", () => {
      try {
        exportBackupToJson(state);
        showToast("Full JSON backup downloaded successfully!", "success");
      } catch (err) {
        showToast("Failed to export JSON backup.", "error");
      }
    });
  }

  // 5. Restore JSON File
  const fileInput = container.querySelector("#backup-file-input");
  const triggerUploadBtn = container.querySelector("#btn-trigger-upload");
  if (triggerUploadBtn && fileInput) {
    triggerUploadBtn.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const result = await readAndValidateBackupFile(file);
      if (!result.success) {
        showToast(result.error || "Invalid backup file.", "error");
        return;
      }

      const backup = result.data;
      const txCount = (backup.transactions || []).length;
      const bgCount = (backup.budgets || []).length;
      const glCount = (backup.goals || []).length;
      const acCount = (backup.accounts || []).length;
      const rrCount = (backup.recurringRules || []).length;
      const blCount = (backup.bills || []).length;

      // Build entity summary lines (skip zero-count v2 arrays)
      const entityLines = [
        `• ${txCount} Transaction${txCount !== 1 ? "s" : ""}`,
        `• ${bgCount} Monthly Budget${bgCount !== 1 ? "s" : ""}`,
        `• ${glCount} Savings Goal${glCount !== 1 ? "s" : ""}`,
      ];
      if (acCount > 0) entityLines.push(`• ${acCount} Account${acCount !== 1 ? "s" : ""}/Wallet${acCount !== 1 ? "s" : ""}`);
      if (rrCount > 0) entityLines.push(`• ${rrCount} Recurring Rule${rrCount !== 1 ? "s" : ""}`);
      if (blCount > 0) entityLines.push(`• ${blCount} Bill${blCount !== 1 ? "s" : ""}`);

      const confirmed = await showConfirmDialog({
        title: "Restore Ledger Backup?",
        message: `This will replace your current workspace with the data from "${escapeHtml(file.name)}":\n\n${entityLines.join("\n")}\n\nExisting local data will be replaced. Do you want to proceed?`,
        confirmLabel: "Restore Ledger",
        isDestructive: false
      });

      if (confirmed) {
        dispatch("RESTORE_BACKUP", backup);
        showToast("Backup restored successfully!", "success");
      }
    });
  }

  // 6. Reload Demo Data
  const resetDemoBtn = container.querySelector("#btn-reset-demo");
  if (resetDemoBtn) {
    resetDemoBtn.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog({
        title: "Reload Demo Dataset?",
        message: "This will overwrite your current ledger and restore the realistic verified Nepal demo dataset with 20 transactions, 5 budgets, and 2 savings goals.",
        confirmLabel: "Reload Demo Data",
        isDestructive: false
      });

      if (confirmed) {
        dispatch("RESET_TO_DEMO");
        showToast("Realistic demo dataset reloaded!", "success");
      }
    });
  }

  // 7. Clear All Data
  const clearDataBtn = container.querySelector("#btn-clear-data");
  if (clearDataBtn) {
    clearDataBtn.addEventListener("click", async () => {
      const confirmed = await showConfirmDialog({
        title: "Clear All Data?",
        message: "Are you sure you want to clear your entire ledger? All transactions, budgets, goals, and settings will be permanently erased. This action cannot be undone.",
        confirmLabel: "Yes, Clear Everything",
        isDestructive: true
      });

      if (confirmed) {
        dispatch("CLEAR_ALL_DATA");
        showToast("Ledger cleared. You now have a blank workspace.", "warning");
      }
    });
  }
}
