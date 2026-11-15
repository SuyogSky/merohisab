/**
 * MeroHisab — Settings View
 * Complete financial baseline configuration, preferences, backup/restore, and data reset.
 */

import { formatCurrency } from "../utils/formatters.js";
import { dispatch, getState, getProfileDisplayName } from "../core/state.js";
import { showToast } from "../components/toast.js";
import { showConfirmDialog } from "../components/confirm-dialog.js";
import { exportTransactionsToCsv, exportBackupToJson, exportRecoverySnapshot, readAndValidateBackupFile } from "../utils/file-io.js";
import { PAYMENT_METHODS } from "../core/constants.js";
import { getPersistenceStatus, requestPersistence, checkPersistenceStatus, PERSISTENCE_STATUS } from "../utils/storage-persistence.js";
import { isValidMoneyAmount, toPaisaBigInt, fromPaisaBigInt } from "../utils/money.js";

function getPersistenceInfo(status) {
  switch (status) {
    case PERSISTENCE_STATUS.GRANTED:
      return {
        badgeClass: "badge-safe",
        badgeText: "🛡️ Protected Persistence",
        boxText: "✅ <strong>Browser Storage Persistence Active:</strong> Your browser has granted persistent storage protection, reducing the risk of automatic storage eviction when device storage is constrained.<br><br><em>Note: Persistent storage protects against automatic browser eviction, but cannot protect against manual clearing of site data, hardware failure, or device loss. Regular JSON backups below remain necessary.</em>"
      };
    case PERSISTENCE_STATUS.NOT_GRANTED:
      return {
        badgeClass: "badge-method",
        badgeText: "Standard Local Storage",
        boxText: "⚠️ <strong>Standard Session Storage:</strong> Storage persistence has not been explicitly granted by the browser. If your device runs low on disk space, the browser may evict local cache. Download regular JSON backups below to guarantee long-term data safety."
      };
    case PERSISTENCE_STATUS.UNSUPPORTED:
      return {
        badgeClass: "badge-method",
        badgeText: "ℹ️ API Unsupported",
        boxText: "ℹ️ <strong>StorageManager Persistence Unsupported:</strong> This browser or platform does not support the Storage Persistence API. Data is safely stored in IndexedDB and LocalStorage, but regular external JSON backups are strongly recommended."
      };
    case PERSISTENCE_STATUS.UNAVAILABLE:
      return {
        badgeClass: "badge-warning",
        badgeText: "⚠️ Status Unavailable",
        boxText: "⚠️ <strong>Storage Status Unavailable:</strong> The browser storage manager encountered an error or permission restriction when checking status. Regular JSON backups are recommended."
      };
    case PERSISTENCE_STATUS.CHECKING:
    default:
      return {
        badgeClass: "badge-method",
        badgeText: "🔄 Checking Status...",
        boxText: "🔄 <strong>Inspecting Browser Storage Status:</strong> Querying browser storage manager for persistence guarantees..."
      };
  }
}

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

  const currentDisplayName = getProfileDisplayName(state);
  const currentUserName = settings.userName || currentDisplayName || "MeroHisab User";
  const currentUserRole = settings.userRole || "Personal Ledger";
  const persistStatus = getPersistenceStatus();
  const persistInfo = getPersistenceInfo(persistStatus);

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: var(--space-6);">
      
      <!-- 0. User Profile Settings -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <span>User Profile</span>
          </div>
          <span class="badge badge-info" id="profile-current-badge">${escapeHtml(currentDisplayName)}</span>
        </div>
        <div class="content-card-body">
          <form id="profile-settings-form" style="display: flex; flex-direction: column; gap: var(--space-4);">
            <p style="font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.5;">
              Personalize your MeroHisab ledger. Your display name appears in the sidebar and navigation.
            </p>

            <div style="max-width: 480px;">
              <div class="form-group">
                <label class="form-label" for="setting-display-name">Display Name *</label>
                <input
                  type="text"
                  id="setting-display-name"
                  class="form-input"
                  maxlength="60"
                  value="${escapeHtml(currentDisplayName)}"
                  placeholder="e.g., Aarav Sharma"
                  required
                />
                <span class="form-hint">Up to 60 characters. Avatar initials update automatically.</span>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-start; margin-top: var(--space-2);">
              <button type="submit" id="btn-save-profile" class="btn btn-primary">
                💾 Save Profile
              </button>
            </div>
          </form>
        </div>
      </div>

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
              
              <!-- User Profile Name & Ledger Subtitle -->
              <div class="form-group">
                <label class="form-label" for="setting-user-name">Your Full Name (Display Name)</label>
                <input
                  type="text"
                  id="setting-user-name"
                  class="form-input"
                  maxlength="60"
                  value="${escapeHtml(currentUserName)}"
                  placeholder="e.g., Suyog Shakya"
                />
                <span class="form-hint">Shown in the sidebar and navigation header</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="setting-user-role">Ledger Title / Subtitle</label>
                <input
                  type="text"
                  id="setting-user-role"
                  class="form-input"
                  maxlength="60"
                  value="${escapeHtml(currentUserRole)}"
                  placeholder="e.g., Personal Ledger"
                />
                <span class="form-hint">Subtitle displayed below your name in the sidebar</span>
              </div>

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

          ${state.recoveryMode ? `
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid #ef4444; border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-4);">
            <strong style="color: #ef4444;">Protected Recovery Mode Active:</strong>
            <p style="margin: 4px 0 0 0; font-size: var(--font-size-xs); color: var(--text-secondary); line-height: 1.5;">
              Ordinary backup export is disabled to prevent saving empty recovery placeholders. You can export each raw recoverable snapshot individually:
            </p>
            <div style="display: flex; gap: var(--space-2); margin-top: var(--space-3); flex-wrap: wrap;">
              ${state.idbRecoverableState ? `<button id="btn-export-recovery-idb" class="btn btn-sm btn-secondary">📥 Export merohisab-recovery-indexeddb.json</button>` : ""}
              ${state.lsRecoverableState ? `<button id="btn-export-recovery-ls" class="btn btn-sm btn-secondary">📥 Export merohisab-recovery-localstorage.json</button>` : ""}
            </div>
          </div>
          ` : ""}

          <div style="display: flex; gap: var(--space-3); flex-wrap: wrap;">
            <button id="btn-export-json" class="btn btn-secondary" ${state.recoveryMode ? "disabled title='Disabled in recovery mode'" : ""}>
              📥 Download JSON Backup
            </button>
            <button id="btn-export-csv" class="btn btn-secondary" ${state.recoveryMode ? "disabled title='Disabled in recovery mode'" : ""}>
              📊 Export CSV (Excel/Sheets)
            </button>
            <button id="btn-trigger-upload" class="btn btn-primary" ${state.recoveryMode && state.recoveryType === "equal_revision_conflict" ? "disabled title='Resolve storage conflict first'" : ""}>
              📤 Restore from JSON Backup
            </button>
            <input type="file" id="backup-file-input" accept=".json" style="display: none;" />
          </div>
        </div>
      </div>

      <!-- 4. Storage Durability & Quota Status -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <span>Storage Durability & Retention Status</span>
          </div>
          <span id="storage-persist-badge" class="badge ${persistInfo.badgeClass}">
            ${persistInfo.badgeText}
          </span>
        </div>
        <div class="content-card-body">
          <p style="font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.5; margin-bottom: var(--space-3);">
            <strong>Financial Database:</strong> IndexedDB (<code>MeroHisabDB</code>) with verified LocalStorage mirror.
            <br>
            <strong>Application Shell:</strong> Service Worker cache (<code>merohisab-v3.1.0</code>) stores static UI assets only and never contains your personal financial records.
          </p>
          <div id="storage-persist-box" style="padding: var(--space-3); background: var(--bg-card-subtle); border-radius: var(--radius-md); font-size: var(--font-size-xs); line-height: 1.6; margin-bottom: var(--space-3);">
            ${persistInfo.boxText}
          </div>
          <div style="display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap;">
            <button type="button" id="btn-request-persist" class="btn btn-secondary" style="font-size: var(--font-size-xs);">
              🛡️ Request Browser Storage Persistence Guarantee
            </button>
            <span id="storage-persist-status" style="font-size: var(--font-size-xs); color: var(--text-muted);"></span>
          </div>
        </div>
      </div>

      <!-- 5. Demo Data & Storage Reset -->
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
              You can start your personal ledger with a clean, zero-balance workspace, restore the realistic Nepal demo dataset anytime (for presentations/testing), or clear your records.
            </p>
            ${state.recoveryMode && state.recoveryType === "equal_revision_conflict" ? `
            <p style="font-size: var(--font-size-xs); color: #ef4444; margin: 0; font-weight: 500;">
              ⚠️ Storage maintenance actions (Demo Reset & Clear All) are blocked while in equal-revision recovery mode to prevent accidental data loss. Please resolve the storage conflict above first.
            </p>
            ` : ""}
            <div style="display: flex; gap: var(--space-3); flex-wrap: wrap;">
              <button id="btn-start-personal" class="btn btn-primary" style="background-color: var(--color-primary);" ${state.recoveryMode && state.recoveryType === "equal_revision_conflict" ? "disabled title='Resolve storage conflict first'" : ""}>
                💼 Start Clean Personal Ledger
              </button>
              <button id="btn-reset-demo" class="btn btn-secondary" ${state.recoveryMode && state.recoveryType === "equal_revision_conflict" ? "disabled title='Resolve storage conflict first'" : ""}>
                🔄 Reload Realistic Demo Dataset
              </button>
              <button id="btn-clear-data" class="btn btn-secondary" style="color: var(--color-expense);" ${state.recoveryMode && state.recoveryType === "equal_revision_conflict" ? "disabled title='Resolve storage conflict first'" : ""}>
                🗑️ Clear All Data (Blank Ledger)
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  `;

  // Attach Event Handlers

  // 0. Profile Settings Form Submit
  const profileForm = container.querySelector("#profile-settings-form");
  if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const inputEl = container.querySelector("#setting-display-name");
      const rawName = inputEl ? inputEl.value : "";
      const trimmed = (rawName || "").trim();

      if (!trimmed) {
        showToast("Display name cannot be empty.", "error");
        if (inputEl) inputEl.focus();
        return;
      }

      if (trimmed.length > 60) {
        showToast("Display name cannot exceed 60 characters.", "error");
        if (inputEl) inputEl.focus();
        return;
      }

      const res = await dispatch("UPDATE_PROFILE", { displayName: trimmed });
      if (res && res.success === false) {
        showToast(res.error || "Failed to update profile display name.", "error");
      } else {
        showToast("Profile display name updated successfully!", "success");
        const badge = container.querySelector("#profile-current-badge");
        if (badge) badge.textContent = trimmed;
        if (inputEl) inputEl.value = trimmed;
      }
    });
  }

  // Storage Persistence Request Handler
  const reqPersistBtn = container.querySelector("#btn-request-persist");
  const persistStatusEl = container.querySelector("#storage-persist-status");
  const updatePersistenceUI = (st) => {
    const info = getPersistenceInfo(st);
    const badge = container.querySelector("#storage-persist-badge");
    const box = container.querySelector("#storage-persist-box");
    if (badge) {
      badge.className = `badge ${info.badgeClass}`;
      badge.textContent = info.badgeText;
    }
    if (box) {
      box.innerHTML = info.boxText;
    }
  };

  if (reqPersistBtn) {
    reqPersistBtn.addEventListener("click", async () => {
      reqPersistBtn.disabled = true;
      if (persistStatusEl) persistStatusEl.textContent = "Requesting permission from browser...";
      const res = await requestPersistence();
      reqPersistBtn.disabled = false;
      updatePersistenceUI(res.status);
      if (res.success) {
        showToast("Storage persistence granted by browser!", "success");
        if (persistStatusEl) persistStatusEl.textContent = "Status: Granted (Protected)";
      } else {
        showToast(res.error || "Browser declined persistence guarantee (standard storage active).", "info");
        if (persistStatusEl) persistStatusEl.textContent = `Status: ${res.status === PERSISTENCE_STATUS.UNSUPPORTED ? "Unsupported" : "Standard (Denied by browser)"}`;
      }
    });
  }

  // If status is checking, refresh dynamically
  if (persistStatus === PERSISTENCE_STATUS.CHECKING) {
    checkPersistenceStatus().then(st => updatePersistenceUI(st)).catch(() => {});
  }

  // 1. Ledger Baseline Form Submit
  const baselineForm = container.querySelector("#ledger-baseline-form");
  if (baselineForm) {
    baselineForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rawInitialBalance = container.querySelector("#setting-initial-balance")?.value;
      const initialBalanceDate = container.querySelector("#setting-initial-date")?.value;

      if (!isValidMoneyAmount(rawInitialBalance, true)) {
        showToast("Opening balance must be a valid non-negative amount with at most 2 decimal places.", "error");
        return;
      }
      if (!initialBalanceDate) {
        showToast("Please select a valid baseline effective date.", "error");
        return;
      }

      const initialBalance = fromPaisaBigInt(toPaisaBigInt(rawInitialBalance));

      const res = await dispatch("UPDATE_SETTINGS", {
        initialBalance,
        initialBalanceDate
      });

      if (res && res.success === false) {
        showToast(res.error || "Failed to update ledger baseline.", "error");
      } else {
        showToast(`Ledger baseline updated: ${formatCurrency(initialBalance)} effective ${initialBalanceDate}`, "success");
      }
    });
  }

  // 2. Preferences Form Submit
  const prefForm = container.querySelector("#preferences-form");
  if (prefForm) {
    prefForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const userNameInput = container.querySelector("#setting-user-name");
      const userRoleInput = container.querySelector("#setting-user-role");
      const userName = (userNameInput?.value || "").trim() || "MeroHisab User";
      const userRole = (userRoleInput?.value || "").trim() || "Personal Ledger";

      const defaultPaymentMethod = container.querySelector("#setting-default-method").value;
      const currencyFormat = container.querySelector("#setting-currency-format").value;
      const dateDisplay = container.querySelector("#setting-date-display").value;

      const res = await dispatch("UPDATE_SETTINGS", {
        userName,
        userRole,
        profile: { displayName: userName },
        defaultPaymentMethod,
        currencyFormat,
        currencyDisplay: currencyFormat,
        dateDisplay
      });

      if (res && res.success === false) {
        showToast(res.error || "Failed to save preferences.", "error");
      } else {
        showToast("Preferences saved successfully!", "success");
        const badge = container.querySelector("#profile-current-badge");
        if (badge) badge.textContent = userName;
        const profileInput = container.querySelector("#setting-display-name");
        if (profileInput) profileInput.value = userName;
      }
    });
  }

  // Theme switch buttons
  const themeBtns = container.querySelectorAll(".theme-select-btn");
  themeBtns.forEach(btn => {
    btn.addEventListener("click", async () => {
      const selectedTheme = btn.getAttribute("data-theme-val");
      await dispatch("SET_THEME", selectedTheme);
      document.documentElement.setAttribute("data-theme", selectedTheme);
      showToast(`Theme switched to ${selectedTheme === "dark" ? "Dark Navy" : "Crisp Light"}`, "info");
      renderSettings(container, getState());
    });
  });

  // Recovery snapshot export handlers
  const exportRecoveryIdbBtn = container.querySelector("#btn-export-recovery-idb");
  if (exportRecoveryIdbBtn) {
    exportRecoveryIdbBtn.addEventListener("click", () => {
      try {
        exportRecoverySnapshot(state.idbRecoverableState, "indexeddb");
        showToast("Exported merohisab-recovery-indexeddb.json", "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  const exportRecoveryLsBtn = container.querySelector("#btn-export-recovery-ls");
  if (exportRecoveryLsBtn) {
    exportRecoveryLsBtn.addEventListener("click", () => {
      try {
        exportRecoverySnapshot(state.lsRecoverableState, "localstorage");
        showToast("Exported merohisab-recovery-localstorage.json", "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  // 3. Export CSV
  const exportCsvBtn = container.querySelector("#btn-export-csv");
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      try {
        if (state.recoveryMode) {
          showToast("CSV export is disabled in recovery mode.", "warning");
          return;
        }
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
        if (state.recoveryMode) {
          showToast("Ordinary backup export is disabled in recovery mode. Export raw recovery snapshots above.", "warning");
          return;
        }
        exportBackupToJson(state);
        showToast("Full JSON backup downloaded successfully!", "success");
      } catch (err) {
        showToast(err.message || "Failed to export JSON backup.", "error");
      }
    });
  }

  // 5. Restore JSON File
  const fileInput = container.querySelector("#backup-file-input");
  const triggerUploadBtn = container.querySelector("#btn-trigger-upload");
  if (triggerUploadBtn && fileInput) {
    triggerUploadBtn.addEventListener("click", () => {
      if (state.recoveryMode && state.recoveryType === "equal_revision_conflict") {
        showToast("Backup restoration is blocked during equal-revision conflict. Please resolve the conflict first.", "warning");
        return;
      }
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
        const res = await dispatch("RESTORE_BACKUP", backup);
        if (res && res.success === false) {
          showToast(res.error || "Failed to restore backup.", "error");
        } else {
          showToast("Backup restored successfully!", "success");
        }
      }
    });
  }

  // 5b. Start Clean Personal Ledger
  const startPersonalBtn = container.querySelector("#btn-start-personal");
  if (startPersonalBtn) {
    startPersonalBtn.addEventListener("click", async () => {
      if (state.recoveryMode && state.recoveryType === "equal_revision_conflict") {
        showToast("Personal ledger initialization is blocked during equal-revision conflict. Please resolve the conflict first.", "warning");
        return;
      }
      const confirmed = await showConfirmDialog({
        title: "Start Personal Ledger?",
        message: "This will remove the sample fictional demo records and create a clean, zero-balance workspace ready for your real personal finances.\n\nDo you want to proceed?",
        confirmLabel: "Start Personal Ledger",
        isDestructive: false
      });

      if (confirmed) {
        const res = await dispatch("INITIALIZE_PERSONAL_LEDGER");
        if (res && res.success === false) {
          showToast(res.error || "Failed to initialize personal ledger.", "error");
        } else {
          showToast("Personal ledger initialized with blank workspace!", "success");
          renderSettings(container, getState());
        }
      }
    });
  }

  // 6. Reload Demo Data
  const resetDemoBtn = container.querySelector("#btn-reset-demo");
  if (resetDemoBtn) {
    resetDemoBtn.addEventListener("click", async () => {
      if (state.recoveryMode && state.recoveryType === "equal_revision_conflict") {
        showToast("Demo data reset is blocked during equal-revision conflict. Please resolve the conflict first.", "warning");
        return;
      }
      const confirmed = await showConfirmDialog({
        title: "Reload Demo Dataset?",
        message: "This will overwrite your current ledger and restore the realistic verified Nepal demo dataset with 20 transactions, 5 budgets, and 2 savings goals.",
        confirmLabel: "Reload Demo Data",
        isDestructive: false
      });

      if (confirmed) {
        const res = await dispatch("RESET_TO_DEMO");
        if (res && res.success === false) {
          showToast(res.error || "Failed to reload demo data.", "error");
        } else {
          showToast("Realistic demo dataset reloaded!", "success");
        }
      }
    });
  }

  // 7. Clear All Data
  const clearDataBtn = container.querySelector("#btn-clear-data");
  if (clearDataBtn) {
    clearDataBtn.addEventListener("click", async () => {
      if (state.recoveryMode && state.recoveryType === "equal_revision_conflict") {
        showToast("Clearing data is blocked during equal-revision conflict. Please resolve the conflict first.", "warning");
        return;
      }
      const confirmed = await showConfirmDialog({
        title: "Clear All Data?",
        message: "Are you sure you want to clear your entire ledger? All transactions, budgets, goals, and settings will be permanently erased. This action cannot be undone.",
        confirmLabel: "Yes, Clear Everything",
        isDestructive: true
      });

      if (confirmed) {
        const res = await dispatch("CLEAR_ALL_DATA");
        if (res && res.success === false) {
          showToast(res.error || "Failed to clear ledger.", "error");
        } else {
          showToast("Ledger cleared. You now have a blank workspace.", "warning");
        }
      }
    });
  }
}
