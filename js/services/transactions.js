/**
 * MeroHisab — Transaction Management & Financial Calculation Engine (v3 Audited)
 * Ensures Global Estimated Ledger Balance ALWAYS reconciles 100% with the sum of
 * individual account balances and account-specific openingBalanceDate rules.
 */
import { TRANSACTION_TYPES, INCOME_CATEGORIES, EXPENSE_CATEGORIES, PAYMENT_METHODS } from "../core/constants.js";
import { calculateAccountBalance } from "../core/state.js";

export function calculateFinancialSummary(state, selectedMonth = null) {
  const hasAccounts = Array.isArray(state.accounts) && state.accounts.length > 0;
  const initialBalance = hasAccounts
    ? state.accounts.reduce((sum, a) => sum + (Number(a.openingBalance) || 0), 0)
    : (Number(state.settings?.initialBalance) || 0);
  const initialBalanceDate = state.settings?.initialBalanceDate || "1970-01-01";

  if (!selectedMonth) {
    const now = new Date();
    selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (state.transactions && state.transactions.length > 0) {
      const hasThisMonth = state.transactions.some(t => t.dateAD.startsWith(selectedMonth));
      if (!hasThisMonth) {
        selectedMonth = state.transactions[0].dateAD.slice(0, 7);
      }
    }
  }

  let activeIncome = 0;
  let activeExpense = 0;

  // Map accountId -> openingBalanceDate for consistent per-account cutoff
  const accOpenDates = new Map();
  if (hasAccounts) {
    for (const acc of state.accounts) {
      accOpenDates.set(acc.id, acc.openingBalanceDate || "1970-01-01");
    }
  }

  for (const t of state.transactions || []) {
    const cutoffDate = (hasAccounts && t.accountId && accOpenDates.has(t.accountId))
      ? accOpenDates.get(t.accountId)
      : initialBalanceDate;
    if (t.dateAD >= cutoffDate) {
      if (t.type === TRANSACTION_TYPES.INCOME) {
        activeIncome += Number(t.amount) || 0;
      } else if (t.type === TRANSACTION_TYPES.EXPENSE) {
        activeExpense += Number(t.amount) || 0;
      }
    }
  }

  // 1. Estimated Ledger Balance = exact sum of all account balances when accounts exist
  const estimatedLedgerBalance = hasAccounts
    ? Math.round(state.accounts.reduce((sum, a) => sum + calculateAccountBalance(state, a.id), 0) * 100) / 100
    : Math.round((initialBalance + activeIncome - activeExpense) * 100) / 100;

  let monthlyInflow = 0;
  let monthlyOutflow = 0;

  for (const t of state.transactions || []) {
    if (t.dateAD.startsWith(selectedMonth)) {
      if (t.type === TRANSACTION_TYPES.INCOME) {
        monthlyInflow += Number(t.amount) || 0;
      } else if (t.type === TRANSACTION_TYPES.EXPENSE) {
        monthlyOutflow += Number(t.amount) || 0;
      }
    }
  }

  const netCashFlow = Math.round((monthlyInflow - monthlyOutflow) * 100) / 100;

  let savingsRate = 0;
  if (monthlyInflow > 0 && netCashFlow > 0) {
    savingsRate = (netCashFlow / monthlyInflow) * 100;
  }

  let totalEarmarkedSavings = 0;
  for (const goal of state.goals || []) {
    for (const alloc of goal.allocations || []) {
      totalEarmarkedSavings += Number(alloc.amount) || 0;
    }
  }

  const availableToAllocate = Math.round((estimatedLedgerBalance - totalEarmarkedSavings) * 100) / 100;

  return {
    selectedMonth,
    initialBalance: Math.round(initialBalance * 100) / 100,
    initialBalanceDate,
    activeIncome: Math.round(activeIncome * 100) / 100,
    activeExpense: Math.round(activeExpense * 100) / 100,
    estimatedLedgerBalance,
    monthlyInflow: Math.round(monthlyInflow * 100) / 100,
    monthlyOutflow: Math.round(monthlyOutflow * 100) / 100,
    netCashFlow,
    savingsRate,
    totalEarmarkedSavings: Math.round(totalEarmarkedSavings * 100) / 100,
    availableToAllocate
  };
}

export function filterAndSortTransactions(transactions, options = {}) {
  const {
    searchQuery = "",
    type = "all",
    category = "all",
    paymentMethod = "all",
    startDate = "",
    endDate = "",
    sortBy = "newest"
  } = options;

  let filtered = [...transactions];

  if (searchQuery.trim() !== "") {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(t => {
      const desc = (t.description || "").toLowerCase();
      const cat = (getCategoryLabel(t.category, t.type) || "").toLowerCase();
      const pm = (getPaymentMethodLabel(t.paymentMethod) || "").toLowerCase();
      return desc.includes(q) || cat.includes(q) || pm.includes(q);
    });
  }

  if (type !== "all") {
    filtered = filtered.filter(t => t.type === type);
  }
  if (category !== "all") {
    filtered = filtered.filter(t => t.category === category);
  }
  if (paymentMethod !== "all") {
    filtered = filtered.filter(t => t.paymentMethod === paymentMethod);
  }
  if (startDate) {
    filtered = filtered.filter(t => t.dateAD >= startDate);
  }
  if (endDate) {
    filtered = filtered.filter(t => t.dateAD <= endDate);
  }

  switch (sortBy) {
    case "oldest":
      filtered.sort((a, b) => new Date(a.dateAD) - new Date(b.dateAD) || (a.createdAt || "").localeCompare(b.createdAt || ""));
      break;
    case "highest":
      filtered.sort((a, b) => b.amount - a.amount);
      break;
    case "lowest":
      filtered.sort((a, b) => a.amount - b.amount);
      break;
    case "newest":
    default:
      filtered.sort((a, b) => new Date(b.dateAD) - new Date(a.dateAD) || (b.createdAt || "").localeCompare(a.createdAt || ""));
      break;
  }

  return filtered;
}

export function getCategoryLabel(categoryId, type = null) {
  if (categoryId === "transfer") return "Account Transfer";
  let cat = null;
  if (!type || type === TRANSACTION_TYPES.EXPENSE) {
    cat = EXPENSE_CATEGORIES.find(c => c.id === categoryId);
  }
  if (!cat && (!type || type === TRANSACTION_TYPES.INCOME)) {
    cat = INCOME_CATEGORIES.find(c => c.id === categoryId);
  }
  return cat ? cat.label : categoryId;
}

export function getCategoryIcon(categoryId) {
  if (categoryId === "transfer") return "⇄";
  const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
  const found = all.find(c => c.id === categoryId);
  const iconMap = {
    utensils: "🍲",
    "shopping-cart": "🛒",
    car: "🛵",
    home: "🏠",
    zap: "⚡",
    "shopping-bag": "🛍️",
    heart: "💊",
    "book-open": "📚",
    film: "🎬",
    compass: "✈️",
    user: "✂️",
    users: "👨‍👩‍👦",
    shield: "🛡️",
    wifi: "📱",
    tag: "🏷️",
    briefcase: "💼",
    laptop: "💻",
    building: "🏢",
    "trending-up": "📈",
    gift: "🎁",
    smile: "🪙",
    "plus-circle": "💰"
  };
  return found && iconMap[found.icon] ? iconMap[found.icon] : "🏷️";
}

export function getCategoryColor(categoryId) {
  if (categoryId === "transfer") return "#0ea5e9";
  const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
  const found = all.find(c => c.id === categoryId);
  return found ? found.color : "#64748b";
}

export function getPaymentMethodLabel(methodId) {
  const found = PAYMENT_METHODS.find(m => m.id === methodId);
  return found ? found.label : methodId;
}
