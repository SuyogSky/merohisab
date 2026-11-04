/**
 * MeroHisab — Confirmation Dialog Component
 * Replaces bare browser confirm() with an accessible, themed UI modal.
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
        <h3 class="modal-title">${options.title || "Confirmation Required"}</h3>
      </div>
      <div class="modal-body">
        <p style="font-size: var(--font-size-sm); color: var(--text-secondary); line-height: 1.5;">
          ${options.message}
        </p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary confirm-cancel-btn">${options.cancelLabel || "Cancel"}</button>
        <button type="button" class="btn ${btnClass} confirm-ok-btn">${options.confirmLabel || "Confirm"}</button>
      </div>
    `;

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

    dialog.querySelector(".confirm-cancel-btn").addEventListener("click", () => cleanup(false));
    dialog.querySelector(".confirm-ok-btn").addEventListener("click", () => cleanup(true));

    overlay.addEventListener("click", e => {
      if (e.target === overlay) cleanup(false);
    });

    requestAnimationFrame(() => overlay.classList.add("active"));
  });
}
