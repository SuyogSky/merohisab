/**
 * MeroHisab — Transaction Management & Financial Calculation Engine (Integer Paisa Engine)
 * Ensures Global Estimated Ledger Balance ALWAYS reconciles 100% with the sum of
 * individual account balances and account-specific openingBalanceDate rules.
 * All computations use exact integer Paisa arithmetic.
 */
import { TRANSACTION_TYPES, INCOME_CATEGORIES, EXPENSE_CATEGORIES, PAYMENT_METHODS } from "../core/constants.js";
import { calculateAccountBalance } from "../core/state.js";
import { toPaisa, fromPaisa, toPaisaBigInt, fromPaisaBigInt, compareMoney } from "../utils/money.js";

/**
 * Returns true only if tx.dateAD >= account.openingBalanceDate (or global initialBalanceDate).
 */
export function isTransactionActiveForAccount(state, tx) {
  if (!tx || !tx.dateAD) return false;
  const initialBalanceDate = state?.settings?.initialBalanceDate || "1970-01-01";
  if (!state?.accounts || state.accounts.length === 0) {
    return tx.dateAD >= initialBalanceDate;
  }
  const acc = state.accounts.find(a => a.id === tx.accountId);
  const cutoff = acc?.openingBalanceDate || initialBalanceDate;
  if (tx.dateAD < cutoff) return false;
  if (tx.type === "transfer") {
    const peerAcc = state.accounts.find(a => a.id === tx.peerAccountId);
    if (!peerAcc || (peerAcc.openingBalanceDate && tx.dateAD < peerAcc.openingBalanceDate)) {
      return false;
    }
  }
  return true;
}

export function calculateFinancialSummary(state, selectedMonth = null) {
  const hasAccounts = Array.isArray(state.accounts) && state.accounts.length > 0;
  const initialBalancePaisa = hasAccounts
    ? state.accounts.reduce((sum, a) => sum + toPaisaBigInt(a.openingBalance || 0), 0n)
    : toPaisaBigInt(state.settings?.initialBalance || 0);
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

  let activeIncomePaisa = 0n;
  let activeExpensePaisa = 0n;

  for (const t of state.transactions || []) {
    if (isTransactionActiveForAccount(state, t)) {
      if (t.type === TRANSACTION_TYPES.INCOME) {
        activeIncomePaisa += toPaisaBigInt(t.amount);
      } else if (t.type === TRANSACTION_TYPES.EXPENSE) {
        activeExpensePaisa += toPaisaBigInt(t.amount);
      }
    }
  }

  // 1. Estimated Ledger Balance = exact sum of all account balances in integer Paisa
  const estimatedLedgerBalancePaisa = hasAccounts
    ? state.accounts.reduce((sum, a) => sum + toPaisaBigInt(calculateAccountBalance(state, a.id)), 0n)
    : (initialBalancePaisa + activeIncomePaisa - activeExpensePaisa);

  let monthlyInflowPaisa = 0n;
  let monthlyOutflowPaisa = 0n;

  for (const t of state.transactions || []) {
    if (t.dateAD.startsWith(selectedMonth) && isTransactionActiveForAccount(state, t)) {
      if (t.type === TRANSACTION_TYPES.INCOME) {
        monthlyInflowPaisa += toPaisaBigInt(t.amount);
      } else if (t.type === TRANSACTION_TYPES.EXPENSE) {
        monthlyOutflowPaisa += toPaisaBigInt(t.amount);
      }
    }
  }

  const netCashFlowPaisa = monthlyInflowPaisa - monthlyOutflowPaisa;

  let savingsRate = 0;
  if (monthlyInflowPaisa > 0n && netCashFlowPaisa > 0n) {
    savingsRate = Number((netCashFlowPaisa * 10000n) / monthlyInflowPaisa) / 100;
  }

  let totalEarmarkedSavingsPaisa = 0n;
  for (const goal of state.goals || []) {
    for (const alloc of goal.allocations || []) {
      totalEarmarkedSavingsPaisa += toPaisaBigInt(alloc.amount || 0);
    }
  }

  const availableToAllocatePaisa = estimatedLedgerBalancePaisa - totalEarmarkedSavingsPaisa;

  return {
    selectedMonth,
    initialBalance: fromPaisaBigInt(initialBalancePaisa),
    initialBalanceDate,
    activeIncome: fromPaisaBigInt(activeIncomePaisa),
    activeExpense: fromPaisaBigInt(activeExpensePaisa),
    estimatedLedgerBalance: fromPaisaBigInt(estimatedLedgerBalancePaisa),
    monthlyInflow: fromPaisaBigInt(monthlyInflowPaisa),
    monthlyOutflow: fromPaisaBigInt(monthlyOutflowPaisa),
    netCashFlow: fromPaisaBigInt(netCashFlowPaisa),
    savingsRate,
    totalEarmarkedSavings: fromPaisaBigInt(totalEarmarkedSavingsPaisa),
    availableToAllocate: fromPaisaBigInt(availableToAllocatePaisa)
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
      filtered.sort((a, b) => (a.dateAD || "").localeCompare(b.dateAD || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
      break;
    case "highest":
      filtered.sort((a, b) => compareMoney(b.amount, a.amount));
      break;
    case "lowest":
      filtered.sort((a, b) => compareMoney(a.amount, b.amount));
      break;
    case "newest":
    default:
      filtered.sort((a, b) => (b.dateAD || "").localeCompare(a.dateAD || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
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
