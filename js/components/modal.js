/**
 * MeroHisab — Reusable Accessible Modal Component
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
      <h3 class="modal-title">${config.title}</h3>
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
        <button type="button" class="btn btn-primary modal-save-btn">${config.saveLabel || "Save Changes"}</button>
      </div>
    `
    }
  `;

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
  const saveBtn = modal.querySelector(".modal-save-btn");
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
    config.onOpen(modal.querySelector(".modal-body"));
  }

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add("active");
  });
}

/**
 * Close active modal
 */
export function closeModal() {
  if (!activeModal) return;
  activeModal.classList.remove("active");
  const toRemove = activeModal;
  activeModal = null;
  document.body.style.overflow = "";
  setTimeout(() => {
    if (toRemove && toRemove.parentElement) {
      toRemove.parentElement.removeChild(toRemove);
    }
  }, 200);
}
