# Contributing to MeroHisab

Thank you for your interest in contributing to **MeroHisab (मेरो हिसाब)**. MeroHisab is a privacy-first, local-only personal finance management application designed for individuals in Nepal.

Because MeroHisab manages real-life personal financial records, mathematical accuracy, data validation, and storage integrity are our highest engineering priorities.

---

## 1. Development Environment Setup

MeroHisab is built with standard native web technologies without complex bundlers, build steps, or external framework dependencies.

### Prerequisites

- **Node.js** (v18.0.0 or higher recommended, for running the test runner)
- **Google Chrome** (required for the real-browser E2E test suite via Chrome DevTools Protocol)
- Any lightweight local HTTP static file server (e.g. `npx serve`, Python `http.server`, or VS Code Live Server)

### Local Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/merohisab.git
   cd merohisab
   ```

2. Start a local development server:
   ```bash
   # Using Python
   python -m http.server 8000

   # Or using npx
   npx serve .
   ```

3. Open `http://localhost:8000` (or the URL printed by your server) in your browser.

> **Note**: Because MeroHisab uses standard ES6 modules (`import`/`export`), opening `index.html` directly via the `file://` protocol will be blocked by browser CORS security policies. Always use an HTTP/HTTPS local server.

---

## 2. Architectural Guidelines & Principles

Contributors must respect the following core principles:

1. **Zero External Runtime Dependencies**:
   Do not introduce client-side frameworks (React, Vue, Angular), CSS frameworks (Tailwind, Bootstrap), or third-party charting libraries. Use standard DOM APIs, CSS Custom Properties, and the HTML5 Canvas API.

2. **Preserve the Vanilla JavaScript Architecture**:
   All application logic lives in modular ES6 files organized under `js/core/`, `js/services/`, `js/utils/`, `js/components/`, and `js/views/`. Do not reorganize directories or introduce a bundler without prior architectural discussion.

3. **Strict Integer Paisa Arithmetic**:
   - **Never use floating-point numbers for financial calculations** (avoid `amount1 + amount2` directly in floating-point, which causes IEEE 754 precision drift such as `0.1 + 0.2 = 0.30000000000000004`).
   - Use the monetary arithmetic utilities in `js/utils/money.js` (`toPaisa`, `fromPaisa`, `addMoney`, `subtractMoney`, `multiplyMoney`, `divideMoney`).
   - Enforce the 2-decimal precision policy (`validatePrecision2Decimals`). Inputs with 3 or more decimal places must be rejected.
   - Respect the financial safety boundary: `MAX_MONEY_AMOUNT = 999,999,999,999.99` NPR.

4. **Multi-Layer Storage & State Integrity**:
   - All state mutations must be dispatched through `dispatch(action, payload)` in `js/core/state.js`.
   - Never mutate state objects directly in views.
   - IndexedDB is the authoritative primary store; LocalStorage is a secondary mirror and fallback.
   - Changes must preserve atomic revision tracking, optimistic locking, and read-back verification.

5. **Two-Legged Atomic Transfers**:
   Transfers between accounts must create two paired transaction legs sharing a unique `transferId`. Direct one-legged updates are strictly prohibited.

6. **Nepal Bikram Sambat (BS) Calendar Invariants**:
   Calendar calculations must maintain bidirectional synchronization between Gregorian (AD) and Bikram Sambat (BS) dates. Do not modify the astronomical calendar constants in `js/utils/nepali-calendar.js` without citing official gazetted sources from the Nepal Calendar Determination Committee (*Nepal Panchanga Nirnayak Bikas Samiti*).

---

## 3. Running the Test Suites

Before submitting any pull request or bug fix, you must run and pass all test suites.

```bash
# Run all unit, domain, and financial reference tests
npm run test:unit

# Run the independent financial reference engine suite
npm run test:ref

# Run the Chrome DevTools Protocol real-browser E2E suite
npm run test:e2e

# Run the complete verification suite (unit + E2E)
npm test
```

### Writing Regression Tests

When fixing any defect:
1. First reproduce the bug with a dedicated test assertion in `tests/domain.test.js`.
2. Implement the fix cleanly in the relevant module.
3. Ensure the test passes without weakening any existing assertions or test counts.
4. Verify that all other existing test suites continue to pass with zero regressions.

---

## 4. Reporting Issues & Proposing Improvements

- **Bug Reports**: Open an issue describing the expected vs actual behavior, steps to reproduce, and browser/OS version.
- **Feature Suggestions**: Open a discussion or issue explaining the use case, why it benefits everyday users in Nepal, and how it aligns with local-first, privacy-focused principles.
- **Security Vulnerabilities**: Please review [SECURITY.md](SECURITY.md) to report sensitive security issues privately.
