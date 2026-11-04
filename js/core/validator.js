/**
 * MeroHisab — Centralized Data & Schema Validator (v3 Audited)
 * Enforces strict validation invariants across accounts, transactions, transfers,
 * recurring rules, bills, budgets, goals, and backups.
 */
import {
  TRANSACTION_TYPES,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS
} from "./constants.js";
import { isValidAdDate } from "../utils/nepali-calendar.js";

export const Validator = {
  validateAccount(acc) {
    const errors = [];
    if (!acc || typeof acc !== "object") {
      return { isValid: false, errors: ["Account must be an object."] };
    }
    if (!acc.id || typeof acc.id !== "string") {
      errors.push("Account must have a valid string 'id'.");
    }
    if (!acc.name || typeof acc.name !== "string" || acc.name.trim() === "") {
      errors.push("Account name is required.");
    }
    const allowedTypes = ["cash", "bank", "esewa", "khalti", "ime_khalti", "custom"];
    if (!allowedTypes.includes(acc.type)) {
      errors.push(`Account type must be one of: ${allowedTypes.join(", ")}.`);
    }
    const bal = Number(acc.openingBalance);
    if (isNaN(bal) || !isFinite(bal) || bal < 0) {
      errors.push("Opening balance must be a non-negative number.");
    }
    if (!acc.openingBalanceDate || !/^\d{4}-\d{2}-\d{2}$/.test(acc.openingBalanceDate) || !isValidAdDate(acc.openingBalanceDate)) {
      errors.push("Opening balance date must be a valid YYYY-MM-DD date.");
    }
    return { isValid: errors.length === 0, errors };
  },

  validateTransferLeg(leg) {
    const errors = [];
    if (!leg || typeof leg !== "object") {
      return { isValid: false, errors: ["Transfer leg must be an object."] };
    }
    if (!leg.transferId || typeof leg.transferId !== "string") {
      errors.push("transferId is required.");
    }
    if (!leg.accountId || typeof leg.accountId !== "string") {
      errors.push("accountId is required.");
    }
    if (leg.transferDirection !== "in" && leg.transferDirection !== "out") {
      errors.push("transferDirection must be 'in' or 'out'.");
    }
    const amount = Number(leg.amount);
    if (isNaN(amount) || amount <= 0 || !isFinite(amount)) {
      errors.push("Transfer amount must be a positive number.");
    }
    if (!isValidAdDate(leg.dateAD)) {
      errors.push(`Invalid Gregorian (AD) date: '${leg.dateAD}'.`);
    }
    return { isValid: errors.length === 0, errors };
  },

  validateRecurringRule(rule) {
    const errors = [];
    if (!rule || typeof rule !== "object") {
      return { isValid: false, errors: ["Recurring rule must be an object."] };
    }
    if (!rule.id || typeof rule.id !== "string") {
      errors.push("Recurring rule id is required.");
    }
    if (!rule.title || typeof rule.title !== "string" || rule.title.trim() === "") {
      errors.push("Title is required.");
    }
    if (rule.type !== "income" && rule.type !== "expense") {
      errors.push("Type must be 'income' or 'expense'.");
    }
    const amount = Number(rule.amount);
    if (isNaN(amount) || amount <= 0 || !isFinite(amount)) {
      errors.push("Amount must be a positive number.");
    }
    if (!rule.accountId || typeof rule.accountId !== "string") {
      errors.push("accountId is required.");
    }
    const schedule = rule.schedule || {};
    const freq = schedule.frequency || schedule.freq;
    const allowedFreq = ["daily", "weekly", "monthly", "yearly"];
    if (!freq || !allowedFreq.includes(freq)) {
      errors.push(`Frequency must be one of ${allowedFreq.join(", ")}.`);
    }
    const interval = Number(schedule.interval || 1);
    if (isNaN(interval) || interval < 1) {
      errors.push("Schedule interval must be >= 1.");
    }
    if ((freq === "monthly" || freq === "yearly") && schedule.dayOfMonth !== undefined) {
      const dom = Number(schedule.dayOfMonth);
      if (isNaN(dom) || dom < 1 || dom > 31) {
        errors.push("dayOfMonth must be between 1 and 31.");
      }
    }
    if (!schedule.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(schedule.startDate) || !isValidAdDate(schedule.startDate)) {
      errors.push("schedule.startDate must be a valid YYYY-MM-DD date.");
    }
    if (schedule.endDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.endDate) || !isValidAdDate(schedule.endDate)) {
        errors.push("schedule.endDate must be a valid YYYY-MM-DD date.");
      } else if (schedule.startDate && schedule.endDate < schedule.startDate) {
        errors.push("schedule.endDate cannot be before startDate.");
      }
    }
    return { isValid: errors.length === 0, errors };
  },

  validateBill(bill) {
    const errors = [];
    if (!bill || typeof bill !== "object") {
      return { isValid: false, errors: ["Bill must be an object."] };
    }
    if (!bill.id || typeof bill.id !== "string") {
      errors.push("Bill id is required.");
    }
    if (!bill.title || typeof bill.title !== "string" || bill.title.trim() === "") {
      errors.push("Bill title is required.");
    }
    const amount = Number(bill.amount);
    if (isNaN(amount) || amount <= 0 || !isFinite(amount)) {
      errors.push("Bill amount must be a positive number.");
    }
    if (!bill.dueDateAD || !/^\d{4}-\d{2}-\d{2}$/.test(bill.dueDateAD) || !isValidAdDate(bill.dueDateAD)) {
      errors.push("bill.dueDateAD must be a valid YYYY-MM-DD date.");
    }
    if (!bill.accountId || typeof bill.accountId !== "string") {
      errors.push("bill.accountId is required.");
    }
    const expenseIds = EXPENSE_CATEGORIES.map(c => c.id);
    if (!bill.category || !expenseIds.includes(bill.category)) {
      errors.push(`Invalid expense category for bill: '${bill.category}'.`);
    }
    return { isValid: errors.length === 0, errors };
  },

  validateTransaction(tx) {
    const errors = [];
    if (!tx || typeof tx !== "object") {
      return { isValid: false, errors: ["Transaction must be an object."] };
    }
    if (tx.type === "transfer") {
      return this.validateTransferLeg(tx);
    }
    if (tx.type !== TRANSACTION_TYPES.INCOME && tx.type !== TRANSACTION_TYPES.EXPENSE) {
      errors.push(`Type must be '${TRANSACTION_TYPES.INCOME}' or '${TRANSACTION_TYPES.EXPENSE}'.`);
    }
    const amount = Number(tx.amount);
    if (isNaN(amount) || amount <= 0 || !isFinite(amount)) {
      errors.push("Amount must be a positive number greater than 0.");
    }
    const validCategories =
      tx.type === TRANSACTION_TYPES.INCOME
        ? INCOME_CATEGORIES.map(c => c.id)
        : EXPENSE_CATEGORIES.map(c => c.id);
    if (!tx.category || !validCategories.includes(tx.category)) {
      errors.push(`Invalid category: '${tx.category}'.`);
    }
    if (!tx.description || typeof tx.description !== "string" || tx.description.trim() === "") {
      errors.push("Description is required.");
    } else if (tx.description.length > 200) {
      errors.push("Description must be 200 characters or less.");
    }
    if (!isValidAdDate(tx.dateAD)) {
      errors.push(`Invalid Gregorian (AD) date: '${tx.dateAD}'. Use YYYY-MM-DD.`);
    }
    const validMethods = PAYMENT_METHODS.map(m => m.id);
    if (!tx.paymentMethod || !validMethods.includes(tx.paymentMethod)) {
      errors.push(`Invalid payment method: '${tx.paymentMethod}'.`);
    }
    return { isValid: errors.length === 0, errors };
  },

  validateBudget(budget, existingBudgets = []) {
    const errors = [];
    if (!budget || typeof budget !== "object") {
      return { isValid: false, errors: ["Budget must be an object."] };
    }
    if (!budget.period || !/^\d{4}-\d{2}$/.test(budget.period)) {
      errors.push("Budget period must be formatted as YYYY-MM.");
    }
    const validCategories = EXPENSE_CATEGORIES.map(c => c.id);
    if (!budget.category || !validCategories.includes(budget.category)) {
      errors.push(`Invalid expense category for budget: '${budget.category}'.`);
    }
    const amount = Number(budget.amount);
    if (isNaN(amount) || amount <= 0 || !isFinite(amount)) {
      errors.push("Budget amount must be a positive number.");
    }
    const isDuplicate = existingBudgets.some(
      b => b.period === budget.period && b.category === budget.category && b.id !== budget.id
    );
    if (isDuplicate) {
      errors.push(`A budget for this category already exists in ${budget.period}.`);
    }
    return { isValid: errors.length === 0, errors };
  },

  validateGoal(goal) {
    const errors = [];
    if (!goal || typeof goal !== "object") {
      return { isValid: false, errors: ["Goal must be an object."] };
    }
    if (!goal.title || typeof goal.title !== "string" || goal.title.trim() === "") {
      errors.push("Goal title is required.");
    }
    const target = Number(goal.targetAmount);
    if (isNaN(target) || target <= 0 || !isFinite(target)) {
      errors.push("Target amount must be a positive number.");
    }
    if (goal.targetDateAD && !isValidAdDate(goal.targetDateAD)) {
      errors.push("Target date must be a valid YYYY-MM-DD date.");
    }
    return { isValid: errors.length === 0, errors };
  },

  validateAllocation(allocation, maxAvailable) {
    const errors = [];
    if (!allocation || typeof allocation !== "object") {
      return { isValid: false, errors: ["Allocation must be an object."] };
    }
    const amount = Number(allocation.amount);
    if (isNaN(amount) || amount <= 0 || !isFinite(amount)) {
      errors.push("Allocation amount must be a positive number.");
    } else if (amount > maxAvailable) {
      errors.push(
        `Allocation exceeds available unallocated balance. Maximum available to allocate is रु ${maxAvailable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}.`
      );
    }
    if (allocation.dateAD && !isValidAdDate(allocation.dateAD)) {
      errors.push("Allocation date must be a valid YYYY-MM-DD date.");
    }
    return { isValid: errors.length === 0, errors };
  },

  /**
   * Comprehensive Backup JSON Validator for v1, v2, and v3 schemas
   */
  validateBackupJson(data) {
    if (!data || typeof data !== "object") {
      return { isValid: false, error: "Backup file is not a valid JSON object." };
    }
    if (!data.version || typeof data.version !== "number" || ![1, 2, 3].includes(data.version)) {
      return { isValid: false, error: "Unsupported or invalid schema version in backup file. Expected version 1, 2, or 3." };
    }
    if (!data.settings || typeof data.settings !== "object") {
      return { isValid: false, error: "Backup file must contain a 'settings' object." };
    }

    const s = data.settings;
    // In v1/v2 initialBalance and initialBalanceDate are required; in v3 they are optional if accounts[] is provided
    if (data.version < 3 || s.initialBalance !== undefined) {
      if (typeof s.initialBalance !== "number" || isNaN(s.initialBalance) || !isFinite(s.initialBalance) || s.initialBalance < 0) {
        return { isValid: false, error: "Settings must contain a valid non-negative initialBalance number." };
      }
    }
    if (data.version < 3 || s.initialBalanceDate !== undefined) {
      if (!s.initialBalanceDate || !/^\d{4}-\d{2}-\d{2}$/.test(s.initialBalanceDate) || !isValidAdDate(s.initialBalanceDate)) {
        return { isValid: false, error: "Settings must contain a valid initialBalanceDate in YYYY-MM-DD format." };
      }
    }

    // 1. Validate Accounts (if v3)
    const accountIds = new Set();
    if (data.version === 3 && data.accounts !== undefined) {
      if (!Array.isArray(data.accounts) || data.accounts.length === 0) {
        return { isValid: false, error: "v3 backup must contain a non-empty 'accounts' array." };
      }
      for (let i = 0; i < data.accounts.length; i++) {
        const acc = data.accounts[i];
        const accRes = this.validateAccount(acc);
        if (!accRes.isValid) {
          return { isValid: false, error: `Invalid account at index ${i}: ${accRes.errors.join("; ")}` };
        }
        if (accountIds.has(acc.id)) {
          return { isValid: false, error: `Duplicate account ID in backup: '${acc.id}'.` };
        }
        accountIds.add(acc.id);
      }
    }

    // 2. Validate Transactions & Transfer Leg Pairing
    if (!Array.isArray(data.transactions)) {
      return { isValid: false, error: "Backup file must contain a 'transactions' array." };
    }
    const seenTxIds = new Set();
    const transferGroups = new Map();

    for (let i = 0; i < data.transactions.length; i++) {
      const tx = data.transactions[i];
      if (!tx || !tx.id || typeof tx.id !== "string") {
        return { isValid: false, error: `Transaction at index ${i} is missing a valid 'id' string.` };
      }
      if (seenTxIds.has(tx.id)) {
        return { isValid: false, error: `Duplicate transaction ID found in backup: '${tx.id}'.` };
      }
      seenTxIds.add(tx.id);

      const validation = this.validateTransaction(tx);
      if (!validation.isValid) {
        return { isValid: false, error: `Transaction at index ${i} is invalid: ${validation.errors.join("; ")}` };
      }

      if (accountIds.size > 0 && tx.accountId && !accountIds.has(tx.accountId)) {
        return { isValid: false, error: `Transaction '${tx.id}' references non-existent accountId '${tx.accountId}'.` };
      }

      if (tx.type === "transfer" || tx.transferId) {
        if (!tx.transferId) {
          return { isValid: false, error: `Transfer transaction '${tx.id}' is missing transferId.` };
        }
        if (!transferGroups.has(tx.transferId)) transferGroups.set(tx.transferId, []);
        transferGroups.get(tx.transferId).push(tx);
      }
    }

    // Verify paired transfer integrity (each transferId must have 1 'out' and 1 'in' leg of equal amount)
    for (const [trId, legs] of transferGroups.entries()) {
      if (legs.length !== 2) {
        return { isValid: false, error: `Transfer '${trId}' is corrupted: expected 2 paired legs, found ${legs.length}.` };
      }
      const outLeg = legs.find(l => l.transferDirection === "out");
      const inLeg = legs.find(l => l.transferDirection === "in");
      if (!outLeg || !inLeg) {
        return { isValid: false, error: `Transfer '${trId}' must have one 'out' leg and one 'in' leg.` };
      }
      if (Number(outLeg.amount) !== Number(inLeg.amount)) {
        return { isValid: false, error: `Transfer '${trId}' legs have mismatched amounts.` };
      }
      if (outLeg.accountId === inLeg.accountId) {
        return { isValid: false, error: `Transfer '${trId}' cannot transfer to the same account.` };
      }
    }

    // 3. Validate Budgets
    if (!Array.isArray(data.budgets)) {
      return { isValid: false, error: "Backup file must contain a 'budgets' array." };
    }
    const validExpenseCats = EXPENSE_CATEGORIES.map(c => c.id);
    const seenBudgetPairs = new Set();
    for (let i = 0; i < data.budgets.length; i++) {
      const b = data.budgets[i];
      if (!b || typeof b !== "object" || !b.period || !/^\d{4}-\d{2}$/.test(b.period)) {
        return { isValid: false, error: `Budget at index ${i} has invalid period.` };
      }
      if (!b.category || !validExpenseCats.includes(b.category)) {
        return { isValid: false, error: `Budget at index ${i} has invalid category '${b.category}'.` };
      }
      if (typeof b.amount !== "number" || isNaN(b.amount) || b.amount <= 0) {
        return { isValid: false, error: `Budget at index ${i} must have a positive amount.` };
      }
      const pairKey = `${b.period}::${b.category}`;
      if (seenBudgetPairs.has(pairKey)) {
        return { isValid: false, error: `Duplicate budget for '${b.category}' in '${b.period}'.` };
      }
      seenBudgetPairs.add(pairKey);
    }

    // 4. Validate Goals & Allocations
    if (!Array.isArray(data.goals)) {
      return { isValid: false, error: "Backup file must contain a 'goals' array." };
    }
    const seenGoalIds = new Set();
    for (let i = 0; i < data.goals.length; i++) {
      const g = data.goals[i];
      const gVal = this.validateGoal(g);
      if (!gVal.isValid || !g.id) {
        return { isValid: false, error: `Goal at index ${i} is invalid.` };
      }
      if (seenGoalIds.has(g.id)) {
        return { isValid: false, error: `Duplicate goal ID '${g.id}'.` };
      }
      seenGoalIds.add(g.id);
    }

    // 5. Validate Recurring Rules (if present)
    if (data.recurringRules !== undefined) {
      if (!Array.isArray(data.recurringRules)) {
        return { isValid: false, error: "Backup 'recurringRules' must be an array." };
      }
      const seenRuleIds = new Set();
      for (let i = 0; i < data.recurringRules.length; i++) {
        const r = data.recurringRules[i];
        const rVal = this.validateRecurringRule(r);
        if (!rVal.isValid) {
          return { isValid: false, error: `Recurring rule at index ${i} invalid: ${rVal.errors.join("; ")}` };
        }
        if (seenRuleIds.has(r.id)) {
          return { isValid: false, error: `Duplicate recurring rule ID '${r.id}'.` };
        }
        seenRuleIds.add(r.id);
        if (accountIds.size > 0 && !accountIds.has(r.accountId)) {
          return { isValid: false, error: `Recurring rule '${r.id}' references unknown account '${r.accountId}'.` };
        }
      }
    }

    // 6. Validate Bills & 1-to-1 Payment Links (if present)
    if (data.bills !== undefined) {
      if (!Array.isArray(data.bills)) {
        return { isValid: false, error: "Backup 'bills' must be an array." };
      }
      const seenBillIds = new Set();
      const linkedTxIds = new Set();
      for (let i = 0; i < data.bills.length; i++) {
        const bill = data.bills[i];
        const bVal = this.validateBill(bill);
        if (!bVal.isValid) {
          return { isValid: false, error: `Bill at index ${i} invalid: ${bVal.errors.join("; ")}` };
        }
        if (seenBillIds.has(bill.id)) {
          return { isValid: false, error: `Duplicate bill ID '${bill.id}'.` };
        }
        seenBillIds.add(bill.id);
        if (accountIds.size > 0 && !accountIds.has(bill.accountId)) {
          return { isValid: false, error: `Bill '${bill.id}' references unknown account '${bill.accountId}'.` };
        }
        if (bill.linkedTransactionId) {
          if (linkedTxIds.has(bill.linkedTransactionId)) {
            return { isValid: false, error: `Multiple bills linked to the same transaction '${bill.linkedTransactionId}'.` };
          }
          if (!seenTxIds.has(bill.linkedTransactionId)) {
            return { isValid: false, error: `Bill '${bill.id}' links to non-existent transaction '${bill.linkedTransactionId}'.` };
          }
          linkedTxIds.add(bill.linkedTransactionId);
        }
      }
    }

    return { isValid: true, error: null };
  }
};
