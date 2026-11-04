/**
 * MeroHisab — Production Calendar Engine Test Suite
 * Directly imports and validates production methods from js/utils/nepali-calendar.js
 */

import {
  BS_CALENDAR_DATA,
  ANCHOR_BS_YEAR,
  ANCHOR_AD_DATE,
  adToBs,
  bsToAd,
  getNepalFiscalYear,
  isValidAdDate,
  getCurrentDualDate
} from "../js/utils/nepali-calendar.js";

console.log("================================================================================");
console.log("SUITE A: OFFICIALLY PUBLISHED YEARS (BS 2070 - BS 2083) INDEPENDENT ACCURACY");
console.log("================================================================================");

const OFFICIAL_NEW_YEARS = {
  2070: { ad: "2013-04-14", source: "MoHA / Panchanga 2070" },
  2071: { ad: "2014-04-14", source: "MoHA / Panchanga 2071" },
  2072: { ad: "2015-04-14", source: "MoHA / Panchanga 2072" },
  2073: { ad: "2016-04-13", source: "MoHA / Panchanga 2073" },
  2074: { ad: "2017-04-14", source: "MoHA / Panchanga 2074" },
  2075: { ad: "2018-04-14", source: "MoHA / Panchanga 2075" },
  2076: { ad: "2019-04-14", source: "MoHA / Panchanga 2076" },
  2077: { ad: "2020-04-13", source: "MoHA / Panchanga 2077" },
  2078: { ad: "2021-04-14", source: "MoHA / Panchanga 2078" },
  2079: { ad: "2022-04-14", source: "MoHA / Panchanga 2079" },
  2080: { ad: "2023-04-14", source: "MoHA / Panchanga 2080" },
  2081: { ad: "2024-04-13", source: "MoHA / Panchanga 2081" },
  2082: { ad: "2025-04-14", source: "MoHA / Panchanga 2082" },
  2083: { ad: "2026-04-14", source: "MoHA / Panchanga 2083 (Current Year)" }
};

let passedA1 = 0;
for (const [bsYearStr, expected] of Object.entries(OFFICIAL_NEW_YEARS)) {
  const bsYear = parseInt(bsYearStr, 10);
  const bsDate = `${bsYear}-01-01`;
  const adResult = bsToAd(bsDate);
  const backToBs = adToBs(expected.ad);

  if (adResult === expected.ad && backToBs && backToBs.formatted === bsDate) {
    console.log(`[New Year] ${bsDate} <-> ${expected.ad} (${expected.source}): PASS`);
    passedA1++;
  } else {
    console.error(`[New Year] ${bsDate} FAIL: bsToAd=${adResult}, expected=${expected.ad}`);
    process.exit(1);
  }
}
console.log(`Subtotal A1 (Official New Years): ${passedA1}/${Object.keys(OFFICIAL_NEW_YEARS).length} passed.\n`);

// A2: Verify every month's 1st day boundary for all officially published years (2070-2083)
let passedA2 = 0;
for (let y = 2070; y <= 2083; y++) {
  for (let m = 1; m <= 12; m++) {
    const bsStr = `${y}-${String(m).padStart(2, "0")}-01`;
    const adStr = bsToAd(bsStr);
    const roundtrip = adToBs(adStr);

    if (roundtrip && roundtrip.formatted === bsStr) {
      passedA2++;
    } else {
      console.error(`Month boundary failed: ${bsStr} -> ${adStr} -> ${roundtrip ? roundtrip.formatted : "null"}`);
      process.exit(1);
    }
  }
}
console.log(`Subtotal A2 (Month 1st Boundaries for BS 2070-2083): ${passedA2}/${14 * 12} passed.\n`);

console.log("================================================================================");
console.log("SUITE B: PROVISIONAL YEARS (BS 2084 - BS 2090) VERIFICATION & CONSISTENCY");
console.log("================================================================================");

const PROVISIONAL_CHECKS = [
  { bs: "2084-01-01", ad: "2027-04-14", label: "Baisakh 1, 2084 (New Year)" },
  { bs: "2084-02-01", ad: "2027-05-15", label: "Jestha 1, 2084" },
  { bs: "2084-03-01", ad: "2027-06-15", label: "Ashadh 1, 2084" },
  { bs: "2084-04-01", ad: "2027-07-17", label: "Shrawan 1, 2084" },
  { bs: "2084-05-01", ad: "2027-08-17", label: "Bhadra 1, 2084" },
  { bs: "2084-06-01", ad: "2027-09-17", label: "Ashwin 1, 2084" },
  { bs: "2084-06-29", ad: "2027-10-15", label: "Ashwin 29, 2084 (Goal 2 Target)" },
  { bs: "2084-01-17", ad: "2027-04-30", label: "Baisakh 17, 2084 (Goal 1 Target)" },
  { bs: "2084-12-30", ad: "2028-04-12", label: "End of Chaitra 2084" },
  { bs: "2085-01-01", ad: "2028-04-13", label: "Baisakh 1, 2085 (New Year)" },
  { bs: "2086-01-01", ad: "2029-04-14", label: "Baisakh 1, 2086 (New Year)" },
  { bs: "2087-01-01", ad: "2030-04-14", label: "Baisakh 1, 2087 (New Year)" },
  { bs: "2088-01-01", ad: "2031-04-15", label: "Baisakh 1, 2088 (New Year)" },
  { bs: "2089-01-01", ad: "2032-04-14", label: "Baisakh 1, 2089 (New Year)" },
  { bs: "2090-01-01", ad: "2033-04-14", label: "Baisakh 1, 2090 (New Year)" }
];

let passedB = 0;
for (const tc of PROVISIONAL_CHECKS) {
  const adRes = bsToAd(tc.bs);
  const bsRes = adToBs(tc.ad);

  if (adRes === tc.ad && bsRes && bsRes.formatted === tc.bs && bsRes.isProvisional === true) {
    console.log(`[Provisional] ${tc.label.padEnd(30)}: ${tc.ad} <-> ${tc.bs} | PASS`);
    passedB++;
  } else {
    console.error(`[Provisional] ${tc.label} FAIL: bsToAd=${adRes}, adToBs=${bsRes ? bsRes.formatted : "null"}, isProvisional=${bsRes ? bsRes.isProvisional : "null"}`);
    process.exit(1);
  }
}
console.log(`Subtotal B (Provisional Estimates): ${passedB}/${PROVISIONAL_CHECKS.length} passed.\n`);

console.log("================================================================================");
console.log("SUITE C: DEMO DATA RECONCILIATION & BOUNDARY TESTS");
console.log("================================================================================");

const DEMO_TRANSACTIONS = [
  { id: "tx_demo_01 (Salary)", ad: "2026-10-01", bs: "2083-06-15" },
  { id: "tx_demo_03 (Rent)", ad: "2026-10-02", bs: "2083-06-16" },
  { id: "tx_demo_04 (Groceries 1)", ad: "2026-10-04", bs: "2083-06-18" },
  { id: "tx_demo_05 (Utilities 1)", ad: "2026-10-08", bs: "2083-06-22" },
  { id: "tx_demo_06 (Lunch)", ad: "2026-10-10", bs: "2083-06-24" },
  { id: "tx_demo_07 (Internet)", ad: "2026-10-14", bs: "2083-06-28" },
  { id: "tx_demo_02 (Freelance)", ad: "2026-10-15", bs: "2083-06-29" },
  { id: "tx_demo_08 (Fuel)", ad: "2026-10-18", bs: "2083-07-01" },
  { id: "tx_demo_09 (Groceries 2)", ad: "2026-10-20", bs: "2083-07-03" },
  { id: "tx_demo_10 (Dinner)", ad: "2026-10-22", bs: "2083-07-05" },
  { id: "tx_demo_11 (Health)", ad: "2026-10-25", bs: "2083-07-08" },
  { id: "tx_demo_12 (Recharge)", ad: "2026-10-27", bs: "2083-07-10" },
  { id: "Goal 1 Alloc 1", ad: "2026-08-05", bs: "2083-04-20" },
  { id: "Goal 1 Alloc 2", ad: "2026-09-05", bs: "2083-05-20" }
];

let passedC1 = 0;
for (const dt of DEMO_TRANSACTIONS) {
  const bsConverted = adToBs(dt.ad);
  const adConverted = bsToAd(dt.bs);

  if (bsConverted && bsConverted.formatted === dt.bs && adConverted === dt.ad) {
    console.log(`[Demo Ledger] ${dt.id.padEnd(25)}: ${dt.ad} AD <-> ${dt.bs} BS: PASS`);
    passedC1++;
  } else {
    console.error(`[Demo Ledger] ${dt.id} FAIL: got bs=${bsConverted ? bsConverted.formatted : "null"}, ad=${adConverted}`);
    process.exit(1);
  }
}
console.log(`Subtotal C1 (Demo Transactions): ${passedC1}/${DEMO_TRANSACTIONS.length} passed.\n`);

const ROLLOVER_INVARIANTS = [
  { bs: "2083-06-31", ad: "2026-10-17", label: "Ashwin 31, 2083 (Month End)" },
  { bs: "2083-07-01", ad: "2026-10-18", label: "Kartik 1, 2083 (Month Start)" },
  { bs: "2082-12-30", ad: "2026-04-13", label: "Chaitra 30, 2082 (Year End)" },
  { bs: "2083-01-01", ad: "2026-04-14", label: "Baisakh 1, 2083 (Year Start)" }
];

let passedC2 = 0;
for (const ri of ROLLOVER_INVARIANTS) {
  const adRes = bsToAd(ri.bs);
  const bsRes = adToBs(ri.ad);

  if (adRes === ri.ad && bsRes && bsRes.formatted === ri.bs) {
    console.log(`[Rollover Invariant] ${ri.label.padEnd(35)}: ${ri.bs} <-> ${ri.ad}: PASS`);
    passedC2++;
  } else {
    console.error(`[Rollover Invariant] ${ri.label} FAIL`);
    process.exit(1);
  }
}
console.log(`Subtotal C2 (Rollover Invariants): ${passedC2}/${ROLLOVER_INVARIANTS.length} passed.\n`);

console.log("================================================================================");
console.log("SUITE D: INVALID INPUTS & OUT-OF-RANGE BOUNDARY GUARDS");
console.log("================================================================================");

const INVALID_TESTS = [
  { fn: () => adToBs("2010-01-01"), desc: "Pre-2070 AD date (2010-01-01)" },
  { fn: () => adToBs("2035-01-01"), desc: "Post-2090 AD date (2035-01-01)" },
  { fn: () => bsToAd("2069-12-30"), desc: "Pre-2070 BS date (2069-12-30)" },
  { fn: () => bsToAd("2091-01-01"), desc: "Post-2090 BS date (2091-01-01)" },
  { fn: () => bsToAd("2083-13-01"), desc: "Invalid BS Month (2083-13-01)" },
  { fn: () => bsToAd("2083-06-32"), desc: "Day exceeds month length (2083-06-32)" },
  { fn: () => bsToAd("2083-07-31"), desc: "Day exceeds month length (2083-07-31)" },
  { fn: () => adToBs("2023-02-29"), desc: "Invalid Gregorian Leap Day (2023-02-29)" },
  { fn: () => adToBs("bad-date"), desc: "Invalid String Format ('bad-date')" },
  { fn: () => adToBs(""), desc: "Empty String Input" },
  { fn: () => adToBs(null), desc: "Null Input" }
];

let passedD = 0;
for (const it of INVALID_TESTS) {
  const res = it.fn();
  if (res === null) {
    console.log(`[Safety Guard] ${it.desc.padEnd(45)}: Returned null | PASS`);
    passedD++;
  } else {
    console.error(`[Safety Guard] ${it.desc} FAIL: Returned ${JSON.stringify(res)} instead of null`);
    process.exit(1);
  }
}
console.log(`Subtotal D (Invalid Inputs & Out-of-Range): ${passedD}/${INVALID_TESTS.length} passed.\n`);

console.log("================================================================================");
console.log("SUITE E: EXHAUSTIVE DAILY BIJECTIVE ROUNDTRIP CONSISTENCY (BS 2070 - BS 2090)");
console.log("================================================================================");

let totalDaysTested = 0;
let bijectiveFailures = 0;

let curUtc = ANCHOR_AD_DATE.getTime();
const endUtc = new Date(Date.UTC(2034, 3, 13)).getTime(); // End of BS 2090 (Chaitra 30)

while (curUtc <= endUtc) {
  const d = new Date(curUtc);
  const adString = d.toISOString().slice(0, 10);

  const bsResult = adToBs(adString);
  if (!bsResult) {
    bijectiveFailures++;
    console.error(`Bijective failure at ${adString}: adToBs returned null`);
    break;
  }

  const roundtripAd = bsToAd(bsResult.formatted);
  if (roundtripAd !== adString) {
    bijectiveFailures++;
    console.error(`Roundtrip mismatch at ${adString}: adToBs=${bsResult.formatted}, bsToAd=${roundtripAd}`);
    break;
  }

  totalDaysTested++;
  curUtc += 86400000;
}

if (bijectiveFailures === 0) {
  console.log(`Exhaustive Days Tested: ${totalDaysTested} consecutive days (2013-04-14 to 2034-04-13 AD).`);
  console.log(`Bijective Failures: ${bijectiveFailures}`);
  console.log("Result: 100% PERFECT BIJECTIVE CONSISTENCY\n");
} else {
  console.error(`Bijective tests failed with ${bijectiveFailures} errors.`);
  process.exit(1);
}

console.log("================================================================================");
console.log("FINAL CALENDAR ENGINE VALIDATION SUMMARY");
console.log(`Suite A (Official Years 2070-2083 Accuracy):  ${passedA1 + passedA2}/${Object.keys(OFFICIAL_NEW_YEARS).length + 14 * 12} PASS`);
console.log(`Suite B (Provisional Years 2084-2090 Checks):  ${passedB}/${PROVISIONAL_CHECKS.length} PASS`);
console.log(`Suite C (Demo Ledger & Rollover Invariants):    ${passedC1 + passedC2}/${DEMO_TRANSACTIONS.length + ROLLOVER_INVARIANTS.length} PASS`);
console.log(`Suite D (Invalid Inputs & Range Guards):       ${passedD}/${INVALID_TESTS.length} PASS`);
console.log(`Suite E (Exhaustive Daily Bijective Test):     ${totalDaysTested}/${totalDaysTested} PASS (0 failures)`);
console.log("================================================================================");
process.exit(0);
