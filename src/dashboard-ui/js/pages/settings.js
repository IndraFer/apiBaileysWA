/** Settings Page — account info, health check modal, OpenAPI viewer, about */
(function () {
	window.SettingsPage = {
		async render() {
			const user = JSON.parse(
				localStorage.getItem("wa-dashboard-user") || "{}",
			);

			document.getElementById("page-content").innerHTML = `
        <div class="card mb-2">
          <div class="card-header"><h3>Account</h3></div>
          <table>
            <tr><td class="text-muted" style="width:100px">Username</td><td><strong>${user.username || "—"}</strong></td></tr>
            <tr><td class="text-muted">Role</td><td><span class="badge badge-info">${(user.role || "user").toUpperCase()}</span></td></tr>
          </table>
        </div>

        <div class="card mb-2">
          <div class="card-header"><h3>Quick Actions</h3></div>
          <div class="flex gap-2" style="flex-wrap:wrap">
            <a href="/docs" target="_blank" class="btn btn-outline">📖 Swagger Docs</a>
            <button class="btn btn-outline" id="btn-health-check">💚 Health Check</button>
            <button class="btn btn-outline" id="btn-openapi">📋 OpenAPI Spec</button>
          </div>
        </div>

        <div class="card" id="about-card">
          <div class="card-header"><h3>About</h3></div>
          <div style="padding: 1rem;"><div class="skeleton skeleton-text" style="width: 200px; height: 16px; margin-bottom: 8px;"></div><div class="skeleton skeleton-text" style="width: 150px; height: 16px;"></div></div>
        </div>`;

			document
				.getElementById("btn-health-check")
				.addEventListener("click", () => this.showHealthCheck());
			document
				.getElementById("btn-openapi")
				.addEventListener("click", () => this.showOpenAPI());

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
					aboutCard.innerHTML = `
					  <div class="card-header"><h3>About</h3></div>
					  <table>
						<tr><td class="text-muted" style="width:100px">Project</td><td><strong>${data.project}</strong></td></tr>
						<tr><td class="text-muted">Version</td><td>${data.version}</td></tr>
						<tr><td class="text-muted">Engine</td><td><strong>${data.engine}</strong></td></tr>
						<tr><td class="text-muted">Runtime</td><td>${data.runtime}</td></tr>
					  </table>
					`;
				}
			} catch (err) {
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
					uptimeH > 0
						? `${uptimeH}h ${uptimeM}m ${uptimeS}s`
						: `${uptimeM}m ${uptimeS}s`;

				const statusColor =
					json.success !== false ? "var(--success)" : "var(--danger)";
				const statusIcon = json.success !== false ? "✓" : "✕";
				const statusText =
					json.success !== false ? "Healthy" : "Unhealthy";

				document.getElementById("modal-body").innerHTML = `
          <div style="text-align:center;margin-bottom:1.25rem">
            <div style="width:56px;height:56px;border-radius:50%;background:${statusColor};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:1.5rem;margin-bottom:0.5rem">${statusIcon}</div>
            <h3 style="margin:0;color:${statusColor}">${statusText}</h3>
            <p class="text-muted text-sm">${d.name || "baileys-wa-api"} v${d.version || "1.0.0"}</p>
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
              <div class="stat-info"><h4>Sessions</h4><div class="stat-value" style="font-size:1.1rem">${d.activeSessions ?? 0} active / ${d.connectedSessions ?? 0} connected</div></div>
            </div>
          </div>

          <table style="margin-top:0.75rem">
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
						const tag =
							detail.tags?.[0] || path.split("/")[1] || "other";
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
						const color =
							methods[ep.method.toLowerCase()] || "badge-info";
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
	};
})();
