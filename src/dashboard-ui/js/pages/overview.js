/** Overview Page — analytics dashboard */
(() => {
  const POLL_MS = 20000;
  const FOCUS_MIN_GAP_MS = 5000;
  const EVENT_MIN_GAP_MS = 10000;

  const state = {
    days: 7,
    data: null,
    charts: {},
    timer: null,
    stream: null,
    lastRefresh: 0,
    loading: false,
    onVisibility: null,
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatUptime(seconds) {
    const numeric = Number(seconds);
    if (!Number.isFinite(numeric) || numeric < 0) return "—";
    const d = Math.floor(numeric / 86400);
    const h = Math.floor((numeric % 86400) / 3600);
    const m = Math.floor((numeric % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function formatSince(ts) {
    const minutes = Math.max(0, Math.round((Date.now() - Number(ts || 0)) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  function chartColors() {
    const styles = getComputedStyle(document.documentElement);
    const read = (name, fallback) => (styles.getPropertyValue(name) || fallback).trim();
    return {
      accent: read("--accent", "#22c55e"),
      text: read("--text-secondary", "#6b7280"),
      grid: read("--border", "#e5e7eb"),
      info: "#3b82f6",
      warn: "#f59e0b",
      danger: "#ef4444",
      muted: "#9ca3af",
    };
  }

  window.OverviewPage = {
    async render() {
      UI.setHtml(
        document.getElementById("page-content"),
        `
        <div class="dash-head">
          <div>
            <h3>Overview</h3>
            <p class="text-muted text-sm" id="dash-meta">Loading…</p>
          </div>
          <div class="dash-controls">
            <select id="dash-range" class="input">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
            <button class="btn btn-outline btn-sm" id="dash-refresh" type="button">Refresh</button>
          </div>
        </div>

        <div class="stats-grid" id="dash-kpis">
          ${Array.from({ length: 4 })
            .map(
              () =>
                '<div class="stat-card"><div class="skeleton skeleton-card w-full"></div></div>',
            )
            .join("")}
        </div>

        <div class="dash-grid">
          <div class="card">
            <div class="card-header"><h3>Routing Decisions</h3></div>
            <div class="dash-chart"><canvas id="chart-routing"></canvas></div>
            <p class="dash-note">Since restart. "Skipped" means the router declined to answer, not that a human replied.</p>
          </div>
          <div class="card">
            <div class="card-header"><h3>Hourly Activity (24h)</h3></div>
            <div class="dash-chart"><canvas id="chart-hourly"></canvas></div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Daily Trend</h3></div>
            <div class="dash-chart"><canvas id="chart-daily"></canvas></div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Top Sessions</h3></div>
            <div class="dash-chart"><canvas id="chart-top"></canvas></div>
          </div>
        </div>

        <div class="card" id="dash-health-card">
          <div class="card-header"><h3>Health</h3></div>
          <div id="dash-health" class="dash-health"></div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Recent Decisions</h3></div>
          <div id="dash-recent"></div>
        </div>`,
      );

      document.getElementById("dash-range")?.addEventListener("change", (event) => {
        state.days = Number(event.target.value) || 7;
        void this.refresh(true);
      });
      document
        .getElementById("dash-refresh")
        ?.addEventListener("click", () => void this.refresh(true));

      await this.refresh(true);
      this.startLive();
    },

    async refresh(force = false) {
      if (state.loading) return;
      if (!force && Date.now() - state.lastRefresh < 2000) return;
      state.loading = true;
      try {
        const result = await API.get(`/overview?days=${state.days}`);
        if (!result.success) return;
        state.data = result.data;
        state.lastRefresh = Date.now();
        this.renderData(result.data);
      } finally {
        state.loading = false;
      }
    },

    renderData(data) {
      const k = data.kpis;
      const meta = document.getElementById("dash-meta");
      if (meta) {
        meta.textContent = `${k.sessions} session(s) · uptime ${formatUptime(k.uptimeSeconds)} · counters since ${formatSince(data.meta.since)} · trend ${data.meta.days}d`;
      }

      const cards = [
        { label: "Sessions", value: `${k.connected}/${k.sessions}`, hint: "connected" },
        { label: "AI Replies", value: k.aiReplies, hint: "since restart" },
        { label: "Skipped", value: k.skipped, hint: "router declined" },
        {
          label: "Avg Latency",
          value: k.avgLatencyMs ? `${(k.avgLatencyMs / 1000).toFixed(1)}s` : "—",
          hint: `${k.failures} failure(s)`,
        },
      ];
      UI.setHtml(
        document.getElementById("dash-kpis"),
        cards
          .map(
            (card) => `<div class="stat-card">
              <div class="stat-info">
                <h4>${escapeHtml(card.label)}</h4>
                <div class="stat-value">${escapeHtml(card.value)}</div>
                <small class="text-muted">${escapeHtml(card.hint)}</small>
              </div>
            </div>`,
          )
          .join(""),
      );

      this.renderHealth(data.health);
      this.renderRecent(data.recent);
      this.renderCharts(data);
    },

    renderHealth(health) {
      const card = document.getElementById("dash-health-card");
      const body = document.getElementById("dash-health");
      if (!card || !body) return;
      if (!health) {
        card.classList.add("hidden");
        return;
      }
      card.classList.remove("hidden");

      const ok = Number(health.webhookOk || 0);
      const failed = Number(health.webhookFailed || 0);
      const total = ok + failed;
      const rate = total > 0 ? Math.round((ok / total) * 100) : null;

      const items = [
        {
          label: "Webhook delivery",
          value: rate === null ? "no data" : `${rate}%`,
          tone: rate === null ? "muted" : rate >= 95 ? "ok" : rate >= 80 ? "warn" : "bad",
        },
        {
          label: "Dead letters",
          value: String(health.deadLetters),
          tone: health.deadLetters > 0 ? "warn" : "ok",
        },
        { label: "Memory scopes", value: String(health.memoryScopes), tone: "muted" },
        { label: "Redis", value: health.redis ? "enabled" : "file only", tone: "muted" },
      ];

      UI.setHtml(
        body,
        items
          .map(
            (item) => `<div class="dash-health-item">
              <span class="text-muted text-xs">${escapeHtml(item.label)}</span>
              <strong class="dash-health-${item.tone}">${escapeHtml(item.value)}</strong>
            </div>`,
          )
          .join(""),
      );
    },

    renderRecent(recent) {
      const target = document.getElementById("dash-recent");
      if (!target) return;
      if (!recent?.length) {
        UI.setHtml(
          target,
          '<div class="empty-state"><p class="text-muted">No routing decisions yet.</p></div>',
        );
        return;
      }
      UI.setHtml(
        target,
        `<div class="table-wrapper"><table>
          <thead><tr><th>When</th><th>Session</th><th>Chat</th><th>Route</th><th>Reason</th></tr></thead>
          <tbody>
            ${recent
              .map(
                (row) => `<tr>
                  <td class="text-muted text-xs">${new Date(row.at).toLocaleTimeString()}</td>
                  <td>${escapeHtml(row.sessionId)}</td>
                  <td class="text-xs">${escapeHtml(String(row.conversationId || "").replace(/@.*$/, ""))}</td>
                  <td><span class="badge ${row.route === "ai" ? "badge-success" : row.route === "failed" ? "badge-danger" : "badge-info"}">${escapeHtml(row.route)}</span></td>
                  <td class="text-muted text-xs">${escapeHtml(row.reason)}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table></div>`,
      );
    },

    renderCharts(data) {
      if (typeof window.Chart !== "function") {
        for (const id of ["chart-routing", "chart-hourly", "chart-daily", "chart-top"]) {
          const canvas = document.getElementById(id);
          const fallback = document.createElement("p");
          fallback.className = "text-muted text-sm";
          fallback.textContent = "Charts need the CDN; the numbers above are authoritative.";
          canvas?.replaceWith(fallback);
        }
        return;
      }

      for (const chart of Object.values(state.charts)) chart?.destroy?.();
      state.charts = {};

      const color = chartColors();
      const base = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: { legend: { labels: { color: color.text, boxWidth: 12 } } },
      };

      const routingCanvas = document.getElementById("chart-routing");
      if (routingCanvas) {
        state.charts.routing = new window.Chart(routingCanvas, {
          type: "doughnut",
          data: {
            labels: ["AI", "Static", "Skipped", "Failed"],
            datasets: [
              {
                data: [
                  data.routing.ai,
                  data.routing.static,
                  data.routing.skipped,
                  data.routing.failed,
                ],
                backgroundColor: [color.accent, color.info, color.warn, color.danger],
                borderWidth: 0,
              },
            ],
          },
          options: { ...base, cutout: "62%" },
        });
      }

      const hourlyCanvas = document.getElementById("chart-hourly");
      if (hourlyCanvas) {
        state.charts.hourly = new window.Chart(hourlyCanvas, {
          type: "bar",
          data: {
            labels: data.hourly.map((bucket) => `${String(bucket.hour).padStart(2, "0")}:00`),
            datasets: [
              {
                label: "AI",
                data: data.hourly.map((bucket) => bucket.ai),
                backgroundColor: color.accent,
                stack: "s",
              },
              {
                label: "Skipped",
                data: data.hourly.map((bucket) => bucket.skipped),
                backgroundColor: color.warn,
                stack: "s",
              },
            ],
          },
          options: {
            ...base,
            scales: {
              x: {
                stacked: true,
                ticks: { color: color.text, maxRotation: 0 },
                grid: { display: false },
              },
              y: {
                stacked: true,
                beginAtZero: true,
                ticks: { color: color.text },
                grid: { color: color.grid },
              },
            },
          },
        });
      }

      const dailyCanvas = document.getElementById("chart-daily");
      if (dailyCanvas) {
        state.charts.daily = new window.Chart(dailyCanvas, {
          type: "line",
          data: {
            labels: data.daily.map((row) => row.day.slice(5)),
            datasets: [
              {
                label: "AI",
                data: data.daily.map((row) => row.ai),
                borderColor: color.accent,
                backgroundColor: `${color.accent}33`,
                fill: true,
                tension: 0.3,
              },
              {
                label: "Skipped",
                data: data.daily.map((row) => row.skipped),
                borderColor: color.warn,
                backgroundColor: "transparent",
                tension: 0.3,
              },
            ],
          },
          options: {
            ...base,
            scales: {
              x: { ticks: { color: color.text }, grid: { display: false } },
              y: { beginAtZero: true, ticks: { color: color.text }, grid: { color: color.grid } },
            },
          },
        });
      }

      const topCanvas = document.getElementById("chart-top");
      if (topCanvas) {
        state.charts.top = new window.Chart(topCanvas, {
          type: "bar",
          data: {
            labels: data.topSessions.map((row) => row.sessionId),
            datasets: [
              {
                label: "AI + skipped",
                data: data.topSessions.map((row) => row.ai + row.skipped),
                backgroundColor: color.info,
              },
            ],
          },
          options: {
            ...base,
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, ticks: { color: color.text }, grid: { color: color.grid } },
              y: { ticks: { color: color.text }, grid: { display: false } },
            },
          },
        });
      }
    },

    /**
     * Live updates without hammering the API: SSE events and a poll while the
     * page is visible, both coalesced. Hidden tab stops everything, and coming
     * back refreshes at most once every few seconds.
     */
    startLive() {
      this.stopLive();

      state.onVisibility = () => {
        if (document.hidden) {
          this.stopLive();
          return;
        }
        if (Date.now() - state.lastRefresh < FOCUS_MIN_GAP_MS) return;
        void this.refresh(true);
        this.startLive();
      };
      document.addEventListener("visibilitychange", state.onVisibility);

      state.timer = setInterval(() => {
        if (!document.hidden) void this.refresh();
      }, POLL_MS);

      try {
        state.stream = new EventSource("/dashboard/api/events/stream");
        state.stream.addEventListener("baileys-event", () => {
          if (document.hidden) return;
          if (Date.now() - state.lastRefresh < EVENT_MIN_GAP_MS) return;
          void this.refresh(true);
        });
      } catch {
        state.stream = null;
      }
    },

    stopLive() {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
      if (state.stream) state.stream.close();
      state.stream = null;
    },

    destroy() {
      this.stopLive();
      if (state.onVisibility) document.removeEventListener("visibilitychange", state.onVisibility);
      state.onVisibility = null;
      for (const chart of Object.values(state.charts)) chart?.destroy?.();
      state.charts = {};
    },
  };
})();
