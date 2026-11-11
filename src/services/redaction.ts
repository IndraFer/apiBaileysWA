/**
 * Deterministic removal of internal addressing.
 *
 * Scope is deliberately narrow: raw WhatsApp addresses, LIDs and the session
 * identifier. Phone numbers, order IDs, emails and every other piece of content
 * pass through untouched, because they are usually the answer the operator put
 * in the instructions ("call us on 0812-…").
 *
 * The token is deleted rather than replaced by a placeholder. A visible marker
 * such as `[jid]` tells the model that something was censored, and it starts
 * explaining the censorship to the customer instead of answering. The security
 * block still forbids mentioning removal, which covers the remaining gap where a
 * sentence simply looks incomplete.
 */

/** Any WhatsApp address, including a device suffix such as `:12@`. */
const JID_PATTERN = /\b[\w.-]{2,}(?::\d+)?@(?:s\.whatsapp\.net|lid|g\.us|broadcast|newsletter)\b/gi;

/** Remove the spacing artifacts left behind by a deleted token. */
export function tidyRemoved(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/** Replace one standalone token, never a fragment of a longer word. */
function removeWholeToken(text: string, token: string): string {
  if (!token) return text;
  const wordChar = /[A-Za-z0-9_-]/;
  let out = "";
  let index = 0;

  for (;;) {
    const found = text.indexOf(token, index);
    if (found < 0) break;
    const before = text[found - 1];
    const after = text[found + token.length];
    const standalone = !(before && wordChar.test(before)) && !(after && wordChar.test(after));
    out += text.slice(index, found) + (standalone ? "" : token);
    index = found + token.length;
  }

  return out + text.slice(index);
}

/**
 * Strip raw JIDs and the session identifier.
 *
 * `sessionId` is operator-chosen and must never be echoed. Whole-token matching
 * keeps it from rewriting a fragment of a longer word; a very short id can still
 * match a standalone word, which is a property of the chosen id.
 */
export function maskInternalIds(text: string, sessionId?: string): string {
  let output = String(text ?? "").replace(JID_PATTERN, "");

  const id = sessionId?.trim() ?? "";
  if (id) output = removeWholeToken(output, id);

  return tidyRemoved(output);
}
