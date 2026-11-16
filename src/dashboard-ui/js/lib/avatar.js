/**
 * Avatar helpers shared by the dashboard pages.
 *
 * Two conventions exist in this UI and they must stay distinct:
 * - `contactInitials` (here) renders exactly two characters for a contact, so
 *   every row in a list has the same visual weight: "Budi Susilo" → BU,
 *   "Susanti" → SU.
 * - `getInitials` in app.js renders the signed-in account: "john_doe" → JD.
 *
 * Pictures come from the session avatar endpoint, which proxies and caches the
 * bytes. `img-src` is `'self'` only, so hotlinking WhatsApp media is not an
 * option. When the endpoint answers 404 the image is dropped and the initials
 * (or the blank placeholder) remain visible.
 */
(() => {
  /** Honorifics and titles that must not become initials. */
  const TITLES = new Set([
    "dr",
    "drs",
    "prof",
    "ir",
    "hj",
    "h",
    "mr",
    "mrs",
    "ms",
    "miss",
    "sdr",
    "bp",
    "ibu",
    "bapak",
  ]);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => {
      const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return map[ch] || ch;
    });
  }

  /** First token that carries a letter, with titles and punctuation removed. */
  function firstMeaningfulToken(name) {
    const parts = String(name ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    for (const part of parts) {
      const bare = part.replace(/[^\p{L}\p{N}]+/gu, "");
      if (!bare) continue;
      if (TITLES.has(bare.toLowerCase())) continue;
      if (!/\p{L}/u.test(bare)) continue;
      return bare;
    }
    return "";
  }

  /** Exactly two characters for Latin names, one for other scripts. */
  function contactInitials(name) {
    const token = firstMeaningfulToken(name);
    if (!token) return "";

    const chars = Array.from(token);
    const first = chars[0] || "";
    // Two CJK/Arabic characters in a small circle look broken; one reads better.
    if (!/\p{Script=Latin}/u.test(first)) return chars.slice(0, 1).join("");

    const letters = Array.from(token).filter((ch) => /\p{L}/u.test(ch));
    return letters.slice(0, 2).join("").toLocaleUpperCase();
  }

  /**
   * @param {{sessionId?: string, jid?: string, name?: string, size?: "sm"|"md"|"lg"}} options
   */
  function markup(options = {}) {
    const size = options.size || "md";
    const initials = contactInitials(options.name);
    const canFetch = Boolean(options.sessionId && options.jid);
    const src = canFetch
      ? `/dashboard/api/sessions/${encodeURIComponent(options.sessionId)}/avatars/${encodeURIComponent(options.jid)}`
      : "";
    const image = src
      ? `<img class="avatar-img" alt="" loading="lazy" decoding="async" data-avatar-img src="${src}">`
      : "";
    const fallback = initials
      ? `<span class="avatar-fallback">${escapeHtml(initials)}</span>`
      : '<span class="avatar-fallback"></span>';

    return `<span class="avatar avatar-${size}${initials ? "" : " is-blank"}" aria-hidden="true">${image}${fallback}</span>`;
  }

  /** Attach load/error handlers; a failed picture falls back to the initials. */
  function hydrate(root) {
    const scope = root || document;
    scope.querySelectorAll("img[data-avatar-img]").forEach((img) => {
      if (img.dataset.avatarBound === "1") return;
      img.dataset.avatarBound = "1";
      const host = img.closest(".avatar");
      img.addEventListener("load", () => {
        if (img.naturalWidth > 0) host?.classList.add("is-loaded");
      });
      img.addEventListener("error", () => {
        img.remove();
        host?.classList.add("is-failed");
      });
    });
  }

  window.Avatar = { contactInitials, markup, hydrate };
})();
