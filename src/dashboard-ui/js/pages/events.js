/** Events Page — real-time event monitor via SSE */
(function () {
	let eventSource = null;
	let paused = false;
	let eventCount = 0;

	window.EventsPage = {
		async render() {
			document.getElementById("page-content").innerHTML = `
        <div class="toolbar">
          <button class="btn btn-outline btn-sm" id="btn-pause-events">⏸ Pause</button>
          <button class="btn btn-outline btn-sm" id="btn-clear-events">🗑 Clear</button>
          <div class="toolbar-spacer"></div>
          <span class="badge badge-success" id="sse-status"><span class="badge-dot pulse"></span>LISTENING</span>
        </div>
        <div class="events-feed" id="events-feed">
          <div class="empty-state"><p class="text-muted">Waiting for events...</p></div>
        </div>`;

			document
				.getElementById("btn-pause-events")
				.addEventListener("click", () => this.togglePause());
			document
				.getElementById("btn-clear-events")
				.addEventListener("click", () => this.clearEvents());

			// Load recent events first
			const recent = await API.get("/events/recent?limit=30");
			if (recent.success && recent.data?.length > 0) {
				const feed = document.getElementById("events-feed");
				feed.innerHTML = "";
				recent.data.reverse().forEach((ev) => this.addEvent(ev, false));
			}

			this.startSSE();
		},

		startSSE() {
			if (eventSource) eventSource.close();
			const token = API.getToken();
			// SSE with auth via query param (since EventSource doesn't support headers natively)
			eventSource = new EventSource(
				`/dashboard/api/events/stream?token=${token}`,
			);

			eventSource.addEventListener("baileys-event", (e) => {
				if (paused) return;
				try {
					const ev = JSON.parse(e.data);
					this.addEvent(ev, true);
					eventCount++;
					const badge = document.getElementById("events-badge");
					if (badge) {
						badge.style.display = "inline";
						badge.textContent = eventCount;
					}
				} catch {}
			});

			eventSource.addEventListener("heartbeat", () => {
				const status = document.getElementById("sse-status");
				if (status)
					status.innerHTML =
						'<span class="badge-dot pulse"></span>LISTENING';
			});

			eventSource.onerror = () => {
				const status = document.getElementById("sse-status");
				if (status) {
					status.className = "badge badge-danger";
					status.innerHTML = "DISCONNECTED";
				}
			};
		},

		addEvent(ev, prepend = true) {
			const feed = document.getElementById("events-feed");
			if (!feed) return;

			// Remove empty state
			const empty = feed.querySelector(".empty-state");
			if (empty) empty.remove();

			const time = new Date(ev.timestamp).toLocaleTimeString();
			const item = document.createElement("div");
			item.className = "event-item";
			item.innerHTML = `
        <div class="event-header">
          <span class="event-type">${ev.event}</span>
          <span class="event-session">${ev.sessionId}</span>
          <span class="event-time">${time}</span>
        </div>
        <div class="event-detail">${JSON.stringify(ev.data, null, 2)}</div>`;

			item.addEventListener("click", () =>
				item.classList.toggle("expanded"),
			);

			prepend ? feed.prepend(item) : feed.appendChild(item);

			// Keep max 100 items
			while (feed.children.length > 100) feed.lastChild.remove();
		},

		togglePause() {
			paused = !paused;
			const btn = document.getElementById("btn-pause-events");
			btn.textContent = paused ? "▶ Resume" : "⏸ Pause";
			const status = document.getElementById("sse-status");
			if (paused) {
				status.className = "badge badge-warning";
				status.innerHTML = "PAUSED";
			} else {
				status.className = "badge badge-success";
				status.innerHTML =
					'<span class="badge-dot pulse"></span>LISTENING';
			}
		},

		clearEvents() {
			const feed = document.getElementById("events-feed");
			if (feed)
				feed.innerHTML =
					'<div class="empty-state"><p class="text-muted">Events cleared</p></div>';
			eventCount = 0;
			const badge = document.getElementById("events-badge");
			if (badge) badge.style.display = "none";
			API.post("/events/clear");
		},

		destroy() {
			if (eventSource) {
				eventSource.close();
				eventSource = null;
			}
		},
	};
})();
