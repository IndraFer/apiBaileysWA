/** Webhooks Page — per-session webhook URL and event selection */
(() => {
  const ALL_EVENTS = [
    "connection.update",
    "messages.upsert",
    "messages.update",
    "messages.delete",
    "messages.reaction",
    "message-receipt.update",
    "chats.upsert",
    "chats.update",
    "chats.delete",
    "contacts.upsert",
    "contacts.update",
    "groups.upsert",
    "groups.update",
    "group-participants.update",
    "presence.update",
    "blocklist.set",
    "blocklist.update",
    "messaging-history.set",
  ];

  const SAMPLE_EVENT_DATA = {
    "connection.update": {
      connection: "open",
      receivedPendingNotifications: true,
      isOnline: true,
    },
    "messages.upsert": {
      messages: [],
      type: "notify",
    },
    "presence.update": {
      id: "6281234567890@s.whatsapp.net",
      presences: {
        "6281234567890@s.whatsapp.net": {
          lastKnownPresence: "composing",
          lastSeen: 1700000000,
        },
      },
    },
    "chats.update": [
      {
        id: "6281234567890@s.whatsapp.net",
        unreadCount: 2,
        conversationTimestamp: 1700000000,
      },
    ],
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  let webhookSessions = [];
  let selectedWebhookSessionId = "";
  let selectedLogSessionId = "";

  function buildRealtimePayload(sessionId, eventName) {
    const fallbackData = {
      note: "Sample payload for this event is not explicitly defined yet.",
    };
    return {
      sessionId,
      event: eventName,
      data: SAMPLE_EVENT_DATA[eventName] || fallbackData,
      extra: {
        media: [
          {
            type: "image",
            mimeType: "image/jpeg",
            base64: "...",
          },
        ],
      },
    };
  }

  let pageListeners = null;

  window.WebhooksPage = {
    async render() {
      const sessions = await this.getSessions();
      webhookSessions = sessions;

      if (
        !selectedWebhookSessionId ||
        !sessions.some((entry) => (entry.sessionId || entry.id) === selectedWebhookSessionId)
      ) {
        selectedWebhookSessionId = sessions[0]?.sessionId || sessions[0]?.id || "";
      }

      const logs = await this.getWebhookLogs();
      const meta = await this.getWebhookMeta();
      const sampleSessionId = "YOUR_SESSION_ID";
      const defaultPreviewEvent = "messages.upsert";
      const sampleTestPayload = JSON.stringify(
        {
          type: "dashboard.webhook.test",
          sessionId: sampleSessionId,
          timestamp: 1700000000000,
          connected: true,
          user: null,
          source: "dashboard",
        },
        null,
        2,
      );

      UI.setHtml(
        document.getElementById("page-content"),
        `
        <div class="card mb-2">
          <div class="card-header"><h3>Where webhooks fit</h3></div>
          <p class="text-sm text-muted mb-2">
            Webhooks only <strong>deliver events</strong> to your endpoint — they never answer
            messages. Replies come from the responder chain:
          </p>
          <ol class="text-sm text-muted u-m0-pl-12">
            <li><strong>AI &amp; Routing</strong> — answers when enabled and eligible.</li>
            <li><strong>Static auto-reply</strong> (session settings) — primary when the AI is off
              or outside its window, fallback when the AI call fails.</li>
            <li><strong>Webhook</strong> — observes only; each payload carries a <code>routing</code>
              block so your endpoint knows the AI/static setup and can skip replying.</li>
          </ol>
        </div>

        <div class="card mb-2">
          <div class="card-header"><h3>Webhook Configuration</h3></div>
          <p class="text-sm text-muted mb-2">Configure webhook URL and event subscriptions per session.</p>
			  <div class="mb-2 u-p-0-0-05">
				<span class="badge ${meta?.signatureMode === "required" ? "badge-danger" : meta?.signatureMode === "optional" ? "badge-warning" : "badge-info"}">SIGNATURE: ${(meta?.signatureMode || "off").toUpperCase()}</span>
				<span class="text-muted text-xs u-ml-05">Auth fallback: ${(meta?.authFallback || []).join(" -> ") || "session webhook secret -> AUTH_GLOBAL_TOKEN"}</span>
			  </div>
          ${
            sessions.length === 0
              ? '<div class="empty-state"><p class="text-muted">No sessions available</p></div>'
              : `<div class="toolbar">
                   <div class="form-group mb-0 u-minw-200">
                     <label for="webhook-session-select">Session</label>
                     <select id="webhook-session-select" class="input">
                       ${sessions
                         .map((entry) => {
                           const id = entry.sessionId || entry.id;
                           return `<option value="${id}" ${
                             id === selectedWebhookSessionId ? "selected" : ""
                           }>${id}</option>`;
                         })
                         .join("")}
                     </select>
                   </div>
                 </div>
                 <div id="webhook-session-config"></div>`
          }
        </div>

					<div class="card mb-2 webhook-payload-reference">
						<div class="card-header">
							<h3>Payload Reference</h3>
							<button type="button" class="btn btn-outline btn-sm" id="payload-ref-toggle">Show Details</button>
						</div>
						<p class="text-sm text-muted mb-1">This reference is generated from the current backend payload structure for 3rd-party app mapping.</p>
						<div class="webhook-ref-summary text-xs">
							Schema: <span class="font-mono">sessionId</span>, <span class="font-mono">event</span>, <span class="font-mono">data</span>, <span class="font-mono">extra</span> (optional)
						</div>
						<div id="payload-ref-details" hidden>
							<div class="webhook-ref-grid">
							<div>
								<h4 class="text-sm">Headers</h4>
								<pre class="webhook-ref-code">Content-Type: application/json
x-webhook-secret: &lt;optional secret&gt;</pre>
								<p class="text-xs text-muted mt-1">The secret header is sent only when webhook secret is configured.</p>
							</div>
							<div>
								<h4 class="text-sm">Realtime Event Payload</h4>
								<div class="webhook-ref-toolbar">
									<label for="payload-event-select" class="text-xs text-muted">Event</label>
									<select id="payload-event-select" class="webhook-ref-select">
										${ALL_EVENTS.map((ev) => `<option value="${ev}" ${ev === defaultPreviewEvent ? "selected" : ""}>${ev}</option>`).join("")}
									</select>
								</div>
								<pre class="webhook-ref-code" id="payload-event-json"></pre>
								<p class="text-xs text-muted mt-1">The extra field is present only when media include mode is enabled.</p>
							</div>
							<div>
								<h4 class="text-sm">Dashboard Test Payload</h4>
								<pre class="webhook-ref-code">${escapeHtml(sampleTestPayload)}</pre>
							</div>
							</div>
							<p class="text-xs text-muted mt-1">The data field differs by event. Session-level filters decide which events are delivered.</p>
						</div>
					</div>

        <div class="card">
          <div class="card-header">
            <h3>Webhook Delivery Logs</h3>
            <div class="flex gap-1">
              <select id="webhook-log-session" class="input input-sm" title="Filter logs by session">
                <option value="">All sessions</option>
                ${sessions
                  .map((entry) => {
                    const id = entry.sessionId || entry.id;
                    return `<option value="${id}" ${
                      id === selectedLogSessionId ? "selected" : ""
                    }>${id}</option>`;
                  })
                  .join("")}
              </select>
              <button class="btn btn-outline btn-sm" id="btn-refresh-wh-logs">Refresh Logs</button>
              <button class="btn btn-danger btn-sm" id="btn-clear-wh-logs">Clear Logs</button>
            </div>
          </div>
          <div id="webhook-logs-container">${this.renderLogs(logs)}</div>
        </div>`,
      );

      document.getElementById("webhook-log-session")?.addEventListener("change", (event) => {
        selectedLogSessionId = event.target.value;
        this.refreshLogs();
      });
      document
        .getElementById("btn-refresh-wh-logs")
        .addEventListener("click", () => this.refreshLogs());
      document
        .getElementById("btn-clear-wh-logs")
        .addEventListener("click", () => this.clearLogs());
      const payloadRefToggle = document.getElementById("payload-ref-toggle");
      const payloadRefDetails = document.getElementById("payload-ref-details");
      const payloadEventSelect = document.getElementById("payload-event-select");
      const payloadEventJson = document.getElementById("payload-event-json");

      const renderRealtimePayload = (eventName) => {
        if (!payloadEventJson) return;
        const payload = buildRealtimePayload(sampleSessionId, eventName || defaultPreviewEvent);
        payloadEventJson.textContent = JSON.stringify(payload, null, 2);
      };

      renderRealtimePayload(defaultPreviewEvent);
      payloadEventSelect?.addEventListener("change", (event) => {
        renderRealtimePayload(event.target?.value || defaultPreviewEvent);
      });

      payloadRefToggle?.addEventListener("click", () => {
        if (!payloadRefDetails) return;
        const isHidden = payloadRefDetails.hasAttribute("hidden");
        if (isHidden) {
          payloadRefDetails.removeAttribute("hidden");
          payloadRefToggle.textContent = "Hide Details";
          return;
        }
        payloadRefDetails.setAttribute("hidden", "hidden");
        payloadRefToggle.textContent = "Show Details";
      });
      // Delegated handlers kept out of the markup so CSP can keep script-src 'self'.
      pageListeners?.abort();
      pageListeners = new AbortController();
      const pageContent = document.getElementById("page-content");
      pageContent.addEventListener(
        "submit",
        (event) => {
          const form = event.target.closest("form[data-session-id]");
          if (!form) return;
          event.preventDefault();
          this.saveWebhook(event, form.getAttribute("data-session-id"));
        },
        { signal: pageListeners.signal },
      );
      const sessionSelect = document.getElementById("webhook-session-select");
      if (sessionSelect) {
        sessionSelect.addEventListener("change", (event) => {
          selectedWebhookSessionId = event.target.value;
          this.renderWebhookConfig();
        });
        this.renderWebhookConfig();
      }

      pageContent.addEventListener(
        "click",
        (event) => {
          const toggle = event.target.closest("button[data-action='toggle-webhook-secret']");
          if (toggle) {
            const sessionId = toggle.getAttribute("data-session-id");
            const input = document.getElementById(`wh-secret-${sessionId}`);
            if (input) {
              const shouldShow = input.type === "password";
              input.type = shouldShow ? "text" : "password";
              toggle.textContent = shouldShow ? "Hide" : "Show";
            }
            return;
          }

          const button = event.target.closest("button[data-action='test-webhook']");
          if (!button) return;
          this.testWebhook(button.getAttribute("data-session-id"));
        },
        { signal: pageListeners.signal },
      );
    },

    renderWebhookConfig() {
      const container = document.getElementById("webhook-session-config");
      if (!container) return;

      const session = webhookSessions.find(
        (entry) => (entry.sessionId || entry.id) === selectedWebhookSessionId,
      );

      if (!session) {
        UI.setHtml(
          container,
          '<div class="empty-state"><p class="text-muted">Select a session to configure its webhook.</p></div>',
        );
        return;
      }

      UI.setHtml(container, this.renderSessionWebhook(session));
    },

    renderSessionWebhook(session) {
      const sid = session.sessionId || session.id;
      const selectedEvents =
        Array.isArray(session.webhookEvents) && session.webhookEvents.length > 0
          ? session.webhookEvents
          : ALL_EVENTS;
      return `
        <div class="card mb-1 u-bg-input">
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-1">
              <strong>${sid}</strong>
              ${
                session.connected
                  ? '<span class="badge badge-success"><span class="badge-dot pulse"></span>CONNECTED</span>'
                  : '<span class="badge badge-danger">OFFLINE</span>'
              }
            </div>
          </div>
		  <form id="wh-form-${sid}" data-session-id="${sid}">
            <div class="form-group">
              <label>Webhook URL</label>
              <input type="url" id="wh-url-${sid}" placeholder="https://your-server.com/webhook" value="${session.webhookUrl || ""}" />
            </div>
						<div class="form-group">
							<label>Webhook Secret</label>
							<div class="webhook-secret-input-wrap">
								<input type="password" id="wh-secret-${sid}" placeholder="Optional x-webhook-secret value" value="${session.webhookSecret || ""}" autocomplete="off" />
								<button type="button" class="btn btn-outline btn-sm webhook-secret-toggle" data-action="toggle-webhook-secret" data-session-id="${sid}">Show</button>
							</div>
						</div>
            <div class="form-group">
              <label>Events</label>
              <div class="checkbox-group">
                ${ALL_EVENTS.map(
                  (ev) => `
                  <label class="checkbox-item">
                    <input type="checkbox" value="${ev}" ${selectedEvents.includes(ev) ? "checked" : ""} /> ${ev}
                  </label>`,
                ).join("")}
              </div>
            </div>
            <div class="flex gap-1">
              <button type="submit" class="btn btn-primary btn-sm">Save Webhook</button>
              <button type="button" class="btn btn-outline btn-sm" data-action="test-webhook" data-session-id="${sid}">Test Connection</button>
            </div>
          </form>
        </div>`;
    },

    async saveWebhook(e, sessionId) {
      e.preventDefault();
      const webhookUrl = document.getElementById(`wh-url-${sessionId}`).value.trim();
      const webhookSecret = document.getElementById(`wh-secret-${sessionId}`).value.trim();
      const form = document.getElementById(`wh-form-${sessionId}`);
      const eventChecks = Array.from(
        form?.querySelectorAll('input[type="checkbox"]:checked') || [],
      ).map((el) => el.value);

      const result = await API.put(`/sessions/${sessionId}/webhook`, {
        webhookUrl,
        webhookSecret,
        events: eventChecks,
      });
      if (result.success) {
        Toast.success("Webhook updated");
        // The Events monitor only makes sense once a webhook exists.
        await window.App?.refreshAvailability?.();
      } else {
        Toast.error(result.message);
      }
    },

    async testWebhook(sessionId) {
      const webhookUrl = document.getElementById(`wh-url-${sessionId}`).value.trim();
      const webhookSecret = document.getElementById(`wh-secret-${sessionId}`).value.trim();
      const result = await API.post(`/sessions/${sessionId}/webhook/test`, {
        webhookUrl,
        webhookSecret,
      });
      if (result.success) {
        Toast.success("Webhook test success");
        await this.refreshLogs();
        return;
      }

      Toast.error(result.message || "Webhook test failed");
      await this.refreshLogs();
    },

    renderLogs(logs) {
      if (!Array.isArray(logs) || logs.length === 0) {
        return '<div class="empty-state"><p class="text-muted">No webhook logs yet</p></div>';
      }

      const formatStatusLabel = (status) => {
        switch (status) {
          case "success":
            return "SUCCESS";
          case "http-error":
            return "HTTP ERR";
          case "network-error":
            return "NETWORK";
          case "test-success":
            return "TEST OK";
          case "test-fail":
            return "TEST FAIL";
          case "skipped":
            return "SKIPPED";
          default:
            return String(status || "-").toUpperCase();
        }
      };

      return `<div class="table-wrapper"><table>
        <thead><tr><th>Time</th><th>Session</th><th>Event</th><th>Status</th><th>Latency</th><th>Info</th></tr></thead>
        <tbody>${logs
          .map((log) => {
            const statusClass =
              log.status === "success" || log.status === "test-success"
                ? "badge-success"
                : log.status === "skipped"
                  ? "badge-warning"
                  : "badge-danger";
            const statusLabel = formatStatusLabel(log.status);
            const latencyLabel = Number.isFinite(log.latencyMs)
              ? `${Math.max(0, Number(log.latencyMs))} ms`
              : "-";
            return `<tr>
              <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
              <td>${escapeHtml(log.sessionId)}</td>
              <td class="font-mono text-xs">${escapeHtml(log.event)}</td>
              <td><span class="badge ${statusClass} webhook-status-badge" title="${escapeHtml(log.status)}">${statusLabel}</span></td>
              <td class="text-xs text-muted webhook-latency">${latencyLabel}</td>
              <td class="text-xs text-muted">${log.httpStatus ? `HTTP ${log.httpStatus}` : ""} ${escapeHtml(log.error || "")}</td>
            </tr>`;
          })
          .join("")}
        </tbody></table></div>`;
    },

    async refreshLogs() {
      const logs = await this.getWebhookLogs();
      const el = document.getElementById("webhook-logs-container");
      if (el) UI.setHtml(el, this.renderLogs(logs));
    },

    async clearLogs() {
      const result = await API.post("/webhooks/logs/clear", {});
      if (!result.success) {
        Toast.error(result.message || "Failed to clear webhook logs");
        return;
      }
      Toast.success("Webhook logs cleared");
      await this.refreshLogs();
    },

    async getWebhookLogs() {
      const params = new URLSearchParams({ limit: "100" });
      if (selectedLogSessionId) params.set("sessionId", selectedLogSessionId);
      const result = await API.get(`/webhooks/logs?${params.toString()}`);
      return result.success ? result.data || [] : [];
    },

    async getSessions() {
      const r = await API.get("/sessions");
      return r.success ? r.data || [] : [];
    },

    async getWebhookMeta() {
      const r = await API.get("/webhooks/meta");
      return r.success ? r.data || null : null;
    },

    destroy() {
      pageListeners?.abort();
      pageListeners = null;
    },
  };
})();
