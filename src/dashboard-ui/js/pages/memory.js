/** Memory Page — browse what the assistant remembers, per session. */
(() => {
  const state = {
    sessionId: "",
    query: "",
    page: 1,
    limit: 20,
    total: 0,
    items: [],
    loading: false,
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function phoneOf(jid) {
    return String(jid || "").replace(/@.*$/, "");
  }

  function kindLabel(item) {
    if (item.kind === "group-digest") return { text: "Group digest", tone: "badge-info" };
    if (item.kind === "group-participant") return { text: "Group member", tone: "badge-success" };
    return { text: "Direct chat", tone: "badge-success" };
  }

  function targetLabel(item) {
    if (item.kind === "group-participant") {
      return `${phoneOf(item.participantId)} · in ${phoneOf(item.conversationId)}`;
    }
    return phoneOf(item.conversationId);
  }

  window.MemoryPage = {
    async render() {
      const sessions = await API.get("/sessions");
      const list = sessions.success ? sessions.data || [] : [];
      if (!state.sessionId) {
        state.sessionId = window.App?.getSelectedSessionId?.() || list[0]?.sessionId || "";
      }

      UI.setHtml(
        document.getElementById("page-content"),
        `
        <div class="card">
          <div class="card-header">
            <h3>Assistant Memory</h3>
            <span class="text-muted text-xs" id="memory-count"></span>
          </div>
          <div class="form-row cols-2">
            <div class="form-group">
              <label for="memory-session">Session</label>
              <select id="memory-session" class="input">
                ${list
                  .map(
                    (session) =>
                      `<option value="${escapeHtml(session.sessionId || session.id)}"${
                        (session.sessionId || session.id) === state.sessionId ? " selected" : ""
                      }>${escapeHtml(session.clientName || session.sessionId || session.id)}</option>`,
                  )
                  .join("")}
              </select>
            </div>
            <div class="form-group">
              <label for="memory-search">Search</label>
              <input id="memory-search" class="input" type="search" placeholder="Summary, fact, number or JID" value="${escapeHtml(state.query)}" />
            </div>
          </div>
          <div id="memory-results"><div class="empty-state"><p class="text-muted">Loading…</p></div></div>
          <div class="flex gap-1 u-between-center u-mt-05">
            <button class="btn btn-outline btn-sm" id="memory-prev" type="button">Previous</button>
            <span class="text-muted text-xs" id="memory-page"></span>
            <button class="btn btn-outline btn-sm" id="memory-next" type="button">Next</button>
          </div>
        </div>
        `,
      );

      document.getElementById("memory-session")?.addEventListener("change", (event) => {
        state.sessionId = event.target.value;
        window.App?.setSelectedSessionId?.(state.sessionId);
        state.page = 1;
        void this.load();
      });

      let debounce;
      document.getElementById("memory-search")?.addEventListener("input", (event) => {
        state.query = event.target.value.trim();
        state.page = 1;
        clearTimeout(debounce);
        debounce = setTimeout(() => void this.load(), 250);
      });

      document.getElementById("memory-prev")?.addEventListener("click", () => {
        if (state.page > 1) {
          state.page -= 1;
          void this.load();
        }
      });

      document.getElementById("memory-next")?.addEventListener("click", () => {
        if (state.page * state.limit < state.total) {
          state.page += 1;
          void this.load();
        }
      });

      await this.load();
    },

    async load() {
      if (!state.sessionId || state.loading) return;
      state.loading = true;
      const results = document.getElementById("memory-results");
      try {
        const params = new URLSearchParams({
          query: state.query,
          page: String(state.page),
          limit: String(state.limit),
        });
        const result = await API.get(
          `/sessions/${encodeURIComponent(state.sessionId)}/memory?${params.toString()}`,
        );
        if (!result.success) {
          if (results)
            UI.setHtml(
              results,
              '<div class="empty-state"><p class="text-muted">Failed to load memory.</p></div>',
            );
          return;
        }

        state.items = result.data?.items || [];
        state.total = result.data?.total || 0;
        this.renderResults();
      } finally {
        state.loading = false;
      }
    },

    renderResults() {
      const results = document.getElementById("memory-results");
      if (!results) return;

      const count = document.getElementById("memory-count");
      if (count) count.textContent = `${state.total} scope(s)`;

      const pageInfo = document.getElementById("memory-page");
      if (pageInfo) {
        const pages = Math.max(1, Math.ceil(state.total / state.limit));
        pageInfo.textContent = `Page ${state.page} of ${pages}`;
      }

      const prev = document.getElementById("memory-prev");
      const next = document.getElementById("memory-next");
      if (prev) prev.disabled = state.page <= 1;
      if (next) next.disabled = state.page * state.limit >= state.total;

      if (state.items.length === 0) {
        UI.setHtml(
          results,
          '<div class="empty-state"><p class="text-muted">Nothing stored for this session yet.</p></div>',
        );
        return;
      }

      UI.setHtml(
        results,
        state.items
          .map((item) => {
            const kind = kindLabel(item);
            const facts = item.facts.length
              ? `<ul class="memory-facts">${item.facts
                  .map(
                    (fact) =>
                      `<li><span class="memory-key">${escapeHtml(fact.key)}</span> ${escapeHtml(fact.value)}</li>`,
                  )
                  .join("")}</ul>`
              : '<div class="text-muted text-xs">No facts stored.</div>';

            return `<div class="memory-block">
              <div class="memory-block-head">
                <div>
                  <span class="badge ${kind.tone}">${kind.text}</span>
                  <strong class="u-ml-05">${escapeHtml(targetLabel(item))}</strong>
                </div>
                <span class="text-muted text-xs">${item.messages} summarised · ${new Date(item.updatedAt).toLocaleString()}</span>
              </div>
              ${
                item.summary
                  ? `<div class="memory-summary">${escapeHtml(item.summary)}</div>`
                  : '<div class="text-muted text-xs">No summary yet.</div>'
              }
              ${facts}
            </div>`;
          })
          .join(""),
      );
    },

    destroy() {
      state.items = [];
    },
  };
})();
