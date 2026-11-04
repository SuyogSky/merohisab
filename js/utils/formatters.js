/**
 * MeroHisab — Currency, Number & Date Formatters
 * Specialized for South Asian (Nepal) numbering: Hundreds, Thousands, Lakhs, Crores
 */

import { APP_METADATA } from "../core/constants.js";
import { getState } from "../core/state.js";

/**
 * Format a number using South Asian numbering system (en-IN notation: 1,23,456.78)
 * @param {number} value
 * @param {number} decimalPlaces
 * @returns {string}
 */
export function formatNepaliNumber(value, decimalPlaces = 2) {
  if (value === null || value === undefined || isNaN(value)) {
    return "0.00";
  }

  const num = Number(value);
  const parts = num.toFixed(decimalPlaces).split(".");
  const integerPart = parts[0];
  const decimalPart = parts.length > 1 ? `.${parts[1]}` : "";

  // Handle negative sign
  const isNegative = integerPart.startsWith("-");
  const absInteger = isNegative ? integerPart.slice(1) : integerPart;

  // South Asian formatting: Last 3 digits grouped, preceding grouped in 2s
  let lastThree = absInteger.slice(-3);
  const otherNumbers = absInteger.slice(0, -3);

  if (otherNumbers !== "") {
    lastThree = "," + lastThree;
  }

  const formattedInteger = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  const result = (isNegative ? "-" : "") + formattedInteger + (decimalPlaces > 0 ? decimalPart : "");

  return result;
}

/**
 * Format currency in Nepalese Rupees (e.g. "रु 1,23,456.78" or "NPR 1,23,456.78")
 * Dynamically respects the user's currencyFormat preference ('symbol' -> 'रु', 'code' -> 'NPR')
 * @param {number} amount
 * @param {boolean} showDecimals
 * @param {string|null} customPrefix
 * @returns {string}
 */
export function formatCurrency(amount, showDecimals = true, customPrefix = null) {
  let prefix = customPrefix;
  if (!prefix) {
    let fmt = "symbol";
    try {
      if (typeof getState === "function") {
        const state = getState();
        fmt = state?.settings?.currencyFormat || state?.settings?.currencyDisplay || "symbol";
      }
    } catch {
      fmt = "symbol";
    }
    prefix = fmt === "code" ? "NPR" : APP_METADATA.currencySymbol;
  }

  const decimals = showDecimals ? 2 : 0;
  const formatted = formatNepaliNumber(amount, decimals);
  return `${prefix} ${formatted}`;
}

/**
 * Format transaction date based on user's dateDisplay preference
 * @param {string} dateAD - e.g. "2026-10-15"
 * @param {string} dateBS - e.g. "2083-06-29"
 * @param {string|null} customPreference - 'both', 'ad', or 'bs'
 * @returns {{ primary: string, secondary: string, inline: string }}
 */
export function formatTransactionDate(dateAD, dateBS, customPreference = null) {
  let pref = customPreference;
  if (!pref) {
    try {
      if (typeof getState === "function") {
        const state = getState();
        pref = state?.settings?.dateDisplay || "both";
      }
    } catch {
      pref = "both";
    }
  }

  const bsWithSuffix = dateBS ? (dateBS.endsWith("BS") ? dateBS : `${dateBS} BS`) : "";
  const adWithSuffix = dateAD ? (dateAD.endsWith("AD") ? dateAD : `${dateAD} AD`) : "";

  if (pref === "ad") {
    return {
      primary: dateAD || "",
      secondary: "",
      inline: adWithSuffix || dateAD || ""
    };
  } else if (pref === "bs") {
    return {
      primary: bsWithSuffix || dateBS || "",
      secondary: "",
      inline: bsWithSuffix || dateBS || ""
    };
  } else {
    // 'both'
    return {
      primary: dateAD || "",
      secondary: bsWithSuffix,
      inline: dateBS ? `${adWithSuffix} • ${bsWithSuffix}` : adWithSuffix
    };
  }
}

/**
 * Format a percentage with rounding
 * @param {number} rate
 * @param {number} decimals
 * @returns {string}
 */
export function formatPercentage(rate, decimals = 1) {
  if (isNaN(rate) || rate === null || rate === undefined) return "0.0%";
  return `${Number(rate).toFixed(decimals)}%`;
}

/**
 * Format standard Gregorian AD date to human-readable string
 * @param {string|Date} dateInput - YYYY-MM-DD or Date object
 * @returns {string} - e.g. "Oct 01, 2026"
 */
export function formatStandardDate(dateInput) {
  if (!dateInput) return "N/A";
  try {
    const d = typeof dateInput === "string" ? new Date(dateInput + "T00:00:00Z") : dateInput;
    return d.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "2-digit",
      year: "numeric"
    });
  } catch {
    return String(dateInput);
  }
}
