/**
 * DOM helpers for the dashboard.
 *
 * Markup is sanitized with DOMPurify before it reaches the document: parsing in
 * an inert document is not sanitization, and event-handler attributes or
 * `javascript:` URLs would become live once inserted. If the sanitizer is not
 * loaded, `setHtml` fails closed and renders the value as text.
 */
(() => {
  const ENTITIES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
  }

  function sanitizeFragment(html) {
    const purify = window.DOMPurify;
    if (!purify || typeof purify.sanitize !== "function") return null;

    const fragment = purify.sanitize(String(html ?? ""), {
      RETURN_DOM_FRAGMENT: true,
      USE_PROFILES: { html: true, svg: true },
      ADD_ATTR: ["target"],
      FORBID_ATTR: ["style"],
    });

    return document.importNode(fragment, true);
  }

  function setHtml(target, html) {
    if (!target) return;
    const fragment = sanitizeFragment(html);
    if (fragment) {
      target.replaceChildren(fragment);
      return;
    }
    target.textContent = String(html ?? "");
  }

  function appendHtml(target, html) {
    if (!target) return;
    const fragment = sanitizeFragment(html);
    if (fragment) {
      target.append(fragment);
      return;
    }
    target.append(document.createTextNode(String(html ?? "")));
  }

  window.UI = { setHtml, appendHtml, escapeHtml };
})();
