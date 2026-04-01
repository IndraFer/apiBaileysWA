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

  window.WebhooksPage = {
    async render() {
      const sessions = await this.getSessions();
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

      document.getElementById("page-content").innerHTML = `
        <div class="card mb-2">
          <div class="card-header"><h3>Webhook Configuration</h3></div>
          <p class="text-sm text-muted mb-2">Configure webhook URL and event subscriptions per session.</p>
			  <div class="mb-2" style="padding:0 0 0.5rem">
				<span class="badge ${meta?.signatureMode === "required" ? "badge-danger" : meta?.signatureMode === "optional" ? "badge-warning" : "badge-info"}">SIGNATURE: ${(meta?.signatureMode || "off").toUpperCase()}</span>
				<span class="text-muted text-xs" style="margin-left:0.5rem">Auth fallback: ${(meta?.authFallback || []).join(" -> ") || "session webhook secret -> AUTH_GLOBAL_TOKEN"}</span>
			  </div>
          ${
            sessions.length === 0
              ? '<div class="empty-state"><p class="text-muted">No sessions available</p></div>'
              : sessions.map((s) => this.renderSessionWebhook(s)).join("")
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
              <button class="btn btn-outline btn-sm" id="btn-refresh-wh-logs">Refresh Logs</button>
              <button class="btn btn-danger btn-sm" id="btn-clear-wh-logs">Clear Logs</button>
            </div>
          </div>
          <div id="webhook-logs-container">${this.renderLogs(logs)}</div>
        </div>`;

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
      document.querySelectorAll(".webhook-secret-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sessionId = btn.getAttribute("data-session-id");
          if (!sessionId) return;
          const input = document.getElementById(`wh-secret-${sessionId}`);
          if (!input) return;
          const shouldShow = input.type === "password";
          input.type = shouldShow ? "text" : "password";
          btn.textContent = shouldShow ? "Hide" : "Show";
        });
      });
    },

    renderSessionWebhook(session) {
      const sid = session.sessionId || session.id;
      const selectedEvents =
        Array.isArray(session.webhookEvents) && session.webhookEvents.length > 0
          ? session.webhookEvents
          : ALL_EVENTS;
      return `
        <div class="card mb-1" style="background:var(--bg-input)">
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
		  <form id="wh-form-${sid}" onsubmit="WebhooksPage.saveWebhook(event, '${sid}')">
            <div class="form-group">
              <label>Webhook URL</label>
              <input type="url" id="wh-url-${sid}" placeholder="https://your-server.com/webhook" value="${session.webhookUrl || ""}" />
            </div>
						<div class="form-group">
							<label>Webhook Secret</label>
							<div class="webhook-secret-input-wrap">
								<input type="password" id="wh-secret-${sid}" placeholder="Optional x-webhook-secret value" value="${session.webhookSecret || ""}" autocomplete="off" />
								<button type="button" class="btn btn-outline btn-sm webhook-secret-toggle" data-session-id="${sid}">Show</button>
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
              <button type="button" class="btn btn-outline btn-sm" onclick="WebhooksPage.testWebhook('${sid}')">Test Connection</button>
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
      result.success ? Toast.success("Webhook updated") : Toast.error(result.message);
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
              <td>${log.sessionId}</td>
              <td class="font-mono text-xs">${log.event}</td>
              <td><span class="badge ${statusClass} webhook-status-badge" title="${log.status}">${statusLabel}</span></td>
              <td class="text-xs text-muted webhook-latency">${latencyLabel}</td>
              <td class="text-xs text-muted">${log.httpStatus ? `HTTP ${log.httpStatus}` : ""} ${log.error || ""}</td>
            </tr>`;
          })
          .join("")}
        </tbody></table></div>`;
    },

    async refreshLogs() {
      const logs = await this.getWebhookLogs();
      const el = document.getElementById("webhook-logs-container");
      if (el) el.innerHTML = this.renderLogs(logs);
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
      const result = await API.get("/webhooks/logs?limit=100");
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
  };
})();
