/** Overview Page — analytics dashboard */
(() => {
  const POLL_MS = 20000;
  const FOCUS_MIN_GAP_MS = 5000;
  const EVENT_MIN_GAP_MS = 10000;

  const state = {
    days: 7,
    charts: {},
    timer: null,
    stream: null,
    lastRefresh: 0,
    loading: false,
    onVisibility: null,
  };

  const ICONS = {
    chat: '<path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21"/>',
    check:
      '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    warning:
      '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    bolt: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/>',
  };

  function icon(name) {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.chat}</svg>`;
  }

  function statCard(tone, iconName, label, value, hint = "") {
    return `<div class="stat-card">
      <div class="stat-icon ${tone}">${icon(iconName)}</div>
      <div class="stat-info">
        <h4>${label}</h4>
        <div class="stat-value">${value}</div>
        ${hint ? `<small class="text-muted">${hint}</small>` : ""}
      </div>
    </div>`;
  }

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
    };
  }

  window.OverviewPage = {
    async render() {
      UI.setHtml(
        document.getElementById("page-content"),
        `
        <div class="stats-grid" id="dash-kpis">
          ${Array.from({ length: 6 })
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
            <p class="dash-note">Since restart. "Skipped" is a routing outcome, not a human reply.</p>
          </div>
          <div class="card">
            <div class="card-header"><h3>Hourly Activity (24h)</h3></div>
            <div class="dash-chart"><canvas id="chart-hourly"></canvas></div>
          </div>
          <div class="card">
            <div class="card-header">
              <h3>Daily Trend</h3>
              <div class="dash-controls">
                <select id="dash-range" class="input">
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                </select>
                <button class="btn btn-outline btn-sm" id="dash-refresh" type="button">Refresh</button>
              </div>
            </div>
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
          <div class="card-header"><h3>Server Information</h3></div>
          <div id="dash-server"><div class="skeleton skeleton-text"></div></div>
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
        const [overview, stats] = await Promise.all([
          API.get(`/overview?days=${state.days}`),
          API.get("/stats"),
        ]);
        if (!overview.success) return;
        state.lastRefresh = Date.now();
        this.renderData(overview.data);
        if (stats.success) this.renderServer(stats.data);
      } finally {
        state.loading = false;
      }
    },

    renderData(data) {
      const k = data.kpis;
      UI.setHtml(
        document.getElementById("dash-kpis"),
        [
          statCard("green", "chat", "Total Sessions", k.sessions),
          statCard("blue", "check", "Connected", k.connected),
          statCard("amber", "warning", "Disconnected", k.disconnected),
          statCard("red", "bolt", "Uptime", formatUptime(k.uptimeSeconds)),
          statCard("green", "clock", "AI Replies", k.aiReplies, "since restart"),
          statCard(
            "blue",
            "timer",
            "Avg Latency",
            k.avgLatencyMs ? `${(k.avgLatencyMs / 1000).toFixed(1)}s` : "—",
            `${k.failures} failure(s)`,
          ),
        ].join(""),
      );

      this.renderHealth(data.health);
      this.renderCharts(data);
    },

    renderServer(stats) {
      const target = document.getElementById("dash-server");
      if (!target) return;
      const mem = stats.memoryUsage;
      const restricted = Boolean(stats.infoRestricted);
      const row = (label, value) =>
        `<tr><td class="text-muted">${label}</td><td>${value}</td></tr>`;

      UI.setHtml(
        target,
        `<table>
          ${restricted ? row("System Info", '<span class="badge badge-warning">ADMIN ONLY</span>') : row("Environment", `<span class="badge badge-info">${escapeHtml(stats.environment)}</span>`)}
          ${restricted ? "" : row("Redis", `<span class="badge ${stats.redisEnabled ? "badge-success" : "badge-warning"}">${stats.redisEnabled ? "CONNECTED" : "DISABLED"}</span>`)}
          ${restricted ? "" : row("Memory (RSS)", `${(mem.rss / 1024 / 1024).toFixed(1)} MB`)}
          ${restricted ? "" : row("Memory (Heap)", `${(mem.heapUsed / 1024 / 1024).toFixed(1)} / ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`)}
          ${row("Version", escapeHtml(stats.version))}
        </table>`,
      );
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

    renderCharts(data) {
      if (typeof window.Chart !== "function") {
        for (const id of ["chart-routing", "chart-hourly", "chart-daily", "chart-top"]) {
          const canvas = document.getElementById(id);
          if (!canvas) continue;
          const fallback = document.createElement("p");
          fallback.className = "text-muted text-sm";
          fallback.textContent = "Charts need the CDN; the numbers are authoritative.";
          canvas.replaceWith(fallback);
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
