# MeroHisab — Comprehensive Testing & Verification Guide

This document describes the automated test architecture, test execution instructions, scope of validation, and verified test results for **MeroHisab (मेरो हिसाब)**.

---

## 1. Test Architecture Overview

Because MeroHisab is a financial application handling real income, expenses, accounts, budgets, and savings goals, its test architecture is built around multi-layered verification:

1. **Bikram Sambat (BS) Astronomical Calendar Suite** (`tests/calendar.test.js`)
2. **Domain, Financial Invariants, Validation & Storage Safety Suite** (`tests/domain.test.js`)
3. **Independent Financial Reference Engine Suite** (`tests/financial-reference.test.js`)
4. **Real-Browser End-to-End (E2E) & Integration Suite** (`tests/e2e.test.js`)

All test runners use Node.js standard libraries and native assertions without third-party test runners, allowing immediate execution across developer workstations and CI/CD pipelines.

---

## 2. Test Execution Commands

The following scripts are defined in `package.json`:

```bash
# Run all unit and reference suites (Calendar + Domain + Financial Reference)
npm run test:unit

# Run only the independent financial reference engine suite
npm run test:ref

# Run the headless Chrome E2E browser automation suite
npm run test:e2e

# Run the complete test verification suite (Unit + E2E)
npm test
```

You can also run individual suites directly with Node:

```bash
# Calendar Suite only
node tests/calendar.test.js

# Domain & Storage Safety Suite only
node tests/domain.test.js

# Financial Reference Suite only
node tests/financial-reference.test.js

# Real-Browser E2E Suite only
node tests/e2e.test.js
```

---

## 3. Detailed Test Suite Breakdown

### Suite 1: Astronomical Bikram Sambat (BS) Calendar (`tests/calendar.test.js`)

- **Purpose**: Verifies bidirectional conversion between Gregorian (AD) and Bikram Sambat (BS) dates across 21 calendar years (BS 2070 to BS 2090, corresponding to 7,670 consecutive days).
- **Areas Validated**:
  - **Officially Gazetted Years (BS 2070 – BS 2083)**: Exact New Year dates, month boundary transitions, and month-length arrays matching official gazettes from the Nepal Calendar Determination Committee (*Nepal Panchanga Nirnayak Bikas Samiti*).
  - **Provisional Future Estimates (BS 2084 – BS 2090)**: Astronomical solar transit models and leap-year consistency.
  - **Demo Dataset Reconciliation**: Exact alignment of all sample transactions, goal milestones, and fiscal year dates.
  - **Boundary Guards & Invalid Input Handling**: Rejection of invalid months (e.g. Month 13), invalid day numbers (e.g. Day 33), negative years, malformed date strings, and leap year roll-over invariants.
- **Verified Result**: **7,896 passed checks** (0 failures).

---

### Suite 2: Domain, Financial Invariants, Validation & Storage Safety (`tests/domain.test.js`)

- **Purpose**: Exercises the core application state machine, financial calculation engine, schema validators, persistence mechanisms, and audit regressions.
- **Areas Validated**:
  - **Exact Paisa Arithmetic**: BigInt integer math preventing IEEE 754 floating-point drift (`addMoney(0.1, 0.2) === 0.30`).
  - **Monetary Boundaries**: 2-decimal precision enforcement, rejection of 3-decimal values (e.g., `1.234`), and `MAX_MONEY_AMOUNT` bounds ($< 10^{12}$ NPR).
  - **Two-Legged Transfers**: Atomic creation and deletion of paired `in`/`out` legs, overdraft protection, and isolation from income/expense analytics.
  - **Recurring Transactions**: Daily, weekly, monthly, and yearly recurring schedules with day-of-month preservation (e.g., Jan 31 advancing to Feb 28 without losing day 31).
  - **Bills & Due Tracking**: Dynamic status computation (`overdue`, `dueSoon`, `upcoming`), idempotent payment handling, and reciprocal transaction linking.
  - **Savings Goals & Headroom Conservation**: Proof that savings allocations earmark funds without double-deducting from ledger balance, with strict headroom validation (`availableToAllocate = balance - earmarked`).
  - **Authoritative Storage & Concurrency**: Multi-layer persistence (IndexedDB primary with LocalStorage fallback), read-back SHA-256 fingerprint validation, atomic revision verification, multi-tab conflict resolution, and non-destructive recovery mode.
  - **Backup & Restore Round-Trip**: Strict schema validation for v3 backups, preservation of intentionally empty arrays, rejection of missing/null collections without silent fallback defaults, and 100% round-trip fingerprint equality.
- **Verified Result**: **1,047 passed checks** (0 failures).

---

### Suite 3: Independent Financial Reference Engine (`tests/financial-reference.test.js`)

- **Purpose**: Monte-Carlo stress test generating hundreds of pseudo-random financial events across 5 deterministic seeds (`123456789`, `987654321`, `555555555`, `7777777`, `101010101`) and comparing results against a mathematically isolated reference ledger engine.
- **Areas Validated**:
  - Per-account balance calculation.
  - October / monthly inflows, outflows, and net cash flow.
  - Total estimated ledger balance.
  - Budget utilization meters, remaining limits, and status transitions (`safe`, `warning`, `exceeded`).
  - Savings goal headroom conservation invariant ($\text{availableToAllocate} + \text{savedAmount} = \text{totalBalance}$).
  - Nepal Fiscal Year income, expenses, and cash flow aggregations.
  - Full backup export and restore state preservation.
- **Verified Result**: **155 passed checks** (0 failures).

---

### Total Unit & Reference Checks

Combining the calendar, domain, and financial reference checks:

$$\text{Total Unit / Reference Checks} = 7,896 + 1,047 + 155 = \mathbf{9,098 \text{ passed checks}}$$

---

### Suite 4: Real-Browser End-to-End (E2E) & Integration Suite (`tests/e2e.test.js`)

- **Purpose**: Drives a live, genuine headless Google Chrome instance via the **Chrome DevTools Protocol (CDP)** on an ephemeral local HTTP test server, exercising full real-world user workflows in the actual browser DOM, IndexedDB engine, and Cache Storage runtime.
- **Browser Prerequisites**:
  - Google Chrome installed locally. The test runner automatically locates Chrome on Windows at `C:\Program Files\Google\Chrome\Application\chrome.exe` (or `C:\Program Files (x86)\...`), or on macOS/Linux via standard PATH binaries (`google-chrome`, `chromium`, `chrome`).
- **33 Verified Real-Browser Workflows**:
  1. Clean first-run ledger initialization (zero demo records, default Cash Wallet at रु 0).
  2. First-run clean welcome banner theme styling verification and screenshot capture (Dark & Light).
  3. High-resolution responsive viewport captures (Desktop 1440px, Tablet 768px, Mobile 390px).
  4. Full navigation traversal across all 9 application routes (`#dashboard`, `#accounts`, `#transactions`, `#recurring`, `#bills`, `#budgets`, `#goals`, `#analytics`, `#settings`).
  5. Account creation via modal dialog.
  6. Income transaction creation via modal.
  7. Expense transaction creation via modal.
  8. Transaction editing via DOM action.
  9. Transaction deletion with accessible confirmation dialog.
  10. Two-legged fund transfer creation between accounts.
  11. Transfer editing across paired legs.
  12. Transfer deletion and reciprocal leg removal.
  13. Monthly category budget creation and utilization meter rendering.
  14. Savings goal milestone creation.
  15. Goal deposit allocation and headroom deduction.
  16. Goal allocation removal and headroom restoration.
  17. Bill creation with due date and account selection.
  18. Bill payment processing and linked expense creation.
  19. Paid bill editing and linked transaction synchronization.
  20. Recurring schedule rule creation.
  21. Recurring rule pause / resume toggling.
  22. Recurring occurrence processing to post real transaction.
  23. Settings baseline configuration (opening balance & effective date).
  24. Complete JSON backup export and restore round-trip with 100% fingerprint equality.
  25. RFC-compliant CSV export with UTF-8 BOM.
  26. Real browser page reload persistence verification via IndexedDB.
  27. Form input validation (rejection of 3-decimal values e.g. `1.234`).
  28. Failed persistent write rollback and state preservation.
  29. Concurrent multi-tab update resolution (stale candidate rejection).
  30. Dynamic profile display name and avatar updates in sidebar across page reloads.
  31. Integer Paisa arithmetic and aggregate overflow defense in browser runtime.
  32. Stored Cross-Site Scripting (XSS) neutralization across modals, toasts, and tables.
  33. PWA Service Worker offline navigation across all 9 views.
- **Verified Result**: **33 workflows passed**, 0 runtime errors, 0 uncaught exceptions.

---

## 4. Test Reporting & Interpretation

- **Exit Code 0**: All assertions passed cleanly without errors.
- **Exit Code 1**: One or more assertions failed. A detailed stack trace, expected vs actual values, and affected test name will be printed to stdout/stderr.
- In E2E tests, the test runner inspects the browser console log via CDP (`Runtime.consoleAPICalled` and `Runtime.exceptionThrown`) and asserts that zero uncaught exceptions occurred during the entire test execution.

---

## 5. Known Testing Boundaries & Limitations

1. **Headless Chrome Prerequisite for E2E**:
   `npm run test:e2e` requires Google Chrome or Chromium installed on the host machine. If Chrome is not installed or the executable cannot be found, unit and reference suites (`npm run test:unit`) can still be run independently without any browser dependency.
2. **Provisional Calendar Verification**:
   Calendar calculations for BS 2084 through BS 2090 are validated against astronomical solar transit models. Official gazetted tables for those future years will be issued year-by-year by the Nepal Government, and dates in that provisional range are subject to future $\pm 1$ day administrative gazette adjustments.
3. **No Guarantee of Zero Defects**:
   While 9,098 automated checks and 33 browser workflows pass without error, comprehensive testing cannot prove the absolute absence of all potential software defects or unforeseen environmental browser incompatibilities.
