/** Sessions Page — list, create (QR/pairing), delete, reconnect */
(() => {
  let pollTimer = null;

  /** Escape dynamic values before they enter an HTML template. */
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function currentUser() {
    try {
      return JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}");
    } catch {
      return {};
    }
  }

  /** id → username for the owner column; refreshed with the session list. */
  let userNames = new Map();

  async function loadUserNames() {
    const result = await API.get("/auth/users").catch(() => null);
    const users = result?.data || [];
    userNames = new Map(users.map((u) => [String(u.id), String(u.username || u.id)]));
  }

  function ownerName(ownerId) {
    if (!ownerId) return "Unassigned";
    return userNames.get(String(ownerId)) || String(ownerId);
  }

  function can(capability) {
    return Boolean(window.App?.hasCapability?.(currentUser(), capability));
  }

  /**
   * Capability says "may delete sessions"; ownership says "this one". A manager
   * sees sessions assigned by an admin that they did not create, and those stay
   * out of reach. The server enforces the same rule, this only avoids offering a
   * button that would answer 403.
   */
  function canDeleteSession(session) {
    if (!can("deleteSessions")) return false;
    const user = currentUser();
    if (user.role === "admin") return true;
    const owner = String(session?.ownerId || "");
    return Boolean(owner) && owner === String(user.id || "");
  }

  window.SessionsPage = {
    async render() {
      const container = document.getElementById("page-content");
      UI.setHtml(
        container,
        `
        <div class="toolbar">
          ${can("createSessions") ? '<button class="btn btn-primary" id="btn-new-session">+ New Session</button>' : ""}
          <div class="toolbar-spacer"></div>
          <button class="btn btn-outline btn-sm" id="btn-refresh-sessions">↻ Refresh</button>
        </div>
        <div id="sessions-list"><div class="skeleton skeleton-card w-full u-h-200"></div></div>`,
      );

      document
        .getElementById("btn-new-session")
        ?.addEventListener("click", () => this.showNewSessionModal());
      document
        .getElementById("btn-refresh-sessions")
        .addEventListener("click", () => this.loadSessions());

      // Delegated row actions: no inline handlers, so CSP keeps script-src 'self'.
      document.getElementById("sessions-list").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) return;
        const sessionId = button.getAttribute("data-session-id");
        if (!sessionId) return;
        const action = button.getAttribute("data-action");
        if (action === "reconnect") this.reconnectSession(sessionId);
        else if (action === "pair") this.pairSession(sessionId);
        else if (action === "settings") this.showSettingsModal(sessionId);
        else if (action === "delete") this.deleteSession(sessionId);
      });

      this.loadSessions();
    },

    async loadSessions() {
      const result = await API.get("/sessions");
      const el = document.getElementById("sessions-list");
      if (!result.success) {
        UI.setHtml(el, '<p class="text-muted">Failed to load sessions</p>');
        return;
      }

      const sessions = result.data || [];
      const isAdmin = currentUser().role === "admin";
      if (isAdmin) await loadUserNames();
      if (sessions.length === 0) {
        UI.setHtml(
          el,
          `<div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/></svg>
          <h3>No Sessions</h3><p class="text-muted">Create a new session to connect your WhatsApp account</p>
        </div>`,
        );
        return;
      }

      UI.setHtml(
        el,
        `<div class="table-wrapper"><table>
        <thead><tr><th>Session ID</th><th>Status</th><th>Phone</th>${isAdmin ? "<th>Owner</th>" : ""}<th>Actions</th></tr></thead>
        <tbody>${sessions
          .map(
            (s) => `
          <tr>
            <td><strong>${escapeHtml(s.sessionId || s.id || "—")}</strong></td>
            <td>${
              s.connected
                ? '<span class="badge badge-success"><span class="badge-dot pulse"></span>CONNECTED</span>'
                : s.paired === false
                  ? '<span class="badge badge-warning"><span class="badge-dot"></span>NOT PAIRED</span>'
                  : '<span class="badge badge-danger"><span class="badge-dot"></span>DISCONNECTED</span>'
            }</td>
            <td class="text-muted">${escapeHtml(s.user?.id || s.phone || "—")}</td>
            ${isAdmin ? `<td class="text-muted">${escapeHtml(ownerName(s.ownerId))}</td>` : ""}
            <td class="flex gap-1">
              ${
                !s.connected && s.paired === false
                  ? `<button class="btn btn-primary btn-sm" data-action="pair" data-session-id="${escapeHtml(s.sessionId || s.id)}">Pair</button>`
                  : !s.connected && can("reconnectSessions")
                    ? `<button class="btn btn-outline btn-sm" data-action="reconnect" data-session-id="${escapeHtml(s.sessionId || s.id)}">Reconnect</button>`
                    : ""
              }
							<button class="btn btn-outline btn-sm" data-action="settings" data-session-id="${escapeHtml(s.sessionId || s.id)}">Settings</button>
              ${canDeleteSession(s) ? `<button class="btn btn-danger btn-sm" data-action="delete" data-session-id="${escapeHtml(s.sessionId || s.id)}">Delete</button>` : ""}
            </td>
          </tr>`,
          )
          .join("")}
        </tbody></table></div>`,
      );
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
            <label for="session-webhook">Webhook URL (Optional)</label>
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

          <button type="submit" class="btn btn-primary btn-full">Create Session</button>
        </form>
      `,
      );

      const pairingToggle = document.getElementById("session-pairing");

      pairingToggle.addEventListener("change", (e) => {
        document
          .getElementById("pairing-phone-group")
          .classList.toggle("hidden", !e.target.checked);
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

        const result = await API.post(`/sessions/${sessionId}`, body);
        if (result.success) {
          Toast.success("Session created");
          // Session-dependent menus appear as soon as a session exists.
          window.App?.refreshAvailability?.();
          // Show the new row now, before pairing finishes. The list is reloaded
          // again when the connection opens, and the QR/pairing modal is opened
          // afterwards so a re-render cannot interfere with it.
          await this.loadSessions();
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

    /** A session created but never scanned has no credentials; pair it now. */
    async pairSession(sessionId) {
      const result = await API.post(`/sessions/${sessionId}`, {});
      if (!result.success) {
        Toast.error(result.message || "Failed to start pairing");
        return;
      }
      await window.App?.refreshAvailability?.();
      if (result.data?.pairingCode) {
        this.showPairingCode(result.data.pairingCode);
        return;
      }
      this.showQR(sessionId);
      this.loadSessions();
    },

    async reconnectSession(sessionId) {
      const result = await API.post(`/sessions/${sessionId}/reconnect`, {});
      if (!result.success) {
        Toast.error(result.message || "Failed to reconnect session");
        return;
      }
      await window.App?.refreshAvailability?.();
      if (result.data?.pairingCode) {
        this.showPairingCode(result.data.pairingCode);
        return;
      }
      this.showQR(sessionId);
    },

    async showQR(sessionId, options = {}) {
      const freshAuthBadge = options.freshAuth
        ? '<div class="badge badge-info qr-fresh-auth-badge">FRESH AUTH ENABLED</div>'
        : "";
      Modal.show(
        `QR Code — ${escapeHtml(sessionId)}`,
        `
        <div class="qr-container">
          ${freshAuthBadge}
          <p class="qr-subtitle">QR Login Mode</p>
          <div class="badge badge-warning qr-status-chip" id="qr-status-chip">WAITING</div>
          <div id="qr-container-body">
            <div class="skeleton u-qr-box"></div>
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
          UI.setHtml(
            el,
            `<div class="u-fs-3rem">✓</div><p class="u-success-bold">Connected successfully!</p>`,
          );
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
          // Build the image through the DOM: assigning src as a property cannot
          // break out of the attribute, unlike interpolating it into HTML.
          const img = document.createElement("img");
          img.src = status.qrCode;
          img.alt = "QR Code";
          const hint = document.createElement("p");
          hint.textContent = "Scan this QR code with WhatsApp";
          el.replaceChildren(img, hint);
          return;
        }

        missingQrCount += 1;
        if (missingQrCount >= 5 || status.exists === false) {
          setQrStatus("EXPIRED", "badge-danger");
          UI.setHtml(
            el,
            `<div class="u-fs-2rem-mb-075">!</div><p>QR code is no longer available. Recreate the session to start a new login.</p>`,
          );
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
        `<p class="u-mb-15-center">Are you sure you want to delete session <strong>"${escapeHtml(sessionId)}"</strong>?<br><span class="u-danger-text">* This action cannot be undone.</span></p>`,
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
        window.App?.refreshAvailability?.();
        this.loadSessions();
      } else {
        Toast.error(result.message || "Failed to delete");
      }
    },

    async showSettingsModal(sessionId) {
      const result = await API.get("/sessions");
      const session = result.data?.find((s) => (s.sessionId || s.id) === sessionId);
      if (!session) return Toast.error("Session data not found");

      const secretHint = session.hasWebhookSecret
        ? `Configured (••••${session.webhookSecretLast4 || ""}) — leave blank to keep`
        : "Optional secret key";

      // Ownership and visibility are admin-only: they decide who reaches the
      // session, not how it behaves.
      const isAdmin = currentUser().role === "admin";
      const currentOwner = String(session.ownerId || "");
      let ownerSelect = "";
      let assigneeBlock = "";

      if (isAdmin) {
        const usersRes = await API.get("/auth/users").catch(() => null);
        const users = usersRes?.data || [];
        const byId = new Map(users.map((u) => [String(u.id), u]));

        // Only managers can be picked as owner. Admins reach every session anyway,
        // and an assistant has no delete rights to hand out.
        const managers = users.filter((u) => u.role === "manager");
        const ownerOptions = managers
          .map(
            (u) =>
              `<option value="${escapeHtml(u.id)}" ${u.id === currentOwner ? "selected" : ""}>${escapeHtml(u.username)}</option>`,
          )
          .join("");

        // Keep a stored owner that is not a manager (created by an admin, or an
        // account that was deleted) visible and unchanged unless the admin moves it.
        const currentUserRecord = currentOwner ? byId.get(currentOwner) : null;
        const ownerFallback =
          currentOwner && !managers.some((u) => u.id === currentOwner)
            ? `<option value="${escapeHtml(currentOwner)}" selected>${
                currentUserRecord
                  ? `${escapeHtml(currentUserRecord.username)} (${escapeHtml(currentUserRecord.role)}) — current`
                  : "Unknown user (deleted account)"
              }</option>`
            : "";

        ownerSelect = `
          <div class="form-group">
            <label for="update-owner">Session Owner</label>
            <select id="update-owner">
              <option value="" ${currentOwner ? "" : "selected"}>Unassigned (admins only)</option>
              ${ownerFallback}${ownerOptions}
            </select>
            <p class="text-xs text-muted">The owner always sees this session and can delete it. Without an owner, only admins reach it.</p>
          </div>`;

        const assigneesRes = await API.get(`/sessions/${sessionId}/assignees`).catch(() => null);
        const assigned = new Set((assigneesRes?.data?.userIds || []).map(String));

        // Admins always reach every session and the owner is edited above, so
        // neither belongs in this list. Assistants do: assignment is how they see
        // anything at all.
        const candidates = users.filter(
          (u) => u.role !== "admin" && String(u.id) !== currentOwner,
        );

        const rows = candidates
          .map(
            (u) => `<label class="assignee-row" data-search="${escapeHtml(
              `${u.username} ${u.role}`.toLowerCase(),
            )}">
              <input type="checkbox" class="update-assignee" value="${escapeHtml(u.id)}" ${assigned.has(String(u.id)) ? "checked" : ""} data-name="${escapeHtml(u.username)}" />
              <span class="assignee-name">${escapeHtml(u.username)}</span>
              <span class="assignee-role">${escapeHtml(u.role)}</span>
            </label>`,
          )
          .join("");

        assigneeBlock = `
          <div class="form-group">
            <div class="assignee-head">
              <label>Also Visible To</label>
              <button type="button" class="btn btn-outline btn-sm" id="assignee-toggle">Choose users</button>
            </div>
            <div class="assignee-summary" id="assignee-summary"></div>
            <div class="assignee-picker hidden" id="assignee-picker">
              <input type="search" id="assignee-search" placeholder="Search name or role" autocomplete="off" />
              <div class="assignee-list">${rows || '<p class="text-muted text-xs u-p-05">No other accounts to assign.</p>'}</div>
              <div class="assignee-actions">
                <button type="button" class="btn btn-outline btn-sm" id="assignee-all">Select all</button>
                <button type="button" class="btn btn-outline btn-sm" id="assignee-none">Clear</button>
                <span class="text-muted text-xs" id="assignee-count"></span>
              </div>
            </div>
            <p class="text-xs text-muted">These accounts can read the session but cannot delete it. Only the owner can.</p>
          </div>`;
      }

      Modal.show(
        `Update Settings — ${escapeHtml(sessionId)}`,
        `
        <form id="update-session-form">
          <div>
            <h4 class="u-fs-09-mb-1">Behaviour</h4>
            <label class="toggle-row">
              <input type="checkbox" id="update-autoread" class="toggle-input" ${session.autoReadMessages === true ? "checked" : ""} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-copy">
                <strong>Auto-Read Messages</strong>
                <small>Mark incoming chats as read, like opening them in WhatsApp Web.</small>
              </span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" id="update-autoonline" class="toggle-input" ${session.autoMarkOnline !== false ? "checked" : ""} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-copy">
                <strong>Auto-Mark Online</strong>
                <small>Appear online while replying. Presence still goes offline when idle.</small>
              </span>
            </label>
            <label class="toggle-row">
              <input type="checkbox" id="update-rejectcalls" class="toggle-input" ${session.rejectCalls === true ? "checked" : ""} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-copy">
                <strong>Auto-Reject Calls</strong>
                <small>Decline incoming calls automatically.</small>
              </span>
            </label>
          </div>

          <div class="u-section-divider"></div>

          ${ownerSelect}
          ${assigneeBlock}

          <div class="form-group">
            <label for="update-webhook">Webhook URL</label>
            <input type="url" id="update-webhook" placeholder="https://your-server.com/webhook" value="${escapeHtml(session.webhookUrl || "")}" />
          </div>
					<div class="form-group">
						<label for="update-secret">Webhook Secret Header</label>
						<div class="input-password-wrapper">
							<input type="password" id="update-secret" placeholder="${escapeHtml(secretHint)}" value="" autocomplete="off" />
							${window.passwordToggleHtml("update-secret")}
						</div>
					</div>

          <button type="submit" class="btn btn-primary btn-full">Save Settings</button>
        </form>
      `,
      );

      window.initPasswordToggles?.(document.getElementById("modal-body"));

      // Assignee picker: collapsed summary, searchable list, live count.
      const assigneePicker = document.getElementById("assignee-picker");
      const assigneeToggle = document.getElementById("assignee-toggle");
      const assigneeSummary = document.getElementById("assignee-summary");
      const assigneeInputs = () => [...document.querySelectorAll(".update-assignee")];

      const paintAssignees = () => {
        const picked = assigneeInputs().filter((el) => el.checked);
        const names = picked.map((el) => el.dataset.name || "?").sort();
        if (assigneeSummary) {
          assigneeSummary.innerHTML = names.length
            ? `${names
                .slice(0, 3)
                .map((name) => `<span class="assignee-chip">${escapeHtml(name)}</span>`)
                .join("")}${names.length > 3 ? `<span class="assignee-chip">+${names.length - 3}</span>` : ""}`
            : '<span class="text-muted text-xs">Nobody else</span>';
        }
        const count = document.getElementById("assignee-count");
        if (count) count.textContent = `${picked.length} selected`;
      };

      assigneeToggle?.addEventListener("click", () => {
        const open = !assigneePicker?.classList.contains("hidden");
        assigneePicker?.classList.toggle("hidden", open);
        assigneeToggle.textContent = open ? "Choose users" : "Done";
        document.getElementById("assignee-search")?.focus();
      });

      document.getElementById("assignee-search")?.addEventListener("input", (event) => {
        const query = String(event.target.value || "").toLowerCase().trim();
        document.querySelectorAll(".assignee-row").forEach((row) => {
          row.classList.toggle("hidden", query.length > 0 && !row.dataset.search?.includes(query));
        });
      });

      document.getElementById("assignee-all")?.addEventListener("click", () => {
        document.querySelectorAll(".assignee-row:not(.hidden) .update-assignee").forEach((el) => {
          el.checked = true;
        });
        paintAssignees();
      });

      document.getElementById("assignee-none")?.addEventListener("click", () => {
        assigneeInputs().forEach((el) => {
          el.checked = false;
        });
        paintAssignees();
      });

      assigneeInputs().forEach((el) => el.addEventListener("change", paintAssignees));
      paintAssignees();
      document.getElementById("update-session-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const ownerField = document.getElementById("update-owner");
        const body = {
          ...(ownerField ? { ownerId: ownerField.value } : {}),
          webhookUrl: document.getElementById("update-webhook").value.trim(),
          webhookSecret: document.getElementById("update-secret").value.trim(),
          autoReadMessages: Boolean(document.getElementById("update-autoread")?.checked),
          autoMarkOnline: Boolean(document.getElementById("update-autoonline")?.checked),
          rejectCalls: Boolean(document.getElementById("update-rejectcalls")?.checked),
        };

        const result = await API.patch(`/sessions/${sessionId}/settings`, body);
        if (result.success) {
          const assigneeInputs = [...document.querySelectorAll(".update-assignee")];
          if (assigneeInputs.length > 0) {
            const userIds = assigneeInputs.filter((el) => el.checked).map((el) => el.value);
            const assignResult = await API.put(`/sessions/${sessionId}/assignees`, { userIds });
            if (!assignResult.success) {
              Toast.error(assignResult.message || "Settings saved, but visibility was not");
            }
          }
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
