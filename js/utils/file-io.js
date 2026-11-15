import { toPaisaBigInt, fromPaisaBigInt } from "./money.js";
import { getTodayLocalDateString } from "./nepali-calendar.js";
/**
 * MeroHisab — File Export & Import Engine
 * Handles RFC-compliant CSV transaction export and schema-validated plain JSON backups.
 * Includes spreadsheet formula-injection defense, 2-decimal financial formatting,
 * and complete round-trip JSON backup export/restore support.
 */

import { Validator } from "../core/validator.js";
import { getCategoryLabel, getPaymentMethodLabel } from "../services/transactions.js";

/**
 * Generate CSV string with UTF-8 BOM, formula-injection defense, and exact 2-decimal formatting
 * @param {Array} transactions
 * @returns {string}
 */
export function generateCsvString(transactions) {
  if (!transactions || transactions.length === 0) {
    throw new Error("No transactions available to export.");
  }

  const headers = [
    "Transaction ID",
    "Date (AD)",
    "Date (BS)",
    "Type",
    "Category",
    "Description",
    "Amount (NPR)",
    "Account ID",
    "Transfer Direction",
    "Transfer ID",
    "Payment Method",
    "Created At"
  ];

  const escapeCell = (val, isNumeric = false) => {
    let str = String(val ?? "");
    // Protect CSV exports against spreadsheet formula injection (OWASP guideline):
    // Prepend a single quote if the raw string or trimmed string begins with formula triggers:
    // '=', '+', '-', '@', '\t', '\r', or '%'
    if (!isNumeric) {
      const trimmed = str.trimStart();
      if (/^[=+\-@\t\r%]/.test(trimmed) || /^[\t\r\n]/.test(str)) {
        str = "'" + str;
      }
    }
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = transactions.map(t => {
    const formattedAmount = fromPaisaBigInt(toPaisaBigInt(t.amount || 0), { asString: true });
    const desc = t.type === "transfer"
      ? `Transfer ${t.transferDirection === "out" ? "to" : "from"} ${t.peerAccountId || ""}${t.description ? " – " + t.description : ""}`
      : t.description;

    return [
      escapeCell(t.id),
      escapeCell(t.dateAD),
      escapeCell(t.dateBS || ""),
      escapeCell(t.type.toUpperCase()),
      escapeCell(t.type === "transfer" ? "Transfer" : getCategoryLabel(t.category, t.type)),
      escapeCell(desc),
      escapeCell(formattedAmount, true),
      escapeCell(t.accountId || ""),
      escapeCell(t.transferDirection || ""),
      escapeCell(t.transferId || ""),
      escapeCell(t.type === "transfer" ? "" : getPaymentMethodLabel(t.paymentMethod)),
      escapeCell(t.createdAt || "")
    ];
  });

  return (
    "\uFEFF" + // UTF-8 BOM for Excel compatibility with Nepali characters
    [headers.map(h => escapeCell(h)).join(","), ...rows.map(r => r.join(","))].join("\r\n")
  );
}

/**
 * Export all transactions to CSV format with UTF-8 BOM
 * @param {Array} transactions
 */
export function exportTransactionsToCsv(transactions) {
  const csvContent = generateCsvString(transactions);
  if (typeof Blob !== "undefined" && typeof document !== "undefined") {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const filename = `MeroHisab_Transactions_${getTodayLocalDateString()}.csv`;
    downloadBlob(blob, filename);
  }
  return csvContent;
}

/**
 * Generate formatted JSON backup string for complete application state
 * @param {object} state
 * @returns {string}
 */
export function generateBackupJsonString(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("Cannot export backup: state must be a valid non-null object.");
  }
  if (state.recoveryMode) {
    throw new Error("Cannot export ordinary backup while in recovery mode. Please export each recoverable snapshot individually or resolve the storage conflict first.");
  }

  // --- Strict Source State Validation for v3 Schema (No silent coercion or fallback substitutions) ---

  // 1. Revision must exist and be a non-negative safe integer (No silent coercion to 1 or 0)
  if (state.revision === undefined) {
    throw new TypeError("Cannot export backup: state.revision is required and must be a non-negative safe integer.");
  }
  if (
    typeof state.revision !== "number" ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    isNaN(state.revision) ||
    !isFinite(state.revision)
  ) {
    throw new TypeError(`Cannot export backup: state.revision must be a non-negative safe integer, received ${typeof state.revision} (${JSON.stringify(state.revision)})`);
  }

  // 2. isDemoData must exist and be a strict boolean (No silent coercion)
  if (state.isDemoData === undefined) {
    throw new TypeError("Cannot export backup: state.isDemoData is required and must be a strict boolean (true/false).");
  }
  if (typeof state.isDemoData !== "boolean") {
    throw new TypeError(`Cannot export backup: state.isDemoData must be a strict boolean, received ${typeof state.isDemoData} (${JSON.stringify(state.isDemoData)})`);
  }

  // 3. settings must exist and be a valid non-null object (No silent fallback to {})
  if (!state.settings || typeof state.settings !== "object" || Array.isArray(state.settings)) {
    throw new TypeError(`Cannot export backup: state.settings must be a valid non-null object, received ${state.settings === null ? "null" : typeof state.settings}`);
  }

  // 4. accounts must exist and be an array (No silent fallback to [])
  if (!Array.isArray(state.accounts)) {
    throw new TypeError(`Cannot export backup: state.accounts must be an array, received ${state.accounts === null ? "null" : typeof state.accounts}`);
  }

  // 5. transactions must exist and be an array (No silent fallback to [])
  if (!Array.isArray(state.transactions)) {
    throw new TypeError(`Cannot export backup: state.transactions must be an array, received ${state.transactions === null ? "null" : typeof state.transactions}`);
  }

  // 6. budgets must exist and be an array (No silent fallback to [])
  if (!Array.isArray(state.budgets)) {
    throw new TypeError(`Cannot export backup: state.budgets must be an array, received ${state.budgets === null ? "null" : typeof state.budgets}`);
  }

  // 7. goals must exist and be an array (No silent fallback to [])
  if (!Array.isArray(state.goals)) {
    throw new TypeError(`Cannot export backup: state.goals must be an array, received ${state.goals === null ? "null" : typeof state.goals}`);
  }

  // 8. recurringRules must exist and be an array (No silent fallback to [])
  if (!Array.isArray(state.recurringRules)) {
    throw new TypeError(`Cannot export backup: state.recurringRules must be an array, received ${state.recurringRules === null ? "null" : typeof state.recurringRules}`);
  }

  // 9. bills must exist and be an array (No silent fallback to [])
  if (!Array.isArray(state.bills)) {
    throw new TypeError(`Cannot export backup: state.bills must be an array, received ${state.bills === null ? "null" : typeof state.bills}`);
  }

  // Construct backup payload directly from validated state properties (No fallback substitutions)
  const backupPayload = {
    version: 3,
    revision: state.revision,
    isDemoData: state.isDemoData,
    exportTimestamp: new Date().toISOString(),
    appName: "MeroHisab",
    settings: state.settings,
    accounts: state.accounts,
    transactions: state.transactions,
    budgets: state.budgets,
    goals: state.goals,
    recurringRules: state.recurringRules,
    bills: state.bills
  };

  // Validate the complete state before creating a backup. Do not produce a backup if validation fails.
  const validation = Validator.validateBackupJson(backupPayload);
  if (!validation.isValid) {
    throw new Error(`Cannot export backup: state validation failed: ${validation.error || validation.errors?.join(", ")}`);
  }

  return JSON.stringify(backupPayload, null, 2);
}

/**
 * Export a specific recoverable snapshot as an explicit recovery JSON file
 * @param {object} snapshot
 * @param {string} sourceName
 * @returns {{ filename: string, content: string }}
 */
export function exportRecoverySnapshot(snapshot, sourceName = "recovery") {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("No recoverable snapshot available to export.");
  }
  const jsonString = JSON.stringify(snapshot, null, 2);
  const cleanName = String(sourceName).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const filename = `merohisab-recovery-${cleanName}.json`;
  if (typeof Blob !== "undefined" && typeof document !== "undefined") {
    const blob = new Blob([jsonString], { type: "application/json;charset=utf-8;" });
    downloadBlob(blob, filename);
  }
  return { filename, content: jsonString };
}

/**
 * Export complete application data snapshot to plain JSON backup
 * @param {object} state
 */
export function exportBackupToJson(state) {
  const jsonString = generateBackupJsonString(state);
  if (typeof Blob !== "undefined" && typeof document !== "undefined") {
    const blob = new Blob([jsonString], { type: "application/json;charset=utf-8;" });
    const filename = `MeroHisab_Backup_${getTodayLocalDateString()}.json`;
    downloadBlob(blob, filename);
  }
  return jsonString;
}

/**
 * Read and validate an uploaded JSON backup file
 * @param {File} file
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
export function readAndValidateBackupFile(file) {
  return new Promise(resolve => {
    if (!file) {
      resolve({ success: false, error: "No file selected." });
      return;
    }

    if (!file.name.endsWith(".json")) {
      resolve({ success: false, error: "Invalid file type. Please upload a .json backup file." });
      return;
    }

    const reader = new FileReader();

    reader.onload = e => {
      try {
        const text = e.target.result;
        const parsed = JSON.parse(text);

        const validation = Validator.validateBackupJson(parsed);
        if (!validation.isValid) {
          resolve({ success: false, error: validation.error });
        } else {
          resolve({ success: true, data: parsed });
        }
      } catch (err) {
        resolve({ success: false, error: `Corrupted file syntax: ${err.message}` });
      }
    };

    reader.onerror = () => {
      resolve({ success: false, error: "Failed to read the file from disk." });
    };

    reader.readAsText(file, "UTF-8");
  });
}

function downloadBlob(blob, filename) {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof document !== "undefined" && document.createElement) {
    const a = document.createElement("a");
    if (a && typeof a.click === "function") {
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      if (document.body && document.body.appendChild) {
        document.body.appendChild(a);
      }
      a.click();
      setTimeout(() => {
        if (document.body && document.body.removeChild) {
          document.body.removeChild(a);
        }
        if (typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(url);
        }
      }, 100);
    }
  }
}
