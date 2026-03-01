/** Webhooks Page — per-session webhook URL and event selection */
(function () {
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

	window.WebhooksPage = {
		async render() {
			const sessions = await this.getSessions();

			document.getElementById("page-content").innerHTML = `
        <div class="card mb-2">
          <div class="card-header"><h3>Webhook Configuration</h3></div>
          <p class="text-sm text-muted mb-2">Configure webhook URL and event subscriptions per session.</p>
          ${
				sessions.length === 0
					? '<div class="empty-state"><p class="text-muted">No sessions available</p></div>'
					: sessions.map((s) => this.renderSessionWebhook(s)).join("")
			}
        </div>`;
		},

		renderSessionWebhook(session) {
			const sid = session.sessionId || session.id;
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
          <form onsubmit="WebhooksPage.saveWebhook(event, '${sid}')">
            <div class="form-group">
              <label>Webhook URL</label>
              <input type="url" id="wh-url-${sid}" placeholder="https://your-server.com/webhook" value="${session.webhookUrl || ""}" />
            </div>
            <div class="form-group">
              <label>Events</label>
              <div class="checkbox-group">
                ${ALL_EVENTS.map(
					(ev) => `
                  <label class="checkbox-item">
                    <input type="checkbox" value="${ev}" checked /> ${ev}
                  </label>`,
				).join("")}
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Save Webhook</button>
          </form>
        </div>`;
		},

		async saveWebhook(e, sessionId) {
			e.preventDefault();
			const webhookUrl = document
				.getElementById(`wh-url-${sessionId}`)
				.value.trim();
			const result = await API.put(`/sessions/${sessionId}/webhook`, {
				webhookUrl,
			});
			result.success
				? Toast.success("Webhook updated")
				: Toast.error(result.message);
		},

		async getSessions() {
			const r = await API.get("/sessions");
			return r.success ? r.data || [] : [];
		},
	};
})();
