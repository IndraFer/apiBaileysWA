/** Modal Component — show, hide, confirm */
(function () {
	window.Modal = {
		show(title, bodyHtml) {
			document.getElementById("modal-title").textContent = title;
			document.getElementById("modal-body").innerHTML = bodyHtml;
			document.getElementById("modal-overlay").classList.remove("hidden");
		},
		hide() {
			document.getElementById("modal-overlay").classList.add("hidden");
			document.getElementById("modal").style.maxWidth = "";
		},

		/**
		 * Confirmation dialog — replaces native confirm()
		 * @param {string} title - Modal header text
		 * @param {string} message - Body message (supports HTML)
		 * @param {object} [opts] - Options
		 * @param {string} [opts.confirmText="Confirm"] - Confirm button label
		 * @param {string} [opts.cancelText="Cancel"] - Cancel button label
		 * @param {string} [opts.variant="danger"] - "danger" | "primary"
		 * @returns {Promise<boolean>}
		 */
		confirm(title, message, opts = {}) {
			const confirmText = opts.confirmText || "Confirm";
			const cancelText = opts.cancelText || "Cancel";
			const variant = opts.variant || "danger";

			return new Promise((resolve) => {
				this.show(
					title,
					`<p style="margin-bottom:1.5rem;color:var(--text-secondary)">${message}</p>
          <div class="flex gap-1" style="justify-content:flex-end">
            <button class="btn btn-outline" id="modal-cancel">${cancelText}</button>
            <button class="btn btn-${variant}" id="modal-confirm">${confirmText}</button>
          </div>`,
				);

				const cleanup = () => {
					this.hide();
					document
						.getElementById("modal-cancel")
						?.removeEventListener("click", onCancel);
					document
						.getElementById("modal-confirm")
						?.removeEventListener("click", onConfirm);
				};

				const onCancel = () => {
					cleanup();
					resolve(false);
				};
				const onConfirm = () => {
					cleanup();
					resolve(true);
				};

				document
					.getElementById("modal-cancel")
					.addEventListener("click", onCancel);
				document
					.getElementById("modal-confirm")
					.addEventListener("click", onConfirm);
			});
		},

		init() {
			document
				.getElementById("modal-close")
				.addEventListener("click", () => this.hide());
			document
				.getElementById("modal-overlay")
				.addEventListener("click", (e) => {
					if (e.target.id === "modal-overlay") this.hide();
				});
		},
	};
})();
