/** Messaging Page — send text, image, file, bulk messages */
(() => {
  window.MessagingPage = {
    async render() {
      const sessions = await this.getSessions();
      const opts = sessions
        .map((s) => `<option value="${s.sessionId || s.id}">${s.sessionId || s.id}</option>`)
        .join("");

      document.getElementById("page-content").innerHTML = `
        <div class="card mb-2">
          <div class="card-header"><h3>Send Message</h3></div>
          <form id="send-msg-form">
            <div class="flex gap-2" style="flex-wrap:wrap">
              <div class="form-group" style="flex:1;min-width:200px">
                <label>Session</label>
                <select id="msg-session" required>${opts || "<option disabled>No sessions</option>"}</select>
              </div>
              <div class="form-group" style="flex:1;min-width:200px">
                <label>Receiver</label>
                <input type="text" id="msg-receiver" placeholder="6281234567890" required />
              </div>
            </div>
            <div class="form-group">
              <label class="checkbox-label"><input type="checkbox" id="msg-is-group" /> Send to Group (use Group JID)</label>
            </div>
            <div class="form-group">
              <label>Message Type</label>
              <select id="msg-type">
                <option value="text">Text</option>
                <option value="image">Image (URL)</option>
                <option value="document">Document (URL)</option>
                <option value="location">Location</option>
              </select>
            </div>
            <div class="form-group" id="msg-text-group">
              <label>Message</label>
              <textarea id="msg-text" placeholder="Type your message..." rows="3"></textarea>
            </div>
            <div class="form-group hidden" id="msg-url-group">
              <label>Media URL</label>
              <input type="url" id="msg-url" placeholder="https://example.com/image.jpg" />
            </div>
            <div class="form-group hidden" id="msg-caption-group">
              <label>Caption (optional)</label>
              <input type="text" id="msg-caption" placeholder="Image caption" />
            </div>
            <div class="form-group hidden" id="msg-location-group">
              <label>Latitude / Longitude</label>
              <div class="flex gap-1">
                <input type="text" id="msg-lat" placeholder="Latitude" style="flex:1" />
                <input type="text" id="msg-lng" placeholder="Longitude" style="flex:1" />
              </div>
            </div>
            <button type="submit" class="btn btn-primary">Send Message</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header"><h3>Bulk Send</h3></div>
          <form id="bulk-msg-form">
            <div class="form-group">
              <label>Session</label>
              <select id="bulk-session" required>${opts || "<option disabled>No sessions</option>"}</select>
            </div>
            <div class="form-group">
              <label>Recipients (one per line: phone,message)</label>
              <textarea id="bulk-data" rows="5" placeholder="6281234567890,Hello!&#10;6281234567891,Hi there!"></textarea>
            </div>
            <button type="submit" class="btn btn-primary">Send Bulk</button>
          </form>
          <div id="bulk-result" class="mt-2"></div>
        </div>`;

      // Type switching
      document.getElementById("msg-type").addEventListener("change", (e) => {
        const v = e.target.value;
        document.getElementById("msg-text-group").classList.toggle("hidden", v !== "text");
        document
          .getElementById("msg-url-group")
          .classList.toggle("hidden", !["image", "document"].includes(v));
        document.getElementById("msg-caption-group").classList.toggle("hidden", v !== "image");
        document.getElementById("msg-location-group").classList.toggle("hidden", v !== "location");
      });

      // Send single
      document.getElementById("send-msg-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const session = document.getElementById("msg-session").value;
        const receiver = document.getElementById("msg-receiver").value.trim();
        const isGroup = document.getElementById("msg-is-group").checked;
        const type = document.getElementById("msg-type").value;
        let message = {};

        if (type === "text")
          message = {
            text: document.getElementById("msg-text").value,
          };
        else if (type === "image")
          message = {
            image: {
              url: document.getElementById("msg-url").value,
            },
            caption: document.getElementById("msg-caption").value || undefined,
          };
        else if (type === "document")
          message = {
            document: {
              url: document.getElementById("msg-url").value,
            },
            fileName: "file",
          };
        else if (type === "location")
          message = {
            location: {
              degreesLatitude: parseFloat(document.getElementById("msg-lat").value),
              degreesLongitude: parseFloat(document.getElementById("msg-lng").value),
            },
          };

        const result = await API.post(`/sessions/${session}/send`, {
          receiver,
          message,
          isGroup,
        });
        result.success ? Toast.success("Message sent!") : Toast.error(result.message);
      });

      // Bulk send
      document.getElementById("bulk-msg-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const session = document.getElementById("bulk-session").value;
        const lines = document.getElementById("bulk-data").value.trim().split("\n").filter(Boolean);
        const messages = lines.map((l) => {
          const [receiver, ...rest] = l.split(",");
          return {
            receiver: receiver.trim(),
            message: { text: rest.join(",").trim() },
          };
        });

        const result = await API.post(`/sessions/${session}/send`, {
          messages,
        });
        if (result.success) {
          Toast.success(`Bulk job created: ${result.data?.jobId || "queued"}`);
          document.getElementById("bulk-result").innerHTML =
            `<p class="text-sm text-accent">Job: ${result.data?.jobId} | Total: ${messages.length}</p>`;
        } else {
          Toast.error(result.message);
        }
      });
    },

    async getSessions() {
      const result = await API.get("/sessions");
      return result.success ? result.data || [] : [];
    },
  };
})();
