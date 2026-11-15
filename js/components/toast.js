/**
 * MeroHisab — Non-blocking Toast Notification Component
 * Strictly renders user and system messages using textContent and DOM construction
 * to guarantee 100% protection against Cross-Site Scripting (XSS).
 */

let container = null;

function ensureContainer() {
  if (!container) {
    container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }
  }
}

/**
 * Display a toast notification safely
 * @param {string} message - Message text
 * @param {"success"|"warning"|"error"|"info"} type - Notification type
 * @param {number} duration - Auto-dismiss duration in ms
 */
export function showToast(message, type = "info", duration = 3500) {
  ensureContainer();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "status");

  // Icon mapping
  let iconText = "ℹ️";
  if (type === "success") iconText = "✓";
  if (type === "warning") iconText = "⚠️";
  if (type === "error") iconText = "✕";

  const iconSpan = document.createElement("span");
  iconSpan.style.fontWeight = "bold";
  iconSpan.style.flexShrink = "0";
  iconSpan.textContent = iconText;

  const msgSpan = document.createElement("span");
  msgSpan.style.flex = "1";
  msgSpan.textContent = String(message ?? "");

  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);

  // Dismiss on click
  toast.addEventListener("click", () => {
    dismissToast(toast);
  });

  container.appendChild(toast);

  // Auto dismiss
  const timer = setTimeout(() => {
    dismissToast(toast);
  }, duration);

  toast._timer = timer;
}

function dismissToast(toast) {
  if (toast.classList.contains("hiding")) return;
  clearTimeout(toast._timer);
  toast.classList.add("hiding");
  setTimeout(() => {
    if (toast.parentElement) {
      toast.parentElement.removeChild(toast);
    }
  }, 200);
}
