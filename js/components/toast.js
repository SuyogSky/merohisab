/**
 * MeroHisab — Non-blocking Toast Notification Component
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
 * Display a toast notification
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
  let iconHtml = "ℹ️";
  if (type === "success") iconHtml = "✓";
  if (type === "warning") iconHtml = "⚠️";
  if (type === "error") iconHtml = "✕";

  toast.innerHTML = `
    <span style="font-weight: bold; flex-shrink: 0;">${iconHtml}</span>
    <span style="flex: 1;">${message}</span>
  `;

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
