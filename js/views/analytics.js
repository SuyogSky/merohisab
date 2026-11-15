/**
 * MeroHisab — Analytics & Reports View
 * Comprehensive financial analytics with zero external libraries.
 * Features 4 high-DPI Canvas charts, period filtering (Monthly & Nepal FY),
 * category distribution tables, and Nepal payment method breakdowns.
 */

import { formatCurrency, formatNepaliNumber } from "../utils/formatters.js";
import { getAnalyticsData } from "../services/analytics.js";
import { renderGroupedBarChart, renderDonutChart, renderLineChart } from "../utils/canvas-charts.js";
import { PAYMENT_METHODS } from "../core/constants.js";
import { adToBs, getNepalFiscalYear, getCurrentDualDate } from "../utils/nepali-calendar.js";
import { toPaisaBigInt, fromPaisaBigInt } from "../utils/money.js";

// Keep active period in view state
let activePeriodType = "month";
let activePeriodValue = "2026-10";

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderAnalytics(container, state) {
  // Extract all available months and fiscal years from transactions
  const transactions = state.transactions || [];
  // Extract all available months from transactions
  const availableMonths = Array.from(
    new Set(transactions.map(t => t.dateAD.slice(0, 7)))
  ).sort().reverse();

  // Extract all unique fiscal years from actual transactions
  const availableFiscalYears = Array.from(
    new Set(
      transactions
        .map(t => {
          const bs = adToBs(t.dateAD);
          return bs ? getNepalFiscalYear(bs.year, bs.month) : null;
        })
        .filter(Boolean)
    )
  ).sort().reverse();

  // Ensure current fiscal year is present as option
  const currentDual = getCurrentDualDate();
  const currentBs = adToBs(currentDual.dateAD);
  const currentFy = currentBs ? getNepalFiscalYear(currentBs.year, currentBs.month) : "FY 2083/84";
  if (!availableFiscalYears.includes(currentFy)) {
    availableFiscalYears.unshift(currentFy);
  }

  if (activePeriodType === "month") {
    if (availableMonths.length > 0 && !availableMonths.includes(activePeriodValue)) {
      activePeriodValue = availableMonths[0];
    } else if (availableMonths.length === 0) {
      activePeriodValue = "2026-10";
    }
  } else {
    if (!availableFiscalYears.includes(activePeriodValue)) {
      activePeriodValue = availableFiscalYears[0] || currentFy;
    }
  }

  // Calculate analytics dataset
  const data = getAnalyticsData(state, activePeriodType, activePeriodValue);

  // Compute Payment Method Breakdown strictly for the selected period in exact integer Paisa
  const methodTotalsPaisa = {};
  for (const m of PAYMENT_METHODS) {
    methodTotalsPaisa[m.id] = 0n;
  }

  const periodTxs = data.periodTransactions || [];
  for (const t of periodTxs) {
    if (t.type === "expense" && t.paymentMethod) {
      methodTotalsPaisa[t.paymentMethod] = (methodTotalsPaisa[t.paymentMethod] || 0n) + toPaisaBigInt(t.amount);
    }
  }

  const totalExpPaisa = toPaisaBigInt(data.totalExpenses || 0);
  const paymentBreakdown = PAYMENT_METHODS.map(m => {
    const amtPaisa = methodTotalsPaisa[m.id] || 0n;
    const amt = fromPaisaBigInt(amtPaisa);
    const pct = totalExpPaisa > 0n ? Number((amtPaisa * 10000n) / totalExpPaisa) / 100 : 0;
    return {
      ...m,
      amount: amt,
      percentage: pct
    };
  }).filter(m => m.amount > 0);

  // Render HTML Shell
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: var(--space-6);">
      
      <!-- Top Analytics Filter & Period Controls -->
      <div class="content-card">
        <div class="content-card-body" style="padding: var(--space-4) var(--space-6);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-4);">
            <div style="display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap;">
              <span style="font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-secondary);">
                Reporting Period:
              </span>
              <div class="filter-pills" id="analytics-period-type-group">
                <button type="button" class="filter-pill ${activePeriodType === "month" ? "active" : ""}" data-type="month">
                  Monthly View
                </button>
                <button type="button" class="filter-pill ${activePeriodType === "fiscal_year" ? "active" : ""}" data-type="fiscal_year">
                  Nepal Fiscal Year
                </button>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: var(--space-3);">
              ${
                activePeriodType === "month"
                  ? `
                  <label for="analytics-month-select" class="sr-only">Select Month</label>
                  <select id="analytics-month-select" class="form-select" style="min-width: 160px; font-weight: var(--font-weight-semibold);">
                    ${
                      availableMonths.length > 0
                        ? availableMonths
                            .map(
                              m =>
                                `<option value="${m}" ${m === activePeriodValue ? "selected" : ""}>${m}</option>`
                            )
                            .join("")
                        : `<option value="2026-10" selected>2026-10</option>`
                    }
                  </select>
                `
                  : `
                  <label for="analytics-fy-select" class="sr-only">Select Fiscal Year</label>
                  <select id="analytics-fy-select" class="form-select" style="min-width: 160px; font-weight: var(--font-weight-semibold);">
                    ${availableFiscalYears
                      .map(
                        fy => `
                      <option value="${fy}" ${activePeriodValue === fy ? "selected" : ""}>
                        ${fy}${fy === currentFy ? " (Current)" : ""}
                      </option>
                    `
                      )
                      .join("")}
                  </select>
                `
              }
              <span class="badge badge-method" style="white-space: nowrap;">
                ${data.transactionCount} Transaction${data.transactionCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- KPI Summary Cards Grid -->
      <div class="kpi-grid">
        <!-- 1. Total Income -->
        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label">Total Inflow</span>
            <div class="kpi-icon icon-income">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </div>
          </div>
          <div class="kpi-value text-income">
            ${formatCurrency(data.totalIncome)}
          </div>
          <div class="kpi-meta">
            <span class="badge badge-safe">Verified Revenue</span>
            <span>Recorded in ${activePeriodValue}</span>
          </div>
        </div>

        <!-- 2. Total Expenses -->
        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label">Total Outflow</span>
            <div class="kpi-icon icon-expense">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
            </div>
          </div>
          <div class="kpi-value text-expense">
            ${formatCurrency(data.totalExpenses)}
          </div>
          <div class="kpi-meta">
            ${
              data.expenseChangePct !== null
                ? `
              <span class="badge ${data.expenseChangePct <= 0 ? "badge-safe" : "badge-exceeded"}">
                ${data.expenseChangePct >= 0 ? "+" : ""}${data.expenseChangePct.toFixed(1)}% vs Prev Month
              </span>
            `
                : `<span class="badge badge-method">Period Total</span>`
            }
            <span>All Categories</span>
          </div>
        </div>

        <!-- 3. Net Cash Flow -->
        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label">Net Cash Flow</span>
            <div class="kpi-icon ${data.netCashFlow >= 0 ? "icon-balance" : "icon-expense"}">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                <polyline points="17 6 23 6 23 12"></polyline>
              </svg>
            </div>
          </div>
          <div class="kpi-value ${data.netCashFlow >= 0 ? "text-income" : "text-expense"}">
            ${data.netCashFlow >= 0 ? "+" : ""}${formatCurrency(data.netCashFlow)}
          </div>
          <div class="kpi-meta">
            <span class="badge ${data.netCashFlow >= 0 ? "badge-safe" : "badge-exceeded"}">
              ${data.netCashFlow >= 0 ? "Net Surplus" : "Operating Deficit"}
            </span>
            <span>Inflow minus Outflow</span>
          </div>
        </div>

        <!-- 4. Savings Rate -->
        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label">Savings Velocity</span>
            <div class="kpi-icon icon-goal">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </div>
          </div>
          <div class="kpi-value text-accent">
            ${data.savingsRate.toFixed(1)}%
          </div>
          <div class="kpi-meta">
            <span class="badge ${data.savingsRate >= 30 ? "badge-safe" : data.savingsRate >= 15 ? "badge-warning" : "badge-exceeded"}">
              ${data.savingsRate >= 30 ? "Robust" : data.savingsRate >= 15 ? "Moderate" : "Conservative"}
            </span>
            <span>Proportion of Net Inflow</span>
          </div>
        </div>
      </div>

      <!-- 4 Native Canvas Charts Grid -->
      <div class="analytics-charts-grid">
        
        <!-- Chart 1: Monthly Income vs Expenses Comparison -->
        <div class="content-card">
          <div class="content-card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
              <span>Monthly Inflow vs Outflow</span>
            </div>
            <div style="display: flex; gap: var(--space-3); font-size: var(--font-size-xs);">
              <span style="display: flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 10px; height: 10px; background: #10b981; border-radius: 2px;"></span>
                Income
              </span>
              <span style="display: flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 10px; height: 10px; background: #f43f5e; border-radius: 2px;"></span>
                Expense
              </span>
            </div>
          </div>
          <div class="content-card-body" style="padding: var(--space-4);">
            <div class="chart-container" style="height: 260px;">
              <canvas id="analytics-bar-chart" width="450" height="260"></canvas>
            </div>
          </div>
        </div>

        <!-- Chart 2: Category Expense Breakdown Donut -->
        <div class="content-card">
          <div class="content-card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
                <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
              </svg>
              <span>Expense Distribution by Category</span>
            </div>
            <span class="badge badge-method">${data.categoryBreakdown.length} Categories</span>
          </div>
          <div class="content-card-body" style="padding: var(--space-4);">
            <div class="chart-container" style="height: 260px;">
              <canvas id="analytics-donut-chart" width="450" height="260"></canvas>
            </div>
          </div>
        </div>

        <!-- Chart 3: Net Cash Flow Trend Line -->
        <div class="content-card">
          <div class="content-card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
              <span>Net Cash Flow Trend Series</span>
            </div>
            <span class="badge badge-safe">Surplus / Deficit</span>
          </div>
          <div class="content-card-body" style="padding: var(--space-4);">
            <div class="chart-container" style="height: 260px;">
              <canvas id="analytics-net-trend-chart" width="450" height="260"></canvas>
            </div>
          </div>
        </div>

        <!-- Chart 4: Savings Velocity Trend -->
        <div class="content-card">
          <div class="content-card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 14 14"></polyline>
              </svg>
              <span>Savings Rate Velocity (%)</span>
            </div>
            <span class="badge badge-method">Target &ge; 30%</span>
          </div>
          <div class="content-card-body" style="padding: var(--space-4);">
            <div class="chart-container" style="height: 260px;">
              <canvas id="analytics-savings-trend-chart" width="450" height="260"></canvas>
            </div>
          </div>
        </div>

      </div>

      <!-- Category Detailed Breakdown Table -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
            <span>Category Spending Analysis (${activePeriodValue})</span>
          </div>
          ${
            data.highestExpenseCategory
              ? `
            <span class="badge badge-exceeded">
              Peak: ${data.highestExpenseCategory.label} (${data.highestExpenseCategory.percentage.toFixed(1)}%)
            </span>
          `
              : ""
          }
        </div>
        <div class="content-card-body" style="padding: 0;">
          ${
            data.categoryBreakdown.length === 0
              ? `
            <div class="empty-state" style="padding: var(--space-8);">
              <p>No expenses found for the selected reporting period.</p>
            </div>
          `
              : `
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th style="text-align: right;">Total Outflow</th>
                    <th style="text-align: right;">Share of Expenses</th>
                    <th style="width: 28%;">Spending Allocation</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.categoryBreakdown
                    .map(cat => {
                      const isHighest = data.highestExpenseCategory && data.highestExpenseCategory.id === cat.id;
                      const isLowest = data.lowestExpenseCategory && data.lowestExpenseCategory.id === cat.id;

                      return `
                      <tr>
                        <td>
                          <div style="display: flex; align-items: center; gap: var(--space-3);">
                            <span style="font-size: 1.25rem;">${cat.icon}</span>
                            <div>
                              <div style="font-weight: var(--font-weight-semibold); color: var(--text-primary);">
                                ${escapeHtml(cat.label)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style="text-align: right; font-weight: var(--font-weight-bold); font-family: var(--font-family-mono);">
                          ${formatCurrency(cat.amount)}
                        </td>
                        <td style="text-align: right; font-weight: var(--font-weight-semibold); color: var(--text-secondary);">
                          ${cat.percentage.toFixed(1)}%
                        </td>
                        <td>
                          <div class="progress-bar-wrap" style="height: 8px;">
                            <div class="progress-bar" style="width: ${Math.min(100, cat.percentage)}%; background-color: ${cat.color};"></div>
                          </div>
                        </td>
                        <td>
                          ${
                            isHighest
                              ? `<span class="badge badge-exceeded">Highest Outflow</span>`
                              : isLowest
                              ? `<span class="badge badge-safe">Lowest Outflow</span>`
                              : `<span class="badge badge-method">Regular</span>`
                          }
                        </td>
                      </tr>
                    `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          }
        </div>
      </div>

      <!-- Payment Method Distribution in Nepal -->
      <div class="content-card">
        <div class="content-card-header">
          <div class="card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
              <line x1="1" y1="10" x2="23" y2="10"></line>
            </svg>
            <span>Nepal Payment Channel Breakdown</span>
          </div>
          <span class="badge badge-method">eSewa, Fonepay, Bank & Cash</span>
        </div>
        <div class="content-card-body">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-4);">
            ${
              paymentBreakdown.length === 0
                ? `<p style="color: var(--text-muted); font-size: var(--font-size-sm);">No payment method data recorded for this period.</p>`
                : paymentBreakdown
                    .map(pm => {
                      return `
                  <div style="padding: var(--space-4); background-color: var(--bg-card-subtle); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2);">
                      <div style="font-weight: var(--font-weight-bold); font-size: var(--font-size-sm); color: var(--text-primary);">
                        ${escapeHtml(pm.label)}
                      </div>
                      <span class="badge badge-method">${pm.percentage.toFixed(1)}%</span>
                    </div>
                    <div style="font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); color: var(--color-expense); margin-bottom: var(--space-2);">
                      ${formatCurrency(pm.amount)}
                    </div>
                    <div class="progress-bar-wrap" style="height: 6px;">
                      <div class="progress-bar" style="width: ${pm.percentage}%; background-color: var(--color-accent);"></div>
                    </div>
                  </div>
                `;
                    })
                    .join("")
            }
          </div>
        </div>
      </div>

    </div>
  `;

  // Attach Event Listeners
  const periodPills = container.querySelectorAll("#analytics-period-type-group .filter-pill");
  periodPills.forEach(pill => {
    pill.addEventListener("click", () => {
      const type = pill.getAttribute("data-type");
      if (type !== activePeriodType) {
        activePeriodType = type;
        activePeriodValue = type === "month" ? (availableMonths[0] || "2026-10") : (availableFiscalYears[0] || currentFy);
        renderAnalytics(container, state);
      }
    });
  });

  const monthSelect = container.querySelector("#analytics-month-select");
  if (monthSelect) {
    monthSelect.addEventListener("change", (e) => {
      activePeriodValue = e.target.value;
      renderAnalytics(container, state);
    });
  }

  const fySelect = container.querySelector("#analytics-fy-select");
  if (fySelect) {
    fySelect.addEventListener("change", (e) => {
      activePeriodValue = e.target.value;
      renderAnalytics(container, state);
    });
  }

  // Render 4 Canvas Charts
  renderCharts(container, data);
}

/**
 * Render the 4 high-DPI Canvas charts
 */
function renderCharts(container, data) {
  // Chart 1: Grouped Bar Chart (Income vs Expense)
  const barCanvas = container.querySelector("#analytics-bar-chart");
  if (barCanvas) {
    const trends = data.monthlyTrends || [];
    const labels = trends.map(t => {
      // Format YYYY-MM into readable month abbreviation
      const parts = t.month.split("-");
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return monthNames[parseInt(parts[1], 10) - 1] || t.month;
    });

    renderGroupedBarChart(barCanvas, {
      labels: labels.length > 0 ? labels : ["Current"],
      series: [
        {
          name: "Income",
          color: "#10b981",
          data: trends.length > 0 ? trends.map(t => t.income) : [data.totalIncome]
        },
        {
          name: "Expense",
          color: "#f43f5e",
          data: trends.length > 0 ? trends.map(t => t.expense) : [data.totalExpenses]
        }
      ]
    });
  }

  // Chart 2: Donut Chart (Category Breakdown)
  const donutCanvas = container.querySelector("#analytics-donut-chart");
  if (donutCanvas) {
    const donutData = (data.categoryBreakdown || []).map(cat => ({
      label: cat.label,
      value: cat.amount,
      color: cat.color
    }));

    renderDonutChart(donutCanvas, {
      data: donutData
    });
  }

  // Chart 3: Net Cash Flow Trend Line
  const netTrendCanvas = container.querySelector("#analytics-net-trend-chart");
  if (netTrendCanvas) {
    const trends = data.monthlyTrends || [];
    const labels = trends.map(t => {
      const parts = t.month.split("-");
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return monthNames[parseInt(parts[1], 10) - 1] || t.month;
    });

    renderLineChart(netTrendCanvas, {
      labels: labels.length > 0 ? labels : ["Current"],
      series: [
        {
          name: "Net Cash Flow",
          data: trends.length > 0 ? trends.map(t => t.net) : [data.netCashFlow],
          color: "#0284c7",
          fill: true
        }
      ]
    });
  }

  // Chart 4: Savings Velocity Trend Line
  const savingsTrendCanvas = container.querySelector("#analytics-savings-trend-chart");
  if (savingsTrendCanvas) {
    const trends = data.monthlyTrends || [];
    const labels = trends.map(t => {
      const parts = t.month.split("-");
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return monthNames[parseInt(parts[1], 10) - 1] || t.month;
    });

    const rates = trends.map(t => {
      if (t.income > 0 && t.net > 0) {
        return (t.net / t.income) * 100;
      }
      return 0;
    });

    renderLineChart(savingsTrendCanvas, {
      labels: labels.length > 0 ? labels : ["Current"],
      isPercent: true,
      series: [
        {
          name: "Savings Rate (%)",
          data: rates.length > 0 ? rates : [data.savingsRate],
          color: "#10b981",
          fill: true
        }
      ]
    });
  }
}
