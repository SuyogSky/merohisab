# MeroHisab (मेरो हिसाब)

> **Your Money. Your Goals. Your Control.**  
> *A simple, smart personal finance dashboard built for everyday life in Nepal.*

---

## 1. What MeroHisab Is

**MeroHisab (मेरो हिसाब)** is a complete, polished, modern personal finance web application specifically tailored for individuals living and working in Nepal. It enables users to record income and expenses, maintain category budgets, set earmarked savings goals, analyze cash flow trends across calendar periods, and view their estimated liquid balance.

MeroHisab is a **100% frontend-only application**. It operates entirely within the user's web browser without requiring a backend server, cloud database, account creation, or paid third-party APIs. All data remains private and local to the user's browser.

---

## 2. Main Features

- **Accounts & Wallets (v3)**:
  - Track balances separately across multiple accounts: Cash, Bank, eSewa, Khalti, and custom wallets.
  - Default "Cash Wallet" account created on first launch. Full CRUD with opening balance and account type.
  - Per-account balance calculated dynamically as `openingBalance + income − expenses + inbound transfers − outbound transfers`.

- **Account-to-Account Transfers (v3)**:
  - Move funds between any two accounts atomically (e.g., Bank → eSewa, Bank → Cash ATM withdrawal).
  - Transfers are analytics-neutral: they create a linked pair of `type: "transfer"` legs (`in`/`out`) with a shared `transferId`. Net effect on global ledger balance is zero.
  - Overdraft protection: blocks source-account transfers when balance would go negative (unless `overdraftEnabled` is set).

- **Recurring Transactions (v3)**:
  - Define `daily`, `weekly`, `monthly`, and `yearly` recurring income/expense rules.
  - Day-of-month preservation: scheduling `Jan 31` monthly always advances to the last day of shorter months (`Feb 28`, `Mar 31`, etc.) without overwriting the original `dayOfMonth`.
  - Pause/resume, skip individual occurrences, or process a due occurrence to stamp a real transaction.

- **Bills & Payment Tracking (v3)**:
  - Track recurring bills (electricity, rent, internet) with due dates, amounts, and accounts.
  - Status computed automatically: `overdue` (past due), `dueSoon` (within 7 days), `upcoming`.
  - Pay a bill with one click — creates a real linked expense transaction (idempotent, prevents duplicate payment).

- **Estimated Ledger Balance & Cash Flow**:
  - Distinguishes between net cash flow and account balance using an opening balance baseline (`initialBalance`) and effective date (`initialBalanceDate`).
  - Estimated Ledger Balance formula: $\text{Opening Balance} + \text{Active Income} - \text{Active Expenses}$ (for transactions where $\text{Date} \ge \text{Baseline Date}$).
  - Live South Asian number grouping with Nepali Rupee formatting (`रु 1,02,450.00`).

- **Transactions Management (Full CRUD)**:
  - Record income and expense entries with amount, category, description, payment method, account, and synchronized AD/BS dates.
  - Transfer rows rendered distinctly with peer account and direction.
  - Live Lakh & Paisa preview while entering transaction amounts.
  - Real-time search and multi-criteria filtering (Type, Category, Payment Channel, Date Range).
  - One-click CSV export with UTF-8 BOM for Microsoft Excel compatibility (includes Account and Transfer columns).

- **Monthly Budget Allocations & 3-Tier Thresholds**:
  - Create and manage monthly category budgets (`YYYY-MM`).
  - Enforces unique `(period, category)` combinations to prevent duplicate budgets.
  - Strict visual threshold feedback:
    - **Safe (`< 75%`)**: Emerald green progress meter.
    - **Approaching Limit (`75% – 99.99%`)**: Amber warning meter with overspending alert.
    - **Exceeded (`100%+`)**: Crimson alert meter indicating budget deficit.

- **Savings Goals & Earmarked Fund Protection**:
  - Define financial milestones with target amounts, target dates (AD & BS), and categories.
  - **Earmarked Fund Model**: Allocations to savings goals earmark money without counting as consumption expenses or double-deducting from ledger balance.
  - **Headroom Protection**: Allocations validate against $\text{Available to Allocate} = \text{Estimated Ledger Balance} - \text{Total Earmarked Savings}$ and prevent over-allocation.
  - Deposit history ledger with deletion support that instantly restores unallocated headroom.

- **Analytics & Nepal Fiscal Year Reporting**:
  - Period filter supporting Monthly views and Nepal Fiscal Year views (Shrawan 1 to Ashadh 31/32, e.g., `FY 2083/84`).
  - **4 Custom Native Canvas Charts (Zero External Libraries)**:
    1. Monthly Inflow vs Outflow comparison (Grouped Bar Chart).
    2. Expense Distribution by Category with center cutout total (Donut Chart).
    3. Net Cash Flow Trend series with smooth line curve and gradient fill.
    4. Savings Velocity / Rate Trend series (%).
  - Category spending analysis table with highest/lowest outflow indicators.
  - Breakdown across Nepal payment channels (Fonepay QR, eSewa, Khalti, Bank Transfer, Cash).

- **Dashboard Bills & Recurring Reminders**:
  - Urgent alert banner on Dashboard when bills are overdue or due within 7 days, or recurring transactions are ready to process.
  - Quick links to `#bills` and `#recurring` views directly from the banner.

- **Settings, Preferences & Data Portability**:
  - Configure opening balance baseline and effective date.
  - Customize preferences: Default payment method, currency format (`रु` vs `NPR`), date format (`Both AD & BS`, `AD Primary`, `BS Primary`).
  - Instant dark mode / light mode toggle (Dark Navy vs Crisp Light).
  - Export transactions to CSV (includes Account ID and Transfer columns).
  - Export full v3 state snapshot (accounts, recurring rules, bills included) to plain JSON backup.
  - Import and validate JSON backup (v2 auto-migrated to v3) with full entity count confirmation before overwrite.
  - One-click realistic demo data reload and blank ledger reset (v3 state with default Cash Wallet).

---

## 3. Technology Stack

MeroHisab is built strictly adhering to zero-dependency native web standards:

- **HTML5**: Semantic elements (`<header>`, `<aside>`, `<main>`, `<nav>`, `<section>`).
- **CSS3**: CSS Custom Properties (Design Tokens), Flexbox, CSS Grid, media queries, high-contrast accessible states.
- **Vanilla JavaScript (ES6+)**: ES Modules (`import`/`export`), `class`, async/await, closures.
- **HTML5 Canvas API**: Native custom charting engine with Retina / High-DPI scaling (`window.devicePixelRatio`).
- **Web Storage API**: `window.localStorage` with defensive error handling and in-memory fallback. **IndexedDB** (`js/utils/indexed-db.js`) used as optional secondary persistence layer with automatic migration from v2 to v3 schema.
  - **Migration Safety**: `migrateV2toV3()` upgrades any v2 stored state transparently on load — adding `accounts`, `recurringRules`, and `bills` arrays, and creating a default "Cash Wallet" account.
  - **v3 Schema**: `version: 3` state includes `accounts[]`, `transactions[]`, `budgets[]`, `goals[]`, `recurringRules[]`, and `bills[]`.
- **Intl API**: Currency and localized date formatting.
- **File & Blob APIs**: In-browser CSV and JSON generation, client-side file reading with `FileReader`.

**Strict Negative Constraints Met**: Zero React, Vue, Angular, TypeScript, Node.js backend services, Bootstrap, Tailwind, jQuery, or third-party charting libraries (Chart.js, etc.).

---

## 4. Project Folder Structure

```text
MeroHisab/
│
├── index.html                   # Semantic SPA Shell & View Container
├── README.md                    # Comprehensive Project Documentation
├── PROJECT_PROGRESS.md          # Implementation Progress & Invariant Log
│
├── assets/
│   ├── icons/
│   │   └── favicon.svg          # Emerald Vector Favicon
│   └── images/                  # Static assets and icons
│
├── css/
│   ├── main.css                 # Master CSS Orchestrator
│   ├── variables.css            # Color Tokens, Typography, Spacing & Themes
│   ├── reset.css                # CSS Reset & Box-Sizing Normalization
│   ├── layout.css               # Shell Architecture, Sidebar & Header
│   ├── components.css           # Cards, Badges, Buttons, Modals, Tables, Toasts
│   └── responsive.css           # Desktop (>=1024px), Tablet (768-1023px), Mobile (<768px)
│
├── js/
│   ├── app.js                   # Main Application Bootstrap
│   │
│   ├── core/
│   │   ├── constants.js         # Categories, Payment Channels, Thresholds, Defaults
│   │   ├── demo-data.js         # Verified, Mathematically Reconciled Nepal Demo Dataset
│   │   ├── state.js             # v3 State Manager: Accounts, Transfers, Recurring, Bills, Dispatch
│   │   ├── storage.js           # LocalStorage Wrapper with In-Memory Fallback
│   │   └── validator.js         # Schema Validation for v3: Accounts, Transfers, Recurring, Bills, Backups
│   │
│   ├── services/
│   │   ├── transactions.js      # Financial Summary Engine & Ledger Math Invariants
│   │   ├── budgets.js           # Budget Utilization & Threshold Analyzer
│   │   ├── goals.js             # Goal Progress & Allocation Headroom Analyzer
│   │   ├── analytics.js         # Fiscal Year & Monthly Aggregations
│   │   └── insights.js          # Rule-Based Heuristic Financial Insights
│   │
│   ├── utils/
│   │   ├── canvas-charts.js     # High-DPI Canvas Charts (Grouped Bar, Donut, Line/Trend)
│   │   ├── file-io.js           # RFC-Compliant CSV Export (v3 columns) & JSON Backup Engine
│   │   ├── formatters.js        # South Asian Digit Grouping (Lakhs/Crores) & NPR Formatting
│   │   ├── indexed-db.js        # IndexedDB Persistence Layer with LocalStorage Fallback
│   │   └── nepali-calendar.js   # Astronomical Bikram Sambat (BS) & Gregorian (AD) Converter
│   │
│   ├── components/
│   │   ├── confirm-dialog.js    # Accessible Modal Confirmation Prompts
│   │   ├── modal.js             # Dialog Controller with Keyboard Traps & Escape Key Support
│   │   ├── navigation.js        # Client-Side Hash Routing (9 routes) & Dynamic Header Date Badge
│   │   └── toast.js             # Non-Blocking Toast Notification Alerts
│   │
│   └── views/
│       ├── accounts.js          # Accounts & Wallets Management (Add/Edit/Delete/Transfer)
│       ├── bills.js             # Bills & Due Payment Tracking (Pay, Status, Reminders)
│       ├── dashboard.js         # Overview Dashboard with KPI Cards, Charts & Reminders Banner
│       ├── transactions.js      # Transaction Ledger (Income, Expense, Transfer rows)
│       ├── budgets.js           # Monthly Budget Management with Utilization Meters
│       ├── goals.js             # Savings Goals with Allocation Modals & Headroom Checks
│       ├── recurring.js         # Recurring Rules (Create/Edit/Pause/Skip/Process)
│       ├── analytics.js         # Analytics Reports, Canvas Series & Payment Channel Breakdown
│       └── settings.js          # Ledger Baseline, Preferences & v3 JSON/CSV Portability
│
├── screenshots/                 # Responsive High-Resolution Application Screenshots
│   ├── desktop_1440px.png       # Desktop Dashboard (1440x900)
│   ├── tablet_768px.png         # Tablet Dashboard (768x1024)
│   ├── mobile_390px.png         # Mobile Dashboard (390x844)
│   ├── desktop_accounts_1440px.png
│   ├── desktop_transactions_1440px.png
│   ├── desktop_recurring_1440px.png
│   ├── desktop_bills_1440px.png
│   ├── desktop_budgets_1440px.png
│   ├── desktop_goals_1440px.png
│   ├── desktop_analytics_1440px.png
│   └── desktop_settings_1440px.png
│
└── tests/                       # Automated Test Suites & Verification Fixtures
    ├── calendar.test.js         # Astronomical BS 2070-2090 Calendar Verification Suite
    ├── domain.test.js           # v3 Math Invariants, Transfers, Recurring, Bills & Schema Validation
    └── e2e.test.js              # Headless Chrome Integration Test: 9 routes + Screenshot Runner
```

---

## 5. How to Run the Application Locally

Because MeroHisab uses standard native ES6 JavaScript Modules (`import` / `export`), modern web browsers enforce CORS security policies that require the application to be served via an HTTP/HTTPS protocol rather than opened directly as a `file://` URL.

You can serve the directory using any standard lightweight local HTTP server:

### Option A: Using Python (Pre-installed on macOS/Linux/Windows)
```bash
# Navigate to the project directory
cd MeroHisab

# Start static server
python -m http.server 8000
```
Open your browser and navigate to: **`http://localhost:8000`**

### Option B: Using Node.js (`npx serve`)
```bash
cd MeroHisab
npx serve .
```
Open the URL shown in your terminal (typically `http://localhost:3000`).

### Option C: Using VS Code Live Server Extension
1. Open the `MeroHisab` folder in Visual Studio Code.
2. Install the **"Live Server"** extension (by Ritwick Dey).
3. Right-click `index.html` and select **"Open with Live Server"**.

---

## 6. How Persistence Works (LocalStorage + IndexedDB)

All financial data created or modified in MeroHisab is stored locally in the user's browser:

- **Primary Storage Key**: `MERO_HISAB_DATA_V3` (LocalStorage)
- **Secondary Storage**: IndexedDB (`js/utils/indexed-db.js`) — used as a fallback if LocalStorage quota is exceeded.
- **Theme Storage Key**: `MERO_HISAB_THEME`

### Migration & Schema Safety:
- On load, `migrateV2toV3()` transparently upgrades any v2 persisted state to v3 by adding `accounts[]`, `recurringRules[]`, and `bills[]` arrays and inserting a default "Cash Wallet" account.
- `clearAllData()` creates a clean v3 state with the default account and all empty arrays ready for a new user.

### Architecture & Safety Measures:
1. **Encapsulated Private State**: The application state is never exposed as a mutable global variable. State reads return immutable defensive deep copies via `getState()`. Mutations are performed exclusively via centralized state methods or action dispatches (`dispatch(action, payload)`).
2. **Defensive Storage Wrapper ([`storage.js`](file:///c:/Users/Administrator/Desktop/Projects/MeroHisab/js/core/storage.js))**: All storage reads and writes are wrapped in `try...catch` blocks. If `localStorage` is disabled, quota-exceeded, or running in an incognito sandbox that restricts storage, MeroHisab automatically falls back to an in-memory storage dictionary so the application remains functional without crashing.
3. **Reactive Subscriptions**: When a mutation occurs, the state manager serializes the updated snapshot to `localStorage` and immediately notifies all active subscribers, causing the current view and header indicators to re-render reactively.

---

## 7. How to Export and Import Backups

MeroHisab provides full data portability through the **Settings** view:

### Exporting Backups:
- **Export CSV**: Under *Settings > Backup & Data Portability*, click **"Download CSV File"**. This exports all recorded transactions with headers, transaction types, categories, payment methods, Account ID, Transfer Direction/ID, and dual AD/BS dates. A UTF-8 Byte Order Mark (`\uFEFF`) is prepended to ensure Microsoft Excel correctly displays Nepali characters. Transfer rows are labelled with `TRANSFER` type and include peer account details.
- **Export JSON Backup (v3)**: Click **"Download JSON Backup"**. This downloads a formatted JSON snapshot containing: `version: 3`, timestamp, user settings, accounts, transactions, monthly budgets, savings goals, recurring rules, and bills.

### Importing Backups:
1. Under *Settings > Backup & Data Portability*, click **"Select JSON File..."**.
2. Select a valid `.json` backup file (v2 or v3 format accepted).
3. MeroHisab validates the file structure using [`Validator.validateBackupJson`](file:///c:/Users/Administrator/Desktop/Projects/MeroHisab/js/core/validator.js). **v2 files are auto-migrated to v3** on import.
4. If valid, a confirmation modal displays the exact count of all entity types (Accounts, Transactions, Budgets, Goals, Recurring Rules, Bills) and requests user confirmation before replacing existing data.
5. Upon confirmation, data is loaded into state and persisted to `localStorage`, and the application re-renders immediately.

---

## 8. Supported AD/BS Calendar Range & Provisional Date Limitations

MeroHisab features a custom astronomical Bikram Sambat (BS) calendar engine ([`nepali-calendar.js`](file:///c:/Users/Administrator/Desktop/Projects/MeroHisab/js/utils/nepali-calendar.js)) with bidirectional conversion (`adToBs` and `bsToAd`).

### Supported Range:
- **BS Range**: Baisakh 1, 2070 BS to Chaitra 30, 2090 BS
- **AD Range**: April 14, 2013 AD to April 13, 2034 AD
- **Total Span**: 21 calendar years (7,670 consecutive days)

### Calendar Classification & Provisional Limitations:
1. **Section A: Officially Published & Gazetted (BS 2070 – BS 2083)**:
   - Month-length arrays for these years are verified against published gazettes from the **Nepal Calendar Determination Committee (*Nepal Panchanga Nirnayak Bikas Samiti*)** and Ministry of Home Affairs holiday notices.
   - Month boundaries and New Year transitions in this range are officially confirmed.
2. **Section B: Provisional Future Estimates (BS 2084 – BS 2090)**:
   - Because Bikram Sambat is an astronomical solar-sidereal calendar where month transitions correspond to the exact moment the Sun enters a new zodiac sign (*Sankranti*), official month lengths are formally announced year-by-year by the Nepal Panchanga Nirnayak Samiti.
   - Month lengths for BS 2084 through BS 2090 are calculated using astronomical solar transit models.
   - **Provisional Notice**: Dates in this range are clearly marked with a `[Provisional Estimate]` notice in the user interface. When the Nepal Government officially gazettes these calendar years in the future, adjustments of $\pm 1$ day to specific month lengths may occur.

---

## 9. Known Boundaries & Limitations

1. **Client-Side Sandbox**: Data is stored exclusively in the browser's `localStorage`. Clearing browser cookies and website data will remove locally stored records unless exported as a JSON backup.
2. **Estimated Ledger Balance**: The ledger balance is a calculated estimate based on the configured opening baseline and recorded transactions. MeroHisab is not linked to live bank feeds or digital wallet APIs (e.g. Fonepay/eSewa APIs).
3. **No Automated Multi-Device Sync**: Synchronizing data between multiple devices requires exporting a JSON backup from the primary device and importing it on the secondary device.
4. **Single Currency Base**: All accounting calculations are standardized to the Nepalese Rupee (NPR / रु). Multi-currency conversion or live foreign exchange rate lookups are not included.

---

## 10. Deployment Instructions

Because MeroHisab contains no backend, server files, or build steps, it can be deployed directly to static hosting platforms within seconds:

### Deploying to GitHub Pages:
1. Create a new repository on GitHub (e.g., `merohisab`).
2. Push the contents of the `MeroHisab` directory to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of MeroHisab"
   git remote add origin https://github.com/<your-username>/merohisab.git
   git branch -M main
   git push -u origin main
   ```
3. On GitHub, navigate to **Settings > Pages**.
4. Under **"Build and deployment"**, select **Source: Deploy from a branch**.
5. Choose branch **`main`** and folder **`/ (root)`**, then click **Save**.
6. Your application will be live at `https://<your-username>.github.io/merohisab/`.

### Deploying to Netlify:
- **Method 1 (Drag & Drop)**:
  1. Log in to [Netlify](https://www.netlify.com/).
  2. Drag and drop the `MeroHisab` folder directly onto the Netlify Drop zone.
  3. Your application is instantly deployed with an HTTPS URL.
- **Method 2 (Git Continuous Deployment)**:
  1. Connect your GitHub repository to Netlify.
  2. Leave the "Build command" empty.
  3. Set "Publish directory" to `.` (root).
  4. Click **Deploy Site**.


---

## 11. v3 Finance-Core Capabilities

- **Multiple Accounts & Wallets (`#accounts`)**: Create, edit, and archive Cash, Bank, eSewa, Khalti, IME Pay, and custom accounts with per-account opening balances and overdraft controls.
- **Atomic Account-to-Account Transfers**: Move money between wallets with paired transfer legs (`transferId`) that update account balances while remaining 100% neutral to income, expenses, budgets, and savings rate.
- **Recurring Transactions (`#recurring`)**: Schedule daily, weekly, monthly, and yearly repeating income/expenses with day-of-month preservation (no month-end drift), skip support, pause/resume, and explicit user confirmation before posting.
- **Bills & Payment Tracking (`#bills`)**: Track upcoming, due-soon, overdue, and paid bills with 1-to-1 idempotent expense linking and automatic recurring bill generation.
- **Hybrid Persistence & Safe v2→v3 Migration**: Automatic non-destructive upgrade from v2 ledgers with synchronous LocalStorage + durable IndexedDB mirroring.
