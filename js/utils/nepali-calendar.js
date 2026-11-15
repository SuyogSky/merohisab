/**
 * MeroHisab — Bikram Sambat (BS) & Gregorian (AD) Calendar Engine
 * Zero dependencies, pure table-driven astronomical calendar calculation.
 */

// Anchor Date: 2070-01-01 BS = 2013-04-14 AD (Sunday)
export const ANCHOR_BS_YEAR = 2070;
export const ANCHOR_AD_DATE = new Date(Date.UTC(2013, 3, 14));

export const BS_MONTH_NAMES = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra"
];

export const BS_MONTH_NAMES_NEPALI = [
  "वैशाख",
  "जेठ",
  "असार",
  "श्रावण",
  "भाद्र",
  "असोज",
  "कार्तिक",
  "मंसिर",
  "पुष",
  "माघ",
  "फागुन",
  "चैत"
];

/**
 * Exact calendar month lengths (Baisakh through Chaitra).
 * Section A: 2070 - 2083 (Officially Published / Gazetted)
 * Section B: 2084 - 2090 (Provisional Astronomical Estimates)
 */
export const BS_CALENDAR_DATA = {
  // Section A: Officially Published
  2070: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2072: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2074: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],

  // Section B: Provisional Estimates
  2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30]
};

/**
 * Check if a BS year is in the provisional section
 */
export function isProvisionalBsYear(year) {
  return year >= 2084 && year <= 2090;
}

/**
 * Get number of days in a specific BS year and month
 * @param {number} year - BS Year
 * @param {number} month - BS Month (1 - 12)
 * @returns {number|null}
 */
export function getBsMonthDays(year, month) {
  if (!BS_CALENDAR_DATA[year] || month < 1 || month > 12) return null;
  return BS_CALENDAR_DATA[year][month - 1];
}

/**
 * Validate BS date components
 */
export function isValidBsDate(year, month, day) {
  const maxDays = getBsMonthDays(year, month);
  if (!maxDays) return false;
  return day >= 1 && day <= maxDays;
}

/**
 * Validate AD date string (YYYY-MM-DD)
 */
export function isValidAdDate(adDateStr) {
  if (!adDateStr || typeof adDateStr !== "string") return false;
  const match = adDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const test = new Date(Date.UTC(y, m - 1, d));
  return (
    test.getUTCFullYear() === y &&
    test.getUTCMonth() === m - 1 &&
    test.getUTCDate() === d
  );
}

/**
 * Convert Gregorian (AD) date string to Bikram Sambat (BS) object
 * @param {string} adDateStr - Format "YYYY-MM-DD"
 * @returns {object|null}
 */
export function adToBs(adDateStr) {
  if (!isValidAdDate(adDateStr)) return null;

  const [y, m, d] = adDateStr.split("-").map(Number);
  const targetUtc = Date.UTC(y, m - 1, d);
  const anchorUtc = ANCHOR_AD_DATE.getTime();
  let diffDays = Math.round((targetUtc - anchorUtc) / 86400000);

  if (diffDays < 0) return null; // Outside supported range

  let bsY = ANCHOR_BS_YEAR;
  let bsM = 1;
  let bsD = 1;

  while (diffDays > 0) {
    if (!BS_CALENDAR_DATA[bsY]) return null; // Post-2090
    const daysInMonth = BS_CALENDAR_DATA[bsY][bsM - 1];
    const daysLeft = daysInMonth - bsD + 1;

    if (diffDays >= daysLeft) {
      diffDays -= daysLeft;
      bsM++;
      bsD = 1;
      if (bsM > 12) {
        bsM = 1;
        bsY++;
      }
    } else {
      bsD += diffDays;
      diffDays = 0;
    }
  }

  if (!BS_CALENDAR_DATA[bsY]) return null;

  const monthName = BS_MONTH_NAMES[bsM - 1];
  const monthNameNepali = BS_MONTH_NAMES_NEPALI[bsM - 1];
  const mm = String(bsM).padStart(2, "0");
  const dd = String(bsD).padStart(2, "0");

  return {
    year: bsY,
    month: bsM,
    day: bsD,
    monthName,
    monthNameNepali,
    formatted: `${bsY}-${mm}-${dd}`,
    readable: `${monthName} ${bsD}, ${bsY}`,
    isProvisional: isProvisionalBsYear(bsY)
  };
}

/**
 * Convert Bikram Sambat (BS) date string to Gregorian (AD) string
 * @param {string} bsDateStr - Format "YYYY-MM-DD"
 * @returns {string|null} - Format "YYYY-MM-DD"
 */
export function bsToAd(bsDateStr) {
  if (!bsDateStr || typeof bsDateStr !== "string") return null;
  const match = bsDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const bsY = parseInt(match[1], 10);
  const bsM = parseInt(match[2], 10);
  const bsD = parseInt(match[3], 10);

  if (!isValidBsDate(bsY, bsM, bsD)) return null;

  let totalDays = 0;
  for (let y = ANCHOR_BS_YEAR; y < bsY; y++) {
    for (let m = 0; m < 12; m++) {
      totalDays += BS_CALENDAR_DATA[y][m];
    }
  }
  for (let m = 1; m < bsM; m++) {
    totalDays += BS_CALENDAR_DATA[bsY][m - 1];
  }
  totalDays += bsD - 1;

  const targetUtc = ANCHOR_AD_DATE.getTime() + totalDays * 86400000;
  const d = new Date(targetUtc);
  return d.toISOString().slice(0, 10);
}

/**
 * Determine Nepal Fiscal Year for a given BS date
 * Nepal fiscal year starts on Shrawan 1 (Month 4) and ends on Ashadh end (Month 3).
 * Example: Ashwin 2083 -> FY 2083/84; Jestha 2083 -> FY 2082/83.
 * @param {number} bsYear
 * @param {number} bsMonth
 * @returns {string} - e.g. "FY 2083/84"
 */
export function getNepalFiscalYear(bsYear, bsMonth) {
  if (bsMonth >= 4) {
    const nextY = String(bsYear + 1).slice(-2);
    return `FY ${bsYear}/${nextY}`;
  } else {
    const prevY = bsYear - 1;
    const currY = String(bsYear).slice(-2);
    return `FY ${prevY}/${currY}`;
  }
}

/**
 * Get calendar date in Nepal local time (Asia/Kathmandu, UTC+05:45) as YYYY-MM-DD.
 * Strictly avoids UTC timezone shifts or OS-local shifts when server/browser is in another timezone.
 *
 * @param {Date} [date=new Date()]
 * @returns {string} - "YYYY-MM-DD"
 */
export function getNepalLocalDateString(date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kathmandu",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return formatter.format(date);
  } catch {
    // Fallback: manual UTC+05:45 calculation
    const utcMs = date.getTime() + (date.getTimezoneOffset() * 60000);
    const nepalMs = utcMs + ((5 * 60 + 45) * 60000);
    const n = new Date(nepalMs);
    const yyyy = n.getFullYear();
    const mm = String(n.getMonth() + 1).padStart(2, "0");
    const dd = String(n.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
}

export function getTodayLocalDateString() {
  return getNepalLocalDateString(new Date());
}

/**
 * Get current system date in both AD and BS dynamically
 * @returns {object}
 */
export function getCurrentDualDate() {
  const adString = getTodayLocalDateString();
  const now = new Date();
  const bsObj = adToBs(adString);

  return {
    dateAD: adString,
    dateBS: bsObj ? bsObj.formatted : "N/A",
    readableAD: now.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
    readableBS: bsObj ? `${bsObj.monthName} ${bsObj.day}, ${bsObj.year} BS` : "",
    isProvisional: bsObj ? bsObj.isProvisional : false
  };
}
