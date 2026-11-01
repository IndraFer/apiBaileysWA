/** REST API page: scoped API keys and the inbound request audit log. */
(() => {
  const state = {
    keys: [],
    logs: [],
    sessions: [],
    timer: null,
  };

  const esc = (value) => window.UI.escapeHtml(value);

  function scopeLabel(sessions) {
    if (!Array.isArray(sessions) || sessions.length === 0 || sessions.includes("*"))
      return "all sessions";
    return sessions.join(", ");
  }

  function statusBadge(status) {
    const tone =
      status >= 200 && status < 300
        ? "badge-success"
        : status >= 500
          ? "badge-danger"
          : "badge-warning";
    return `<span class="badge ${tone}">${esc(status)}</span>`;
  }

  function formatTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString();
  }

  async function loadSessions() {
    const result = await window.API.get("/sessions");
    state.sessions = (result.success ? result.data : []).map((session) =>
      String(session.sessionId),
    );
    const select = document.getElementById("key-sessions");
    if (!select) return;
    window.UI.setHtml(
      select,
      state.sessions.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join(""),
    );
  }

  async function loadKeys() {
    const table = document.getElementById("api-keys-table");
    if (!table) return;

    const result = await window.API.get("/api-keys");
    if (!result.success) {
      window.UI.setHtml(
        table,
        `<tr><td class="text-danger">${esc(result.message || "Failed to load keys")}</td></tr>`,
      );
      return;
    }

    state.keys = result.data || [];
    if (state.keys.length === 0) {
      window.UI.setHtml(
        table,
        `<tr><td class="text-muted">No API keys yet. Create one above for your widget or chatbot.</td></tr>`,
      );
      return;
    }

    const rows = state.keys
      .map(
        (key) => `
        <tr>
          <td><strong>${esc(key.label)}</strong><div class="text-muted text-xs font-mono">${esc(key.id)}</div></td>
          <td><span class="badge ${key.role === "admin" ? "badge-success" : "badge-info"}">${esc(key.role.toUpperCase())}</span></td>
          <td class="text-sm">${esc(scopeLabel(key.sessions))}</td>
          <td class="text-muted text-sm">${formatTime(key.createdAt)}</td>
          <td class="text-muted text-sm">${formatTime(key.lastUsedAt)}</td>
          <td class="u-text-right">
            <button class="btn btn-danger btn-sm" data-revoke-key="${esc(key.id)}">Revoke</button>
          </td>
        </tr>`,
      )
      .join("");

    window.UI.setHtml(
      table,
      `<tr><th>Label</th><th>Role</th><th>Scope</th><th>Created</th><th>Last used</th><th class="u-text-right">Actions</th></tr>${rows}`,
    );

    table.querySelectorAll("[data-revoke-key]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.revokeKey;
        if (!confirm(`Revoke API key ${id}? Requests using it will start failing immediately.`))
          return;
        const response = await window.API.del(`/api-keys/${id}`);
        if (response.success) {
          window.Toast.success("API key revoked");
          loadKeys();
        } else {
          window.Toast.error(response.message);
        }
      });
    });
  }

  async function loadLogs() {
    const table = document.getElementById("api-logs-table");
    if (!table) return;

    const params = new URLSearchParams({ limit: "100" });
    const session = document.getElementById("log-filter-session")?.value?.trim();
    const status = document.getElementById("log-filter-status")?.value;
    if (session) params.set("session", session);
    if (status) params.set("status", status);

    const result = await window.API.get(`/api-logs?${params.toString()}`);
    if (!result.success) {
      window.UI.setHtml(
        table,
        `<tr><td class="text-danger">${esc(result.message || "Failed to load log")}</td></tr>`,
      );
      return;
    }

    state.logs = result.data || [];
    if (state.logs.length === 0) {
      window.UI.setHtml(table, `<tr><td class="text-muted">No API calls recorded yet.</td></tr>`);
      return;
    }

    const rows = state.logs
      .map(
        (entry) => `
        <tr>
          <td class="text-muted text-xs">${formatTime(entry.timestamp)}</td>
          <td class="text-sm">${esc(entry.keyLabel || "—")}<div class="text-muted text-xs font-mono">${esc(entry.keyId || "")}</div></td>
          <td class="text-sm">${esc(entry.session || "—")}</td>
          <td class="text-sm font-mono">${esc(entry.receiver || "—")}</td>
          <td class="text-sm">${esc(entry.type || "—")}</td>
          <td>${statusBadge(entry.status)}</td>
          <td class="text-muted text-sm">${esc(entry.latencyMs)} ms</td>
          <td class="text-muted text-xs font-mono">${esc(entry.ip || "—")}</td>
        </tr>`,
      )
      .join("");

    window.UI.setHtml(
      table,
      `<tr><th>Time</th><th>Key</th><th>Session</th><th>Receiver</th><th>Type</th><th>Status</th><th>Latency</th><th>IP</th></tr>${rows}`,
    );
  }

  async function createKey() {
    const label = document.getElementById("key-label").value.trim();
    const role = document.getElementById("key-role").value;
    const selected = Array.from(document.getElementById("key-sessions").selectedOptions).map(
      (option) => option.value,
    );

    if (label.length < 2) {
      window.Toast.error("Label must be at least 2 characters");
      return;
    }

    const button = document.getElementById("btn-create-key");
    button.disabled = true;
    button.textContent = "Creating...";

    const result = await window.API.post("/api-keys", {
      label,
      role,
      sessions: selected.length > 0 ? selected : ["*"],
    });

    button.disabled = false;
    button.textContent = "Create key";

    if (!result.success) {
      window.Toast.error(result.message);
      return;
    }

    const token = result.data?.token || "";
    window.Modal.show(
      "API key created",
      `<p class="text-sm">Copy this token now. Only its hash is stored, so it cannot be shown again.</p>
       <pre class="webhook-ref-code" id="new-key-token"></pre>
       <div class="u-mt-075-end">
         <button class="btn btn-primary btn-sm" id="btn-copy-key">Copy token</button>
       </div>`,
    );

    const tokenElement = document.getElementById("new-key-token");
    if (tokenElement) tokenElement.textContent = token;
    document.getElementById("btn-copy-key")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(token);
        window.Toast.success("Token copied");
      } catch {
        window.Toast.error("Copy failed — select the token manually");
      }
    });

    document.getElementById("key-label").value = "";
    loadKeys();
  }

  window.ApiPage = {
    async render() {
      const container = document.getElementById("page-content");
      window.UI.setHtml(
        container,
        `
        <div class="page-header">
          <div>
            <h1>REST API</h1>
            <p class="text-muted">Send WhatsApp messages from widgets, chatbots and other services. Keys are scoped per session and every call is audited.</p>
          </div>
        </div>

        <div class="card">
          <h3 class="u-mt-0">Create API key</h3>
          <div class="u-grid-3-gap">
            <div class="form-group u-mb-0">
              <label for="key-label">Label</label>
              <input id="key-label" class="input" placeholder="chatbot-widget" autocomplete="off">
            </div>
            <div class="form-group u-mb-0">
              <label for="key-role">Role</label>
              <select id="key-role" class="input">
                <option value="user">USER</option>
                <option value="admin">ADMIN</option>
              </select>
            </div>
            <div class="form-group u-mb-0">
              <label for="key-sessions">Session scope</label>
              <select id="key-sessions" class="input" multiple size="3"></select>
            </div>
          </div>
          <div class="u-mt-075-between">
            <span class="text-muted text-xs">No selection means every session. Scope restricts which <code>from</code> values the key may use.</span>
            <button class="btn btn-primary btn-sm" id="btn-create-key">Create key</button>
          </div>
        </div>

        <div class="card">
          <div class="u-between-center u-mb-075">
            <h3 class="u-mt-0">Keys</h3>
            <button class="btn btn-outline btn-sm" id="btn-refresh-keys">Refresh</button>
          </div>
          <div class="table-wrapper"><table id="api-keys-table"></table></div>
        </div>

        <div class="card">
          <div class="u-between-center u-mb-075">
            <h3 class="u-mt-0">Request log</h3>
            <div class="flex gap-1">
              <input id="log-filter-session" class="input input-sm" placeholder="filter session">
              <select id="log-filter-status" class="input input-sm">
                <option value="">all status</option>
                <option value="200">200</option>
                <option value="400">400</option>
                <option value="403">403</option>
                <option value="404">404</option>
                <option value="409">409</option>
                <option value="500">500</option>
              </select>
              <button class="btn btn-outline btn-sm" id="btn-refresh-logs">Refresh</button>
            </div>
          </div>
          <div class="table-wrapper"><table id="api-logs-table"></table></div>
          <p class="text-muted text-xs u-mt-05">Bodies are not stored unless AUDIT_LOG_BODY=true; tokens never appear in the log.</p>
        </div>
      `,
      );

      document.getElementById("btn-create-key").addEventListener("click", createKey);
      document.getElementById("btn-refresh-keys").addEventListener("click", loadKeys);
      document.getElementById("btn-refresh-logs").addEventListener("click", loadLogs);
      document.getElementById("log-filter-status").addEventListener("change", loadLogs);

      let debounce = null;
      document.getElementById("log-filter-session").addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(loadLogs, 300);
      });

      await Promise.all([loadSessions(), loadKeys(), loadLogs()]);
      state.timer = setInterval(loadLogs, 15000);
    },

    destroy() {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
    },
  };
})();
