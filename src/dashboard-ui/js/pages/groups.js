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
        <thead><tr><th>Name</th><th>JID</th><th>Size</th></tr></thead>
        <tbody>${groups
          .map(
            (g) => `
          <tr>
            <td><strong>${UI.escapeHtml(g.subject || g.name || "—")}</strong></td>
            <td class="text-muted font-mono text-xs">${UI.escapeHtml(g.id || g.jid || "")}</td>
            <td>${UI.escapeHtml(g.size || g.participants?.length || "—")}</td>
          </tr>`,
          )
          .join("")}
        </tbody></table></div>`,
      );
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
