/**
 * MeroHisab — Reusable Accessible Modal Component
 * Hardened with safe textContent title injection against XSS.
 */

let activeModal = null;

/**
 * Open a generic modal dialog
 * @param {object} config
 * @param {string} config.title - Modal header title
 * @param {string} config.contentHtml - Inner form/body HTML
 * @param {string} [config.saveLabel="Save"] - Submit button label
 * @param {boolean} [config.hideFooter=false] - Whether to hide save/cancel buttons
 * @param {Function} [config.onSave] - Callback executed on submit: (modalBody) => boolean|Promise<boolean>
 * @param {Function} [config.onOpen] - Callback executed after modal is mounted
 */
export function openModal(config) {
  closeModal(); // Close any currently open modal

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "modal-dialog";

  modal.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title"></h3>
      <button class="modal-close-btn" aria-label="Close dialog">&times;</button>
    </div>
    <div class="modal-body">
      ${config.contentHtml}
    </div>
    ${
      config.hideFooter
        ? ""
        : `
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn btn-primary modal-save-btn"></button>
      </div>
    `
    }
  `;

  // Safely assign title and button labels via textContent
  const titleEl = modal.querySelector(".modal-title");
  if (titleEl) {
    titleEl.textContent = String(config.title || "");
  }

  const saveBtn = modal.querySelector(".modal-save-btn");
  if (saveBtn) {
    saveBtn.textContent = String(config.saveLabel || "Save Changes");
  }

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  activeModal = overlay;

  // Bind close buttons
  const closeBtn = modal.querySelector(".modal-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  const cancelBtn = modal.querySelector(".modal-cancel-btn");
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  // Click outside backdrop to close
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeModal();
  });

  // Escape key to close
  const escHandler = e => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  // Save handler
  if (saveBtn && config.onSave) {
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      const initialText = saveBtn.textContent;
      saveBtn.textContent = "Saving...";

      try {
        const modalBody = modal.querySelector(".modal-body");
        const shouldClose = await config.onSave(modalBody);
        if (shouldClose !== false) {
          closeModal();
        }
      } catch (err) {
        console.error("[Modal] Save error:", err);
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = initialText;
        }
      }
    });
  }

  // Trigger onOpen callback
  if (config.onOpen) {
    const modalBody = modal.querySelector(".modal-body");
    config.onOpen(modalBody);
  }

  // Focus trap / First input auto-focus
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
  raf(() => {
    overlay.classList.add("active");
    const firstInput = modal.querySelector("input, select, textarea");
    if (firstInput) firstInput.focus();
  });
}

/**
 * Close any active modal
 */
export function closeModal() {
  if (!activeModal) return;

  const overlay = activeModal;
  activeModal = null;

  overlay.classList.remove("active");
  document.body.style.overflow = "";

  setTimeout(() => {
    if (overlay.parentElement) {
      overlay.parentElement.removeChild(overlay);
    }
  }, 150);
}
