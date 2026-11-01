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
    const select = document.getElementById("key-session");
    const button = document.getElementById("btn-create-key");
    if (button) button.disabled = state.sessions.length === 0;

    if (!select) return;
    if (state.sessions.length === 0) {
      window.UI.setHtml(select, '<option value="">No connected session</option>');
      return;
    }
    window.UI.setHtml(
      select,
      ['<option value="">Select a session…</option>']
        .concat(state.sessions.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`))
        .join(""),
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
          <td class="text-sm">${esc(scopeLabel(key.sessions))}</td>
          <td class="text-muted text-sm">${formatTime(key.createdAt)}</td>
          <td class="text-muted text-sm">${formatTime(key.lastUsedAt)}</td>
          <td class="u-text-right">
            <button class="btn btn-outline btn-sm btn-key-snippet" data-session="${esc(key.sessions?.[0] || "")}">Snippet</button>
            <button class="btn btn-danger btn-sm" data-revoke-key="${esc(key.id)}">Revoke</button>
          </td>
        </tr>`,
      )
      .join("");

    window.UI.setHtml(
      table,
      `<tr><th>Label</th><th>Session</th><th>Created</th><th>Last used</th><th class="u-text-right">Actions</th></tr>${rows}`,
    );

    table.querySelectorAll(".btn-key-snippet").forEach((button) => {
      button.addEventListener("click", () => openIntegrationSnippet(button.dataset.session));
    });

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
    const session = document.getElementById("key-session").value;

    if (label.length < 2) {
      window.Toast.error("Label must be at least 2 characters");
      return;
    }
    if (!session) {
      window.Toast.error("Select the session this key may send from");
      return;
    }

    const button = document.getElementById("btn-create-key");
    button.disabled = true;
    button.textContent = "Creating...";

    const result = await window.API.post("/api-keys", { label, session });

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

  /** Copy-paste blocks for a third-party chatbot tool configuration. */
  function openIntegrationSnippet(prefillFrom) {
    const endpoint = `${window.location.origin}/api/v1/messages`;
    const schema = {
      description:
        "Send a WhatsApp message from a connected session. Use text for plain messages, image/document with media.url, and location with latitude/longitude.",
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Session id (e.g. ROG8) or the phone number bound to it.",
        },
        receiver: {
          type: "string",
          description:
            "Recipient in international digits (e.g. 628123456789), a JID, or a group id ending with @g.us.",
        },
        type: {
          type: "string",
          enum: ["text", "image", "document", "location"],
          description: "Message kind. Defaults to text.",
        },
        messages: {
          type: "string",
          description: "Text body, or the caption for image and document.",
        },
        media: {
          type: "object",
          required: ["url"],
          description: "Required for image and document.",
          properties: {
            url: { type: "string", description: "Public file URL." },
            filename: { type: "string", description: "Displayed file name." },
            mimetype: { type: "string", description: "MIME type, e.g. application/pdf." },
          },
        },
        location: {
          type: "object",
          required: ["latitude", "longitude"],
          description: "Required for location.",
          properties: {
            latitude: { type: "number", description: "Decimal degrees." },
            longitude: { type: "number", description: "Decimal degrees." },
            name: { type: "string", description: "Place name." },
            address: { type: "string", description: "Street address." },
          },
        },
        isGroup: {
          type: "boolean",
          description: "Force group semantics when receiver is not an @g.us JID.",
        },
      },
      required: ["from", "receiver"],
    };
    const example = {
      from: prefillFrom || "ROG8",
      receiver: "628123456789",
      type: "text",
      messages: "Halo, ini pesan dari bot.",
    };

    const tool = {
      name: "send_whatsapp_message",
      description: schema.description,
      method: "POST",
      url: endpoint,
      headers: {
        Authorization: "Bearer <API_KEY>",
        "Content-Type": "application/json",
      },
      parameters: schema,
      example,
    };

    window.Modal.show(
      "Integration snippet",
      `<p class="text-sm text-muted">Copy each block into your chatbot's external tool configuration. Replace <code>&lt;API_KEY&gt;</code> with a key created below.</p>
       <h4>Method &amp; URL</h4>
       <pre class="webhook-ref-code" id="snippet-url"></pre>
       <div class="u-mb-05"><button class="btn btn-outline btn-sm" data-copy-snippet="snippet-url">Copy URL</button></div>
       <h4>Headers</h4>
       <pre class="webhook-ref-code" id="snippet-headers"></pre>
       <div class="u-mb-05"><button class="btn btn-outline btn-sm" data-copy-snippet="snippet-headers">Copy headers</button></div>
       <h4>JSON Schema (tool parameters)</h4>
       <pre class="webhook-ref-code" id="snippet-schema"></pre>
       <div class="u-mb-05"><button class="btn btn-outline btn-sm" data-copy-snippet="snippet-schema">Copy schema</button></div>
       <h4>Example body</h4>
       <pre class="webhook-ref-code" id="snippet-body"></pre>
       <div class="u-mb-05"><button class="btn btn-outline btn-sm" data-copy-snippet="snippet-body">Copy body</button></div>
       <h4>Full tool definition</h4>
       <pre class="webhook-ref-code" id="snippet-tool"></pre>
       <div>
         <button class="btn btn-outline btn-sm" data-copy-snippet="snippet-tool">Copy full JSON</button>
         <button class="btn btn-primary btn-sm" id="btn-download-tool">Download .json</button>
       </div>`,
    );

    const setText = (id, text) => {
      const element = document.getElementById(id);
      if (element) element.textContent = text;
    };
    setText("snippet-url", `POST ${endpoint}`);
    setText("snippet-headers", "Authorization: Bearer <API_KEY>\nContent-Type: application/json");
    setText("snippet-schema", JSON.stringify(schema, null, 2));
    setText("snippet-body", JSON.stringify(example, null, 2));
    setText("snippet-tool", JSON.stringify(tool, null, 2));

    document.getElementById("btn-download-tool")?.addEventListener("click", () => {
      const source = document.getElementById("snippet-tool");
      if (!source) return;
      const blob = new Blob([source.textContent || ""], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `whatsapp-tool${prefillFrom ? `-${prefillFrom}` : ""}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.Toast.success("Tool definition downloaded");
    });

    document.querySelectorAll("[data-copy-snippet]").forEach((button) => {
      button.addEventListener("click", async () => {
        const source = document.getElementById(button.dataset.copySnippet);
        if (!source) return;
        try {
          await navigator.clipboard.writeText(source.textContent || "");
          window.Toast.success("Copied");
        } catch {
          window.Toast.error("Copy failed — select the text manually");
        }
      });
    });
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
          <button class="btn btn-outline btn-sm" id="btn-integration">Integration snippet</button>
        </div>

        <div class="card">
          <h3 class="u-mt-0">Create API key</h3>
          <div class="u-grid-2-gap">
            <div class="form-group u-mb-0">
              <label for="key-label">Label</label>
              <input id="key-label" class="input" placeholder="chatbot-widget" autocomplete="off">
            </div>
            <div class="form-group u-mb-0">
              <label for="key-session">Session</label>
              <select id="key-session" class="input"></select>
            </div>
          </div>
          <div class="u-mt-075-between">
            <span class="text-muted text-xs">One key is bound to one session. Create a separate key per number you expose.</span>
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
      document
        .getElementById("btn-integration")
        .addEventListener("click", () => openIntegrationSnippet());
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
