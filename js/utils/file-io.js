/**
 * MeroHisab — File Export & Import Engine
 * Handles RFC-compliant CSV transaction export and schema-validated plain JSON backups.
 */

import { Validator } from "../core/validator.js";
import { getCategoryLabel, getPaymentMethodLabel } from "../services/transactions.js";

/**
 * Export all transactions to CSV format with UTF-8 BOM
 * @param {Array} transactions
 */
export function exportTransactionsToCsv(transactions) {
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

  const rows = transactions.map(t => [
    t.id,
    t.dateAD,
    t.dateBS || "",
    t.type.toUpperCase(),
    t.type === "transfer" ? "Transfer" : getCategoryLabel(t.category, t.type),
    t.type === "transfer"
      ? `Transfer ${t.transferDirection === "out" ? "to" : "from"} ${t.peerAccountId || ""}${t.description ? " – " + t.description : ""}`
      : t.description,
    t.amount.toFixed(2),
    t.accountId || "",
    t.transferDirection || "",
    t.transferId || "",
    t.type === "transfer" ? "" : getPaymentMethodLabel(t.paymentMethod),
    t.createdAt || ""
  ]);

  const escapeCell = val => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvContent =
    "\uFEFF" + // UTF-8 BOM for Excel compatibility with Nepali characters
    [headers.map(escapeCell).join(","), ...rows.map(r => r.map(escapeCell).join(","))].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const filename = `MeroHisab_Transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadBlob(blob, filename);
}

/**
 * Export complete application data snapshot to plain JSON backup
 * @param {object} state
 */
export function exportBackupToJson(state) {
  const backupPayload = {
    version: 3,
    exportTimestamp: new Date().toISOString(),
    appName: "MeroHisab",
    settings: state.settings,
    accounts: state.accounts || [],
    transactions: state.transactions,
    budgets: state.budgets,
    goals: state.goals,
    recurringRules: state.recurringRules || [],
    bills: state.bills || []
  };

  const jsonString = JSON.stringify(backupPayload, null, 2);
  const blob = new Blob([jsonString], { type: "application/json;charset=utf-8;" });
  const filename = `MeroHisab_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  downloadBlob(blob, filename);
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
