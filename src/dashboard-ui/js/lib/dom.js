/**
 * DOM helpers for the dashboard.
 *
 * `setHtml` parses markup in an inert document and imports the nodes, so the
 * dashboard never assigns `innerHTML`. CSP already forbids inline handlers and
 * scripts; escaping still matters for text, and `escapeHtml` is the shared
 * helper for template interpolation.
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

  function toNodes(html) {
    const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
    return Array.from(doc.body.childNodes, (node) => document.importNode(node, true));
  }

  function setHtml(target, html) {
    if (!target) return;
    target.replaceChildren(...toNodes(html));
  }

  function appendHtml(target, html) {
    if (!target) return;
    target.append(...toNodes(html));
  }

  window.UI = { setHtml, appendHtml, escapeHtml };
})();
