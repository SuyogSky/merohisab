/**
 * MeroHisab — View Routing & Navigation Controller (v3)
 */
import { renderDashboard } from "../views/dashboard.js";
import { renderAccounts } from "../views/accounts.js";
import { renderTransactions } from "../views/transactions.js";
import { renderRecurring } from "../views/recurring.js";
import { renderBills } from "../views/bills.js";
import { renderBudgets } from "../views/budgets.js";
import { renderGoals } from "../views/goals.js";
import { renderAnalytics } from "../views/analytics.js";
import { renderSettings } from "../views/settings.js";
import { getState, dispatch, getProfileDisplayName, computeProfileInitials, calculateAccountBalance } from "../core/state.js";
import { getCurrentDualDate } from "../utils/nepali-calendar.js";
import { showToast } from "./toast.js";
import { Validator } from "../core/validator.js";
import { toPaisaBigInt, fromPaisaBigInt } from "../utils/money.js";
import { exportRecoverySnapshot } from "../utils/file-io.js";
import { showConfirmDialog } from "./confirm-dialog.js";

const VIEW_METADATA = {
  dashboard: {
    title: "Dashboard Overview",
    subtitle: "Welcome back! Here is your financial pulse for Nepal."
  },
  accounts: {
    title: "Accounts & Wallets",
    subtitle: "Track Cash, Bank, eSewa, and Khalti balances and transfers."
  },
  transactions: {
    title: "Transactions",
    subtitle: "Manage your daily cash inflows, outflows, and transfers."
  },
  recurring: {
    title: "Recurring Transactions",
    subtitle: "Manage repeating income and expense schedules."
  },
  bills: {
    title: "Bills & Reminders",
    subtitle: "Track upcoming due dates and mark bills as paid."
  },
  budgets: {
    title: "Monthly Budgets",
    subtitle: "Category budget allocations and spending alerts."
  },
  goals: {
    title: "Savings Goals",
    subtitle: "Track your progress toward target financial milestones."
  },
  analytics: {
    title: "Analytics & Reports",
    subtitle: "Nepal Fiscal Year reporting and spending breakdowns."
  },
  settings: {
    title: "Settings & Ledger",
    subtitle: "Opening balance, theme mode, and storage management."
  }
};

let currentView = "dashboard";

export function computeSnapshotSummary(snapshot, sourceLabel) {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      sourceLabel,
      available: false,
      isValid: false,
      error: "Snapshot missing"
    };
  }
  const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
  const transactions = Array.isArray(snapshot.transactions) ? snapshot.transactions : [];
  const budgets = Array.isArray(snapshot.budgets) ? snapshot.budgets : [];
  const goals = Array.isArray(snapshot.goals) ? snapshot.goals : [];
  const bills = Array.isArray(snapshot.bills) ? snapshot.bills : [];
  const recurringRules = Array.isArray(snapshot.recurringRules) ? snapshot.recurringRules : [];

  let totalBalPaisa = 0n;
  for (const a of accounts) {
    totalBalPaisa += toPaisaBigInt(calculateAccountBalance(snapshot, a.id));
  }
  let totalIncomePaisa = 0n;
  let totalExpensePaisa = 0n;
  for (const t of transactions) {
    if (t.type === "income") totalIncomePaisa += toPaisaBigInt(t.amount || 0);
    else if (t.type === "expense") totalExpensePaisa += toPaisaBigInt(t.amount || 0);
  }

  const val = Validator.validateBackupJson(snapshot);

  return {
    sourceLabel,
    available: true,
    revision: snapshot.revision ?? "1",
    lastUpdated: snapshot.lastUpdated ? new Date(snapshot.lastUpdated).toLocaleString() : "N/A",
    accountCount: accounts.length,
    transactionCount: transactions.length,
    budgetCount: budgets.length,
    goalCount: goals.length,
    billCount: bills.length,
    recurringCount: recurringRules.length,
    totalBalance: fromPaisaBigInt(totalBalPaisa, { asString: true }),
    totalIncome: fromPaisaBigInt(totalIncomePaisa, { asString: true }),
    totalExpense: fromPaisaBigInt(totalExpensePaisa, { asString: true }),
    isValid: val.isValid,
    validationError: val.isValid ? null : val.error
  };
}

export function updateSidebarProfile(state = getState()) {
  if (typeof document === "undefined") return;
  const s = state || getState() || {};
  const settings = s.settings || {};
  const userName = (settings.profile?.displayName || settings.userName || "").trim() || "MeroHisab User";
  const userRole = (settings.userRole || "").trim() || "Personal Ledger";
  const initials = computeProfileInitials(userName);

  const nameEl = document.getElementById("sidebar-user-name") || document.querySelector(".user-name");
  const roleEl = document.getElementById("sidebar-user-role") || document.querySelector(".user-role");
  const avatarEl = document.getElementById("sidebar-user-avatar") || document.querySelector(".user-avatar");

  if (nameEl) {
    nameEl.textContent = userName;
    nameEl.title = userName;
  }
  if (roleEl) {
    roleEl.textContent = userRole;
  }
  if (avatarEl) {
    avatarEl.textContent = initials;
  }

  const demoBadge = document.getElementById("demo-mode-badge");
  if (demoBadge) {
    if (s.isDemoData) {
      demoBadge.style.display = "inline-flex";
    } else {
      demoBadge.style.display = "none";
    }
  }
}

export function initNavigation() {
  updateSidebarProfile();
  const dateEl = document.getElementById("header-live-date");
  if (dateEl) {
    const dual = getCurrentDualDate();
    dateEl.innerHTML = `${dual.dateAD} AD &bull; ${dual.dateBS} BS`;
  }

  const allNavLinks = document.querySelectorAll("[data-route]");
  allNavLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const route = link.getAttribute("data-route");
      if (route) {
        navigateTo(route);
        closeMobileSidebar();
      }
    });
  });

  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const sidebar = document.getElementById("app-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");

  if (mobileMenuBtn && sidebar && backdrop) {
    mobileMenuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      backdrop.classList.toggle("active");
    });
    backdrop.addEventListener("click", () => {
      closeMobileSidebar();
    });
  }

  const themeToggleBtn = document.getElementById("header-theme-toggle");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", async () => {
      const state = getState();
      const nextTheme = state.settings.theme === "dark" ? "light" : "dark";
      await dispatch("SET_THEME", nextTheme);
      document.documentElement.setAttribute("data-theme", nextTheme);
      showToast(`Switched to ${nextTheme === "dark" ? "Dark Navy" : "Crisp Light"} theme`, "info", 2000);
    });
  }

  window.addEventListener("hashchange", () => {
    const hash = window.location.hash.replace("#", "");
    if (hash && VIEW_METADATA[hash]) {
      navigateTo(hash, false);
    }
  });

  const initialHash = window.location.hash.replace("#", "");
  const startRoute = initialHash && VIEW_METADATA[initialHash] ? initialHash : "dashboard";
  navigateTo(startRoute, true);
}

export function navigateTo(route, updateHistory = true) {
  if (!VIEW_METADATA[route]) {
    route = "dashboard";
  }
  currentView = route;
  if (updateHistory) {
    window.location.hash = route;
  }
  const allNavLinks = document.querySelectorAll("[data-route]");
  allNavLinks.forEach(link => {
    if (link.getAttribute("data-route") === route) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
  const titleEl = document.getElementById("header-page-title");
  const subtitleEl = document.getElementById("header-subtitle");
  if (titleEl && subtitleEl) {
    titleEl.textContent = VIEW_METADATA[route].title;
    subtitleEl.textContent = VIEW_METADATA[route].subtitle;
  }
  renderCurrentView();
}

export function renderCurrentView() {
  const container = document.getElementById("view-container");
  if (!container) return;
  const state = getState();
  updateSidebarProfile(state);

  switch (currentView) {
    case "dashboard":
      renderDashboard(container, state);
      break;
    case "accounts":
      renderAccounts(container, state);
      break;
    case "transactions":
      renderTransactions(container, state);
      break;
    case "recurring":
      renderRecurring(container, state);
      break;
    case "bills":
      renderBills(container, state);
      break;
    case "budgets":
      renderBudgets(container, state);
      break;
    case "goals":
      renderGoals(container, state);
      break;
    case "analytics":
      renderAnalytics(container, state);
      break;
    case "settings":
      renderSettings(container, state);
      break;
    default:
      renderDashboard(container, state);
  }

  if (state && state.recoveryMode) {
    const banner = document.createElement("div");
    banner.className = "recovery-banner card";
    banner.style.cssText = "margin-bottom: 1.5rem; border: 1px solid #ef4444; background: rgba(239, 68, 68, 0.1); padding: 1.25rem; border-radius: 8px;";

    if (state.recoveryType === "equal_revision_conflict") {
      const idbInfo = computeSnapshotSummary(state.idbRecoverableState, "IndexedDB (Primary Store)");
      const lsInfo = computeSnapshotSummary(state.lsRecoverableState, "LocalStorage (Fallback Mirror)");

      banner.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:1rem;">
          <span style="color:#ef4444;font-size:1.75rem;line-height:1;">⚠️</span>
          <div style="flex:1;">
            <h3 style="margin:0 0 0.35rem 0;color:#ef4444;font-size:1.15rem;">Storage Divergence Conflict (Revision ${state.revision})</h3>
            <p style="margin:0;font-size:0.875rem;color:var(--text-secondary);line-height:1.5;">
              IndexedDB and LocalStorage both contain revision ${state.revision} with divergent records. Normal mutations, resets, and backup restorations are blocked until you choose which original snapshot to keep. Neither copy has been deleted or overwritten.
            </p>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(290px, 1fr));gap:1rem;margin-bottom:1rem;">
          <!-- IndexedDB Card -->
          <div style="background:var(--bg-card);border:1px solid ${idbInfo.isValid ? "var(--border-color, #e2e8f0)" : "#ef4444"};border-radius:8px;padding:1rem;display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                <strong style="color:var(--text-primary);font-size:0.95rem;">📦 IndexedDB Snapshot</strong>
                <span class="badge ${idbInfo.isValid ? "badge-safe" : "badge-expense"}" style="font-size:0.75rem;">${idbInfo.isValid ? "✓ Valid Schema" : "⚠️ Invalid"}</span>
              </div>
              <ul style="margin:0 0 1rem 0;padding-left:1.1rem;font-size:0.825rem;color:var(--text-secondary);line-height:1.6;">
                <li><strong>Revision:</strong> ${idbInfo.revision} &bull; <strong>Updated:</strong> ${idbInfo.lastUpdated}</li>
                <li><strong>Calculated Total Balance:</strong> रु ${idbInfo.totalBalance}</li>
                <li><strong>Accounts:</strong> ${idbInfo.accountCount} account(s)</li>
                <li><strong>Transactions:</strong> ${idbInfo.transactionCount} (Inflow: रु ${idbInfo.totalIncome} &bull; Outflow: रु ${idbInfo.totalExpense})</li>
                <li><strong>Entities:</strong> ${idbInfo.budgetCount} budgets &bull; ${idbInfo.goalCount} goals &bull; ${idbInfo.billCount} bills</li>
                ${idbInfo.validationError ? `<li style="color:#ef4444;"><strong>Error:</strong> ${idbInfo.validationError}</li>` : ""}
              </ul>
            </div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <button id="btn-export-idb-snapshot" class="btn btn-sm btn-secondary" style="font-size:0.75rem;">📥 Export merohisab-recovery-indexeddb.json</button>
              <button id="btn-resolve-idb" class="btn btn-sm btn-primary" style="background:#2563eb;border-color:#2563eb;font-size:0.75rem;" ${!idbInfo.isValid ? "disabled title='Snapshot is invalid'" : ""}>✓ Keep IndexedDB Snapshot</button>
            </div>
          </div>

          <!-- LocalStorage Card -->
          <div style="background:var(--bg-card);border:1px solid ${lsInfo.isValid ? "var(--border-color, #e2e8f0)" : "#ef4444"};border-radius:8px;padding:1rem;display:flex;flex-direction:column;justify-content:space-between;">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                <strong style="color:var(--text-primary);font-size:0.95rem;">💾 LocalStorage Snapshot</strong>
                <span class="badge ${lsInfo.isValid ? "badge-safe" : "badge-expense"}" style="font-size:0.75rem;">${lsInfo.isValid ? "✓ Valid Schema" : "⚠️ Invalid"}</span>
              </div>
              <ul style="margin:0 0 1rem 0;padding-left:1.1rem;font-size:0.825rem;color:var(--text-secondary);line-height:1.6;">
                <li><strong>Revision:</strong> ${lsInfo.revision} &bull; <strong>Updated:</strong> ${lsInfo.lastUpdated}</li>
                <li><strong>Calculated Total Balance:</strong> रु ${lsInfo.totalBalance}</li>
                <li><strong>Accounts:</strong> ${lsInfo.accountCount} account(s)</li>
                <li><strong>Transactions:</strong> ${lsInfo.transactionCount} (Inflow: रु ${lsInfo.totalIncome} &bull; Outflow: रु ${lsInfo.totalExpense})</li>
                <li><strong>Entities:</strong> ${lsInfo.budgetCount} budgets &bull; ${lsInfo.goalCount} goals &bull; ${lsInfo.billCount} bills</li>
                ${lsInfo.validationError ? `<li style="color:#ef4444;"><strong>Error:</strong> ${lsInfo.validationError}</li>` : ""}
              </ul>
            </div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <button id="btn-export-ls-snapshot" class="btn btn-sm btn-secondary" style="font-size:0.75rem;">📥 Export merohisab-recovery-localstorage.json</button>
              <button id="btn-resolve-ls" class="btn btn-sm btn-secondary" style="font-size:0.75rem;" ${!lsInfo.isValid ? "disabled title='Snapshot is invalid'" : ""}>✓ Keep LocalStorage Snapshot</button>
            </div>
          </div>
        </div>
      `;
      const btnExportIdb = banner.querySelector("#btn-export-idb-snapshot");
      const btnExportLs = banner.querySelector("#btn-export-ls-snapshot");
      const btnIdb = banner.querySelector("#btn-resolve-idb");
      const btnLs = banner.querySelector("#btn-resolve-ls");

      if (btnExportIdb) {
        btnExportIdb.addEventListener("click", () => {
          try {
            exportRecoverySnapshot(state.idbRecoverableState, "indexeddb");
            showToast("Exported merohisab-recovery-indexeddb.json", "success");
          } catch (e) {
            showToast(e.message, "error");
          }
        });
      }
      if (btnExportLs) {
        btnExportLs.addEventListener("click", () => {
          try {
            exportRecoverySnapshot(state.lsRecoverableState, "localstorage");
            showToast("Exported merohisab-recovery-localstorage.json", "success");
          } catch (e) {
            showToast(e.message, "error");
          }
        });
      }
      if (btnIdb) {
        btnIdb.addEventListener("click", async () => {
          const res = await dispatch("RESOLVE_STORAGE_CONFLICT", "idb");
          if (res.success) {
            showToast("Resolved storage conflict with IndexedDB snapshot", "success");
          } else {
            showToast(res.error || "Failed to resolve conflict", "error");
          }
        });
      }
      if (btnLs) {
        btnLs.addEventListener("click", async () => {
          const res = await dispatch("RESOLVE_STORAGE_CONFLICT", "ls");
          if (res.success) {
            showToast("Resolved storage conflict with LocalStorage snapshot", "success");
          } else {
            showToast(res.error || "Failed to resolve conflict", "error");
          }
        });
      }
    } else {
      banner.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:0.75rem;">
          <span style="color:#ef4444;font-size:1.5rem;line-height:1;">⚠️</span>
          <div>
            <h3 style="margin:0 0 0.5rem 0;color:#ef4444;font-size:1.1rem;">Protected Recovery Mode Active</h3>
            <p style="margin:0;font-size:0.9rem;line-height:1.4;">${state.recoveryError || "Data storage requires inspection."} Normal financial writes are paused to protect your original records.</p>
          </div>
        </div>
      `;
    }
    container.prepend(banner);
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("app-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.classList.remove("active");
}
