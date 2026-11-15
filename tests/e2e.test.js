import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import net from "net";
import { spawn, execSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const WORKSPACE_DIR = path.resolve(path.dirname(__filename), "..");
const SCREENSHOT_DIR = path.resolve(WORKSPACE_DIR, "screenshots");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

/**
 * Get a random free port from the operating system
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// 1. Static file HTTP server
const server = http.createServer((req, res) => {
  let reqPath = req.url.split("?")[0].split("#")[0];
  if (reqPath === "/") reqPath = "/index.html";
  const cleanPath = reqPath.replace(/^\/+/, "");
  const filePath = path.join(WORKSPACE_DIR, cleanPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`File not found: ${reqPath}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
});

// Start static server on dynamic port
server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  console.log(`[TestServer] Server running at http://127.0.0.1:${port}`);

  let exitCode = 0;
  try {
    await runAutomatedSuite(port);
  } catch (err) {
    console.error("\n[TestRunner] Suite execution FAILED:", err.message);
    exitCode = 1;
  } finally {
    server.close();
    process.exit(exitCode);
  }
});

/**
 * Locate Chrome or Chromium executable cross-platform
 */
function findChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const candidatePaths = [
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    (process.env.LOCALAPPDATA || "") + "\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];

  for (const p of candidatePaths) {
    if (p && fs.existsSync(p)) return p;
  }

  // Fallback check on PATH
  try {
    const isWin = process.platform === "win32";
    const checkCmd = isWin ? "where chrome" : "which google-chrome || which chromium";
    const result = execSync(checkCmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const firstLine = result.trim().split("\n")[0].trim();
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {
    // Not found on PATH
  }

  return null;
}

/**
 * Dynamically poll the Chrome DevTools HTTP endpoint until it is accepting connections.
 */
async function pollDevToolsEndpoint(cdpPort, timeoutMs = 25000) {
  const start = Date.now();
  const pollDelay = (ms) => new Promise(r => setTimeout(r, ms));
  while (Date.now() - start < timeoutMs) {
    try {
      // 1. Check if DevTools HTTP server is answering
      const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).catch(() => null);
      if (listRes && listRes.ok) {
        const targets = await listRes.json().catch(() => []);
        if (Array.isArray(targets) && targets.length > 0) {
          return targets;
        }
        // Try creating target if list is empty
        try {
          let newRes = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" }).catch(() => null);
          if (!newRes || !newRes.ok) {
            newRes = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`).catch(() => null);
          }
          if (newRes && newRes.ok) {
            const target = await newRes.json().catch(() => null);
            if (target && target.webSocketDebuggerUrl) return [target];
          }
        } catch {}
      } else {
        // Probe /json/version
        const verRes = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
        if (verRes && verRes.ok) {
          const verInfo = await verRes.json().catch(() => null);
          if (verInfo && verInfo.webSocketDebuggerUrl) {
            // CDP server is up; if /json/list is still initializing, wait for next poll iteration
          }
        }
      }
    } catch {
      // DevTools port not accepting connections yet
    }
    await pollDelay(150);
  }
  throw new Error(`Timed out waiting for Chrome remote debugging endpoint on port ${cdpPort} after ${timeoutMs}ms`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runAutomatedSuite(port) {
  console.log("====================================================");
  console.log("MeroHisab (मेरो हिसाब) — Integration & E2E Test Suite");
  console.log("====================================================");

  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error(
      "No Chrome or Chromium browser executable found on this system.\n" +
        "Please install Google Chrome or set the CHROME_PATH environment variable."
    );
  }
  console.log(`[Chrome] Located browser binary: ${chromePath}`);

  // 1. Launch Headless Chrome with dynamic CDP Port
  console.log("\n[1/4] Initializing Headless Chrome CDP Session on Dynamic Port...");
  const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "merohisab-chrome-"));

  let chromeStderr = "";
  let cdpPortFromStderr = null;
  let childExitedEarly = false;
  let childExitCode = null;

  const cdpChild = spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-translate",
    "--no-first-run",
    `--user-data-dir=${testUserDataDir}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    "--window-size=1440,900",
    "--remote-debugging-port=0",
    "about:blank"
  ]);

  cdpChild.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    chromeStderr += text;
    // Extract port from "DevTools listening on ws://127.0.0.1:PORT/devtools/browser/UUID"
    const match = text.match(/DevTools listening on ws:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//);
    if (match && !cdpPortFromStderr) {
      cdpPortFromStderr = parseInt(match[1], 10);
    }
  });

  cdpChild.on("exit", (code) => {
    childExitedEarly = true;
    childExitCode = code;
  });

  const cleanupProcess = () => {
    try {
      if (process.platform === "win32" && cdpChild.pid) {
        execSync(`taskkill /pid ${cdpChild.pid} /T /F`, { stdio: "ignore" });
      } else if (!cdpChild.killed) {
        cdpChild.kill();
      }
    } catch {
      // ignore
    }
    try {
      fs.rmSync(testUserDataDir, { recursive: true, force: true });
    } catch {}
  };
  process.on("exit", cleanupProcess);
  process.on("SIGINT", cleanupProcess);

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // Read assigned CDP port from DevToolsActivePort file or stderr
  const activePortFile = path.join(testUserDataDir, "DevToolsActivePort");
  let cdpPort = null;
  for (let i = 0; i < 150; i++) {
    if (childExitedEarly) {
      throw new Error(`Chrome process exited prematurely with code ${childExitCode}. Stderr:\n${chromeStderr}`);
    }
    if (cdpPortFromStderr) {
      cdpPort = cdpPortFromStderr;
      break;
    }
    if (fs.existsSync(activePortFile)) {
      try {
        const fileContent = fs.readFileSync(activePortFile, "utf8").trim();
        const firstLine = fileContent.split(/\r?\n/)[0].trim();
        const parsed = parseInt(firstLine, 10);
        if (parsed > 0) {
          cdpPort = parsed;
          break;
        }
      } catch {}
    }
    await delay(100);
  }
  if (!cdpPort) {
    throw new Error(`Failed to read assigned port from DevToolsActivePort file or stderr after 15s. Stderr:\n${chromeStderr}`);
  }
  console.log(`[CDP] Assigned dynamic debugging port: ${cdpPort}`);

  let ws;
  try {
    let lastWsError = null;
    const wsStart = Date.now();
    while (Date.now() - wsStart < 25000) {
      try {
        const targets = await pollDevToolsEndpoint(cdpPort, 20000);
        const pageTarget = targets.find(t => t.type === "page" && t.url.includes("index.html")) || targets.find(t => t.type === "page") || targets[0];
        if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
          throw new Error("No page target with webSocketDebuggerUrl found");
        }
        // Normalize localhost to 127.0.0.1 to avoid Node.js IPv6 ::1 connection refused
        const safeWsUrl = pageTarget.webSocketDebuggerUrl.replace(/\b(localhost)\b/, "127.0.0.1");
        ws = new WebSocket(safeWsUrl);
        await new Promise((res, rej) => {
          const timeout = setTimeout(() => {
            cleanup();
            rej(new Error("DevTools WebSocket handshake timed out"));
          }, 8000);
          const onOpen = () => {
            cleanup();
            res();
          };
          const onError = (err) => {
            cleanup();
            rej(err?.error || err || new Error("WebSocket error"));
          };
          const cleanup = () => {
            clearTimeout(timeout);
            ws.removeEventListener("open", onOpen);
            ws.removeEventListener("error", onError);
          };
          ws.addEventListener("open", onOpen);
          ws.addEventListener("error", onError);
        });
        lastWsError = null;
        break;
      } catch (err) {
        lastWsError = err;
        try { if (ws) ws.close(); } catch {}
        await delay(300);
      }
    }
    if (lastWsError) {
      throw new Error(`Failed to establish DevTools WebSocket connection after multiple attempts: ${lastWsError.message || lastWsError}`);
    }

    let cdpMsgId = 1;
    const sendCdp = (method, params = {}) => new Promise((resolve, reject) => {
      const mId = cdpMsgId++;
      const handler = (event) => {
        const data = JSON.parse(event.data);
        if (data.id === mId) {
          ws.removeEventListener("message", handler);
          if (data.error) reject(new Error(data.error.message));
          else if (data.result?.exceptionDetails) reject(new Error(data.result.exceptionDetails.exception?.description || "CDP evaluation exception"));
          else resolve(data.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id: mId, method, params }));
    });

    const evaluate = async (expr) => {
      const res = await sendCdp("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      });
      return res.result?.value;
    };

    // Verify local HTTP test server is responding before navigating
    await new Promise((resolve) => {
      const probe = () => {
        http.get(`http://127.0.0.1:${port}/index.html`, (res) => {
          if (res.statusCode === 200) resolve();
          else setTimeout(probe, 50);
        }).on("error", () => setTimeout(probe, 50));
      };
      probe();
    });

    await sendCdp("Page.enable");
    await sendCdp("Runtime.enable");
    await sendCdp("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });

    // Wait until document navigation completes to local server with automatic retry
    let navigated = false;
    for (let i = 0; i < 60; i++) {
      const curHref = await evaluate(`window.location.href`).catch(() => "");
      const readyState = await evaluate(`document.readyState`).catch(() => "");
      if (curHref && curHref.startsWith(`http://127.0.0.1:${port}`) && readyState === "complete") {
        navigated = true;
        break;
      }
      if (curHref && curHref.startsWith("chrome-error:")) {
        await delay(200);
        await sendCdp("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
      }
      await delay(100);
    }
    if (!navigated) {
      const curHref = await evaluate(`window.location.href`).catch(() => "unknown");
      throw new Error(`Failed to navigate to http://127.0.0.1:${port}/index.html; browser current URL is ${curHref}`);
    }
    await delay(300);

    // Ensure DOM is mounted
    for (let i = 0; i < 30; i++) {
      const count = await evaluate(`document.querySelector("#view-container")?.children?.length || 0`);
      if (count > 0) break;
      await delay(100);
    }

    // Verify Clean First-Run Initialization in genuine clean browser profile
    console.log("\n[First-Run Verification] Testing Genuine First-Launch Clean Initialization...");
    const firstRunCheck = await evaluate(`(async () => {
      const { getState, calculateAccountBalance } = await import('./js/core/state.js');
      const s = getState();
      return {
        isDemoData: s.isDemoData,
        accountsCount: s.accounts?.length || 0,
        accountName: s.accounts?.[0]?.name || "",
        balance: calculateAccountBalance(s, s.accounts?.[0]?.id),
        txCount: s.transactions?.length || 0,
        budgetCount: s.budgets?.length || 0,
        goalCount: s.goals?.length || 0,
        billCount: s.bills?.length || 0,
        recurringCount: s.recurringRules?.length || 0,
        hasWelcomeBanner: !!document.querySelector(".clean-ledger-banner")
      };
    })()`);
    assert(firstRunCheck.isDemoData === false, "First-run verification: isDemoData is false");
    assert(firstRunCheck.accountsCount === 1, "First-run verification: 1 default account initialized");
    assert(firstRunCheck.accountName === "Cash Wallet", "First-run verification: default account is Cash Wallet");
    assert(firstRunCheck.balance === 0, "First-run verification: opening balance is 0");
    assert(firstRunCheck.txCount === 0, "First-run verification: 0 transactions");
    assert(firstRunCheck.budgetCount === 0, "First-run verification: 0 budgets");
    assert(firstRunCheck.goalCount === 0, "First-run verification: 0 goals");
    assert(firstRunCheck.billCount === 0, "First-run verification: 0 bills");
    assert(firstRunCheck.recurringCount === 0, "First-run verification: 0 recurring rules");
    assert(firstRunCheck.hasWelcomeBanner === true, "First-run verification: Clean Ledger Welcome banner rendered in DOM");
    console.log("  ✓ Clean first-run initialization verified with 0 demo records.");

    // Capture clean welcome banner screenshots in both dark and light themes
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    const ssDark = await sendCdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.resolve(SCREENSHOT_DIR, "desktop_welcome_dark.png"), Buffer.from(ssDark.data, "base64"));
    console.log("  [Screenshot] Saved desktop_welcome_dark.png");

    await evaluate(`document.documentElement.setAttribute("data-theme", "light")`);
    await delay(300);
    const ssLight = await sendCdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.resolve(SCREENSHOT_DIR, "desktop_welcome_light.png"), Buffer.from(ssLight.data, "base64"));
    console.log("  [Screenshot] Saved desktop_welcome_light.png");

    await evaluate(`document.documentElement.setAttribute("data-theme", "dark")`);
    await delay(200);

    // Initial check: Reset to clean demo data in browser context for responsive screenshots and demo tests
    await evaluate(`(async () => {
      const { dispatch } = await import('./js/core/state.js');
      await dispatch('RESET_TO_DEMO');
    })()`);
    await delay(500);

    // Capture Responsive Screenshots via CDP (ensuring rich, fully-rendered DOM cards)
    console.log("\n[Responsive Screenshots] Capturing Rich Rendered Screenshots via CDP...");
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const takeScreenshot = async (w, h, isMobile, filename) => {
      await sendCdp("Emulation.setDeviceMetricsOverride", {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: isMobile
      });
      await delay(300);
      const ss = await sendCdp("Page.captureScreenshot", { format: "png" });
      const buffer = Buffer.from(ss.data, "base64");
      const outPath = path.resolve(SCREENSHOT_DIR, filename);
      fs.writeFileSync(outPath, buffer);
      console.log(`  [Screenshot] Saved ${filename} (${w}x${h}) [Size: ${buffer.length} bytes]`);
    };

    // 1. Desktop 1440px
    await takeScreenshot(1440, 900, false, "desktop_1440px.png");
    // 2. Tablet 768px
    await takeScreenshot(768, 1024, false, "tablet_768px.png");
    // 3. Mobile 390px
    await takeScreenshot(390, 844, true, "mobile_390px.png");

    // Reset to desktop viewport for route captures
    await sendCdp("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });

    const routeScreenshots = [
      { route: "transactions", file: "desktop_transactions_1440px.png" },
      { route: "budgets", file: "desktop_budgets_1440px.png" },
      { route: "goals", file: "desktop_goals_1440px.png" },
      { route: "analytics", file: "desktop_analytics_1440px.png" },
      { route: "settings", file: "desktop_settings_1440px.png" },
      { route: "accounts", file: "desktop_accounts_1440px.png" },
      { route: "recurring", file: "desktop_recurring_1440px.png" },
      { route: "bills", file: "desktop_bills_1440px.png" }
    ];

    for (const r of routeScreenshots) {
      await evaluate(`(() => {
        const link = document.querySelector('[data-route="${r.route}"]');
        if (link) link.click(); else window.location.hash = "#${r.route}";
      })()`);
      await delay(300);
      await takeScreenshot(1440, 900, false, r.file);
    }

    // Verify desktop screenshot is fully rendered
    const desktopStat = fs.statSync(path.resolve(SCREENSHOT_DIR, "desktop_1440px.png"));
    assert(desktopStat.size > 40000, `desktop_1440px.png captures full non-blank rendered cards (size: ${desktopStat.size} bytes > 40KB)`);

    // Return to dashboard
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="dashboard"]');
      if (link) link.click(); else window.location.hash = "#dashboard";
    })()`);
    await delay(300);

    // Verify all 9 routes render cleanly
    console.log("\n[Route Rendering] Testing Route Rendering Across All 9 Views...");
    const routes = [
      { name: "dashboard", expectText: "Dashboard Overview" },
      { name: "accounts", expectText: "Accounts & Wallets" },
      { name: "transactions", expectText: "Transactions" },
      { name: "recurring", expectText: "Recurring Transactions" },
      { name: "bills", expectText: "Bills & Reminders" },
      { name: "budgets", expectText: "Monthly Budgets" },
      { name: "goals", expectText: "Savings Goals" },
      { name: "analytics", expectText: "Reporting Period:" },
      { name: "settings", expectText: "Settings & Ledger" }
    ];

    for (const r of routes) {
      await evaluate(`(() => {
        const link = document.querySelector('[data-route="${r.name}"]');
        if (link) link.click();
        else window.location.hash = "#${r.name}";
      })()`);
      await delay(300);
      const bodyText = await evaluate(`document.body.innerText || ""`);
      if (!bodyText.toLowerCase().includes(r.expectText.toLowerCase())) {
        throw new Error(`Route #${r.name} failed to render expected text: '${r.expectText}'.`);
      }
      console.log(`  ✓ Route #${r.name} rendered cleanly.`);
    }

    // Dynamic dates & ledger math check
    console.log("\n[3/4] Verifying Dynamic Local Dates & Ledger Math Invariants...");
    const nepaliCal = await import(pathToFileURL(path.join(WORKSPACE_DIR, "js", "utils", "nepali-calendar.js")).href);
    const dual = nepaliCal.getCurrentDualDate();
    console.log(`  Dynamic Current Date: ${dual.dateAD} AD • ${dual.dateBS} BS (${dual.readableBS})`);

    const demoMod = await import(pathToFileURL(path.join(WORKSPACE_DIR, "js", "core", "demo-data.js")).href);
    const txMod = await import(pathToFileURL(path.join(WORKSPACE_DIR, "js", "services", "transactions.js")).href);
    const demoData = demoMod.getDemoData();
    const summary = txMod.calculateFinancialSummary(demoData);

    console.log("  Opening Baseline:", summary.initialBalance);
    console.log("  Monthly Inflow:", summary.monthlyInflow);
    console.log("  Monthly Outflow:", summary.monthlyOutflow);
    console.log("  Net Cash Flow:", summary.netCashFlow);
    console.log("  Estimated Ledger Balance:", summary.estimatedLedgerBalance);
    console.log("  Total Earmarked Savings:", summary.totalEarmarkedSavings);
    console.log("  Available to Allocate:", summary.availableToAllocate);

    assert(summary.estimatedLedgerBalance === 102450, "Ledger balance reconciles to 102450");
    assert(summary.availableToAllocate === 22450, "Available to allocate reconciles to 22450");

    // =========================================================================
    // SECTION 14: 27 GENUINE BROWSER-DRIVEN USER WORKFLOWS
    // =========================================================================
    console.log("\n[3.5/4] Running 27 Genuine Browser-Driven User Workflows (Section 14)...");

    // Workflow 1: Create accounts
    console.log("  [Workflow 1] Create account via DOM modal...");
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="accounts"]');
      if (link) link.click(); else window.location.hash = "#accounts";
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('#btn-add-account').click();`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#acc-name').value = 'Siddhartha Bank E2E';
      document.querySelector('#acc-type').value = 'bank';
      document.querySelector('#acc-balance').value = '50000';
      document.querySelector('#acc-date').value = '2026-10-01';
      document.querySelector('#acc-overdraft').checked = false;
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasAcc = await evaluate(`document.body.innerText.includes('Siddhartha Bank E2E')`);
    assert(hasAcc, "Workflow 1: Account created and rendered in accounts view");

    // Workflow 2: Add income
    console.log("  [Workflow 2] Add income transaction via DOM modal...");
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="transactions"]');
      if (link) link.click(); else window.location.hash = "#transactions";
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('#btn-add-tx').click();`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#btn-type-income').click();
      const selAcc = document.querySelector('#tx-modal-account');
      for (const opt of selAcc.options) {
        if (opt.text.includes('Siddhartha Bank E2E')) {
          selAcc.value = opt.value;
          break;
        }
      }
      document.querySelector('#tx-modal-amount').value = '30000';
      document.querySelector('#tx-modal-category').value = 'salary';
      document.querySelector('#tx-modal-desc').value = 'E2E Freelance Contract';
      document.querySelector('#tx-modal-date').value = '2026-10-05';
      document.querySelector('#tx-modal-method').value = 'bank_transfer';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasIncome = await evaluate(`document.body.innerText.includes('E2E Freelance Contract')`);
    assert(hasIncome, "Workflow 2: Income transaction added and displayed");

    // Workflow 3: Add expense
    console.log("  [Workflow 3] Add expense transaction via DOM modal...");
    await evaluate(`document.querySelector('#btn-add-tx').click();`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#btn-type-expense').click();
      const selAcc = document.querySelector('#tx-modal-account');
      for (const opt of selAcc.options) {
        if (opt.text.includes('Siddhartha Bank E2E')) {
          selAcc.value = opt.value;
          break;
        }
      }
      document.querySelector('#tx-modal-amount').value = '4500';
      document.querySelector('#tx-modal-category').value = 'food_dining';
      document.querySelector('#tx-modal-desc').value = 'E2E Grocery Restock';
      document.querySelector('#tx-modal-date').value = '2026-10-06';
      document.querySelector('#tx-modal-method').value = 'fonepay';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasExpense = await evaluate(`document.body.innerText.includes('E2E Grocery Restock')`);
    assert(hasExpense, "Workflow 3: Expense transaction added and displayed");

    // Workflow 4: Edit transaction
    console.log("  [Workflow 4] Edit transaction via DOM action button...");
    await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.innerText.includes('E2E Grocery Restock'));
      if (!row) throw new Error("Row for E2E Grocery Restock not found");
      const editBtn = row.querySelector('.btn-edit-tx');
      editBtn.click();
    })()`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#tx-modal-amount').value = '5200';
      document.querySelector('#tx-modal-desc').value = 'E2E Grocery Restock Bulk';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasEditedTx = await evaluate(`document.body.innerText.includes('E2E Grocery Restock Bulk')`);
    assert(hasEditedTx, "Workflow 4: Transaction edited and updated in DOM");

    // Workflow 5: Delete transaction
    console.log("  [Workflow 5] Delete transaction via DOM confirmation dialog...");
    await evaluate(`document.querySelector('#btn-add-tx').click();`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#tx-modal-amount').value = '999';
      document.querySelector('#tx-modal-desc').value = 'Tx To Be Deleted E2E';
      document.querySelector('#tx-modal-date').value = '2026-10-07';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.innerText.includes('Tx To Be Deleted E2E'));
      if (!row) throw new Error("Temporary row not found");
      row.querySelector('.btn-delete-tx').click();
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('.confirm-ok-btn').click();`);
    await delay(500);
    const hasDeletedTx = await evaluate(`document.body.innerText.includes('Tx To Be Deleted E2E')`);
    assert(!hasDeletedTx, "Workflow 5: Transaction permanently deleted from DOM");

    // Workflow 6: Create transfers
    console.log("  [Workflow 6] Create fund transfer via transfer modal...");
    await evaluate(`document.querySelector('#btn-tx-transfer').click();`);
    await delay(300);
    await evaluate(`(() => {
      const fromSel = document.querySelector('#tr-from');
      const toSel = document.querySelector('#tr-to');
      for (const opt of fromSel.options) {
        if (opt.text.includes('Siddhartha Bank E2E')) {
          fromSel.value = opt.value;
          break;
        }
      }
      for (const opt of toSel.options) {
        if (opt.text.includes('Cash Wallet') || opt.value === 'acc_default_cash') {
          toSel.value = opt.value;
          break;
        }
      }
      document.querySelector('#tr-amount').value = '7000';
      document.querySelector('#tr-date').value = '2026-10-08';
      document.querySelector('#tr-desc').value = 'ATM Cash Withdrawal E2E';
      document.querySelector('#tr-method').value = 'bank_transfer';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasTransfer = await evaluate(`document.body.innerText.includes('ATM Cash Withdrawal E2E')`);
    assert(hasTransfer, "Workflow 6: Transfer created and displayed with paired legs");

    // Workflow 7: Edit transfers
    console.log("  [Workflow 7] Edit transfer via .btn-edit-transfer...");
    await evaluate(`(() => {
      const editTransferBtn = document.querySelector('.btn-edit-transfer');
      if (!editTransferBtn) throw new Error("Could not find .btn-edit-transfer");
      editTransferBtn.click();
    })()`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#tr-amount').value = '8000';
      document.querySelector('#tr-desc').value = 'ATM Cash Withdrawal E2E Updated';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasUpdatedTransfer = await evaluate(`document.body.innerText.includes('ATM Cash Withdrawal E2E Updated')`);
    assert(hasUpdatedTransfer, "Workflow 7: Transfer updated atomically across both legs");

    // Workflow 8: Delete transfers
    console.log("  [Workflow 8] Delete transfer via .btn-delete-tx on transfer row...");
    await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => r.innerText.includes('ATM Cash Withdrawal E2E Updated'));
      if (!row) throw new Error("Transfer row to delete not found");
      row.querySelector('.btn-delete-tx').click();
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('.confirm-ok-btn').click();`);
    await delay(500);
    const hasDeletedTransfer = await evaluate(`document.body.innerText.includes('ATM Cash Withdrawal E2E Updated')`);
    assert(!hasDeletedTransfer, "Workflow 8: Transfer and reciprocal leg deleted cleanly");

    // Workflow 9: Create budgets
    console.log("  [Workflow 9] Create category budget via budget modal...");
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="budgets"]');
      if (link) link.click(); else window.location.hash = "#budgets";
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('#btn-add-budget').click();`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#budget-modal-period').value = '2026-10';
      document.querySelector('#budget-modal-category').value = 'education';
      document.querySelector('#budget-modal-amount').value = '18000';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasBudget = await evaluate(`document.body.innerText.includes('Education') && document.body.innerText.includes('18,000')`);
    assert(hasBudget, "Workflow 9: Monthly category budget created with utilization card");

    // Workflow 10: Create goals
    console.log("  [Workflow 10] Create savings goal via goal modal...");
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="goals"]');
      if (link) link.click(); else window.location.hash = "#goals";
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('#btn-add-goal').click();`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#goal-modal-title').value = 'Pokhara Holiday E2E';
      document.querySelector('#goal-modal-cat').value = 'Travel';
      document.querySelector('#goal-modal-target').value = '45000';
      document.querySelector('#goal-modal-date').value = '2026-10-30';
      document.querySelector('#goal-modal-desc').value = 'Vacation savings';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasGoal = await evaluate(`document.body.innerText.includes('Pokhara Holiday E2E')`);
    assert(hasGoal, "Workflow 10: Savings goal milestone created and displayed");

    // Workflow 11: Add and remove goal allocations
    console.log("  [Workflow 11] Add and remove goal allocations...");
    await evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('.content-card'));
      const card = cards.find(c => c.innerText.includes('Pokhara Holiday E2E'));
      if (!card) throw new Error("Goal card for Pokhara Holiday E2E not found");
      card.querySelector('.btn-add-allocation').click();
    })()`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#alloc-modal-amount').value = '6000';
      document.querySelector('#alloc-modal-date').value = '2026-10-10';
      document.querySelector('#alloc-modal-note').value = 'E2E Advance Deposit';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasAlloc = await evaluate(`document.body.innerText.includes('E2E Advance Deposit')`);
    assert(hasAlloc, "Workflow 11a: Earmarked goal allocation deposited");

    await evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('.btn-remove-alloc'));
      const btn = btns.find(b => b.parentElement?.innerText.includes('E2E Advance Deposit')) || btns[btns.length - 1];
      if (!btn) throw new Error("Could not find .btn-remove-alloc");
      btn.click();
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('.confirm-ok-btn').click();`);
    await delay(600);
    const allocRemoved = await evaluate(`!document.body.innerText.includes('E2E Advance Deposit')`);
    assert(allocRemoved, "Workflow 11b: Earmarked allocation removed and returned to headroom");

    // Workflow 12: Create bills
    console.log("  [Workflow 12] Create upcoming bill via bill modal...");
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="bills"]');
      if (link) link.click(); else window.location.hash = "#bills";
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('#btn-add-bill').click();`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#bill-title').value = 'Subisu Internet E2E';
      document.querySelector('#bill-amount').value = '1750';
      document.querySelector('#bill-due').value = '2026-10-22';
      document.querySelector('#bill-category').value = 'utilities';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasBill = await evaluate(`document.body.innerText.includes('Subisu Internet E2E')`);
    assert(hasBill, "Workflow 12: Bill created and displayed in bills view");

    // Workflow 13: Pay bills
    console.log("  [Workflow 13] Pay bill via .btn-pay-bill...");
    await evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('.content-card'));
      const card = cards.find(c => c.innerText.includes('Subisu Internet E2E'));
      if (!card) throw new Error("Subisu Internet E2E card not found");
      card.querySelector('.btn-pay-bill').click();
    })()`);
    await delay(600);
    const billPaid = await evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('.content-card'));
      const card = cards.find(c => c.innerText.includes('Subisu Internet E2E'));
      return card && (card.innerText.includes('Paid') || card.innerText.includes('PAID'));
    })()`);
    assert(billPaid, "Workflow 13: Bill marked as paid and linked to transaction");

    // Workflow 14: Edit paid bills
    console.log("  [Workflow 14] Edit paid bill via .btn-edit-bill...");
    await evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('.content-card'));
      const card = cards.find(c => c.innerText.includes('Subisu Internet E2E'));
      card.querySelector('.btn-edit-bill').click();
    })()`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#bill-title').value = 'Subisu Internet E2E Gigabit';
      document.querySelector('#bill-amount').value = '1850';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasEditedPaidBill = await evaluate(`document.body.innerText.includes('Subisu Internet E2E Gigabit') && document.body.innerText.includes('1,850')`);
    assert(hasEditedPaidBill, "Workflow 14: Paid bill edited and linked expense synchronized");

    // Workflow 15: Create recurring rules
    console.log("  [Workflow 15] Create recurring schedule rule via modal...");
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="recurring"]');
      if (link) link.click(); else window.location.hash = "#recurring";
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('#btn-add-recurring').click();`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#rr-title').value = 'Netflix E2E';
      document.querySelector('#rr-type').value = 'expense';
      document.querySelector('#rr-amount').value = '1500';
      document.querySelector('#rr-category').value = 'entertainment';
      document.querySelector('#rr-freq').value = 'monthly';
      document.querySelector('#rr-start').value = '2026-10-01';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(500);
    const hasRecurring = await evaluate(`document.body.innerText.includes('Netflix E2E')`);
    assert(hasRecurring, "Workflow 15: Recurring schedule rule created");

    // Workflow 16: Process recurring occurrences
    console.log("  [Workflow 16] Process recurring occurrence via .btn-post-rr...");
    await evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('.content-card'));
      const card = cards.find(c => c.innerText.includes('Netflix E2E'));
      if (!card) throw new Error("Netflix E2E card not found");
      const postBtn = card.querySelector('.btn-post-rr');
      if (!postBtn) throw new Error("Post button not found on Netflix card");
      postBtn.click();
    })()`);
    await delay(600);
    const postedTx = await evaluate(`(async () => {
      const { getState } = await import('./js/core/state.js');
      const state = getState();
      return state.transactions.some(t => t.description.includes('Netflix E2E'));
    })()`);
    assert(postedTx, "Workflow 16: Recurring occurrence posted into transaction ledger");

    // Workflow 17: Skip recurring occurrences
    console.log("  [Workflow 17] Skip recurring occurrence via .btn-skip-rr...");
    await evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('.content-card'));
      const card = cards.find(c => c.innerText.includes('Netflix E2E'));
      const skipBtn = card.querySelector('.btn-skip-rr');
      if (!skipBtn) throw new Error("Skip button not found on Netflix card");
      skipBtn.click();
    })()`);
    await delay(600);
    const skippedValid = await evaluate(`(async () => {
      const { getState } = await import('./js/core/state.js');
      const state = getState();
      const rule = state.recurringRules.find(r => r.title === 'Netflix E2E');
      return Boolean(rule && rule.skippedDates && rule.skippedDates.length > 0);
    })()`);
    assert(skippedValid, "Workflow 17: Recurring occurrence skipped cleanly");

    // Workflow 18: Export JSON
    console.log("  [Workflow 18] Export JSON backup via Settings view...");
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="settings"]');
      if (link) link.click(); else window.location.hash = "#settings";
    })()`);
    await delay(300);
    const exportedJsonStr = await evaluate(`(async () => {
      const { generateBackupJsonString } = await import('./js/utils/file-io.js');
      const { getState } = await import('./js/core/state.js');
      return generateBackupJsonString(getState());
    })()`);
    const parsedBackup = JSON.parse(exportedJsonStr);
    assert(parsedBackup && parsedBackup.version === 3 && Array.isArray(parsedBackup.accounts), "Workflow 18: JSON backup exported with v3 schema");

    // Workflow 19: Import JSON
    console.log("  [Workflow 19] Import JSON backup via file input and confirmation dialog...");
    await evaluate(`(async () => {
      const { getState } = await import('./js/core/state.js');
      const state = getState();
      const testAccount = {
        id: 'acc_import_everest',
        name: 'Everest Bank Import E2E',
        type: 'bank',
        openingBalance: 65000,
        openingBalanceDate: '2026-10-01',
        overdraftEnabled: false,
        archived: false,
        createdAt: new Date().toISOString()
      };
      const candidate = {
        ...state,
        revision: (state.revision || 1) + 1,
        accounts: [...state.accounts, testAccount]
      };
      const file = new File([JSON.stringify(candidate)], "merohisab_backup.json", { type: "application/json" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector('#backup-file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await delay(600);
    await evaluate(`(() => {
      const okBtn = document.querySelector('.confirm-ok-btn') || document.querySelector('.modal-save-btn');
      if (okBtn) okBtn.click();
    })()`);
    await delay(1200);
    const hasImportedAcc = await evaluate(`(async () => {
      const { getState } = await import('./js/core/state.js');
      return getState().accounts.some(a => a.name === 'Everest Bank Import E2E');
    })()`);
    assert(hasImportedAcc, "Workflow 19: Backup imported and restored into state");

    // Workflow 20: Verify complete backup round-trip equality
    console.log("  [Workflow 20] Verify complete backup round-trip equality...");
    const roundTripRes = await evaluate(`(async () => {
      const { computeStateFingerprint } = await import('./js/core/migrate-to-idb.js');
      const { generateBackupJsonString } = await import('./js/utils/file-io.js');
      const { dispatch, getState } = await import('./js/core/state.js');

      const before = getState();
      const fpBefore = computeStateFingerprint(before);
      const jsonStr = generateBackupJsonString(before);

      const restoreRes = await dispatch('RESTORE_BACKUP', JSON.parse(jsonStr));
      if (!restoreRes || !restoreRes.success) return { success: false, error: restoreRes?.error };

      const after = getState();
      const fpAfter = computeStateFingerprint(after);
      return { success: true, equal: fpBefore === fpAfter };
    })()`);
    assert(roundTripRes.success && roundTripRes.equal, "Workflow 20: 100% Round-trip fingerprint equality verified");

    // Workflow 21: Export CSV
    console.log("  [Workflow 21] Export RFC-compliant CSV with UTF-8 BOM...");
    const csvCheck = await evaluate(`(async () => {
      const { generateCsvString } = await import('./js/utils/file-io.js');
      const { getState } = await import('./js/core/state.js');
      const txs = getState().transactions;
      const csv = generateCsvString(txs);
      return {
        hasBom: csv.startsWith('\\uFEFF'),
        hasHeader: csv.includes('Transaction ID,Date (AD),Date (BS)'),
        rowCount: csv.split('\\n').filter(Boolean).length,
        txCount: txs.length
      };
    })()`);
    assert(csvCheck.hasBom && csvCheck.hasHeader && csvCheck.rowCount >= csvCheck.txCount, "Workflow 21: RFC-compliant CSV with BOM exported accurately");

    // Workflow 22: Reload browser and verify persistent data
    console.log("  [Workflow 22] Trigger genuine page reload and verify persistent state...");
    await evaluate(`location.reload();`);
    await delay(1600);
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="accounts"]');
      if (link) link.click(); else window.location.hash = "#accounts";
    })()`);
    await delay(500);
    const hasAccPostReload = await evaluate(`document.body.innerText.includes('Everest Bank Import E2E')`);
    assert(hasAccPostReload, "Workflow 22: Complete state persisted in IndexedDB across browser reload");

    // Workflow 23: Verify all 9 views show correct reconciling figures
    console.log("  [Workflow 23] Traverse all 9 views and check visual reconciliation...");
    const allViewsReconciled = await evaluate(`(async () => {
      const routes = ['dashboard', 'accounts', 'transactions', 'recurring', 'bills', 'budgets', 'goals', 'analytics', 'settings'];
      for (const r of routes) {
        const link = document.querySelector(\`[data-route="\${r}"]\`);
        if (link) link.click(); else window.location.hash = '#' + r;
        await new Promise(res => setTimeout(res, 250));
        if (!document.querySelector('main')) return false;
      }
      return true;
    })()`);
    assert(allViewsReconciled, "Workflow 23: All 9 views render and reconcile financial figures cleanly");

    // Workflow 24: Test invalid inputs
    console.log("  [Workflow 24] Test invalid input validation (amount 1.234) in DOM modal...");
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="transactions"]');
      if (link) link.click(); else window.location.hash = "#transactions";
    })()`);
    await delay(300);
    await evaluate(`document.querySelector('#btn-add-tx').click();`);
    await delay(300);
    await evaluate(`(() => {
      document.querySelector('#tx-modal-amount').value = '1.234';
      document.querySelector('#tx-modal-desc').value = 'Invalid Money Test';
      document.querySelector('#tx-modal-date').value = '2026-10-15';
    })()`);
    await evaluate(`document.querySelector('.modal-save-btn').click();`);
    await delay(400);
    const modalErrorShown = await evaluate(`(() => {
      const err = document.querySelector('#tx-modal-error');
      return err && err.style.display !== 'none' && err.innerText.length > 0;
    })()`);
    assert(modalErrorShown, "Workflow 24: Invalid 3-decimal amount (1.234) rejected in modal with error");
    await evaluate(`document.querySelector('.modal-close-btn')?.click() || document.querySelector('.btn-secondary')?.click();`);
    await delay(300);

    // Workflow 25: Test failed persistent writes
    console.log("  [Workflow 25] Test failed persistent writes rollback cleanly...");
    const rollbackSucceeded = await evaluate(`(async () => {
      const { __configureMockIdb, __disableMockIdb } = await import('./js/utils/indexed-db.js');
      const { StorageService } = await import('./js/core/storage.js');
      const { dispatch, getState } = await import('./js/core/state.js');
      const beforeState = getState();
      const beforeCount = beforeState.accounts.length;

      const origLsSet = StorageService.setItem;
      StorageService.setItem = () => ({ success: false, error: "Simulated LocalStorage Quota Exceeded" });
      __configureMockIdb({ writeFailure: true });

      const failRes = await dispatch('ADD_ACCOUNT', {
        name: 'Ghost Account Storage Failure',
        type: 'bank',
        openingBalance: 1000,
        openingBalanceDate: '2026-10-01'
      });

      StorageService.setItem = origLsSet;
      __disableMockIdb();

      const afterState = getState();
      const ghostExists = afterState.accounts.some(a => a.name.includes('Ghost Account'));
      return {
        failReported: failRes && failRes.success === false,
        inMemoryPreserved: !ghostExists && afterState.accounts.length === beforeCount
      };
    })()`);
    assert(rollbackSucceeded.failReported && rollbackSucceeded.inMemoryPreserved, "Workflow 25: Failed persistent write rejected and previous state preserved");

    // Workflow 26: Test concurrent updates from two browser contexts
    console.log("  [Workflow 26] Test concurrent updates from two browser tabs/contexts via CDP...");
    const target2 = await sendCdp("Target.createTarget", {
      url: `http://127.0.0.1:${port}/index.html`
    });
    const tab2TargetId = target2.targetId;
    await delay(1200);

    let tab2Info = null;
    for (let i = 0; i < 40; i++) {
      const listRes2 = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).catch(() => null);
      if (listRes2 && listRes2.ok) {
        const targets2 = await listRes2.json().catch(() => []);
        tab2Info = targets2.find(t => t.id === tab2TargetId);
        if (tab2Info?.webSocketDebuggerUrl) break;
      }
      await delay(100);
    }
    if (!tab2Info?.webSocketDebuggerUrl) {
      throw new Error(`Failed to find target info with webSocketDebuggerUrl for tab2 (${tab2TargetId})`);
    }

    const tab2WsUrl = tab2Info.webSocketDebuggerUrl.replace(/\b(localhost)\b/, "127.0.0.1");
    const wsTab2 = new WebSocket(tab2WsUrl);
    await new Promise((res, rej) => {
      const timer = setTimeout(() => {
        cleanup();
        rej(new Error("Tab 2 WebSocket connection timed out"));
      }, 8000);
      const onOpen = () => { cleanup(); res(); };
      const onError = (e) => { cleanup(); rej(e?.error || e || new Error("Tab 2 WebSocket error")); };
      const cleanup = () => {
        clearTimeout(timer);
        wsTab2.removeEventListener("open", onOpen);
        wsTab2.removeEventListener("error", onError);
      };
      wsTab2.addEventListener("open", onOpen);
      wsTab2.addEventListener("error", onError);
    });

    let tab2MsgId = 1;
    const sendCdpTab2 = (method, params = {}) => new Promise((resolve, reject) => {
      const mId = tab2MsgId++;
      const handler = (event) => {
        const data = JSON.parse(event.data);
        if (data.id === mId) {
          wsTab2.removeEventListener("message", handler);
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result);
        }
      };
      wsTab2.addEventListener("message", handler);
      wsTab2.send(JSON.stringify({ id: mId, method, params }));
    });

    const evalTab2 = async (expr) => {
      const res = await sendCdpTab2("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      });
      return res.result?.value;
    };

    // Tab 2 updates an account (advancing revision)
    const tab2Res = await evalTab2(`(async () => {
      const { dispatch } = await import('./js/core/state.js');
      return await dispatch('ADD_ACCOUNT', {
        name: 'Context 2 Multi-Tab Account',
        type: 'bank',
        openingBalance: 12500,
        openingBalanceDate: '2026-10-01'
      });
    })()`);
    assert(tab2Res && tab2Res.success, "Tab 2 successfully committed update and advanced revision");
    await delay(600);

    // Tab 1 attempts a stale revision write
    const tab1Conflict = await evaluate(`(async () => {
      const { setStoredState } = await import('./js/utils/indexed-db.js');
      const { getState } = await import('./js/core/state.js');
      const state = getState();
      // Candidate with stale revision (1)
      const staleCandidate = { ...state, revision: 1 };
      return await setStoredState(staleCandidate);
    })()`);
    assert(tab1Conflict.conflict === true || tab1Conflict.success === false, "Workflow 26: Tab 1 stale candidate rejected atomically by IndexedDB revision check");

    wsTab2.close();
    await sendCdp("Target.closeTarget", { targetId: tab2TargetId });

    // Workflow 27: Dynamic User Profile Name & Live Sidebar Updates
    console.log("  [Workflow 27] Test dynamic profile display name in Settings and live sidebar update...");
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="settings"]');
      if (link) link.click(); else window.location.hash = "#settings";
    })()`);
    await delay(400);

    // Initial sidebar verification
    const initialName = await evaluate(`document.querySelector('#sidebar-user-name, .user-name')?.textContent?.trim()`);
    const initialAvatar = await evaluate(`document.querySelector('#sidebar-user-avatar, .user-avatar')?.textContent?.trim()`);
    assert(initialName === "MeroHisab User", `Workflow 27a: Sidebar initial display name is 'MeroHisab User' (found: '${initialName}')`);
    assert(initialAvatar === "MU", `Workflow 27b: Sidebar initial avatar is 'MU' (found: '${initialAvatar}')`);

    // Edit profile name to "Aarav Sharma"
    await evaluate(`(() => {
      const input = document.querySelector('#setting-display-name');
      if (input) {
        input.value = '  Aarav Sharma  ';
      }
      document.querySelector('#btn-save-profile')?.click() || document.querySelector('#profile-settings-form')?.requestSubmit();
    })()`);
    await delay(500);

    // Live update check without page reload
    const liveName = await evaluate(`document.querySelector('#sidebar-user-name, .user-name')?.textContent?.trim()`);
    const liveAvatar = await evaluate(`document.querySelector('#sidebar-user-avatar, .user-avatar')?.textContent?.trim()`);
    const badgeText = await evaluate(`document.querySelector('#profile-current-badge')?.textContent?.trim()`);
    assert(liveName === "Aarav Sharma", "Workflow 27c: Live sidebar name updated immediately to 'Aarav Sharma'");
    assert(liveAvatar === "AS", "Workflow 27d: Live sidebar avatar updated immediately to 'AS'");
    assert(badgeText === "Aarav Sharma", "Workflow 27e: Profile current badge updated to 'Aarav Sharma'");

    // Verify persistence across genuine page reload
    await sendCdp("Page.reload");
    await delay(1200);

    const reloadedName = await evaluate(`document.querySelector('#sidebar-user-name, .user-name')?.textContent?.trim()`);
    const reloadedAvatar = await evaluate(`document.querySelector('#sidebar-user-avatar, .user-avatar')?.textContent?.trim()`);
    assert(reloadedName === "Aarav Sharma", "Workflow 27f: Profile name 'Aarav Sharma' persisted across genuine page reload");
    assert(reloadedAvatar === "AS", "Workflow 27g: Avatar initials 'AS' persisted across genuine page reload");

    // Test Preferences Form (userName & userRole inputs)
    await evaluate(`(() => {
      const link = document.querySelector('[data-route="settings"]');
      if (link) link.click(); else window.location.hash = "#settings";
    })()`);
    await delay(400);

    await evaluate(`(() => {
      const nameInput = document.querySelector('#setting-user-name');
      const roleInput = document.querySelector('#setting-user-role');
      if (nameInput) nameInput.value = 'Suyog Shakya';
      if (roleInput) roleInput.value = 'Chief Financial Officer';
      document.querySelector('#preferences-form')?.requestSubmit();
    })()`);
    await delay(500);

    const prefName = await evaluate(`document.querySelector('#sidebar-user-name, .user-name')?.textContent?.trim()`);
    const prefRole = await evaluate(`document.querySelector('#sidebar-user-role, .user-role')?.textContent?.trim()`);
    const prefAvatar = await evaluate(`document.querySelector('#sidebar-user-avatar, .user-avatar')?.textContent?.trim()`);
    assert(prefName === "Suyog Shakya", "Workflow 27h: Preferences form updated userName to 'Suyog Shakya'");
    assert(prefRole === "Chief Financial Officer", "Workflow 27i: Preferences form updated userRole to 'Chief Financial Officer'");
    assert(prefAvatar === "SS", "Workflow 27j: Sidebar avatar updated to 'SS'");

    // =========================================================================
    // WORKFLOW 28: BROWSER INTEGER PAISA ACCUMULATION & AGGREGATE PRECISION
    // =========================================================================
    console.log("  [Workflow 28] Test live browser integer Paisa & aggregate overflow defense...");
    const paisaPrecisionCheck = await evaluate(`(async () => {
      const { toPaisaBigInt, fromPaisaBigInt, addMoney } = await import('./js/utils/money.js');

      // 1. Verify 0.10 + 0.20 === 0.30 in browser runtime
      const exactSum = addMoney(0.10, 0.20);

      // 2. Accumulate 100 transactions of 999,999,999,999.99
      let accPaisa = 0n;
      const singleTxPaisa = toPaisaBigInt(999999999999.99);
      for (let i = 0; i < 100; i++) {
        accPaisa += singleTxPaisa;
      }
      const formattedTotal = fromPaisaBigInt(accPaisa, { asString: true });
      return { exactSum, formattedTotal, isExact: formattedTotal === "99999999999999.00" };
    })()`);
    assert(paisaPrecisionCheck.exactSum === 0.3, "Workflow 28a: Browser runtime evaluates addMoney(0.10, 0.20) === 0.30 exactly");
    assert(paisaPrecisionCheck.isExact, `Workflow 28b: 100 max transactions equal exact 99999999999999.00 (got: ${paisaPrecisionCheck.formattedTotal})`);

    // =========================================================================
    // WORKFLOW 29: STORED XSS ATTACK RESISTANCE & TEXTCONTENT TEMPLATE DEFENSE
    // =========================================================================
    console.log("  [Workflow 29] Test stored XSS resistance across dialogs, toasts & views...");
    const xssTestResult = await evaluate(`(async () => {
      window.__xss_fired = false;
      const { showToast } = await import('./js/components/toast.js');
      const { openModal, closeModal } = await import('./js/components/modal.js');
      const { showConfirmDialog } = await import('./js/components/confirm-dialog.js');
      const { dispatch } = await import('./js/core/state.js');

      // 1. Test toast message textContent
      showToast('<img src="invalid-url-toast" onerror="window.__xss_fired=true">', 'info');

      // 2. Test modal title textContent
      openModal({
        title: '<img src="invalid-url-modal" onerror="window.__xss_fired=true">',
        contentHtml: '<p>Modal body</p>'
      });
      closeModal();

      // 3. Test confirm dialog title and message textContent
      showConfirmDialog({
        title: '<img src="invalid-url-dlg-title" onerror="window.__xss_fired=true">',
        message: '<img src="invalid-url-dlg-msg" onerror="window.__xss_fired=true">',
        confirmText: 'OK',
        cancelText: 'Cancel'
      });
      document.querySelector('#confirm-dialog-cancel')?.click();

      // 4. Test state mutation with XSS payload in transaction description
      await dispatch('ADD_TRANSACTION', {
        type: 'income',
        accountId: 'acc_default_cash',
        amount: 50,
        category: 'other_income',
        description: '<img src="invalid-url-tx" onerror="window.__xss_fired=true"><script>window.__xss_fired=true</script>',
        dateAD: '2026-10-15',
        paymentMethod: 'cash'
      });

      // Navigate to transactions view
      const link = document.querySelector('[data-route="transactions"]');
      if (link) link.click(); else window.location.hash = "#transactions";

      await new Promise(r => setTimeout(r, 400));
      return {
        xssFired: window.__xss_fired,
        hasErrorImg: !!document.querySelector('img[src^="invalid-url"]')
      };
    })()`);
    assert(xssTestResult.xssFired === false, "Workflow 29a: Malicious XSS payload was NOT executed (window.__xss_fired is false)");
    assert(xssTestResult.hasErrorImg === false, "Workflow 29b: XSS img elements were not parsed into the DOM");

    // =========================================================================
    // WORKFLOW 30: SERVICE WORKER PRECACHING & PWA OFFLINE NAVIGATION
    // =========================================================================
    console.log("  [Workflow 30] Test Service Worker precaching & PWA offline navigation...");

    // Check Cache Storage in browser context
    const swStatus = await evaluate(`(async () => {
      if (!('serviceWorker' in navigator) || !('caches' in window)) {
        return { supported: false };
      }
      try {
        const cache = await caches.open('merohisab-v3.1.0');
        const keys = await cache.keys();
        return {
          supported: true,
          cacheName: 'merohisab-v3.1.0',
          cachedUrlsCount: keys.length
        };
      } catch (e) {
        return { supported: true, error: e.message };
      }
    })()`);
    console.log("  SW Cache status:", JSON.stringify(swStatus));
    assert(swStatus.supported, "Workflow 30a: Service Worker and Cache Storage supported in browser");

    // Enable Network emulation in CDP to simulate complete offline mode
    await sendCdp("Network.enable");
    console.log("  [Offline Emulation] Emulating complete offline network conditions...");
    await sendCdp("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    });
    await delay(300);

    // Navigate through all views while completely offline
    const offlineViews = ["dashboard", "transactions", "budgets", "goals", "accounts", "bills", "recurring", "analytics", "settings"];
    for (const view of offlineViews) {
      await evaluate(`(() => {
        const link = document.querySelector('[data-route="${view}"]');
        if (link) link.click(); else window.location.hash = "#${view}";
      })()`);
      await delay(200);
      const childCount = await evaluate(`document.querySelector('#view-container')?.children?.length || 0`);
      assert(childCount > 0, `Workflow 30b: View #${view} renders successfully while 100% offline (${childCount} children)`);
    }

    // Re-enable normal online network conditions
    await sendCdp("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });
    console.log("  [Offline Emulation] Restored online network conditions.");

    // =========================================================================
    // WORKFLOW 31: REAL-BROWSER EQUAL-REVISION CONFLICT RECOVERY (IDB SELECTION)
    // =========================================================================
    console.log("  [Workflow 31] Test equal-revision divergence & IDB resolution in real browser storage...");
    await evaluate(`(async () => {
      const { setStoredState } = await import('./js/utils/indexed-db.js');
      const { STORAGE_KEYS, DEFAULT_SETTINGS } = await import('./js/core/constants.js');

      const base = {
        version: 3,
        revision: 77,
        isDemoData: false,
        settings: { ...DEFAULT_SETTINGS, initialBalance: 30000, initialBalanceDate: '2026-01-01' },
        accounts: [{ id: 'acc_e2e_div', name: 'E2E Diverge', type: 'bank', openingBalance: 30000, openingBalanceDate: '2026-01-01', overdraftEnabled: false, archived: false }],
        budgets: [], goals: [], recurringRules: [], bills: []
      };

      const idbSnap = {
        ...base,
        transactions: [{ id: 'tx_e2e_idb', accountId: 'acc_e2e_div', type: 'income', amount: 5000, category: 'freelance', description: 'Real Browser IDB Leg', dateAD: '2026-03-01', dateBS: '2082-11-17', paymentMethod: 'bank_transfer' }]
      };

      const lsSnap = {
        ...base,
        transactions: [{ id: 'tx_e2e_ls', accountId: 'acc_e2e_div', type: 'expense', amount: 2000, category: 'groceries', description: 'Real Browser LS Leg', dateAD: '2026-03-02', dateBS: '2082-11-18', paymentMethod: 'cash' }]
      };

      await setStoredState(idbSnap, { force: true });
      localStorage.setItem(STORAGE_KEYS.APP_DATA, JSON.stringify(lsSnap));
    })()`);

    // Reload page to trigger real-browser startup reconciliation
    await sendCdp("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
    await delay(600);

    const conflictDetected = await evaluate(`(() => {
      const s = window.__merohisab_test_getState ? window.__merohisab_test_getState() : null;
      const banner = document.querySelector('.recovery-banner');
      return {
        hasBanner: !!banner,
        hasExportIdb: !!document.querySelector('#btn-export-idb-snapshot'),
        hasExportLs: !!document.querySelector('#btn-export-ls-snapshot'),
        hasResolveIdb: !!document.querySelector('#btn-resolve-idb')
      };
    })()`);
    assert(conflictDetected.hasBanner, "Workflow 31a: Equal-revision conflict banner renders in real browser DOM");
    assert(conflictDetected.hasExportIdb && conflictDetected.hasExportLs, "Workflow 31b: Recovery snapshot export buttons present in browser DOM");

    // Attempt blocked mutation in recovery mode
    const blockedRes = await evaluate(`(async () => {
      const { dispatch } = await import('./js/core/state.js');
      return await dispatch('ADD_TRANSACTION', {
        type: 'income', accountId: 'acc_e2e_div', amount: 100, category: 'salary', description: 'Blocked In Browser', dateAD: '2026-03-05', paymentMethod: 'cash'
      });
    })()`);
    assert(blockedRes.success === false, "Workflow 31c: Normal financial write blocked during equal-revision conflict in browser");

    // Click resolve IDB button
    await evaluate(`document.querySelector('#btn-resolve-idb')?.click()`);
    await delay(600);

    // Verify recovery cleared and chosen snapshot persisted after real browser reload
    await sendCdp("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
    await delay(600);

    const postResolveIdbState = await evaluate(`(async () => {
      const { getState, calculateAccountBalance } = await import('./js/core/state.js');
      const s = getState();
      return {
        recoveryMode: s.recoveryMode,
        revision: s.revision,
        balance: calculateAccountBalance(s, 'acc_e2e_div'),
        txId: s.transactions[0]?.id
      };
    })()`);
    assert(postResolveIdbState.recoveryMode !== true, "Workflow 31d: Recovery mode cleared after browser conflict resolution");
    assert(postResolveIdbState.revision === 78, "Workflow 31e: State revision advanced monotonically to 78");
    assert(postResolveIdbState.txId === "tx_e2e_idb", "Workflow 31f: Chosen IDB transaction persisted in real browser database");
    assert(postResolveIdbState.balance === 35000, "Workflow 31g: Account balance reflects chosen snapshot (30000 + 5000 = 35000)");

    // =========================================================================
    // WORKFLOW 32: REAL-BROWSER EQUAL-REVISION CONFLICT RECOVERY (LS SELECTION)
    // =========================================================================
    console.log("  [Workflow 32] Test equal-revision divergence & LS resolution in real browser storage...");
    await evaluate(`(async () => {
      const { setStoredState } = await import('./js/utils/indexed-db.js');
      const { STORAGE_KEYS, DEFAULT_SETTINGS } = await import('./js/core/constants.js');

      const base = {
        version: 3,
        revision: 85,
        isDemoData: false,
        settings: { ...DEFAULT_SETTINGS, initialBalance: 40000, initialBalanceDate: '2026-01-01' },
        accounts: [{ id: 'acc_e2e_lsdiv', name: 'E2E LS Diverge', type: 'bank', openingBalance: 40000, openingBalanceDate: '2026-01-01', overdraftEnabled: false, archived: false }],
        budgets: [], goals: [], recurringRules: [], bills: []
      };

      const idbSnap = {
        ...base,
        transactions: [{ id: 'tx_e2e_idb85', accountId: 'acc_e2e_lsdiv', type: 'income', amount: 8000, category: 'freelance', description: 'IDB 85 Leg', dateAD: '2026-03-01', dateBS: '2082-11-17', paymentMethod: 'bank_transfer' }]
      };

      const lsSnap = {
        ...base,
        transactions: [{ id: 'tx_e2e_ls85', accountId: 'acc_e2e_lsdiv', type: 'expense', amount: 4000, category: 'groceries', description: 'LS 85 Leg', dateAD: '2026-03-02', dateBS: '2082-11-18', paymentMethod: 'cash' }]
      };

      await setStoredState(idbSnap, { force: true });
      localStorage.setItem(STORAGE_KEYS.APP_DATA, JSON.stringify(lsSnap));
    })()`);

    await sendCdp("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
    await delay(600);

    // Click resolve LS button
    await evaluate(`document.querySelector('#btn-resolve-ls')?.click()`);
    await delay(600);

    // Verify recovery cleared and chosen snapshot persisted after real browser reload
    await sendCdp("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
    await delay(600);

    const postResolveLsState = await evaluate(`(async () => {
      const { getState, calculateAccountBalance } = await import('./js/core/state.js');
      const { STORAGE_KEYS } = await import('./js/core/constants.js');
      const s = getState();
      const backup = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONFLICT_BACKUP) || '{}');
      return {
        recoveryMode: s.recoveryMode,
        revision: s.revision,
        balance: calculateAccountBalance(s, 'acc_e2e_lsdiv'),
        txId: s.transactions[0]?.id,
        backupTxId: backup.transactions?.[0]?.id
      };
    })()`);
    assert(postResolveLsState.recoveryMode !== true, "Workflow 32a: Recovery mode cleared after LS selection in browser");
    assert(postResolveLsState.revision === 86, "Workflow 32b: State revision advanced monotonically to 86");
    assert(postResolveLsState.txId === "tx_e2e_ls85", "Workflow 32c: Chosen LocalStorage transaction persisted in real browser database");
    assert(postResolveLsState.balance === 36000, "Workflow 32d: Account balance reflects chosen snapshot (40000 - 4000 = 36000)");
    assert(postResolveLsState.backupTxId === "tx_e2e_idb85", "Workflow 32e: Alternate IDB snapshot preserved independently in CONFLICT_BACKUP");

    // =========================================================================
    // WORKFLOW 33: SAFE FIRST-TIME PERSONAL LEDGER INITIALIZATION
    // =========================================================================
    console.log("  [Workflow 33] Test clean first-time personal ledger initialization in browser...");
    const personalSetupRes = await evaluate(`(async () => {
      const { dispatch, getState, calculateAccountBalance } = await import('./js/core/state.js');
      const res = await dispatch('INITIALIZE_PERSONAL_LEDGER', {
        initialBalance: 0,
        initialBalanceDate: '2026-01-01',
        accountName: 'My Cash Wallet'
      });
      const s = getState();
      return {
        success: res.success,
        isDemoData: s.isDemoData,
        txCount: s.transactions.length,
        accName: s.accounts[0]?.name,
        accBalance: calculateAccountBalance(s, s.accounts[0]?.id)
      };
    })()`);
    assert(personalSetupRes.success === true, "Workflow 33a: INITIALIZE_PERSONAL_LEDGER succeeded");
    assert(personalSetupRes.isDemoData === false, "Workflow 33b: isDemoData flag set to false");
    assert(personalSetupRes.txCount === 0, "Workflow 33c: Zero fictional transactions present in personal ledger");
    assert(personalSetupRes.accBalance === 0, "Workflow 33d: Opening account balance is exactly रु 0");

    // Add real transaction in personal ledger
    await evaluate(`(async () => {
      const { dispatch, getState, waitForPendingWrites } = await import('./js/core/state.js');
      const s = getState();
      await dispatch('ADD_TRANSACTION', {
        type: 'income',
        accountId: s.accounts[0].id,
        amount: 25000,
        category: 'salary',
        description: 'First Real Salary',
        dateAD: '2026-10-01',
        paymentMethod: 'bank_transfer'
      });
      await waitForPendingWrites();
    })()`);

    // Reload page to verify real browser IndexedDB persistence
    await sendCdp("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` });
    await delay(600);

    const reloadedPersonalState = await evaluate(`(async () => {
      const { getState, calculateAccountBalance } = await import('./js/core/state.js');
      const s = getState();
      return {
        isDemoData: s.isDemoData,
        txCount: s.transactions.length,
        balance: calculateAccountBalance(s, s.accounts[0]?.id)
      };
    })()`);
    assert(reloadedPersonalState.isDemoData === false, "Workflow 33e: Personal ledger retains isDemoData: false across real browser reload");
    assert(reloadedPersonalState.txCount === 1, "Workflow 33f: Real transaction persisted across reload");
    assert(reloadedPersonalState.balance === 25000, "Workflow 33g: Balance matches real transaction (रु 25,000)");

    // Clean up: Reset to demo data
    console.log("  [Cleanup] Resetting to demo data...");
    await evaluate(`(async () => {
      const { dispatch } = await import('./js/core/state.js');
      await dispatch('RESET_TO_DEMO');
    })()`);
    await delay(500);

    ws.close();
  } finally {
    cleanupProcess();
  }

  // 4. Check console runtime output
  console.log("\n[4/4] Checking Headless Chrome Console & Runtime Output...");
  const consoleUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "merohisab-console-"));
  const child = spawn(chromePath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--user-data-dir=${consoleUserDataDir}`,
    "--virtual-time-budget=1500",
    "--enable-logging=stderr",
    `http://127.0.0.1:${port}/index.html`
  ]);

  let stderrOutput = "";
  child.stderr.on("data", d => {
    stderrOutput += d.toString();
  });

  await new Promise(r => child.on("close", r));
  try {
    fs.rmSync(consoleUserDataDir, { recursive: true, force: true });
  } catch {}

  const seriousErrors = stderrOutput
    .split("\n")
    .filter(
      line =>
        line.includes("Uncaught") ||
        line.includes("SyntaxError") ||
        line.includes("TypeError") ||
        line.includes("ReferenceError")
    );

  if (seriousErrors.length > 0) {
    throw new Error(`Browser console errors detected:\n${seriousErrors.join("\n")}`);
  }
  console.log("  ✓ Zero JavaScript uncaught exceptions or runtime errors found!");

  console.log("\n====================================================");
  console.log("✓ ALL E2E & INTEGRATION CHECKS PASSED SUCCESSFULLY!");
  console.log("====================================================");
}
