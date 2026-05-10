/** Settings Page — account info, health check modal, OpenAPI viewer, about */
(() => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  window.SettingsPage = {
    formatAssignedSessionsSummary(assignedSessions) {
      if (!assignedSessions || assignedSessions.length === 0) {
        return "All sessions";
      }

      if (assignedSessions.length === 1) {
        return assignedSessions[0];
      }

      if (assignedSessions.length === 2) {
        return assignedSessions.join(", ");
      }

      return `${assignedSessions.length} sessions selected`;
    },

    async render() {
      const user = JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}");
      const role = user.role || "assistant";
      const roleSummary =
        {
          admin:
            "Full system control, user approval, session/webhook management, outbound messaging, and monitoring.",
          manager:
            "Operational role for handling chats and outbound communication, without system-level control.",
          assistant:
            "Reply-only role for existing inbound 1-on-1 conversations. No proactive outbound, no session changes.",
        }[role] || "Limited operational access.";

      document.getElementById("page-content").innerHTML = `
        <div class="card mb-2">
          <div class="card-header">
            <h3>Account</h3>
          </div>
          <table style="margin-bottom: 1rem">
            <tr><td class="text-muted" style="width:100px">Username</td><td><strong>${user.username || "—"}</strong></td></tr>
			<tr><td class="text-muted">Role</td><td><span class="badge ${user.role === "admin" ? "badge-success" : "badge-info"}">${(user.role || "assistant").toUpperCase()}</span></td></tr>
          </table>
          <button class="btn btn-outline btn-sm" id="btn-show-password-modal">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Change Password
          </button>
        </div>

		<div class="card mb-2">
		  <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem">
			<h3>Role Permissions</h3>
			${user.role === "admin" ? `<button class="btn btn-outline btn-sm" id="btn-show-users-modal"><span style="margin-right:0.35rem">👥</span>Users, Approvals & Roles</button>` : ""}
		  </div>
		  <div style="padding: 0 1rem 1rem">
			<p class="text-sm" style="margin-bottom:0.75rem"><strong>Your role:</strong> <span class="badge ${role === "admin" ? "badge-success" : role === "manager" ? "badge-info" : "badge-warning"}">${role.toUpperCase()}</span></p>
			<p class="text-muted text-sm" style="margin-bottom:0.8rem">${roleSummary}</p>
			<details style="border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-input)">
				<summary style="cursor:pointer;padding:0.7rem 0.85rem;font-size:0.86rem;font-weight:600;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:0.5rem">
					<span>Show full permission matrix</span>
					<span class="text-muted text-xs">Expand</span>
				</summary>
				<div class="table-wrapper" style="padding:0 0.75rem 0.75rem">
				  <table>
					<tr><th>Capability</th><th>Admin</th><th>Manager</th><th>Assistant</th></tr>
					<tr><td>Assigned sessions ACL</td><td>✅ All sessions</td><td>⚠️ Optional dashboard-only filter</td><td>⚠️ Optional dashboard-only filter</td></tr>
					<tr><td>View sessions</td><td>✅ Allowed</td><td>✅ Allowed</td><td>✅ Allowed</td></tr>
					<tr><td>Create / delete sessions</td><td>✅ Allowed</td><td>❌ Restricted</td><td>❌ Restricted</td></tr>
					<tr><td>Manage webhooks</td><td>✅ Allowed</td><td>❌ Restricted</td><td>❌ Restricted</td></tr>
					<tr><td>View chats / events</td><td>✅ Allowed</td><td>✅ Allowed</td><td>✅ Allowed</td></tr>
					<tr><td>Proactive outbound messaging</td><td>✅ Allowed</td><td>✅ Allowed</td><td>❌ Restricted</td></tr>
					<tr><td>Reply to inbound chats</td><td>✅ Allowed</td><td>✅ Allowed</td><td>✅ Allowed</td></tr>
					<tr><td>Assistant reply policy</td><td>✅ Not limited</td><td>✅ Not limited</td><td>⚠️ Limited: existing inbound 1-on-1 only</td></tr>
					<tr><td>Groups management</td><td>✅ Allowed</td><td>✅ Allowed</td><td>❌ Restricted</td></tr>
					<tr><td>User approval / role changes</td><td>✅ Allowed</td><td>❌ Restricted</td><td>❌ Restricted</td></tr>
				  </table>
				</div>
			</details>
		  </div>
		</div>

        <div class="card mb-2">
          <div class="card-header"><h3>Quick Actions</h3></div>
          <div class="flex gap-2" style="flex-wrap:wrap">
            <a href="/docs" target="_blank" class="btn btn-outline">📖 Swagger Docs</a>
						${user.role === "admin" ? `<button class="btn btn-outline" id="btn-health-check">💚 Health Check</button>` : ""}
            <button class="btn btn-outline" id="btn-openapi">📋 OpenAPI Spec</button>
          </div>
        </div>

        <div class="card mb-2" id="simulation-card">
          <div class="card-header"><h3>🤖 WA Web Behavior Simulation</h3></div>
          <div style="padding: 1rem"><div class="skeleton skeleton-text" style="width: 200px; height: 16px; margin-bottom: 8px;"></div><div class="skeleton skeleton-text" style="width: 150px; height: 16px;"></div></div>
        </div>

        <div class="card" id="about-card">
          <div class="card-header"><h3>About</h3></div>
          <div style="padding: 1rem;"><div class="skeleton skeleton-text" style="width: 200px; height: 16px; margin-bottom: 8px;"></div><div class="skeleton skeleton-text" style="width: 150px; height: 16px;"></div></div>
        </div>`;

      const healthBtn = document.getElementById("btn-health-check");
      if (healthBtn) {
        healthBtn.addEventListener("click", () => this.showHealthCheck());
      }
      document.getElementById("btn-openapi").addEventListener("click", () => this.showOpenAPI());

      // Password logic
      document
        .getElementById("btn-show-password-modal")
        .addEventListener("click", () => this.showChangePasswordModal());

      // Load simulation config & users (if admin)
      this.loadSimulationConfig();

      if (user.role === "admin") {
        const btnUsers = document.getElementById("btn-show-users-modal");
        if (btnUsers) btnUsers.addEventListener("click", () => this.showUsersModal());
      }

      try {
        const res = await fetch("/dashboard/api/about", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("wa-dashboard-token")}`,
          },
        });
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        const data = json.data;
        const aboutCard = document.getElementById("about-card");
        if (aboutCard) {
          const restricted = Boolean(data.infoRestricted);
          aboutCard.innerHTML = `
					  <div class="card-header"><h3>About</h3></div>
					  <table>
						<tr><td class="text-muted" style="width:100px">Project</td><td><strong>${data.project}</strong></td></tr>
						<tr><td class="text-muted">Version</td><td>${data.version}</td></tr>
						${restricted ? `<tr><td class="text-muted">System Details</td><td><span class="badge badge-warning">ADMIN ONLY</span></td></tr>` : `<tr><td class="text-muted">Engine</td><td><strong>${data.engine}</strong></td></tr>`}
						${restricted ? "" : `<tr><td class="text-muted">Runtime</td><td>${data.runtime}</td></tr>`}
					  </table>
					`;
        }
      } catch (_err) {
        const aboutCard = document.getElementById("about-card");
        if (aboutCard) {
          aboutCard.innerHTML = `
					  <div class="card-header"><h3>About</h3></div>
					  <table>
						<tr><td class="text-muted" style="width:100px">Project</td><td><strong>Baileys WA API</strong></td></tr>
						<tr><td class="text-muted">Version</td><td>v1.0.0</td></tr>
						<tr><td class="text-muted">Engine</td><td>Baileys 7.0.0-rc.9</td></tr>
						<tr><td class="text-muted">Runtime</td><td>Bun + Hono</td></tr>
					  </table>
					`;
        }
      }
    },

    /** Health Check — fetches /status and renders visual cards */
    async showHealthCheck() {
      Modal.show(
        "Health Check",
        '<div style="text-align:center;padding:2rem"><div class="skeleton skeleton-card w-full" style="height:120px"></div></div>',
      );

      try {
        const res = await fetch("/status");
        const json = await res.json();
        const d = json.data || json;

        const uptimeH = Math.floor((d.uptime || 0) / 3600);
        const uptimeM = Math.floor(((d.uptime || 0) % 3600) / 60);
        const uptimeS = Math.floor((d.uptime || 0) % 60);
        const uptimeStr =
          uptimeH > 0 ? `${uptimeH}h ${uptimeM}m ${uptimeS}s` : `${uptimeM}m ${uptimeS}s`;

        const statusColor = json.success !== false ? "var(--success)" : "var(--danger)";
        const statusIcon = json.success !== false ? "✓" : "✕";
        const statusText = json.success !== false ? "Healthy" : "Unhealthy";
        const projectName = d.name || "Baileys WA API";
        const projectVersion = d.version || "v1.0.0";

        document.getElementById("modal-body").innerHTML = `
          <div style="text-align:center;margin-bottom:1.25rem">
            <div style="width:56px;height:56px;border-radius:50%;background:${statusColor};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:1.5rem;margin-bottom:0.5rem">${statusIcon}</div>
            <h3 style="margin:0;color:${statusColor}">${statusText}</h3>
						<p class="text-muted text-sm">${projectName} ${projectVersion}</p>
          </div>

					<div class="stats-grid" style="grid-template-columns:1fr 1fr;gap:0.75rem">
						<div class="stat-card" style="padding:0.85rem">
              <div class="stat-icon green" style="width:36px;height:36px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div class="stat-info"><h4>Uptime</h4><div class="stat-value" style="font-size:1.1rem">${uptimeStr}</div></div>
            </div>
						<div class="stat-card" style="padding:0.85rem">
							<div class="stat-icon blue" style="width:36px;height:36px">
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/></svg>
							</div>
							<div class="stat-info">
								<h4>Sessions</h4>
								<div class="stat-value" style="font-size:0.98rem;line-height:1.4">
									<div><strong>${d.activeSessions ?? 0}</strong> active</div>
									<div><strong>${d.connectedSessions ?? 0}</strong> connected</div>
								</div>
							</div>
						</div>
          </div>

          <table style="margin-top:0.75rem">
			<tr><td class="text-muted" style="width:140px">Project</td><td><strong>${projectName}</strong></td></tr>
			<tr><td class="text-muted">Version</td><td>${projectVersion}</td></tr>
            <tr><td class="text-muted" style="width:140px">Environment</td><td><span class="badge badge-info">${(d.environment || "unknown").toUpperCase()}</span></td></tr>
            <tr><td class="text-muted">Redis</td><td><span class="badge ${d.redis === "connected" ? "badge-success" : "badge-warning"}">${(d.redis || "disabled").toUpperCase()}</span></td></tr>
            <tr><td class="text-muted">Description</td><td class="text-sm">${d.description || "—"}</td></tr>
          </table>
        `;
      } catch (err) {
        document.getElementById("modal-body").innerHTML = `
          <div style="text-align:center;padding:1.5rem">
            <div style="font-size:2rem;margin-bottom:0.5rem">⚠️</div>
            <p class="text-danger">Failed to reach health endpoint</p>
            <p class="text-muted text-sm">${err.message}</p>
          </div>`;
      }
    },

    /** OpenAPI Spec — fetches /openapi.json and renders formatted tree view */
    async showOpenAPI() {
      Modal.show(
        "OpenAPI Specification",
        '<div style="text-align:center;padding:2rem"><div class="skeleton skeleton-card w-full" style="height:120px"></div></div>',
      );

      try {
        const res = await fetch("/openapi.json");
        const spec = await res.json();

        const paths = Object.keys(spec.paths || {});
        const methods = {
          get: "badge-info",
          post: "badge-success",
          put: "badge-warning",
          delete: "badge-danger",
          patch: "badge-warning",
        };

        // Group paths by tag or first segment
        const grouped = {};
        for (const path of paths) {
          const ops = spec.paths[path];
          for (const [method, detail] of Object.entries(ops)) {
            if (!methods[method]) continue;
            const tag = detail.tags?.[0] || path.split("/")[1] || "other";
            if (!grouped[tag]) grouped[tag] = [];
            grouped[tag].push({
              method: method.toUpperCase(),
              path,
              summary: detail.summary || detail.operationId || "",
            });
          }
        }

        let html = `
          <div style="margin-bottom:1rem">
            <h4 style="margin:0">${spec.info?.title || "API"}</h4>
            <p class="text-muted text-sm">${spec.info?.description || ""} — v${spec.info?.version || "1.0.0"}</p>
          </div>
          <p class="text-sm text-muted mb-1">${paths.length} endpoints found</p>
        `;

        for (const [tag, endpoints] of Object.entries(grouped)) {
          html += `<div class="mb-1"><strong style="text-transform:capitalize;font-size:0.85rem">${tag.replace(/[_-]/g, " ")}</strong></div>`;
          html += `<div class="table-wrapper mb-2"><table>`;
          for (const ep of endpoints) {
            const color = methods[ep.method.toLowerCase()] || "badge-info";
            html += `<tr>
              <td style="width:70px"><span class="badge ${color}">${ep.method}</span></td>
              <td class="font-mono text-xs">${ep.path}</td>
              <td class="text-muted text-sm">${ep.summary}</td>
            </tr>`;
          }
          html += `</table></div>`;
        }

        html += `<div class="flex gap-1 mt-2">
          <a href="/docs" target="_blank" class="btn btn-primary btn-sm">Open Swagger UI</a>
          <a href="/openapi.json" target="_blank" class="btn btn-outline btn-sm">Download JSON</a>
        </div>`;

        document.getElementById("modal-body").innerHTML = html;

        // Allow the modal to be wider for the spec
        document.getElementById("modal").style.maxWidth = "700px";
      } catch (err) {
        document.getElementById("modal-body").innerHTML = `
          <div style="text-align:center;padding:1.5rem">
            <div style="font-size:2rem;margin-bottom:0.5rem">⚠️</div>
            <p class="text-danger">Failed to load OpenAPI spec</p>
            <p class="text-muted text-sm">${err.message}</p>
          </div>`;
      }
    },

    async loadSimulationConfig() {
      const card = document.getElementById("simulation-card");
      if (!card) return;

      try {
        const result = await window.API.get("/config/simulation");
        if (!result.success) throw new Error(result.message);

        const d = result.data;
        const badge = (val) =>
          val
            ? '<span class="badge badge-success">ON</span>'
            : '<span class="badge badge-warning">OFF</span>';

        card.innerHTML = `
				  <div class="card-header"><h3>🤖 WA Web Behavior Simulation</h3></div>
				  <table>
					<tr><td class="text-muted" style="width:200px">Auto-Typing Before Send</td><td>${badge(d.typingBeforeSend)}</td></tr>
					<tr><td class="text-muted">Typing Delay</td><td><strong>${d.typingDelayMinMs}ms</strong> – <strong>${d.typingDelayMaxMs}ms</strong> <span class="text-muted text-sm">(randomized)</span></td></tr>
					<tr><td class="text-muted">Auto-Read Messages</td><td>${badge(d.autoReadMessages)}</td></tr>
					<tr><td class="text-muted">Auto-Mark Online</td><td>${badge(d.autoMarkOnline)}</td></tr>
					<tr><td class="text-muted">Auto-Reject Calls</td><td>${badge(d.rejectCalls)}</td></tr>
				  </table>
				  <p class="text-muted text-sm" style="padding:0.75rem 1rem 0.75rem;margin:0"><span style="font-weight:bold; color:var(--warning)">*</span> Settings are configured via <code>.env</code> file. Restart the server after changes.</p>
				`;
      } catch (err) {
        card.innerHTML = `
				  <div class="card-header"><h3>🤖 WA Web Behavior Simulation</h3></div>
				  <div style="padding: 1.5rem; text-align: center;">
					<p class="text-danger" style="margin-bottom:0.5rem">Unable to load simulation config</p>
					<p class="text-muted text-sm">${err.message}</p>
				  </div>
				`;
      }
    },

    showChangePasswordModal() {
      const minLen = Number(window.__dashboardMinPasswordLength || 6);
      Modal.show(
        "Change Password",
        `
                <form id="modal-form-change-password">
                    <p class="text-muted text-sm mb-2">Update your account password. Must be at least ${minLen} characters.</p>
                    <div class="form-group">
                        <label for="current-password">Current Password</label>
                        <div class="input-password-wrapper">
                            <input type="password" id="current-password" required autocomplete="current-password">
                            <button type="button" class="password-toggle" data-target="current-password" title="Show password">
                            <svg class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            <svg class="eye-closed" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            </button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="new-password">New Password</label>
                        <div class="input-password-wrapper">
							<input type="password" id="new-password" required minlength="${minLen}" autocomplete="new-password">
                            <button type="button" class="password-toggle" data-target="new-password" title="Show password">
                            <svg class="eye-open" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            <svg class="eye-closed" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                            </button>
                        </div>
                    </div>
                    <div class="flex gap-1" style="margin-top:1.5rem">
                        <button type="submit" class="btn btn-primary" id="btn-submit-change">Update Password</button>
                        <button type="button" class="btn btn-outline" onclick="Modal.hide()">Cancel</button>
                    </div>
                </form>
            `,
      );

      if (window.initPasswordToggles)
        window.initPasswordToggles(document.getElementById("modal-body"));

      document.getElementById("modal-form-change-password").addEventListener("submit", (e) => {
        e.preventDefault();
        this.changePassword();
      });
    },

    async changePassword() {
      const currentPassword = document.getElementById("current-password").value;
      const newPassword = document.getElementById("new-password").value;
      const btn = document.getElementById("btn-submit-change");

      if (!currentPassword || !newPassword) return Toast.error("Missing fields");

      btn.disabled = true;
      btn.textContent = "Updating...";

      const res = await window.API.put("/auth/password", {
        currentPassword,
        newPassword,
      });

      btn.disabled = false;
      btn.textContent = "Update Password";

      if (res.success) {
        Toast.success("Password updated successfully");
        Modal.hide();
      } else {
        Toast.error(res.message);
      }
    },

    showUsersModal() {
      Modal.show(
        "Users, Approvals & Roles",
        `
                <p class="text-muted text-sm mb-2">Manage dashboard users, approve pending registrations, assign roles, and scope session access.</p>
                <div class="table-wrapper">
                    <table id="modal-users-table">
                        <tr><td style="text-align:center"><span class="loader" style="width:20px;height:20px;border-width:2px;display:inline-block"></span></td></tr>
                    </table>
                </div>
            `,
      );

      // Allow wider modal for table
      document.getElementById("modal").style.maxWidth = "700px";

      this.loadUsers();
    },

    async loadUsers() {
      const table = document.getElementById("modal-users-table");
      if (!table) return;

      const [usersRes, sessionsRes] = await Promise.all([
        window.API.get("/auth/users"),
        window.API.get("/sessions"),
      ]);

      if (!usersRes.success) {
        table.innerHTML = `<tr><td class="text-danger text-center">Failed to load users: ${usersRes.message}</td></tr>`;
        return;
      }

      const sessionIds = (sessionsRes.success ? sessionsRes.data : [])
        .map((session) => String(session.sessionId || ""))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));

      let html = `
                <tr>
                    <th>Username</th>
					<th>Status</th>
                    <th>Role</th>
					<th>Assigned Sessions</th>
                    <th>Joined</th>
                    <th style="width:100px;text-align:right">Actions</th>
                </tr>
            `;

      usersRes.data.forEach((u) => {
        const isCurrentUser =
          JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}").id === u.id;
        const date = new Date(u.createdAt).toLocaleDateString();
        const assignedSessions = Array.isArray(u.assignedSessions) ? u.assignedSessions : [];
        const assignedSummary = this.formatAssignedSessionsSummary(assignedSessions);
        const sessionSelector = sessionIds.length
          ? sessionIds
              .map((sessionId) => {
                const checked = assignedSessions.includes(sessionId) ? "checked" : "";
                return `
									<label style="display:flex;align-items:center;gap:0.45rem;padding:0.3rem 0;border-bottom:1px solid rgba(255,255,255,0.04)">
										<input type="checkbox" class="user-session-option" data-user-id="${u.id}" value="${escapeHtml(sessionId)}" ${checked} ${isCurrentUser ? "disabled" : ""}>
										<span class="text-sm" style="word-break:break-all">${escapeHtml(sessionId)}</span>
									</label>`;
              })
              .join("")
          : '<div class="text-muted text-xs" style="padding:0.35rem 0">No sessions yet. Empty assignment means future sessions remain visible.</div>';

        html += `
                <tr>
                    <td><strong>${u.username}</strong> ${isCurrentUser ? '<span class="text-muted text-xs ml-1">(You)</span>' : ""}</td>
					<td>
						${u.status === "pending" ? '<span class="badge badge-warning">PENDING</span>' : '<span class="badge badge-success">ACTIVE</span>'}
					</td>
                    <td>
                        <select class="user-role-select" data-id="${u.id}" ${isCurrentUser ? "disabled" : ""} style="padding:0.2rem;font-size:0.8rem;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--bg-input);color:var(--text-primary)">
							<option value="assistant" ${u.role === "assistant" ? "selected" : ""}>ASSISTANT</option>
							<option value="manager" ${u.role === "manager" ? "selected" : ""}>MANAGER</option>
                            <option value="admin" ${u.role === "admin" ? "selected" : ""}>ADMIN</option>
                        </select>
                    </td>
					<td>
						<details class="user-sessions-picker" data-id="${u.id}" style="position:relative">
							<summary style="cursor:${isCurrentUser ? "default" : "pointer"};list-style:none;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.4rem 0.55rem;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--bg-input);font-size:0.78rem;${isCurrentUser ? "opacity:0.7" : ""}">
								<span class="user-sessions-summary" data-id="${u.id}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(assignedSummary)}</span>
								<span class="text-muted">${isCurrentUser ? "Locked" : "Edit"}</span>
							</summary>
							<div style="position:absolute;z-index:20;top:calc(100% + 0.35rem);left:0;min-width:280px;max-width:360px;width:100%;padding:0.65rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);box-shadow:0 14px 32px rgba(0,0,0,0.22)">
								<p class="text-muted text-xs" style="margin:0 0 0.45rem 0">Empty selection means this user can access all sessions.</p>
								<div style="max-height:170px;overflow:auto;padding-right:0.2rem">${sessionSelector}</div>
								<div class="flex gap-1" style="margin-top:0.65rem;justify-content:flex-end">
									${isCurrentUser ? "" : `<button type="button" class="btn btn-outline btn-sm btn-user-sessions-all" data-id="${u.id}">Use All</button><button type="button" class="btn btn-primary btn-sm btn-user-sessions-save" data-id="${u.id}">Save</button>`}
								</div>
							</div>
						</details>
					</td>
                    <td class="text-muted">${date}</td>
                    <td style="text-align:right">
						${!isCurrentUser && u.status === "pending" ? `<button class="btn btn-outline btn-sm text-xs btn-approve-user" data-id="${u.id}" data-username="${u.username}" style="padding:0.2rem 0.6rem;margin-right:0.35rem">Approve</button>` : ""}
						${!isCurrentUser ? `<button class="btn btn-danger btn-sm text-xs btn-delete-user" data-id="${u.id}" data-username="${u.username}" style="padding:0.2rem 0.6rem">Delete</button>` : '<span class="text-muted text-xs">—</span>'}
                    </td>
                </tr>`;
      });

      table.innerHTML = html;

      table.querySelectorAll(".user-role-select").forEach((sel) => {
        sel.addEventListener("change", async (e) => {
          const id = e.target.dataset.id;
          const role = e.target.value;
          const res = await window.API.put(`/auth/users/${id}/role`, {
            role,
          });
          if (res.success) {
            Toast.success(`Role updated to ${role.toUpperCase()}`);

            // If they changed their own role somehow, reload the app (though UI disables it)
            const currentUserId = JSON.parse(localStorage.getItem("wa-dashboard-user") || "{}").id;
            if (currentUserId === id) {
              setTimeout(() => window.location.reload(), 1500);
            }
          } else {
            Toast.error(res.message);
            this.loadUsers(); // Revert on failure
          }
        });
      });

      table.querySelectorAll(".btn-delete-user").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const id = e.target.dataset.id;
          const username = e.target.dataset.username;

          if (confirm(`Are you sure you want to delete user @${username}?`)) {
            const res = await window.API.del(`/auth/users/${id}`);
            if (res.success) {
              Toast.success(`User @${username} deleted`);
              this.loadUsers();
            } else {
              Toast.error(res.message);
            }
          }
        });
      });

      table.querySelectorAll(".btn-approve-user").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const id = e.target.dataset.id;
          const username = e.target.dataset.username;
          const res = await window.API.put(`/auth/users/${id}/approve`, {});
          if (res.success) {
            Toast.success(`User @${username} approved`);
            this.loadUsers();
          } else {
            Toast.error(res.message);
          }
        });
      });

      table.querySelectorAll(".user-sessions-picker").forEach((picker) => {
        const summary = picker.querySelector(".user-sessions-summary");
        const saveButton = picker.querySelector(".btn-user-sessions-save");
        const allButton = picker.querySelector(".btn-user-sessions-all");
        const summaryElement = picker.querySelector("summary");

        const collectAssignedSessions = () =>
          Array.from(picker.querySelectorAll(".user-session-option:checked")).map(
            (input) => input.value,
          );

        if (!saveButton && summaryElement) {
          summaryElement.addEventListener("click", (event) => {
            event.preventDefault();
          });
        }

        if (saveButton) {
          saveButton.addEventListener("click", async () => {
            const id = saveButton.dataset.id;
            const assignedSessions = collectAssignedSessions();
            saveButton.disabled = true;
            saveButton.textContent = "Saving...";

            const res = await window.API.put(`/auth/users/${id}/sessions`, {
              assignedSessions,
            });

            saveButton.disabled = false;
            saveButton.textContent = "Save";

            if (res.success) {
              if (summary) {
                summary.textContent = this.formatAssignedSessionsSummary(assignedSessions);
              }
              picker.open = false;
              Toast.success("Assigned sessions updated");
            } else {
              Toast.error(res.message);
              this.loadUsers();
            }
          });
        }

        if (allButton) {
          allButton.addEventListener("click", () => {
            picker.querySelectorAll(".user-session-option").forEach((input) => {
              input.checked = false;
            });
          });
        }
      });
    },
  };
})();
