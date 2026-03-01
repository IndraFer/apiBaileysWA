/** Sessions Page — list, create (QR/pairing), delete, reconnect */
(function () {
	let pollTimer = null;

	window.SessionsPage = {
		async render() {
			const container = document.getElementById("page-content");
			container.innerHTML = `
        <div class="toolbar">
          <button class="btn btn-primary" id="btn-new-session">+ New Session</button>
          <div class="toolbar-spacer"></div>
          <button class="btn btn-outline btn-sm" id="btn-refresh-sessions">↻ Refresh</button>
        </div>
        <div id="sessions-list"><div class="skeleton skeleton-card w-full" style="height:200px"></div></div>`;

			document
				.getElementById("btn-new-session")
				.addEventListener("click", () => this.showNewSessionModal());
			document
				.getElementById("btn-refresh-sessions")
				.addEventListener("click", () => this.loadSessions());
			this.loadSessions();
		},

		async loadSessions() {
			const result = await API.get("/sessions");
			const el = document.getElementById("sessions-list");
			if (!result.success) {
				el.innerHTML =
					'<p class="text-muted">Failed to load sessions</p>';
				return;
			}

			const sessions = result.data || [];
			if (sessions.length === 0) {
				el.innerHTML = `<div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/></svg>
          <h3>No Sessions</h3><p class="text-muted">Create a new session to connect your WhatsApp account</p>
        </div>`;
				return;
			}

			el.innerHTML = `<div class="table-wrapper"><table>
        <thead><tr><th>Session ID</th><th>Status</th><th>Phone</th><th>Actions</th></tr></thead>
        <tbody>${sessions
			.map(
				(s) => `
          <tr>
            <td><strong>${s.sessionId || s.id || "—"}</strong></td>
            <td>${
				s.connected
					? '<span class="badge badge-success"><span class="badge-dot pulse"></span>CONNECTED</span>'
					: '<span class="badge badge-danger"><span class="badge-dot"></span>DISCONNECTED</span>'
			}</td>
            <td class="text-muted">${s.user?.id || s.phone || "—"}</td>
            <td class="flex gap-1">
              ${!s.connected ? `<button class="btn btn-outline btn-sm" onclick="SessionsPage.showQR('${s.sessionId || s.id}')">QR</button>` : ""}
              <button class="btn btn-danger btn-sm" onclick="SessionsPage.deleteSession('${s.sessionId || s.id}')">Delete</button>
            </td>
          </tr>`,
			)
			.join("")}
        </tbody></table></div>`;
		},

		showNewSessionModal() {
			Modal.show(
				"New Session",
				`
        <form id="new-session-form">
          <div class="form-group">
            <label for="session-id">Session ID</label>
            <input type="text" id="session-id" placeholder="e.g. my-phone" required />
          </div>
          <div class="form-group">
            <label for="session-webhook">Webhook URL (optional)</label>
            <input type="url" id="session-webhook" placeholder="https://your-server.com/webhook" />
          </div>
          <div class="form-group">
            <label class="checkbox-label"><input type="checkbox" id="session-pairing" /> Use Pairing Code (instead of QR)</label>
          </div>
          <div class="form-group hidden" id="pairing-phone-group">
            <label for="session-phone">Phone Number</label>
            <input type="text" id="session-phone" placeholder="+6281234567890" />
          </div>
          <button type="submit" class="btn btn-primary btn-full">Create Session</button>
        </form>
      `,
			);

			document
				.getElementById("session-pairing")
				.addEventListener("change", (e) => {
					document
						.getElementById("pairing-phone-group")
						.classList.toggle("hidden", !e.target.checked);
				});

			document
				.getElementById("new-session-form")
				.addEventListener("submit", async (e) => {
					e.preventDefault();
					const sessionId = document
						.getElementById("session-id")
						.value.trim();
					const webhookUrl = document
						.getElementById("session-webhook")
						.value.trim();
					const usePairingCode =
						document.getElementById("session-pairing").checked;
					const phoneNumber = document
						.getElementById("session-phone")
						.value.trim();

					if (!sessionId)
						return Toast.warning("Session ID is required");

					const body = { webhookUrl, usePairingCode };
					if (usePairingCode && phoneNumber)
						body.phoneNumber = phoneNumber;

					const result = await API.post(
						`/sessions/${sessionId}`,
						body,
					);

					if (result.success) {
						Toast.success("Session created");
						if (result.data?.pairingCode) {
							this.showPairingCode(result.data.pairingCode);
						} else {
							this.showQR(sessionId);
						}
					} else {
						Toast.error(
							result.message || "Failed to create session",
						);
					}
				});
		},

		async showQR(sessionId) {
			Modal.show(
				`QR Code — ${sessionId}`,
				`
        <div class="qr-container" id="qr-container">
          <div class="skeleton" style="width:260px;height:260px;margin:0 auto"></div>
          <p>Waiting for QR code...</p>
        </div>
      `,
			);
			this.pollQR(sessionId);
		},

		async pollQR(sessionId) {
			if (pollTimer) clearInterval(pollTimer);
			const update = async () => {
				const result = await API.get(`/sessions/${sessionId}`);
				if (!result.success) return;
				const status = result.data;
				const el = document.getElementById("qr-container");
				if (!el) {
					clearInterval(pollTimer);
					return;
				}

				if (status.connected) {
					clearInterval(pollTimer);
					el.innerHTML = `<div style="font-size:3rem;margin-bottom:1rem">✓</div><p style="color:var(--success);font-weight:600">Connected successfully!</p>`;
					Toast.success(`Session ${sessionId} connected!`);
					setTimeout(() => {
						Modal.hide();
						this.loadSessions();
					}, 1500);
					return;
				}
				if (status.qrCode) {
					el.innerHTML = `<img src="${status.qrCode}" alt="QR Code" /><p>Scan this QR code with WhatsApp</p>`;
				}
			};
			await update();
			pollTimer = setInterval(update, 3000);
		},

		showPairingCode(code) {
			Modal.show(
				"Pairing Code",
				`
        <div class="qr-container">
          <p class="pairing-code">${code}</p>
          <p>Enter this code in WhatsApp &gt; Linked Devices &gt; Link a Device</p>
        </div>
      `,
			);
		},

		async deleteSession(sessionId) {
			const confirmed = await Modal.confirm(
				"Delete Session",
				`<p style="margin-bottom:1.5rem; text-align:center">Are you sure you want to delete session <strong>"${sessionId}"</strong>?<br><span style="color:var(--danger)">* This action cannot be undone.</span></p>`,
				{
					confirmText: "Delete",
					cancelText: "Cancel",
					variant: "danger",
				},
			);
			if (!confirmed) return;
			const result = await API.del(`/sessions/${sessionId}`);
			if (result.success) {
				Toast.success("Session deleted");
				this.loadSessions();
			} else {
				Toast.error(result.message || "Failed to delete");
			}
		},

		destroy() {
			if (pollTimer) clearInterval(pollTimer);
		},
	};
})();
