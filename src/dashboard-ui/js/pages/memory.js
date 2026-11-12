/** Memory Page — browse what the assistant remembers, per session. */
(() => {
  const state = {
    sessionId: "",
    query: "",
    page: 1,
    limit: 25,
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
          <div class="memory-footer">
            <label class="memory-page-size">
              Show
              <select id="memory-page-size" class="input">
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
              items per page
            </label>
            <div class="memory-pager" id="memory-pager"></div>
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

      const sizeSelect = document.getElementById("memory-page-size");
      if (sizeSelect) {
        sizeSelect.value = String(state.limit);
        sizeSelect.addEventListener("change", (event) => {
          state.limit = Number(event.target.value) || 20;
          state.page = 1;
          void this.load();
        });
      }

      document.getElementById("memory-pager")?.addEventListener("click", (event) => {
        const button = event.target instanceof Element ? event.target.closest("[data-page]") : null;
        if (!button) return;
        const next = Number(button.getAttribute("data-page"));
        if (!Number.isFinite(next) || next === state.page) return;
        state.page = next;
        void this.load();
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

    /** Page numbers with ellipsis, so a long list stays one row. */
    pageNumbers(current, totalPages) {
      if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
      }

      const pages = [1];
      const from = Math.max(2, current - 1);
      const to = Math.min(totalPages - 1, current + 1);
      if (from > 2) pages.push("…");
      for (let page = from; page <= to; page += 1) pages.push(page);
      if (to < totalPages - 1) pages.push("…");
      pages.push(totalPages);
      return pages;
    },

    renderPager() {
      const pager = document.getElementById("memory-pager");
      if (!pager) return;

      const totalPages = Math.max(1, Math.ceil(state.total / state.limit));
      if (state.page > totalPages) state.page = totalPages;

      const button = (label, page, options = {}) =>
        `<button type="button" class="memory-page-btn${options.active ? " is-active" : ""}" data-page="${page}" ${
          options.disabled ? "disabled" : ""
        }>${label}</button>`;

      const parts = [
        button("First", 1, { disabled: state.page === 1 }),
        button("Prev", state.page - 1, { disabled: state.page === 1 }),
      ];
      for (const entry of this.pageNumbers(state.page, totalPages)) {
        parts.push(
          entry === "…"
            ? '<span class="memory-page-gap">…</span>'
            : button(String(entry), entry, { active: entry === state.page }),
        );
      }
      parts.push(
        button("Next", state.page + 1, { disabled: state.page >= totalPages }),
        button("Last", totalPages, { disabled: state.page >= totalPages }),
      );

      pager.innerHTML = parts.join("");
    },

    renderResults() {
      const results = document.getElementById("memory-results");
      if (!results) return;

      const count = document.getElementById("memory-count");
      if (count) count.textContent = `${state.total} scope(s)`;

      this.renderPager();

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
