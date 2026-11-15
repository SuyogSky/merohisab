/**
 * MeroHisab — Centralized Data & Schema Validator (v3 Audited)
 * Enforces strict validation invariants across accounts, transactions, transfers,
 * recurring rules, bills, budgets, goals, allocations, and backups.
 * Guarantees exact money precision, safe financial limits, and relational integrity.
 */
import {
  TRANSACTION_TYPES,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS
} from "./constants.js";
import { isValidAdDate, isValidBsDate, adToBs, bsToAd } from "../utils/nepali-calendar.js";
import { isValidMoneyAmount, isValidMoneyPrecision, MAX_MONEY_AMOUNT, toPaisaBigInt, fromPaisaBigInt, checkAggregateOverflow, MAX_SAFE_RUPEES } from "../utils/money.js";

export function hasPrototypePollution(obj) {
  if (!obj || typeof obj !== "object") return false;
  const keys = Object.getOwnPropertyNames(obj);
  for (const key of keys) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return true;
    }
    const val = obj[key];
    if (val && typeof val === "object") {
      if (hasPrototypePollution(val)) return true;
    }
  }
  return false;
}


export function isValidBsDateString(bsDateStr) {
  if (!bsDateStr || typeof bsDateStr !== "string") return false;
  const match = bsDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  return isValidBsDate(y, m, d);
}

export function validateDualDate(adDateStr, bsDateStr, fieldName = "Date") {
  const errors = [];
  if (!isValidAdDate(adDateStr)) {
    errors.push(`${fieldName}: Invalid Gregorian (AD) date '${adDateStr}'.`);
    return { isValid: false, errors };
  }
  if (bsDateStr !== undefined && bsDateStr !== null && bsDateStr !== "" && bsDateStr !== "N/A") {
    if (typeof bsDateStr !== "string") {
      errors.push(`${fieldName}: Bikram Sambat (BS) date must be a string.`);
      return { isValid: false, errors };
    }
    if (!isValidBsDateString(bsDateStr)) {
      errors.push(`${fieldName}: Invalid Bikram Sambat (BS) date '${bsDateStr}'. Date does not exist in the calendar or is out of supported range (2070-2090 BS).`);
      return { isValid: false, errors };
    }
    const computedBs = adToBs(adDateStr);
    if (!computedBs) {
      errors.push(`${fieldName}: AD date '${adDateStr}' is outside the supported Bikram Sambat calendar range.`);
      return { isValid: false, errors };
    }
    if (computedBs.formatted !== bsDateStr) {
      errors.push(`${fieldName}: Date mismatch. AD date '${adDateStr}' corresponds to BS '${computedBs.formatted}', but found BS '${bsDateStr}'.`);
      return { isValid: false, errors };
    }
    const computedAd = bsToAd(bsDateStr);
    if (computedAd !== adDateStr) {
      errors.push(`${fieldName}: Date bijective mismatch between AD '${adDateStr}' and BS '${bsDateStr}'.`);
      return { isValid: false, errors };
    }
  }
  return { isValid: true, errors: [] };
}

export const Validator = {
  validateAccount(acc) {
    const errors = [];
    if (!acc || typeof acc !== "object") {
      return { isValid: false, errors: ["Account must be an object."] };
    }
    if (!acc.id || typeof acc.id !== "string" || acc.id.trim() === "") {
      errors.push("Account must have a valid string 'id'.");
    }
    if (!acc.name || typeof acc.name !== "string" || acc.name.trim() === "") {
      errors.push("Account name is required.");
    }
    const allowedTypes = ["cash", "bank", "esewa", "khalti", "ime_khalti", "custom"];
    if (!allowedTypes.includes(acc.type)) {
      errors.push(`Account type must be one of: ${allowedTypes.join(", ")}.`);
    }
    if (!isValidMoneyAmount(acc.openingBalance, true)) {
      errors.push(`Opening balance must be a valid non-negative amount with at most 2 decimal places and <= रु ${MAX_MONEY_AMOUNT.toLocaleString("en-IN")}.`);
    }
    if (acc.overdraftEnabled !== undefined && typeof acc.overdraftEnabled !== "boolean") {
      errors.push("Account field 'overdraftEnabled' must be a strict boolean (true/false).");
    }
    if (acc.archived !== undefined && typeof acc.archived !== "boolean") {
      errors.push("Account field 'archived' must be a strict boolean (true/false).");
    }
    if (acc.isPrimary !== undefined && typeof acc.isPrimary !== "boolean") {
      errors.push("Account field 'isPrimary' must be a strict boolean (true/false).");
    }
    const accDateVal = validateDualDate(acc.openingBalanceDate, acc.openingBalanceDateBS, "Account opening balance date");
    if (!accDateVal.isValid) {
      errors.push(...accDateVal.errors);
    }
    return { isValid: errors.length === 0, errors };
  },

  validateTransferLeg(leg) {
    const errors = [];
    if (!leg || typeof leg !== "object") {
      return { isValid: false, errors: ["Transfer leg must be an object."] };
    }
    if (!leg.transferId || typeof leg.transferId !== "string" || leg.transferId.trim() === "") {
      errors.push("transferId is required.");
    }
    if (!leg.accountId || typeof leg.accountId !== "string" || leg.accountId.trim() === "") {
      errors.push("accountId is required.");
    }
    if (!leg.peerAccountId || typeof leg.peerAccountId !== "string" || leg.peerAccountId.trim() === "") {
      errors.push("peerAccountId is required.");
    }
    if (leg.accountId && leg.peerAccountId && leg.accountId === leg.peerAccountId) {
      errors.push("Transfer leg accountId and peerAccountId must be different.");
    }
    if (leg.transferDirection !== "in" && leg.transferDirection !== "out") {
      errors.push("transferDirection must be 'in' or 'out'.");
    }
    if (!isValidMoneyAmount(leg.amount)) {
      errors.push(`Transfer amount must be a positive number with at most 2 decimal places and <= रु ${MAX_MONEY_AMOUNT.toLocaleString("en-IN")}.`);
    }
    const trDateVal = validateDualDate(leg.dateAD, leg.dateBS, "Transfer leg date");
    if (!trDateVal.isValid) {
      errors.push(...trDateVal.errors);
    }
    return { isValid: errors.length === 0, errors };
  },

  validateRecurringRule(rule, { requirePaused = true } = {}) {
    const errors = [];
    if (!rule || typeof rule !== "object") {
      return { isValid: false, errors: ["Recurring rule must be an object."] };
    }
    if (!rule.id || typeof rule.id !== "string" || rule.id.trim() === "") {
      errors.push("Recurring rule id is required.");
    }
    if (!rule.title || typeof rule.title !== "string" || rule.title.trim() === "") {
      errors.push("Title is required.");
    }
    if (rule.type !== "income" && rule.type !== "expense") {
      errors.push("Type must be 'income' or 'expense'.");
    }
    if (!isValidMoneyAmount(rule.amount)) {
      errors.push(`Amount must be a positive number with at most 2 decimal places and <= रु ${MAX_MONEY_AMOUNT.toLocaleString("en-IN")}.`);
    }
    if (!rule.accountId || typeof rule.accountId !== "string" || rule.accountId.trim() === "") {
      errors.push("accountId is required.");
    }

    if (requirePaused) {
      if (typeof rule.paused !== "boolean") {
        errors.push("Recurring rule field 'paused' is required and must be a strict boolean (true/false).");
      }
      if (typeof rule.isPaused !== "boolean") {
        errors.push("Recurring rule field 'isPaused' is required and must be a strict boolean (true/false).");
      }
    } else {
      if (rule.paused !== undefined && typeof rule.paused !== "boolean") {
        errors.push("Recurring rule field 'paused' must be a strict boolean (true/false).");
      }
      if (rule.isPaused !== undefined && typeof rule.isPaused !== "boolean") {
        errors.push("Recurring rule field 'isPaused' must be a strict boolean (true/false).");
      }
    }
    if (typeof rule.paused === "boolean" && typeof rule.isPaused === "boolean") {
      if (rule.paused !== rule.isPaused) {
        errors.push("Recurring rule fields 'paused' and 'isPaused' must not contradict each other.");
      }
    }

    // Category validation according to rule.type
    const validCats = rule.type === "income" ? INCOME_CATEGORIES.map(c => c.id) : EXPENSE_CATEGORIES.map(c => c.id);
    if (!rule.category || !validCats.includes(rule.category)) {
      errors.push(`Invalid ${rule.type || ""} category: '${rule.category}'.`);
    }

    // Payment method validation
    const validMethods = PAYMENT_METHODS.map(m => m.id);
    if (!rule.paymentMethod || !validMethods.includes(rule.paymentMethod)) {
      errors.push(`Invalid payment method: '${rule.paymentMethod}'.`);
    }

    const schedule = rule.schedule || {};
    if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
      errors.push("Recurring rule schedule must be an object.");
      return { isValid: false, errors };
    }

    const freq = schedule.frequency || schedule.freq;
    const allowedFreq = ["daily", "weekly", "monthly", "yearly"];
    if (!freq || !allowedFreq.includes(freq)) {
      errors.push(`Frequency must be one of ${allowedFreq.join(", ")}.`);
    }

    // Interval must be a positive safe integer. Not fractional, not infinite, not NaN, not zero, not negative.
    const rawInterval = schedule.interval;
    if (rawInterval !== undefined && rawInterval !== null) {
      if (typeof rawInterval !== "number" || !Number.isInteger(rawInterval) || rawInterval < 1 || !Number.isSafeInteger(rawInterval) || isNaN(rawInterval) || !isFinite(rawInterval)) {
        errors.push("Schedule interval must be a positive safe integer >= 1.");
      }
    }

    if (schedule.dayOfMonth !== undefined && schedule.dayOfMonth !== null) {
      const dom = schedule.dayOfMonth;
      if (typeof dom !== "number" || !Number.isInteger(dom) || dom < 1 || dom > 31) {
        errors.push("dayOfMonth must be between 1 and 31.");
      }
    }

    if (schedule.month !== undefined && schedule.month !== null) {
      const m = schedule.month;
      if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 12) {
        errors.push("Yearly month must be an integer between 1 and 12.");
      }
    }

    if (!schedule.startDate) {
      errors.push("schedule.startDate is required.");
    } else {
      const sDateVal = validateDualDate(schedule.startDate, schedule.startDateBS, "schedule.startDate");
      if (!sDateVal.isValid) {
        errors.push(...sDateVal.errors);
      }
    }

    if (schedule.endDate) {
      const eDateVal = validateDualDate(schedule.endDate, schedule.endDateBS, "schedule.endDate");
      if (!eDateVal.isValid) {
        errors.push(...eDateVal.errors);
      } else if (schedule.startDate && schedule.endDate < schedule.startDate) {
        errors.push("schedule.endDate cannot be before startDate.");
      }
    }

    if (rule.nextOccurrence) {
      const nDateVal = validateDualDate(rule.nextOccurrence, rule.nextOccurrenceBS, "rule.nextOccurrence");
      if (!nDateVal.isValid) {
        errors.push(...nDateVal.errors);
      } else {
        if (schedule.startDate && rule.nextOccurrence < schedule.startDate) {
          errors.push("rule.nextOccurrence cannot be before schedule startDate.");
        }
        if (schedule.endDate && rule.nextOccurrence > schedule.endDate) {
          errors.push("rule.nextOccurrence cannot be after schedule endDate.");
        }
      }
    }

    if (rule.lastProcessedDate) {
      const lDateVal = validateDualDate(rule.lastProcessedDate, rule.lastProcessedDateBS, "rule.lastProcessedDate");
      if (!lDateVal.isValid) {
        errors.push(...lDateVal.errors);
      }
    }

    if (rule.skippedDates !== undefined) {
      if (!Array.isArray(rule.skippedDates)) {
        errors.push("rule.skippedDates must be an array.");
      } else {
        const seenSkipped = new Set();
        for (let sIdx = 0; sIdx < rule.skippedDates.length; sIdx++) {
          const sDate = rule.skippedDates[sIdx];
          if (!isValidAdDate(sDate)) {
            errors.push(`rule.skippedDates[${sIdx}]: Invalid AD date '${sDate}'.`);
          }
          if (seenSkipped.has(sDate)) {
            errors.push(`rule.skippedDates: Duplicate skipped date '${sDate}'.`);
          }
          seenSkipped.add(sDate);
        }
      }
    }
    return { isValid: errors.length === 0, errors };
  },

  validateBill(bill, { requireIsPaid = true } = {}) {
    const errors = [];
    if (!bill || typeof bill !== "object") {
      return { isValid: false, errors: ["Bill must be an object."] };
    }
    if (!bill.id || typeof bill.id !== "string" || bill.id.trim() === "") {
      errors.push("Bill id is required.");
    }
    if (!bill.title || typeof bill.title !== "string" || bill.title.trim() === "") {
      errors.push("Bill title is required.");
    }
    if (!isValidMoneyAmount(bill.amount)) {
      errors.push(`Bill amount must be a positive number with at most 2 decimal places and <= रु ${MAX_MONEY_AMOUNT.toLocaleString("en-IN")}.`);
    }
    if (requireIsPaid) {
      if (typeof bill.isPaid !== "boolean") {
        errors.push("Bill field 'isPaid' must be a strict boolean (true/false).");
      }
    } else {
      if (bill.isPaid !== undefined && typeof bill.isPaid !== "boolean") {
        errors.push("Bill field 'isPaid' must be a strict boolean (true/false).");
      }
    }
    const allowedBillStatuses = ["paid", "unpaid", "overdue", "dueSoon", "upcoming"];
    if (bill.status !== undefined && !allowedBillStatuses.includes(bill.status)) {
      errors.push(`Invalid bill status '${bill.status}'. Allowed statuses are: ${allowedBillStatuses.join(", ")}.`);
    }
    if (bill.isPaid === true && bill.status !== undefined && bill.status !== "paid") {
      errors.push(`Paid bill (isPaid=true) cannot have non-paid status '${bill.status}'.`);
    }
    if (bill.isPaid === false && bill.status === "paid") {
      errors.push("Unpaid bill (isPaid=false) cannot have status 'paid'.");
    }
    const isPaid = bill.isPaid === true || bill.status === "paid";
    if (!isPaid && bill.linkedTransactionId) {
      errors.push(`Unpaid bill cannot have a linkedTransactionId ('${bill.linkedTransactionId}').`);
    }
    if (isPaid && (!bill.linkedTransactionId || typeof bill.linkedTransactionId !== "string" || bill.linkedTransactionId.trim() === "")) {
      errors.push("Paid bill (isPaid=true) must have a valid linkedTransactionId string.");
    }
    const billDateVal = validateDualDate(bill.dueDateAD, bill.dueDateBS, "bill.dueDate");
    if (!billDateVal.isValid) {
      errors.push(...billDateVal.errors);
    }
    if (bill.paidDateAD || bill.paidDateBS) {
      const paidDateVal = validateDualDate(bill.paidDateAD, bill.paidDateBS, "bill.paidDate");
      if (!paidDateVal.isValid) {
        errors.push(...paidDateVal.errors);
      }
    }
    if (!bill.accountId || typeof bill.accountId !== "string" || bill.accountId.trim() === "") {
      errors.push("bill.accountId is required.");
    }
    const expenseIds = EXPENSE_CATEGORIES.map(c => c.id);
    if (!bill.category || !expenseIds.includes(bill.category)) {
      errors.push(`Invalid expense category for bill: '${bill.category}'.`);
    }

    // Bill Recurrence Object Validation
    if (bill.recurrence !== undefined && bill.recurrence !== null) {
      if (typeof bill.recurrence !== "object" || Array.isArray(bill.recurrence)) {
        errors.push("bill.recurrence must be a valid recurrence object or null.");
      } else {
        const rec = bill.recurrence;
        const keys = Object.keys(rec);
        if (keys.length === 0) {
          errors.push("bill.recurrence cannot be an empty object. It must be null or a complete recurrence configuration.");
        } else {
          // Reject arbitrary unknown properties
          const allowedKeys = [
            "frequency", "freq", "interval", "dayOfMonth", "month",
            "startDate", "startDateBS", "endDate", "endDateBS",
            "untilAD", "untilBS", "nextOccurrence", "nextOccurrenceBS"
          ];
          const unknownKeys = keys.filter(k => !allowedKeys.includes(k));
          if (unknownKeys.length > 0) {
            errors.push(`Unknown bill recurrence properties: ${unknownKeys.join(", ")}.`);
          }

          // 1. Frequency is mandatory
          const recFreq = rec.frequency || rec.freq;
          const allowedFreq = ["daily", "weekly", "monthly", "yearly"];
          if (!recFreq) {
            errors.push("Bill recurrence frequency is required.");
          } else if (typeof recFreq !== "string" || !allowedFreq.includes(recFreq)) {
            errors.push(`Invalid bill recurrence frequency '${recFreq}'. Must be one of: ${allowedFreq.join(", ")}.`);
          }

          // 2. Interval is mandatory and must be a positive safe integer
          if (rec.interval === undefined || rec.interval === null) {
            errors.push("Bill recurrence interval is required.");
          } else if (
            typeof rec.interval !== "number" ||
            !Number.isInteger(rec.interval) ||
            rec.interval < 1 ||
            !Number.isSafeInteger(rec.interval) ||
            isNaN(rec.interval) ||
            !isFinite(rec.interval)
          ) {
            errors.push("Bill recurrence interval must be a positive safe integer >= 1.");
          }

          // 3. Day of month validation
          if (rec.dayOfMonth !== undefined && rec.dayOfMonth !== null) {
            if (
              typeof rec.dayOfMonth !== "number" ||
              !Number.isInteger(rec.dayOfMonth) ||
              rec.dayOfMonth < 1 ||
              rec.dayOfMonth > 31
            ) {
              errors.push("Bill recurrence dayOfMonth must be an integer between 1 and 31.");
            }
          }

          // 4. Yearly month validation
          if (rec.month !== undefined && rec.month !== null) {
            if (
              typeof rec.month !== "number" ||
              !Number.isInteger(rec.month) ||
              rec.month < 1 ||
              rec.month > 12
            ) {
              errors.push("Bill recurrence month must be an integer between 1 and 12.");
            }
          }

          // 5. Start date validation
          if (rec.startDate !== undefined && rec.startDate !== null) {
            if (typeof rec.startDate !== "string" || !isValidAdDate(rec.startDate)) {
              errors.push("Bill recurrence startDate must be a valid AD date (YYYY-MM-DD).");
            } else {
              const sVal = validateDualDate(rec.startDate, rec.startDateBS, "bill.recurrence.startDate");
              if (!sVal.isValid) errors.push(...sVal.errors);
            }
          }

          // 6. End date validation
          if (rec.endDate !== undefined && rec.endDate !== null) {
            if (typeof rec.endDate !== "string" || !isValidAdDate(rec.endDate)) {
              errors.push("Bill recurrence endDate must be a valid AD date (YYYY-MM-DD).");
            } else {
              const eVal = validateDualDate(rec.endDate, rec.endDateBS, "bill.recurrence.endDate");
              if (!eVal.isValid) errors.push(...eVal.errors);
              if (rec.startDate && rec.endDate < rec.startDate) {
                errors.push("bill.recurrence.endDate cannot be before startDate.");
              }
              if (bill.dueDateAD && rec.endDate < bill.dueDateAD) {
                errors.push("bill.recurrence.endDate cannot be before dueDateAD.");
              }
            }
          }

          // 7. untilAD / untilBS validation
          if (rec.untilAD !== undefined && rec.untilAD !== null) {
            if (typeof rec.untilAD !== "string" || !isValidAdDate(rec.untilAD)) {
              errors.push("Bill recurrence until date must be a valid AD date (YYYY-MM-DD).");
            } else {
              const uVal = validateDualDate(rec.untilAD, rec.untilBS, "bill.recurrence.until");
              if (!uVal.isValid) errors.push(...uVal.errors);
              if (rec.startDate && rec.untilAD < rec.startDate) {
                errors.push("bill.recurrence until date cannot be before startDate.");
              }
              if (bill.dueDateAD && rec.untilAD < bill.dueDateAD) {
                errors.push("bill.recurrence until date cannot be before dueDateAD.");
              }
            }
          }

          // 8. Next occurrence validation
          if (rec.nextOccurrence !== undefined && rec.nextOccurrence !== null) {
            if (typeof rec.nextOccurrence !== "string" || !isValidAdDate(rec.nextOccurrence)) {
              errors.push("Bill recurrence nextOccurrence must be a valid AD date (YYYY-MM-DD).");
            } else {
              const nVal = validateDualDate(rec.nextOccurrence, rec.nextOccurrenceBS, "bill.recurrence.nextOccurrence");
              if (!nVal.isValid) errors.push(...nVal.errors);
              if (rec.startDate && rec.nextOccurrence < rec.startDate) {
                errors.push("bill.recurrence.nextOccurrence cannot be before startDate.");
              }
              if (rec.endDate && rec.nextOccurrence > rec.endDate) {
                errors.push("bill.recurrence.nextOccurrence cannot be after endDate.");
              }
              if (rec.untilAD && rec.nextOccurrence > rec.untilAD) {
                errors.push("bill.recurrence.nextOccurrence cannot be after until date.");
              }
            }
          }
        }
      }
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
    if (!isValidMoneyAmount(tx.amount)) {
      errors.push(`Amount must be a positive number with at most 2 decimal places and <= रु ${MAX_MONEY_AMOUNT.toLocaleString("en-IN")}.`);
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
    const txDateVal = validateDualDate(tx.dateAD, tx.dateBS, "Transaction date");
    if (!txDateVal.isValid) {
      errors.push(...txDateVal.errors);
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
    if (budget.id !== undefined && (typeof budget.id !== "string" || budget.id.trim() === "")) {
      errors.push("Budget must have a valid string 'id'.");
    }
    if (budget.id && Array.isArray(existingBudgets)) {
      if (existingBudgets.some(b => b && b.id === budget.id && b !== budget)) {
        errors.push(`Budget ID '${budget.id}' must be unique.`);
      }
    }
    if (!budget.period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(budget.period)) {
      errors.push("Budget period must be formatted as YYYY-MM with month between 01 and 12.");
    } else {
      const year = parseInt(budget.period.split("-")[0], 10);
      if (year < 1900 || year > 2200) {
        errors.push("Budget year must be between 1900 and 2200.");
      }
    }
    const validCategories = EXPENSE_CATEGORIES.map(c => c.id);
    if (!budget.category || !validCategories.includes(budget.category)) {
      errors.push(`Invalid expense category for budget: '${budget.category}'.`);
    }
    if (!isValidMoneyAmount(budget.amount)) {
      errors.push(`Budget amount must be a positive number with at most 2 decimal places and <= रु ${MAX_MONEY_AMOUNT.toLocaleString("en-IN")}.`);
    }
    const isDuplicate = existingBudgets.some(
      b => b && b.period === budget.period && b.category === budget.category && b.id !== budget.id
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
    if (goal.id !== undefined && (typeof goal.id !== "string" || goal.id.trim() === "")) {
      errors.push("Goal must have a valid string 'id'.");
    }
    if (!goal.title || typeof goal.title !== "string" || goal.title.trim() === "") {
      errors.push("Goal title is required.");
    }
    if (!isValidMoneyAmount(goal.targetAmount)) {
      errors.push(`Target amount must be a positive number with at most 2 decimal places and <= रु ${MAX_MONEY_AMOUNT.toLocaleString("en-IN")}.`);
    }
    if (goal.targetDateAD || goal.targetDateBS) {
      const gDateVal = validateDualDate(goal.targetDateAD, goal.targetDateBS, "Goal targetDate");
      if (!gDateVal.isValid) {
        errors.push(...gDateVal.errors);
      }
    }
    return { isValid: errors.length === 0, errors };
  },

  validateProfileName(name) {
    const errors = [];
    if (typeof name !== "string") {
      errors.push("Display name must be a string.");
      return { isValid: false, errors };
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      errors.push("Display name cannot be empty.");
    } else if (trimmed.length > 60) {
      errors.push("Display name cannot exceed 60 characters.");
    }
    return { isValid: errors.length === 0, errors, trimmedName: trimmed };
  },

  validateAllocation(allocation, maxAvailable, existingAllocations) {
    const errors = [];
    if (!allocation || typeof allocation !== "object") {
      return { isValid: false, errors: ["Allocation must be an object."] };
    }
    if (allocation.id !== undefined && (typeof allocation.id !== "string" || allocation.id.trim() === "")) {
      errors.push("Allocation ID must be a non-empty string if provided.");
    }
    if (!isValidMoneyAmount(allocation.amount)) {
      errors.push(`Allocation amount must be a positive number with at most 2 decimal places and <= रु ${MAX_MONEY_AMOUNT.toLocaleString("en-IN")}.`);
    } else if (maxAvailable !== undefined && Number(allocation.amount) > maxAvailable) {
      errors.push(
        `Allocation exceeds available unallocated balance. Maximum available to allocate is रु ${maxAvailable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}.`
      );
    }
    const allocDateVal = validateDualDate(allocation.dateAD, allocation.dateBS, "Allocation date");
    if (!allocDateVal.isValid) {
      errors.push(...allocDateVal.errors);
    }
    if (Array.isArray(existingAllocations) && allocation.id) {
      if (existingAllocations.some(a => a.id === allocation.id)) {
        errors.push(`Allocation ID '${allocation.id}' must be unique.`);
      }
    }
    return { isValid: errors.length === 0, errors };
  },

  /**
   * Comprehensive Backup JSON Validator for v1, v2, and v3 schemas.
   * Performs deep relational, structural, and monetary integrity verification.
   */
  validateBackupJson(data) {
    if (!data || typeof data !== "object") {
      return { isValid: false, error: "Backup file is not a valid JSON object." };
    }
    if (hasPrototypePollution(data)) {
      return { isValid: false, error: "Malicious payload detected: prototype pollution keys (__proto__, constructor, prototype) are strictly forbidden." };
    }
    if (!data.version || typeof data.version !== "number" || ![1, 2, 3].includes(data.version)) {
      return { isValid: false, error: "Unsupported or invalid schema version in backup file. Expected version 1, 2, or 3." };
    }
    if (data.revision !== undefined) {
      if (
        typeof data.revision !== "number" ||
        !Number.isInteger(data.revision) ||
        data.revision < 0 ||
        !Number.isSafeInteger(data.revision) ||
        isNaN(data.revision) ||
        !isFinite(data.revision)
      ) {
        return { isValid: false, error: "Backup file 'revision' must be a non-negative safe integer." };
      }
    }
    if (data.version === 3) {
      if (data.isDemoData === undefined) {
        return { isValid: false, error: "Backup file 'isDemoData' is required and must be a strict boolean (true/false) in version 3 schema." };
      }
      if (typeof data.isDemoData !== "boolean") {
        return { isValid: false, error: "Backup file 'isDemoData' must be a strict boolean (true/false)." };
      }
    } else {
      if (data.isDemoData !== undefined && typeof data.isDemoData !== "boolean") {
        return { isValid: false, error: "Backup file 'isDemoData' must be a strict boolean (true/false)." };
      }
    }
    if (!data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) {
      return { isValid: false, error: "Backup file must contain a 'settings' object." };
    }

    const s = data.settings;
    // In v1/v2 initialBalance and initialBalanceDate are required; in v3 they are optional if accounts[] is provided
    if (data.version < 3 || s.initialBalance !== undefined) {
      if (!isValidMoneyAmount(s.initialBalance, true)) {
        return { isValid: false, error: "Settings must contain a valid non-negative initialBalance number with at most 2 decimal places." };
      }
    }
    if (data.version < 3 || s.initialBalanceDate !== undefined) {
      if (!s.initialBalanceDate || !/^\d{4}-\d{2}-\d{2}$/.test(s.initialBalanceDate) || !isValidAdDate(s.initialBalanceDate)) {
        return { isValid: false, error: "Settings must contain a valid initialBalanceDate in YYYY-MM-DD format." };
      }
      const sDateVal = validateDualDate(s.initialBalanceDate, s.initialBalanceDateBS, "Settings initialBalanceDate");
      if (!sDateVal.isValid) {
        return { isValid: false, error: sDateVal.errors.join("; ") };
      }
    }

    if (s.profile !== undefined) {
      if (!s.profile || typeof s.profile !== "object") {
        return { isValid: false, error: "Settings 'profile' must be an object." };
      }
      if (s.profile.displayName !== undefined) {
        if (typeof s.profile.displayName !== "string") {
          return { isValid: false, error: "Profile displayName must be a string." };
        }
        if (s.profile.displayName.length > 60) {
          return { isValid: false, error: "Profile displayName cannot exceed 60 characters." };
        }
      }
    }

    // Global Entity ID registry to prevent ID collisions across any entities
    const seenGlobalEntityIds = new Set();

    // 1. Validate Accounts (Required for v3)
    const accountIds = new Set();
    const accountsList = Array.isArray(data.accounts) ? data.accounts : [];
    if (data.version === 3) {
      if (!Array.isArray(data.accounts) || accountsList.length === 0) {
        return { isValid: false, error: "v3 backup must contain a non-empty 'accounts' array." };
      }
    }
    for (let i = 0; i < accountsList.length; i++) {
      const acc = accountsList[i];
      const accRes = this.validateAccount(acc);
      if (!accRes.isValid) {
        return { isValid: false, error: `Invalid account at index ${i}: ${accRes.errors.join("; ")}` };
      }
      if (!acc.id || typeof acc.id !== "string" || acc.id.trim() === "") {
        return { isValid: false, error: `Account at index ${i} is missing a valid string 'id'.` };
      }
      if (accountIds.has(acc.id) || seenGlobalEntityIds.has(acc.id)) {
        return { isValid: false, error: `Duplicate account ID in backup: '${acc.id}'.` };
      }
      accountIds.add(acc.id);
      seenGlobalEntityIds.add(acc.id);
    }

    // 2. Validate Transactions & Transfer Leg Pairing
    if (!Array.isArray(data.transactions)) {
      return { isValid: false, error: "Backup file must contain a 'transactions' array." };
    }
    const seenTxIds = new Set();
    const txMap = new Map();
    const transferGroups = new Map();

    for (let i = 0; i < data.transactions.length; i++) {
      const tx = data.transactions[i];
      if (!tx || !tx.id || typeof tx.id !== "string" || tx.id.trim() === "") {
        return { isValid: false, error: `Transaction at index ${i} is missing a valid 'id' string.` };
      }
      if (seenTxIds.has(tx.id) || seenGlobalEntityIds.has(tx.id)) {
        return { isValid: false, error: `Duplicate transaction ID found in backup: '${tx.id}'.` };
      }
      seenTxIds.add(tx.id);
      seenGlobalEntityIds.add(tx.id);
      txMap.set(tx.id, tx);

      // In v3, accountId is strictly required and must reference an existing account!
      if (data.version === 3) {
        if (!tx.accountId || typeof tx.accountId !== "string" || tx.accountId.trim() === "") {
          return { isValid: false, error: `Transaction '${tx.id}' is missing required 'accountId' in v3 schema.` };
        }
        if (!accountIds.has(tx.accountId)) {
          return { isValid: false, error: `Transaction '${tx.id}' references non-existent accountId '${tx.accountId}'.` };
        }
      } else if (accountIds.size > 0 && tx.accountId && !accountIds.has(tx.accountId)) {
        return { isValid: false, error: `Transaction '${tx.id}' references non-existent accountId '${tx.accountId}'.` };
      }

      const validation = this.validateTransaction(tx);
      if (!validation.isValid) {
        return { isValid: false, error: `Transaction at index ${i} is invalid: ${validation.errors.join("; ")}` };
      }

      if (tx.type === "transfer" || tx.transferId) {
        if (!tx.transferId || typeof tx.transferId !== "string" || tx.transferId.trim() === "") {
          return { isValid: false, error: `Transfer transaction '${tx.id}' is missing transferId.` };
        }
        if (!transferGroups.has(tx.transferId)) transferGroups.set(tx.transferId, []);
        transferGroups.get(tx.transferId).push(tx);
      }
    }

    // Verify paired transfer integrity: exactly 2 legs, 1 'out' and 1 'in', equal amounts, identical dates, reciprocal peerAccountIds
    for (const [trId, legs] of transferGroups.entries()) {
      if (legs.length !== 2) {
        return { isValid: false, error: `Transfer '${trId}' is corrupted: expected 2 paired legs, found ${legs.length}.` };
      }
      const outLeg = legs.find(l => l.transferDirection === "out");
      const inLeg = legs.find(l => l.transferDirection === "in");
      if (!outLeg || !inLeg) {
        return { isValid: false, error: `Transfer '${trId}' must have one 'out' leg and one 'in' leg.` };
      }
      if (!outLeg.peerAccountId || typeof outLeg.peerAccountId !== "string" || outLeg.peerAccountId.trim() === "") {
        return { isValid: false, error: `Transfer '${trId}' out-leg is missing required 'peerAccountId'.` };
      }
      if (!inLeg.peerAccountId || typeof inLeg.peerAccountId !== "string" || inLeg.peerAccountId.trim() === "") {
        return { isValid: false, error: `Transfer '${trId}' in-leg is missing required 'peerAccountId'.` };
      }
      if (outLeg.peerAccountId !== inLeg.accountId) {
        return { isValid: false, error: `Transfer '${trId}' out-leg peerAccountId '${outLeg.peerAccountId}' does not match in-leg accountId '${inLeg.accountId}'.` };
      }
      if (inLeg.peerAccountId !== outLeg.accountId) {
        return { isValid: false, error: `Transfer '${trId}' in-leg peerAccountId '${inLeg.peerAccountId}' does not match out-leg accountId '${outLeg.accountId}'.` };
      }
      if (outLeg.accountId === inLeg.accountId) {
        return { isValid: false, error: `Transfer '${trId}' cannot transfer to the same account.` };
      }
      if (toPaisaBigInt(outLeg.amount) !== toPaisaBigInt(inLeg.amount)) {
        return { isValid: false, error: `Transfer '${trId}' legs have mismatched amounts (${outLeg.amount} !== ${inLeg.amount}).` };
      }
      if (outLeg.dateAD !== inLeg.dateAD) {
        return { isValid: false, error: `Transfer '${trId}' legs have mismatched dates (${outLeg.dateAD} !== ${inLeg.dateAD}).` };
      }
      if (accountIds.size > 0) {
        if (!accountIds.has(outLeg.accountId)) {
          return { isValid: false, error: `Transfer '${trId}' references non-existent account '${outLeg.accountId}'.` };
        }
        if (!accountIds.has(inLeg.accountId)) {
          return { isValid: false, error: `Transfer '${trId}' references non-existent account '${inLeg.accountId}'.` };
        }
      }
    }

    // 3. Validate Budgets
    if (!Array.isArray(data.budgets)) {
      return { isValid: false, error: "Backup file must contain a 'budgets' array." };
    }
    const validExpenseCats = EXPENSE_CATEGORIES.map(c => c.id);
    const seenBudgetIds = new Set();
    const seenBudgetPairs = new Set();
    for (let i = 0; i < data.budgets.length; i++) {
      const b = data.budgets[i];
      if (!b || typeof b !== "object") {
        return { isValid: false, error: `Budget at index ${i} is not an object.` };
      }
      if (!b.id || typeof b.id !== "string" || b.id.trim() === "") {
        return { isValid: false, error: `Budget at index ${i} is missing a valid 'id' string.` };
      }
      if (seenBudgetIds.has(b.id) || seenGlobalEntityIds.has(b.id)) {
        return { isValid: false, error: `Duplicate budget ID in backup: '${b.id}'.` };
      }
      seenBudgetIds.add(b.id);
      seenGlobalEntityIds.add(b.id);

      const bVal = this.validateBudget(b);
      if (!bVal.isValid) {
        return { isValid: false, error: `Budget '${b.id}' is invalid: ${bVal.errors.join("; ")}` };
      }
      const pairKey = `${b.period}::${b.category}`;
      if (seenBudgetPairs.has(pairKey)) {
        return { isValid: false, error: `Duplicate budget for '${b.category}' in '${b.period}'.` };
      }
      seenBudgetPairs.add(pairKey);
    }

    // 4. Validate Goals & Global Unique Allocation IDs
    if (!Array.isArray(data.goals)) {
      return { isValid: false, error: "Backup file must contain a 'goals' array." };
    }
    const seenGoalIds = new Set();
    const seenAllocIds = new Set();
    for (let i = 0; i < data.goals.length; i++) {
      const g = data.goals[i];
      if (!g || !g.id || typeof g.id !== "string" || g.id.trim() === "") {
        return { isValid: false, error: `Goal at index ${i} is missing a valid 'id' string.` };
      }
      if (seenGoalIds.has(g.id) || seenGlobalEntityIds.has(g.id)) {
        return { isValid: false, error: `Duplicate goal ID '${g.id}'.` };
      }
      seenGoalIds.add(g.id);
      seenGlobalEntityIds.add(g.id);

      const gVal = this.validateGoal(g);
      if (!gVal.isValid) {
        return { isValid: false, error: `Goal at index ${i} is invalid: ${gVal.errors.join("; ")}` };
      }

      if (g.allocations !== undefined) {
        if (!Array.isArray(g.allocations)) {
          return { isValid: false, error: `Goal '${g.id}' allocations must be an array.` };
        }
        for (let j = 0; j < g.allocations.length; j++) {
          const alloc = g.allocations[j];
          if (!alloc || typeof alloc !== "object") {
            return { isValid: false, error: `Goal '${g.id}' has invalid allocation object at index ${j}.` };
          }
          if (!alloc.id || typeof alloc.id !== "string" || alloc.id.trim() === "") {
            return { isValid: false, error: `Goal '${g.id}' allocation at index ${j} is missing a valid 'id' string.` };
          }
          if (seenAllocIds.has(alloc.id) || seenGlobalEntityIds.has(alloc.id)) {
            return { isValid: false, error: `Duplicate allocation ID '${alloc.id}' found globally across goals.` };
          }
          seenAllocIds.add(alloc.id);
          seenGlobalEntityIds.add(alloc.id);

          const allocVal = this.validateAllocation(alloc);
          if (!allocVal.isValid) {
            return { isValid: false, error: `Goal '${g.id}' allocation '${alloc.id || j}' is invalid: ${allocVal.errors.join("; ")}` };
          }
          const allocDateVal = validateDualDate(alloc.dateAD, alloc.dateBS, `Goal '${g.id}' allocation '${alloc.id}' date`);
          if (!allocDateVal.isValid) {
            return { isValid: false, error: allocDateVal.errors.join("; ") };
          }
        }
      }
    }

    // 5. Validate Recurring Rules
    const recurringRuleIds = new Set();
    if (data.version === 3) {
      if (!Array.isArray(data.recurringRules)) {
        return { isValid: false, error: "Backup file must contain a 'recurringRules' array in version 3 schema." };
      }
    } else if (data.recurringRules !== undefined) {
      if (!Array.isArray(data.recurringRules)) {
        return { isValid: false, error: "Backup 'recurringRules' must be an array." };
      }
    }
    if (Array.isArray(data.recurringRules)) {
      for (let i = 0; i < data.recurringRules.length; i++) {
        const r = data.recurringRules[i];
        if (!r || !r.id || typeof r.id !== "string" || r.id.trim() === "") {
          return { isValid: false, error: `Recurring rule at index ${i} is missing a valid 'id' string.` };
        }
        if (recurringRuleIds.has(r.id) || seenGlobalEntityIds.has(r.id)) {
          return { isValid: false, error: `Duplicate recurring rule ID '${r.id}'.` };
        }
        recurringRuleIds.add(r.id);
        seenGlobalEntityIds.add(r.id);

        if (data.version === 3) {
          if (typeof r.paused !== "boolean") {
            return { isValid: false, error: `Recurring rule '${r.id}' field 'paused' is required and must be a strict boolean (true/false).` };
          }
          if (typeof r.isPaused !== "boolean") {
            return { isValid: false, error: `Recurring rule '${r.id}' field 'isPaused' is required and must be a strict boolean (true/false).` };
          }
          if (r.paused !== r.isPaused) {
            return { isValid: false, error: `Recurring rule '${r.id}' fields 'paused' and 'isPaused' must not contradict each other.` };
          }
        } else {
          if (r.paused !== undefined && typeof r.paused !== "boolean") {
            return { isValid: false, error: `Recurring rule '${r.id}' field 'paused' must be a strict boolean (true/false).` };
          }
          if (r.isPaused !== undefined && typeof r.isPaused !== "boolean") {
            return { isValid: false, error: `Recurring rule '${r.id}' field 'isPaused' must be a strict boolean (true/false).` };
          }
          if (r.paused !== undefined && r.isPaused !== undefined && r.paused !== r.isPaused) {
            return { isValid: false, error: `Recurring rule '${r.id}' fields 'paused' and 'isPaused' must not contradict each other.` };
          }
        }

        const rVal = this.validateRecurringRule(r, { requirePaused: data.version === 3 });
        if (!rVal.isValid) {
          return { isValid: false, error: `Recurring rule at index ${i} invalid: ${rVal.errors.join("; ")}` };
        }
        if (accountIds.size > 0 && !accountIds.has(r.accountId)) {
          return { isValid: false, error: `Recurring rule '${r.id}' references unknown account '${r.accountId}'.` };
        }
      }
    }

    // 6. Validate Bills & Strict 1-to-1 Payment Invariants
    const seenBillIds = new Set();
    if (data.version === 3) {
      if (!Array.isArray(data.bills)) {
        return { isValid: false, error: "Backup file must contain a 'bills' array in version 3 schema." };
      }
    } else if (data.bills !== undefined) {
      if (!Array.isArray(data.bills)) {
        return { isValid: false, error: "Backup 'bills' must be an array." };
      }
    }
    if (Array.isArray(data.bills)) {
      const linkedTxIds = new Set();
      const requireIsPaid = (data.version === 3);

      for (let i = 0; i < data.bills.length; i++) {
        const bill = data.bills[i];
        if (!bill || !bill.id || typeof bill.id !== "string" || bill.id.trim() === "") {
          return { isValid: false, error: `Bill at index ${i} is missing a valid 'id' string.` };
        }
        if (seenBillIds.has(bill.id) || seenGlobalEntityIds.has(bill.id)) {
          return { isValid: false, error: `Duplicate bill ID '${bill.id}'.` };
        }
        seenBillIds.add(bill.id);
        seenGlobalEntityIds.add(bill.id);

        if (requireIsPaid) {
          if (typeof bill.isPaid !== "boolean") {
            return { isValid: false, error: `Bill '${bill.id}' field 'isPaid' must be a strict boolean (true/false).` };
          }
        } else {
          if (bill.isPaid !== undefined && typeof bill.isPaid !== "boolean") {
            return { isValid: false, error: `Bill '${bill.id}' field 'isPaid' must be a strict boolean (true/false).` };
          }
        }
        const allowedBillStatuses = ["paid", "unpaid", "overdue", "dueSoon", "upcoming"];
        if (bill.status !== undefined && !allowedBillStatuses.includes(bill.status)) {
          return { isValid: false, error: `Bill '${bill.id}' has invalid status '${bill.status}'. Allowed statuses are: ${allowedBillStatuses.join(", ")}.` };
        }
        if (bill.isPaid === true && bill.status !== undefined && bill.status !== "paid") {
          return { isValid: false, error: `Paid bill '${bill.id}' (isPaid=true) cannot have non-paid status '${bill.status}'.` };
        }
        if (bill.isPaid === false && bill.status === "paid") {
          return { isValid: false, error: `Unpaid bill '${bill.id}' (isPaid=false) cannot have status 'paid'.` };
        }

        const bVal = this.validateBill(bill, { requireIsPaid });
        if (!bVal.isValid) {
          return { isValid: false, error: `Bill at index ${i} invalid: ${bVal.errors.join("; ")}` };
        }
        if (accountIds.size > 0 && !accountIds.has(bill.accountId)) {
          return { isValid: false, error: `Bill '${bill.id}' references unknown account '${bill.accountId}'.` };
        }

        const isPaid = bill.isPaid === true || bill.status === "paid";

        if (isPaid) {
          if (!bill.linkedTransactionId || typeof bill.linkedTransactionId !== "string" || bill.linkedTransactionId.trim() === "") {
            return { isValid: false, error: `Paid bill '${bill.id}' is missing required 'linkedTransactionId'.` };
          }
          if (linkedTxIds.has(bill.linkedTransactionId)) {
            return { isValid: false, error: `Multiple bills linked to the same transaction '${bill.linkedTransactionId}'.` };
          }
          const linkedTx = txMap.get(bill.linkedTransactionId);
          if (!linkedTx) {
            return { isValid: false, error: `Bill '${bill.id}' links to non-existent transaction '${bill.linkedTransactionId}'.` };
          }
          if (linkedTx.type !== "expense") {
            return { isValid: false, error: `Bill '${bill.id}' linked transaction must be an 'expense', but found '${linkedTx.type}'.` };
          }
          if (!linkedTx.linkedBillId || linkedTx.linkedBillId !== bill.id) {
            return { isValid: false, error: `Paid bill '${bill.id}' linked transaction '${linkedTx.id}' is missing reciprocal linkedBillId (expected '${bill.id}', found '${linkedTx.linkedBillId}').` };
          }
          if (toPaisaBigInt(linkedTx.amount) !== toPaisaBigInt(bill.amount)) {
            return { isValid: false, error: `Bill '${bill.id}' amount (${bill.amount}) does not match linked transaction amount (${linkedTx.amount}).` };
          }
          if (linkedTx.accountId !== bill.accountId) {
            return { isValid: false, error: `Bill '${bill.id}' account (${bill.accountId}) does not match linked transaction account (${linkedTx.accountId}).` };
          }
          if (linkedTx.category !== bill.category) {
            return { isValid: false, error: `Bill '${bill.id}' category (${bill.category}) does not match linked transaction category (${linkedTx.category}).` };
          }
          if (!bill.paidDateAD || typeof bill.paidDateAD !== "string" || !isValidAdDate(bill.paidDateAD)) {
            return { isValid: false, error: `Paid bill '${bill.id}' is missing a valid paidDateAD.` };
          }
          if (bill.paidDateAD !== linkedTx.dateAD) {
            return { isValid: false, error: `Paid bill '${bill.id}' paidDateAD (${bill.paidDateAD}) does not match linked transaction date (${linkedTx.dateAD}).` };
          }
          if (bill.paidDateBS) {
            const expectedBs = adToBs(bill.paidDateAD);
            if (expectedBs && bill.paidDateBS !== expectedBs.formatted) {
              return { isValid: false, error: `Paid bill '${bill.id}' paidDateBS (${bill.paidDateBS}) does not match AD/BS conversion (${expectedBs.formatted}).` };
            }
          }
          linkedTxIds.add(bill.linkedTransactionId);
        } else {
          // Unpaid bill must not link to any transaction
          if (bill.linkedTransactionId) {
            return { isValid: false, error: `Unpaid bill '${bill.id}' cannot have a linkedTransactionId ('${bill.linkedTransactionId}').` };
          }
        }
      }
    }

    // Foreign Key reverse check: transactions linking to bills must reference existing PAID bills with reciprocal link
    const billMap = new Map((data.bills || []).map(b => [b.id, b]));
    if (Array.isArray(data.transactions)) {
      for (const tx of data.transactions) {
        if (tx.linkedBillId) {
          const refBill = billMap.get(tx.linkedBillId);
          if (!refBill) {
            return { isValid: false, error: `Transaction '${tx.id}' references non-existent bill '${tx.linkedBillId}'.` };
          }
          const billIsPaid = refBill.isPaid === true || refBill.status === "paid";
          if (!billIsPaid) {
            return { isValid: false, error: `Transaction '${tx.id}' references bill '${refBill.id}', but that bill is not paid.` };
          }
          if (refBill.linkedTransactionId !== tx.id) {
            return { isValid: false, error: `Transaction '${tx.id}' references bill '${refBill.id}', but bill's linkedTransactionId is '${refBill.linkedTransactionId}'.` };
          }
        }
      }
    }

    // 7. Validate Aggregate Financial Limits & Projected Balances
    let totalOpeningPaisa = 0n;
    if (Array.isArray(data.accounts)) {
      for (const a of data.accounts) {
        totalOpeningPaisa += toPaisaBigInt(a.openingBalance || 0);
      }
      if (!checkAggregateOverflow(totalOpeningPaisa).safe) {
        return { isValid: false, error: `Aggregate opening balances exceed safe limit (रु ${MAX_SAFE_RUPEES.toLocaleString("en-IN")}).` };
      }
    }

    let totalTxPaisa = 0n;
    if (Array.isArray(data.transactions)) {
      for (const tx of data.transactions) {
        totalTxPaisa += toPaisaBigInt(tx.amount || 0);
      }
      if (!checkAggregateOverflow(totalTxPaisa).safe) {
        return { isValid: false, error: `Aggregate transactions amount exceeds safe limit (रु ${MAX_SAFE_RUPEES.toLocaleString("en-IN")}).` };
      }
    }

    // Projected Account Balances & Chronological Overdraft Invariant Verification
    if (Array.isArray(data.accounts)) {
      const txs = Array.isArray(data.transactions) ? data.transactions : [];
      let totalCombinedPaisa = 0n;

      for (const acc of data.accounts) {
        const openDate = acc.openingBalanceDate || "1970-01-01";
        const openingPaisa = toPaisaBigInt(acc.openingBalance || 0);

        // Filter transactions for this account that are on or after openingBalanceDate
        const accTxs = txs.filter(tx => {
          if (tx.accountId !== acc.id) return false;
          if (tx.dateAD && tx.dateAD < openDate) return false;
          if (tx.type === "transfer") {
            const peerAcc = data.accounts.find(a => a && a.id === tx.peerAccountId);
            if (!peerAcc || (peerAcc.openingBalanceDate && tx.dateAD < peerAcc.openingBalanceDate)) {
              return false;
            }
          }
          return true;
        });

        // Sort chronologically:
        // 1. By dateAD ascending
        // 2. On same dateAD, apply inflows (income, transfer-in) before outflows (expense, transfer-out)
        accTxs.sort((a, b) => {
          if (a.dateAD !== b.dateAD) {
            return (a.dateAD || "").localeCompare(b.dateAD || "");
          }
          const aIsInflow = a.type === "income" || (a.type === "transfer" && a.transferDirection === "in");
          const bIsInflow = b.type === "income" || (b.type === "transfer" && b.transferDirection === "in");
          if (aIsInflow && !bIsInflow) return -1;
          if (!aIsInflow && bIsInflow) return 1;
          return 0;
        });

        let runningPaisa = openingPaisa;

        for (const tx of accTxs) {
          const amt = toPaisaBigInt(tx.amount || 0);
          if (tx.type === "income") {
            runningPaisa += amt;
          } else if (tx.type === "expense") {
            runningPaisa -= amt;
          } else if (tx.type === "transfer") {
            runningPaisa += tx.transferDirection === "in" ? amt : -amt;
          }

          // Enforce overdraft rule chronologically
          if (!acc.overdraftEnabled && runningPaisa < 0n) {
            return {
              isValid: false,
              error: `Account '${acc.name || acc.id}' has overdraft disabled, but balance became negative (रु ${fromPaisaBigInt(runningPaisa, { asString: true })}) on ${tx.dateAD}.`
            };
          }

          if (!checkAggregateOverflow(runningPaisa).safe) {
            return {
              isValid: false,
              error: `Running balance for account '${acc.name || acc.id}' exceeds maximum supported limit.`
            };
          }
        }

        // Enforce overdraft rule at final state
        if (!acc.overdraftEnabled && runningPaisa < 0n) {
          return {
            isValid: false,
            error: `Account '${acc.name || acc.id}' has overdraft disabled, but resulting balance is negative (रु ${fromPaisaBigInt(runningPaisa, { asString: true })}).`
          };
        }

        if (!checkAggregateOverflow(runningPaisa).safe) {
          return {
            isValid: false,
            error: `Projected balance for account '${acc.name || acc.id}' exceeds maximum supported limit (रु 9,999,999,999,999,999.99).`
          };
        }

        totalCombinedPaisa += runningPaisa;
      }

      if (!checkAggregateOverflow(totalCombinedPaisa).safe) {
        return {
          isValid: false,
          error: "Projected combined balance across all accounts exceeds maximum supported limit (रु 9,999,999,999,999,999.99)."
        };
      }
    }

    return { isValid: true, error: null };
  },

  /**
   * Pre-commit candidate state validator
   */
  validateState(state) {
    if (!state || typeof state !== "object") {
      return { isValid: false, error: "Candidate state must be an object." };
    }
    const target = { ...state, version: 3 };
    return this.validateBackupJson(target);
  }
};
