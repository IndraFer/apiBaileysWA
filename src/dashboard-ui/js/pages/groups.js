/** Groups Page */
(() => {
  window.GroupsPage = {
    async render() {
      const sessions = await this.getSessions();
      const opts = sessions
        .map((s) => `<option value="${s.sessionId || s.id}">${s.sessionId || s.id}</option>`)
        .join("");

      UI.setHtml(
        document.getElementById("page-content"),
        `
        <div class="toolbar">
          <div class="form-group mb-0 u-minw-180">
            <select id="group-session">${opts || "<option disabled>No sessions</option>"}</select>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-load-groups">Load Groups</button>
          <button class="btn btn-outline btn-sm" id="btn-create-group">+ Create Group</button>
        </div>
        <div id="groups-list"><div class="empty-state"><p class="text-muted">Select a session and click "Load Groups"</p></div></div>`,
      );

      document.getElementById("btn-load-groups").addEventListener("click", () => this.loadGroups());
      document
        .getElementById("btn-create-group")
        .addEventListener("click", () => this.showCreateModal());
    },

    async loadGroups() {
      const session = document.getElementById("group-session").value;
      if (!session) return Toast.warning("Select a session first");

      const el = document.getElementById("groups-list");
      UI.setHtml(el, '<div class="skeleton skeleton-card w-full u-h-150"></div>');

      // Use the main API endpoint
      const result = await API.request(`/groups/${session}/list`, {
        method: "GET",
      });
      if (!result.success) {
        UI.setHtml(el, `<p class="text-muted">${UI.escapeHtml(result.message)}</p>`);
        return;
      }

      const groups = result.data || [];
      if (groups.length === 0) {
        UI.setHtml(el, '<div class="empty-state"><h3>No Groups</h3></div>');
        return;
      }

      UI.setHtml(
        el,
        `<div class="table-wrapper"><table>
        <thead><tr><th>Name</th><th>JID</th><th>Size</th><th class="u-text-right">Actions</th></tr></thead>
        <tbody>${groups
          .map((g) => {
            const jid = String(g.id || g.jid || "");
            const name = g.subject || g.name || jid;
            return `
          <tr>
            <td><strong>${UI.escapeHtml(name)}</strong></td>
            <td class="text-muted font-mono text-xs">${UI.escapeHtml(jid)}</td>
            <td>${UI.escapeHtml(g.size || g.participants?.length || "—")}</td>
            <td class="u-text-right">
              <button class="btn btn-outline btn-sm" data-group-clear="${UI.escapeHtml(jid)}" data-group-name="${UI.escapeHtml(name)}">Clear Chat</button>
              <button class="btn btn-outline-danger btn-sm" data-group-exit="${UI.escapeHtml(jid)}" data-group-name="${UI.escapeHtml(name)}">Exit &amp; Delete</button>
            </td>
          </tr>`;
          })
          .join("")}
        </tbody></table></div>`,
      );

      const sessionId = document.getElementById("group-session")?.value || "";

      el.querySelectorAll("[data-group-clear]").forEach((button) => {
        button.addEventListener("click", async () => {
          const jid = button.dataset.groupClear;
          const name = button.dataset.groupName || jid;
          const ok = await Modal.confirm(
            "Clear Chat",
            `Clear this group's history on WhatsApp and in the dashboard?<br><br><strong>${UI.escapeHtml(name)}</strong><br><br>This cannot be undone.`,
            { confirmText: "Clear chat", variant: "danger" },
          );
          if (!ok) return;

          button.disabled = true;
          const result = await API.post(`/sessions/${encodeURIComponent(sessionId)}/chats/clear`, {
            jid,
          });
          button.disabled = false;

          if (result.success) {
            Toast.success(`Cleared ${result.data?.clearedMessages ?? 0} messages in this group`);
          } else {
            Toast.error(result.message || "Failed to clear this group");
          }
        });
      });

      el.querySelectorAll("[data-group-exit]").forEach((button) => {
        button.addEventListener("click", async () => {
          const jid = button.dataset.groupExit;
          const name = button.dataset.groupName || jid;
          const ok = await Modal.confirm(
            "Exit & Delete Group",
            `Leave <strong>${UI.escapeHtml(name)}</strong> and delete its chat?<br><br>You will stop receiving messages from this group and the chat is removed on WhatsApp and here.`,
            { confirmText: "Exit & delete", variant: "danger" },
          );
          if (!ok) return;

          button.disabled = true;
          const result = await API.post(
            `/groups/${encodeURIComponent(sessionId)}/leave-and-delete/${encodeURIComponent(jid)}`,
            {},
          );
          button.disabled = false;

          if (result.success) {
            Toast.success("Left and deleted the group");
            this.loadGroups();
          } else {
            Toast.error(result.message || "Failed to exit the group");
          }
        });
      });
    },

    showCreateModal() {
      const session = document.getElementById("group-session").value;
      if (!session) return Toast.warning("Select a session first");

      Modal.show(
        "Create Group",
        `
        <form id="create-group-form">
          <div class="form-group"><label>Group Name</label><input type="text" id="grp-name" required /></div>
          <div class="form-group"><label>Participants (comma-separated phones)</label><input type="text" id="grp-participants" placeholder="6281234567890,6281234567891" required /></div>
          <button type="submit" class="btn btn-primary btn-full">Create</button>
        </form>`,
      );

      document.getElementById("create-group-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const result = await API.request(`/groups/${session}/create`, {
          method: "POST",
          body: JSON.stringify({
            groupName: document.getElementById("grp-name").value,
            participants: document
              .getElementById("grp-participants")
              .value.split(",")
              .map((p) => p.trim()),
          }),
        });
        if (result.success) {
          Toast.success("Group created");
          Modal.hide();
          this.loadGroups();
        } else {
          Toast.error(result.message);
        }
      });
    },

    async getSessions() {
      const r = await API.get("/sessions");
      return r.success ? r.data || [] : [];
    },
  };
})();
