/**
 * MeroHisab — Native HTML5 Canvas Chart Engine
 * Zero external dependencies. High-DPI scaling for vector-crisp lines and text.
 */

import { formatNepaliNumber } from "./formatters.js";

/**
 * Configure canvas for high-DPI displays (Retina/4K)
 */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.width || 400;
  const height = rect.height || canvas.height || 260;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, width, height, dpr };
}

/**
 * Render a Grouped Bar Chart (Income vs Expense)
 * @param {HTMLCanvasElement} canvas
 * @param {object} options
 */
export function renderGroupedBarChart(canvas, options) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);

  const labels = options.labels || [];
  const series = options.series || []; // [{ name, data: [], color }]
  if (labels.length === 0 || series.length === 0) {
    renderEmptyChart(ctx, width, height, "No financial data available for chart.");
    return;
  }

  // Find max value for Y-axis scale
  let maxVal = 0;
  for (const s of series) {
    for (const v of s.data) {
      if (v > maxVal) maxVal = v;
    }
  }
  if (maxVal === 0) {
    renderEmptyChart(ctx, width, height, options.emptyMessage || "No transactions recorded for this period.");
    return;
  }
  // Round maxVal up to pleasant step
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
  maxVal = Math.ceil(maxVal / magnitude) * magnitude;

  // Chart padding
  const padding = { top: 25, right: 20, bottom: 45, left: 65 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Read theme colors from CSS
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)";
  const textColor = isDark ? "#94a3b8" : "#64748b";

  // Draw Horizontal Gridlines and Y labels
  const gridSteps = 4;
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillStyle = textColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= gridSteps; i++) {
    const val = (maxVal / gridSteps) * i;
    const y = padding.top + chartH - (chartH / gridSteps) * i;

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.stroke();

    // Format Y value (e.g. 50k, 1L)
    let label = val >= 100000 ? `${(val / 100000).toFixed(1)}L` : val >= 1000 ? `${Math.round(val / 1000)}k` : String(val);
    if (val === 0) label = "0";
    ctx.fillText(`रु ${label}`, padding.left - 8, y);
  }

  // Draw Bars
  const numGroups = labels.length;
  const groupWidth = chartW / numGroups;
  const barWidth = Math.max(8, Math.min(26, (groupWidth * 0.65) / series.length));
  const seriesGap = 4;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let g = 0; g < numGroups; g++) {
    const groupCenterX = padding.left + g * groupWidth + groupWidth / 2;
    const groupTotalWidth = series.length * barWidth + (series.length - 1) * seriesGap;
    let startX = groupCenterX - groupTotalWidth / 2;

    for (let s = 0; s < series.length; s++) {
      const val = series[s].data[g] || 0;
      const barH = (val / maxVal) * chartH;
      const barY = padding.top + chartH - barH;

      ctx.fillStyle = series[s].color;
      // Rounded top of bar
      drawRoundedRect(ctx, startX, barY, barWidth, barH, 4);

      startX += barWidth + seriesGap;
    }

    // X-axis label
    ctx.fillStyle = textColor;
    ctx.fillText(labels[g], groupCenterX, padding.top + chartH + 10);
  }
}

/**
 * Render an interactive Donut Chart (Category Spending Breakdown)
 * @param {HTMLCanvasElement} canvas
 * @param {object} options
 */
export function renderDonutChart(canvas, options) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);

  const data = options.data || []; // [{ label, value, color }]
  const total = data.reduce((sum, d) => sum + d.value, 0);

  ctx.clearRect(0, 0, width, height);

  if (total === 0 || data.length === 0) {
    renderEmptyChart(ctx, width, height, "No expenses recorded for this period.");
    return;
  }

  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const textColor = isDark ? "#f8fafc" : "#0f172a";
  const subTextColor = isDark ? "#94a3b8" : "#64748b";

  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.min(centerX, centerY) - 20;
  const innerRadius = outerRadius * 0.62;

  let startAngle = -Math.PI / 2;

  for (const item of data) {
    const sliceAngle = (item.value / total) * (Math.PI * 2);
    const endAngle = startAngle + sliceAngle;

    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
    ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
    ctx.closePath();

    ctx.fillStyle = item.color;
    ctx.fill();

    // Subtle slice separator
    ctx.strokeStyle = isDark ? "#111c38" : "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    startAngle = endAngle;
  }

  // Center cutout text (Total)
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = "bold 15px -apple-system, sans-serif";
  ctx.fillStyle = textColor;
  ctx.fillText(`रु ${formatNepaliNumber(total, 0)}`, centerX, centerY - 6);

  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillStyle = subTextColor;
  ctx.fillText("Total Spent", centerX, centerY + 14);
}

/**
 * Render a Line / Area Trend Chart (Net Cash Flow trend, Savings velocity)
 * @param {HTMLCanvasElement} canvas
 * @param {object} options
 */
export function renderLineChart(canvas, options) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);

  const labels = options.labels || [];
  const series = options.series || []; // [{ name, data: [], color, fill: true }]
  if (labels.length === 0 || series.length === 0) {
    renderEmptyChart(ctx, width, height, "No data available for trend chart.");
    return;
  }

  // Find min and max values across all series
  let minVal = 0;
  let maxVal = 0;
  for (const s of series) {
    for (const v of s.data) {
      if (v > maxVal) maxVal = v;
      if (v < minVal) minVal = v;
    }
  }

  if (maxVal === 0 && minVal === 0) {
    renderEmptyChart(ctx, width, height, options.emptyMessage || "No trend data recorded for this period.");
    return;
  }

  // Add margin to top and bottom
  const valRange = maxVal - minVal || 100;
  const topVal = maxVal + valRange * 0.15;
  const bottomVal = minVal < 0 ? minVal - valRange * 0.15 : 0;
  const totalRange = topVal - bottomVal || 1;

  const padding = { top: 30, right: 25, bottom: 45, left: 65 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);

  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.06)";
  const textColor = isDark ? "#94a3b8" : "#64748b";

  // Draw Horizontal Gridlines & Y-axis labels
  const gridSteps = 4;
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillStyle = textColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= gridSteps; i++) {
    const val = bottomVal + (totalRange / gridSteps) * i;
    const y = padding.top + chartH - (chartH / gridSteps) * i;

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.stroke();

    let label = "";
    if (options.isPercent) {
      label = `${Math.round(val)}%`;
    } else {
      const absVal = Math.abs(val);
      const prefix = val < 0 ? "-" : "";
      if (absVal >= 100000) {
        label = `${prefix}रु ${(absVal / 100000).toFixed(1)}L`;
      } else if (absVal >= 1000) {
        label = `${prefix}रु ${Math.round(absVal / 1000)}k`;
      } else {
        label = `${prefix}रु ${Math.round(absVal)}`;
      }
    }
    ctx.fillText(label, padding.left - 8, y);
  }

  // Draw Zero Line if range spans negative & positive
  if (bottomVal < 0 && topVal > 0) {
    const zeroY = padding.top + chartH - ((0 - bottomVal) / totalRange) * chartH;
    ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(padding.left + chartW, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw Series Lines and Data Points
  const numPts = labels.length;
  const xStep = numPts > 1 ? chartW / (numPts - 1) : chartW / 2;

  series.forEach(s => {
    const pts = [];
    for (let i = 0; i < numPts; i++) {
      const val = s.data[i] !== undefined ? s.data[i] : 0;
      const x = padding.left + i * xStep;
      const y = padding.top + chartH - ((val - bottomVal) / totalRange) * chartH;
      pts.push({ x, y, val });
    }

    if (pts.length === 0) return;

    // Fill area under line if requested
    if (s.fill) {
      const zeroY = Math.min(
        padding.top + chartH,
        Math.max(padding.top, padding.top + chartH - ((0 - bottomVal) / totalRange) * chartH)
      );
      const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
      grad.addColorStop(0, s.color + "33");
      grad.addColorStop(1, s.color + "00");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, zeroY);
      for (const pt of pts) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.lineTo(pts[pts.length - 1].x, zeroY);
      ctx.closePath();
      ctx.fill();
    }

    // Draw Line
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();

    // Draw Points and Values
    pts.forEach(pt => {
      // Outer point
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Inner dot
      ctx.fillStyle = isDark ? "#0f172a" : "#ffffff";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
      ctx.fill();

      // Point label
      ctx.font = "bold 10px -apple-system, sans-serif";
      ctx.fillStyle = textColor;
      ctx.textAlign = "center";
      let valText = options.isPercent
        ? `${Math.round(pt.val)}%`
        : pt.val >= 1000
        ? `${Math.round(pt.val / 1000)}k`
        : `${pt.val}`;
      ctx.fillText(valText, pt.x, pt.y - 10);
    });
  });

  // Draw X-axis Labels
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < numPts; i++) {
    const x = padding.left + i * xStep;
    ctx.fillText(labels[i], x, padding.top + chartH + 10);
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  if (height <= 0) return;
  const r = Math.min(radius, width / 2, height);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function renderEmptyChart(ctx, width, height, message) {
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  ctx.clearRect(0, 0, width, height);
  ctx.font = "13px -apple-system, sans-serif";
  ctx.fillStyle = isDark ? "#64748b" : "#94a3b8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, width / 2, height / 2);
}
