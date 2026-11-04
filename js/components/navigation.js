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
import { getState, dispatch } from "../core/state.js";
import { getCurrentDualDate } from "../utils/nepali-calendar.js";
import { showToast } from "./toast.js";

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

export function initNavigation() {
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
    themeToggleBtn.addEventListener("click", () => {
      const state = getState();
      const nextTheme = state.settings.theme === "dark" ? "light" : "dark";
      dispatch("SET_THEME", nextTheme);
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
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("app-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.classList.remove("active");
}
