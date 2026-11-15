/**
 * MeroHisab — Confirmation Dialog Component
 * Replaces bare browser confirm() with an accessible, themed UI modal.
 * Uses strict textContent for title and message to completely prevent XSS.
 */

let activeDialog = null;

/**
 * Show a confirmation prompt dialog
 * @param {object} options
 * @param {string} options.title - Header title
 * @param {string} options.message - Explanation text
 * @param {string} [options.confirmLabel="Confirm"] - Confirm button label
 * @param {string} [options.cancelLabel="Cancel"] - Cancel button label
 * @param {boolean} [options.isDestructive=true] - Red/danger button style
 * @returns {Promise<boolean>} Resolves true if confirmed, false if cancelled
 */
export function showConfirmDialog(options) {
  return new Promise(resolve => {
    if (activeDialog) {
      document.body.removeChild(activeDialog);
      activeDialog = null;
    }

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog confirm-dialog";

    const btnClass = options.isDestructive ? "btn-danger" : "btn-primary";

    dialog.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title"></h3>
      </div>
      <div class="modal-body">
        <p class="confirm-message" style="font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.5;"></p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary confirm-cancel-btn"></button>
        <button type="button" class="btn ${btnClass} confirm-ok-btn"></button>
      </div>
    `;

    const titleEl = dialog.querySelector(".modal-title");
    if (titleEl) titleEl.textContent = String(options.title || "Confirmation Required");

    const msgEl = dialog.querySelector(".confirm-message");
    if (msgEl) msgEl.textContent = String(options.message || "");

    const cancelBtn = dialog.querySelector(".confirm-cancel-btn");
    if (cancelBtn) cancelBtn.textContent = String(options.cancelLabel || "Cancel");

    const okBtn = dialog.querySelector(".confirm-ok-btn");
    if (okBtn) okBtn.textContent = String(options.confirmLabel || "Confirm");

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    activeDialog = overlay;

    const cleanup = confirmed => {
      overlay.classList.remove("active");
      document.body.style.overflow = "";
      setTimeout(() => {
        if (overlay.parentElement) {
          overlay.parentElement.removeChild(overlay);
        }
        if (activeDialog === overlay) activeDialog = null;
        resolve(confirmed);
      }, 150);
    };

    cancelBtn.addEventListener("click", () => cleanup(false));
    okBtn.addEventListener("click", () => cleanup(true));

    overlay.addEventListener("click", e => {
      if (e.target === overlay) cleanup(false);
    });

    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
    raf(() => overlay.classList.add("active"));
  });
}
