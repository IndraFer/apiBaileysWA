/** Sessions Page — list, create (QR/pairing), delete, reconnect */
(() => {
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
        el.innerHTML = '<p class="text-muted">Failed to load sessions</p>';
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
							<button class="btn btn-outline btn-sm" onclick="SessionsPage.showSettingsModal('${s.sessionId || s.id}')">Settings</button>
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
					<div class="form-group">
						<label class="checkbox-label"><input type="checkbox" id="session-fresh-auth" checked /> Fresh Auth (clear old auth state before create)</label>
					</div>
          <div class="form-group hidden" id="pairing-phone-group">
            <label for="session-phone">Phone Number</label>
            <input type="text" id="session-phone" placeholder="+6281234567890" />
          </div>

					<div style="margin: 1.5rem 0 1rem; padding-top: 1rem; border-top: 1px solid var(--border)">
						<h4 style="font-size: 0.9rem; margin-bottom: 1rem">Auto Reply Configuration</h4>
						<div class="form-group">
							<label class="checkbox-label"><input type="checkbox" id="session-autoreply-enabled" /> Enable Auto Reply for this session</label>
						</div>
						<div id="autoreply-settings" class="hidden" style="padding-left: 1rem; border-left: 2px solid var(--accent-soft); margin-bottom: 1rem">
							<div class="form-group">
								<label for="session-autoreply-type">Trigger Mode</label>
								<select id="session-autoreply-type">
									<option value="always">Always Reply</option>
									<option value="time_range">Outside Working Hours</option>
									<option value="on_webhook_fail">On Webhook Failure</option>
								</select>
							</div>
							<div id="autoreply-time-group" class="hidden" style="display:flex; gap:1rem; margin-bottom:1rem">
								<div style="flex:1">
									<label style="font-size:0.8rem">Start Time</label>
									<input type="time" id="session-autoreply-start" value="18:00" />
								</div>
								<div style="flex:1">
									<label style="font-size:0.8rem">End Time</label>
									<input type="time" id="session-autoreply-end" value="08:00" />
								</div>
							</div>
							<div class="form-group">
								<label for="session-autoreply-msg">Auto Reply Message</label>
								<textarea id="session-autoreply-msg" rows="3" placeholder="Hello, we're currently away..."></textarea>
							</div>
						</div>
					</div>

          <button type="submit" class="btn btn-primary btn-full">Create Session</button>
        </form>
      `,
      );

      const pairingToggle = document.getElementById("session-pairing");
      const autoReplyToggle = document.getElementById("session-autoreply-enabled");
      const autoReplyType = document.getElementById("session-autoreply-type");

      pairingToggle.addEventListener("change", (e) => {
        document
          .getElementById("pairing-phone-group")
          .classList.toggle("hidden", !e.target.checked);
      });

      autoReplyToggle.addEventListener("change", (e) => {
        document.getElementById("autoreply-settings").classList.toggle("hidden", !e.target.checked);
      });

      autoReplyType.addEventListener("change", (e) => {
        const timeGroup = document.getElementById("autoreply-time-group");
        if (e.target.value === "time_range") {
          timeGroup.classList.remove("hidden");
          timeGroup.style.display = "flex";
        } else {
          timeGroup.classList.add("hidden");
          timeGroup.style.display = "none";
        }
      });

      document.getElementById("new-session-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const sessionId = document.getElementById("session-id").value.trim();
        if (!sessionId) return Toast.warning("Session ID is required");

        const body = {
          webhookUrl: document.getElementById("session-webhook").value.trim(),
          usePairingCode: pairingToggle.checked,
          freshAuth: document.getElementById("session-fresh-auth").checked,
          phoneNumber: document.getElementById("session-phone").value.trim(),
        };

        if (autoReplyToggle.checked) {
          body.autoReply = {
            enabled: true,
            type: autoReplyType.value,
            message: document.getElementById("session-autoreply-msg").value.trim() || "Halo!",
            timeStart: document.getElementById("session-autoreply-start").value,
            timeEnd: document.getElementById("session-autoreply-end").value,
          };
        }

        const result = await API.post(`/sessions/${sessionId}`, body);
        if (result.success) {
          Toast.success("Session created");
          if (result.data?.pairingCode) this.showPairingCode(result.data.pairingCode);
          else
            this.showQR(sessionId, {
              freshAuth: body.freshAuth,
            });
        } else {
          Toast.error(result.message || "Failed to create session");
        }
      });
    },

    async showQR(sessionId, options = {}) {
      const freshAuthBadge = options.freshAuth
        ? '<div class="badge badge-info qr-fresh-auth-badge">FRESH AUTH ENABLED</div>'
        : "";
      Modal.show(
        `QR Code — ${sessionId}`,
        `
        <div class="qr-container">
          ${freshAuthBadge}
          <p class="qr-subtitle">QR Login Mode</p>
          <div class="badge badge-warning qr-status-chip" id="qr-status-chip">WAITING</div>
          <div id="qr-container-body">
            <div class="skeleton" style="width:260px;height:260px;margin:0 auto"></div>
            <p>Waiting for QR code...</p>
          </div>
        </div>
      `,
      );
      this.pollQR(sessionId);
    },

    async pollQR(sessionId) {
      if (pollTimer) clearInterval(pollTimer);
      let missingQrCount = 0;

      const setQrStatus = (label, tone) => {
        const chip = document.getElementById("qr-status-chip");
        if (!chip) return;
        chip.className = `badge qr-status-chip ${tone}`;
        chip.textContent = label;
      };

      const update = async () => {
        const result = await API.get(`/sessions/${sessionId}`);
        if (!result.success) return;
        const status = result.data;
        const el = document.getElementById("qr-container-body");
        if (!el) {
          clearInterval(pollTimer);
          return;
        }

        if (status.connected) {
          clearInterval(pollTimer);
          setQrStatus("CONNECTED", "badge-success");
          el.innerHTML = `<div style="font-size:3rem;margin-bottom:1rem">✓</div><p style="color:var(--success);font-weight:600">Connected successfully!</p>`;
          Toast.success(`Session ${sessionId} connected!`);
          setTimeout(() => {
            Modal.hide();
            this.loadSessions();
          }, 1500);
          return;
        }
        if (status.qrCode) {
          missingQrCount = 0;
          setQrStatus("READY TO SCAN", "badge-info");
          el.innerHTML = `<img src="${status.qrCode}" alt="QR Code" /><p>Scan this QR code with WhatsApp</p>`;
          return;
        }

        missingQrCount += 1;
        if (missingQrCount >= 5 || status.exists === false) {
          setQrStatus("EXPIRED", "badge-danger");
          el.innerHTML = `<div style="font-size:2rem;margin-bottom:0.75rem">!</div><p>QR code is no longer available. Recreate the session to start a new login.</p>`;
          clearInterval(pollTimer);
          return;
        }

        setQrStatus("WAITING", "badge-warning");
      };
      await update();
      pollTimer = setInterval(update, 3000);
    },

    showPairingCode(code) {
      Modal.show(
        "Pairing Code",
        `
        <div class="qr-container">
          <p class="qr-subtitle">Pairing Code Login Mode</p>
          <div class="badge badge-info qr-status-chip">READY</div>
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

    async showSettingsModal(sessionId) {
      const result = await API.get("/sessions");
      const session = result.data?.find((s) => (s.sessionId || s.id) === sessionId);
      if (!session) return Toast.error("Session data not found");

      const ar = session.autoReply || {};

      Modal.show(
        `Update Settings — ${sessionId}`,
        `
        <form id="update-session-form">
          <div class="form-group">
            <label for="update-webhook">Webhook URL</label>
            <input type="url" id="update-webhook" placeholder="https://your-server.com/webhook" value="${session.webhookUrl || ""}" />
          </div>
					<div class="form-group">
						<label for="update-secret">Webhook Secret Header</label>
						<input type="text" id="update-secret" placeholder="Optional secret key" value="${session.webhookSecret || ""}" />
					</div>

					<div style="margin: 1.5rem 0 1rem; padding-top: 1rem; border-top: 1px solid var(--border)">
						<h4 style="font-size: 0.9rem; margin-bottom: 1rem">Auto Reply Configuration</h4>
						<div class="form-group">
							<label class="checkbox-label"><input type="checkbox" id="update-autoreply-enabled" ${ar.enabled ? "checked" : ""} /> Enable Auto Reply</label>
						</div>
						<div id="update-autoreply-settings" class="${ar.enabled ? "" : "hidden"}" style="padding-left: 1rem; border-left: 2px solid var(--accent-soft); margin-bottom: 1rem">
							<div class="form-group">
								<label for="update-autoreply-type">Trigger Mode</label>
								<select id="update-autoreply-type">
									<option value="always" ${ar.type === "always" ? "selected" : ""}>Always Reply</option>
									<option value="time_range" ${ar.type === "time_range" ? "selected" : ""}>Outside Working Hours</option>
									<option value="on_webhook_fail" ${ar.type === "on_webhook_fail" ? "selected" : ""}>On Webhook Failure</option>
								</select>
							</div>
							<div id="update-autoreply-time-group" class="${ar.type === "time_range" ? "" : "hidden"}" style="display:${ar.type === "time_range" ? "flex" : "none"}; gap:1rem; margin-bottom:1rem">
								<div style="flex:1">
									<label style="font-size:0.8rem">Start Time</label>
									<input type="time" id="update-autoreply-start" value="${ar.timeStart || "18:00"}" />
								</div>
								<div style="flex:1">
									<label style="font-size:0.8rem">End Time</label>
									<input type="time" id="update-autoreply-end" value="${ar.timeEnd || "08:00"}" />
								</div>
							</div>
							<div class="form-group">
								<label for="update-autoreply-msg">Auto Reply Message</label>
								<textarea id="update-autoreply-msg" rows="3" placeholder="Hello, we're currently away...">${ar.message || ""}</textarea>
							</div>
						</div>
					</div>

          <button type="submit" class="btn btn-primary btn-full">Save Settings</button>
        </form>
      `,
      );

      const autoReplyToggle = document.getElementById("update-autoreply-enabled");
      const autoReplyType = document.getElementById("update-autoreply-type");

      autoReplyToggle.addEventListener("change", (e) => {
        document
          .getElementById("update-autoreply-settings")
          .classList.toggle("hidden", !e.target.checked);
      });

      autoReplyType.addEventListener("change", (e) => {
        const timeGroup = document.getElementById("update-autoreply-time-group");
        if (e.target.value === "time_range") {
          timeGroup.classList.remove("hidden");
          timeGroup.style.display = "flex";
        } else {
          timeGroup.classList.add("hidden");
          timeGroup.style.display = "none";
        }
      });

      document.getElementById("update-session-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = {
          webhookUrl: document.getElementById("update-webhook").value.trim(),
          webhookSecret: document.getElementById("update-secret").value.trim(),
        };

        if (autoReplyToggle.checked) {
          body.autoReply = {
            enabled: true,
            type: autoReplyType.value,
            message:
              document.getElementById("update-autoreply-msg").value.trim() ||
              "Hello, we're currently away...",
            timeStart: document.getElementById("update-autoreply-start").value,
            timeEnd: document.getElementById("update-autoreply-end").value,
          };
        } else {
          body.autoReply = {
            enabled: false,
            message: "",
            type: "always",
          };
        }

        const result = await API.patch(`/sessions/${sessionId}/settings`, body);
        if (result.success) {
          Toast.success("Settings updated successfully");
          Modal.hide();
          this.loadSessions();
        } else {
          Toast.error(result.message || "Failed to update settings");
        }
      });
    },

    destroy() {
      if (pollTimer) clearInterval(pollTimer);
    },
  };
})();
