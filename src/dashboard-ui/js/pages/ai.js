/** AI & Routing Page — per-number responder, model, instruction, knowledge tools, metrics */
(() => {
  const MODE_HINTS = {
    off: "Static auto-reply (AUTO_REPLY_*) answers instead of the AI.",
    window: "AI answers inside the window; the static rules apply outside it.",
    always: 'AI answers 24/7 ("full handle"). A human reply still pauses it.',
  };

  const ROUTE_BADGES = {
    ai: "badge-success",
    static: "badge-info",
    human: "badge-warning",
    paused: "badge-warning",
    failed: "badge-danger",
  };

  const state = { sessions: [], sessionId: "", config: null, metrics: null };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function minutes(ms) {
    return Math.round((Number(ms) || 0) / 60000);
  }

  async function fetchSessions() {
    const result = await API.get("/sessions");
    return result.success ? result.data || [] : [];
  }

  async function fetchConfig(sessionId) {
    const result = await API.get(`/sessions/${sessionId}/ai-config`);
    return result.success ? result.data : null;
  }

  async function fetchMetrics(sessionId) {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    const result = await API.get(`/ai/metrics${query}`);
    return result.success ? result.data : null;
  }

  function metricValue(value) {
    const number = Number(value) || 0;
    return number.toLocaleString();
  }

  window.AiPage = {
    async render() {
      const container = document.getElementById("page-content");
      const sessions = await fetchSessions();
      state.sessions = sessions;

      if (sessions.length === 0) {
        container.innerHTML = `<div class="empty-state"><p class="text-muted">No sessions yet. Create a session first.</p></div>`;
        return;
      }

      state.sessionId = state.sessionId || sessions[0].sessionId;
      // pi-lens-ignore: no-inner-html-js, ast-grep:no-inner-html-js -- all interpolated values pass through escapeHtml(); same convention as the other dashboard pages
      container.innerHTML = `
        <div class="toolbar">
          <div class="form-group" style="margin:0;min-width:220px">
            <select id="ai-session-select" class="input">
              ${sessions
                .map(
                  (session) =>
                    `<option value="${escapeHtml(session.sessionId)}" ${session.sessionId === state.sessionId ? "selected" : ""}>${escapeHtml(session.sessionId)}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="toolbar-spacer"></div>
          <button class="btn btn-outline btn-sm" id="ai-refresh">↻ Refresh</button>
          <button class="btn btn-primary btn-sm" id="ai-save">Save changes</button>
        </div>

        <div class="card">
          <div class="card-header"><h3>Responder</h3></div>
          <div class="form-group">
            <label for="ai-enabled">Enable AI for this number</label>
            <select id="ai-enabled" class="input">
              <option value="false">No — static auto-reply</option>
              <option value="true">Yes — AI agent</option>
            </select>
          </div>
          <div class="form-group">
            <label for="ai-mode">When may the AI answer?</label>
            <select id="ai-mode" class="input">
              <option value="off">Off (static only)</option>
              <option value="window">Inside the time window</option>
              <option value="always">Always (full handle)</option>
            </select>
            <small class="text-muted" id="ai-mode-hint"></small>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Time window</h3></div>
          <div class="flex gap-1" style="flex-wrap:wrap">
            <div class="form-group" style="min-width:120px">
              <label for="ai-window-start">Start</label>
              <input id="ai-window-start" class="input" placeholder="16:00" />
            </div>
            <div class="form-group" style="min-width:120px">
              <label for="ai-window-end">End</label>
              <input id="ai-window-end" class="input" placeholder="08:00" />
            </div>
            <div class="form-group" style="min-width:180px">
              <label for="ai-timezone">Timezone</label>
              <input id="ai-timezone" class="input" placeholder="Asia/Jakarta" />
            </div>
          </div>
          <div class="flex gap-1" style="flex-wrap:wrap">
            <div class="form-group" style="min-width:150px">
              <label for="ai-batch-idle">Idle before reply (sec)</label>
              <input id="ai-batch-idle" class="input" type="number" min="3" max="120" />
            </div>
            <div class="form-group" style="min-width:150px">
              <label for="ai-human-idle">Human pause (min)</label>
              <input id="ai-human-idle" class="input" type="number" min="1" max="1440" />
            </div>
            <div class="form-group" style="min-width:150px">
              <label for="ai-handoff-pause">Handoff pause (min)</label>
              <input id="ai-handoff-pause" class="input" type="number" min="1" max="1440" />
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Model &amp; credentials</h3></div>
          <div class="flex gap-1" style="flex-wrap:wrap">
            <div class="form-group" style="min-width:160px">
              <label for="ai-driver">Driver</label>
              <select id="ai-driver" class="input">
                <option value="openai">OpenAI-compatible</option>
                <option value="webhook">Webhook gateway</option>
              </select>
            </div>
            <div class="form-group" style="min-width:220px">
              <label for="ai-base-url">Base URL</label>
              <input id="ai-base-url" class="input" placeholder="https://openrouter.ai/api/v1" />
            </div>
            <div class="form-group" style="min-width:180px">
              <label for="ai-model">Model</label>
              <input id="ai-model" class="input" placeholder="openai/gpt-4o-mini" />
            </div>
          </div>
          <div class="flex gap-1" style="flex-wrap:wrap">
            <div class="form-group" style="min-width:120px">
              <label for="ai-temperature">Temperature</label>
              <input id="ai-temperature" class="input" type="number" step="0.1" min="0" max="2" />
            </div>
            <div class="form-group" style="min-width:120px">
              <label for="ai-max-tokens">Max tokens</label>
              <input id="ai-max-tokens" class="input" type="number" min="64" max="8192" />
            </div>
          </div>
          <div class="form-group">
            <label for="ai-credentials">Credentials (JSON, write-only)</label>
            <textarea id="ai-credentials" class="input" rows="3"
              placeholder='{"apiKey":"sk-...","endpoints":{"cek_anggota":{"headers":{"X-API-Key":"..."}}}}'></textarea>
            <small class="text-muted" id="ai-credentials-hint"></small>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>System instruction</h3></div>
          <div class="form-group">
            <textarea id="ai-instruction" class="input" rows="5"
              placeholder="Anda CS IKA UI. Jawab ramah, singkat, Bahasa Indonesia."></textarea>
            <small class="text-muted">Persona, tone, dan aturan eskalasi ke manusia.</small>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Knowledge endpoints</h3></div>
          <div class="form-group">
            <textarea id="ai-endpoints" class="input" rows="8"
              placeholder='[{"name":"cek_anggota","description":"Cek status anggota","method":"GET","url":"https://example.com/api/members/search","params":[{"name":"q","type":"string","description":"Nama atau nomor anggota","required":true}]}]'></textarea>
            <small class="text-muted">
              JSON array. Each endpoint declares its own params (name, type, enum, default,
              required, in: query|body|path). The URL must already be reachable by this server.
            </small>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Routing metrics</h3>
            <button class="btn btn-outline btn-sm" id="ai-reset-metrics">Reset</button>
          </div>
          <div id="ai-metrics"><div class="empty-state"><p class="text-muted">Loading…</p></div></div>
        </div>`;

      document.getElementById("ai-session-select").addEventListener("change", (event) => {
        state.sessionId = event.target.value;
        this.loadConfig();
        this.loadMetrics();
      });
      document.getElementById("ai-refresh").addEventListener("click", () => {
        this.loadConfig();
        this.loadMetrics();
      });
      document.getElementById("ai-save").addEventListener("click", () => this.save());
      document
        .getElementById("ai-reset-metrics")
        .addEventListener("click", () => this.resetMetrics());
      document.getElementById("ai-mode").addEventListener("change", (event) => {
        const hint = document.getElementById("ai-mode-hint");
        if (hint) hint.textContent = MODE_HINTS[event.target.value] || "";
      });

      await Promise.all([this.loadConfig(), this.loadMetrics()]);
    },

    async loadConfig() {
      if (!state.sessionId) return;
      const data = await fetchConfig(state.sessionId);
      if (!data) {
        Toast.error("Failed to load AI configuration");
        return;
      }
      state.config = data;
      const routing = data.routing || {};
      const ai = data.ai || {};

      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? "";
      };

      set("ai-enabled", String(Boolean(ai.enabled)));
      set("ai-mode", ai.mode || "window");
      set("ai-window-start", routing.aiWindowStart || "");
      set("ai-window-end", routing.aiWindowEnd || "");
      set("ai-timezone", routing.timezone || "");
      set("ai-batch-idle", Math.round((Number(routing.batchIdleMs) || 0) / 1000));
      set("ai-human-idle", minutes(routing.humanIdleMs));
      set("ai-handoff-pause", minutes(routing.handoffPauseMs));
      set("ai-driver", ai.driver || "openai");
      set("ai-base-url", ai.agentUrl || data.defaults?.agentUrl || "");
      set("ai-model", ai.model || "");
      set("ai-temperature", data.temperature ?? 0.4);
      set("ai-max-tokens", data.maxTokens ?? 800);
      set("ai-instruction", ai.systemInstruction || "");
      set("ai-endpoints", JSON.stringify(ai.ragEndpoints || [], null, 2));

      const credentials = document.getElementById("ai-credentials");
      if (credentials) credentials.value = "";
      const hint = document.getElementById("ai-credentials-hint");
      if (hint) {
        hint.textContent = ai.credentialsSet
          ? `Stored (${ai.credentialsEncrypted ? "encrypted" : "plaintext"}). Leave empty to keep it.`
          : "No credentials stored yet.";
      }

      const modeHint = document.getElementById("ai-mode-hint");
      if (modeHint) modeHint.textContent = MODE_HINTS[ai.mode || "window"] || "";
    },

    async save() {
      if (!state.sessionId) return;
      const value = (id) => document.getElementById(id)?.value?.trim() ?? "";

      let endpoints;
      try {
        endpoints = JSON.parse(value("ai-endpoints") || "[]");
      } catch {
        Toast.error("Knowledge endpoints must be valid JSON");
        return;
      }

      const credentialsJson = value("ai-credentials");
      if (credentialsJson) {
        try {
          JSON.parse(credentialsJson);
        } catch {
          Toast.error("Credentials must be valid JSON");
          return;
        }
      }

      const payload = {
        routing: {
          aiWindowStart: value("ai-window-start"),
          aiWindowEnd: value("ai-window-end"),
          timezone: value("ai-timezone"),
          batchIdleMs: Math.max(3, Number(value("ai-batch-idle")) || 20) * 1000,
          humanIdleMs: Math.max(1, Number(value("ai-human-idle")) || 15) * 60000,
          handoffPauseMs: Math.max(1, Number(value("ai-handoff-pause")) || 30) * 60000,
        },
        ai: {
          enabled: value("ai-enabled") === "true",
          mode: value("ai-mode"),
          driver: value("ai-driver"),
          model: value("ai-model"),
          baseUrl: value("ai-base-url"),
          temperature: Number(value("ai-temperature")) || 0.4,
          maxTokens: Number(value("ai-max-tokens")) || 800,
          systemInstruction: value("ai-instruction"),
          ragEndpoints: endpoints,
          ...(credentialsJson ? { credentialsJson } : {}),
        },
      };

      const result = await API.patch(`/sessions/${state.sessionId}/ai-config`, payload);
      if (!result.success) {
        Toast.error(result.message || "Failed to save AI configuration");
        return;
      }
      Toast.success("AI configuration saved");
      await this.loadConfig();
    },

    async loadMetrics() {
      const data = await fetchMetrics(state.sessionId);
      state.metrics = data;
      const target = document.getElementById("ai-metrics");
      if (!target) return;
      // pi-lens-ignore: no-inner-html-js, ast-grep:no-inner-html-js -- renderMetrics() escapes every dynamic value with escapeHtml()
      target.innerHTML = this.renderMetrics(data);
    },

    renderMetrics(metrics) {
      if (!metrics) {
        return '<div class="empty-state"><p class="text-muted">No metrics yet</p></div>';
      }
      const counters = metrics.counters || {};
      const latency = metrics.latency || {};
      const hourly = metrics.hourly || [];
      const recent = metrics.recent || [];

      const maxHour = Math.max(1, ...hourly.map((h) => (h.ai || 0) + (h.human || 0)));

      return `
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-info"><span class="text-muted text-xs">AI replies</span><strong>${metricValue(counters.aiReplies)}</strong></div></div>
          <div class="stat-card"><div class="stat-info"><span class="text-muted text-xs">Human handled</span><strong>${metricValue(counters.humanSkips)}</strong></div></div>
          <div class="stat-card"><div class="stat-info"><span class="text-muted text-xs">Static replies</span><strong>${metricValue(counters.staticReplies)}</strong></div></div>
          <div class="stat-card"><div class="stat-info"><span class="text-muted text-xs">Failures</span><strong>${metricValue(counters.failures)}</strong></div></div>
          <div class="stat-card"><div class="stat-info"><span class="text-muted text-xs">Tool calls</span><strong>${metricValue(counters.toolCalls)}</strong></div></div>
          <div class="stat-card"><div class="stat-info"><span class="text-muted text-xs">Avg latency</span><strong>${metricValue(latency.avgMs)} ms</strong></div></div>
          <div class="stat-card"><div class="stat-info"><span class="text-muted text-xs">Tokens in/out</span><strong>${metricValue(counters.tokensIn)} / ${metricValue(counters.tokensOut)}</strong></div></div>
        </div>
        <p class="text-muted text-xs" style="margin-top:8px">
          In-process counters since ${new Date(metrics.since).toLocaleString()} — they reset on restart.
        </p>

        <div class="card-header"><h3>Per hour</h3></div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Hour</th><th>AI</th><th>Human</th><th>Share</th></tr></thead>
          <tbody>${
            hourly
              .filter((bucket) => bucket.ai > 0 || bucket.human > 0)
              .map((bucket) => {
                const total = (bucket.ai || 0) + (bucket.human || 0);
                const width = Math.round((total / maxHour) * 100);
                return `<tr>
                <td class="font-mono text-xs">${String(bucket.hour).padStart(2, "0")}:00</td>
                <td>${metricValue(bucket.ai)}</td>
                <td>${metricValue(bucket.human)}</td>
                <td><span class="badge badge-info" style="width:${width}%">${total}</span></td>
              </tr>`;
              })
              .join("") || '<tr><td colspan="4" class="text-muted text-xs">No traffic yet</td></tr>'
          }
          </tbody></table></div>

        <div class="card-header"><h3>Recent decisions</h3></div>
        <div class="table-wrapper"><table>
          <thead><tr><th>Time</th><th>Route</th><th>Conversation</th><th>Reason</th><th>Latency</th></tr></thead>
          <tbody>${
            recent
              .slice(0, 25)
              .map(
                (entry) => `<tr>
                <td class="text-xs">${new Date(entry.at).toLocaleTimeString()}</td>
                <td><span class="badge ${ROUTE_BADGES[entry.route] || "badge-info"}">${escapeHtml(entry.route)}</span></td>
                <td class="font-mono text-xs">${escapeHtml(entry.conversationId)}</td>
                <td class="text-xs text-muted">${escapeHtml(entry.reason || "-")}</td>
                <td class="text-xs text-muted">${entry.latencyMs ? `${entry.latencyMs} ms` : "-"}</td>
              </tr>`,
              )
              .join("") ||
            '<tr><td colspan="5" class="text-muted text-xs">No decisions yet</td></tr>'
          }
          </tbody></table></div>`;
    },

    async resetMetrics() {
      const result = await API.post("/ai/metrics/reset", {});
      if (!result.success) {
        Toast.error(result.message || "Failed to reset metrics");
        return;
      }
      Toast.success("Metrics reset");
      await this.loadMetrics();
    },
  };
})();
