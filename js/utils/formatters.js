/**
 * MeroHisab — Currency, Number & Date Formatters
 * Specialized for South Asian (Nepal) numbering: Hundreds, Thousands, Lakhs, Crores
 */

import { APP_METADATA } from "../core/constants.js";
import { getState } from "../core/state.js";

/**
 * Format a number using South Asian numbering system (en-IN notation: 1,23,456.78)
 *
 * Documented Rounding Policy:
 * Half-up rounding (round half away from zero: e.g. 1.50 -> 2, -1.50 -> -2, 1.49 -> 1, -1.49 -> -1).
 * Applies identically to numeric string and JS Number inputs using exact BigInt arithmetic
 * to eliminate floating-point truncation, ULP representation drift, and precision loss.
 *
 * @param {number|string|bigint} value
 * @param {number} decimalPlaces
 * @returns {string}
 */
export function formatNepaliNumber(value, decimalPlaces = 2) {
  if (value === null || value === undefined || value === "") {
    return decimalPlaces > 0 ? "0." + "0".repeat(decimalPlaces) : "0";
  }

  const clean = (typeof value === "string" ? value.replace(/,/g, "") : String(value)).trim();
  if (clean === "" || isNaN(Number(clean))) {
    return decimalPlaces > 0 ? "0." + "0".repeat(decimalPlaces) : "0";
  }

  const isNegative = clean.startsWith("-");
  const raw = isNegative ? clean.slice(1) : clean;
  const [intPart = "0", fracPart = ""] = raw.split(".");

  let roundedInt = intPart;
  let roundedFrac = "";

  if (fracPart.length > decimalPlaces) {
    const inspectDigit = parseInt(fracPart[decimalPlaces] || "0", 10);
    const baseFrac = fracPart.slice(0, decimalPlaces);
    const combinedStr = intPart + baseFrac;
    let combinedBig = BigInt(combinedStr || "0");
    if (inspectDigit >= 5) {
      combinedBig += 1n;
    }
    const combinedResStr = combinedBig.toString().padStart(decimalPlaces + 1, "0");
    if (decimalPlaces > 0) {
      roundedInt = combinedResStr.slice(0, combinedResStr.length - decimalPlaces);
      roundedFrac = combinedResStr.slice(combinedResStr.length - decimalPlaces);
    } else {
      roundedInt = combinedResStr;
      roundedFrac = "";
    }
  } else {
    roundedFrac = decimalPlaces > 0 ? fracPart.padEnd(decimalPlaces, "0") : "";
  }

  // Handle negative sign: only show negative if rounded value is non-zero
  const isNonZero = BigInt(roundedInt) > 0n || (roundedFrac && BigInt(roundedFrac) > 0n);
  const showNegative = isNegative && isNonZero;

  // South Asian formatting: Last 3 digits grouped, preceding grouped in 2s
  let lastThree = roundedInt.slice(-3);
  const otherNumbers = roundedInt.slice(0, -3);
  if (otherNumbers !== "") {
    lastThree = "," + lastThree;
  }

  const formattedInteger = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  const decimalPart = decimalPlaces > 0 ? `.${roundedFrac}` : "";

  return (showNegative ? "-" : "") + formattedInteger + decimalPart;
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
