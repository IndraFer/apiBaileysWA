/**
 * Prompt-injection screening and hardening.
 *
 * The heuristics here are a *tripwire*, not a security boundary: a determined
 * attacker can rephrase. The controls that actually limit damage live
 * elsewhere — allowlisted tools, credentials never placed in the prompt,
 * bounded tool rounds, response truncation, output scrubbing and the mute
 * policy. This module provides the cheap deterministic signal used to refuse
 * obvious override attempts and to escalate repeated abuse into a mute.
 */

export interface GuardVerdict {
  score: number;
  reasons: string[];
}

interface Rule {
  pattern: RegExp;
  weight: number;
  reason: string;
}

const RULES: Rule[] = [
  {
    pattern:
      /\b(ignore|disregard|forget|abaikan|lupakan)\b[^\n]{0,40}\b(previous|above|prior|earlier|sebelumnya|di atas)\b[^\n]{0,24}\b(instruction|instructions|prompt|rules|instruksi|aturan)\b/i,
    weight: 60,
    reason: "instruction_override",
  },
  {
    pattern: /\b(system prompt|prompt sistem|instruksi sistem|aturan sistem|hidden instruction)\b/i,
    weight: 45,
    reason: "system_prompt_probe",
  },
  {
    pattern:
      /\b(reveal|show|print|repeat|dump|tampilkan|tunjukkan|bocorkan|sebutkan)\b[^\n]{0,40}\b(prompt|instruction|instruksi|api[ _-]?key|token|secret|kredensial|credential)\b/i,
    weight: 55,
    reason: "secret_probe",
  },
  {
    pattern: /\b(jailbreak|developer mode|do anything now|dan mode|mode pengembang)\b/i,
    weight: 55,
    reason: "jailbreak",
  },
  {
    pattern:
      /\b(you are now|from now on you|act as|berperan sebagai|anggap kamu|mulai sekarang kamu)\b[^\n]{0,40}\b(system|admin|root|developer|sistem)\b/i,
    weight: 35,
    reason: "role_switch",
  },
  {
    pattern: /<\|?\s*(im_start|im_end|system|endoftext)\s*\|?>/i,
    weight: 60,
    reason: "prompt_delimiter_injection",
  },
  {
    pattern: /\b(base64|rot13|hex)\b[^\n]{0,30}\b(decode|jalankan|execute|abaikan|ignore)\b/i,
    weight: 30,
    reason: "encoding_trick",
  },
  {
    // Attempts to make the model print or reuse configured credentials.
    pattern: /\b(print|echo|cetak|tulis)\b[^\n]{0,30}\b(header|headers|authorization|x-api-key)\b/i,
    weight: 40,
    reason: "credential_exfiltration",
  },
];

/** Score the input. Higher means more suspicious; caller decides the cut-off. */
export function scanUserText(text: string): GuardVerdict {
  const reasons: string[] = [];
  let score = 0;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      score += rule.weight;
      reasons.push(rule.reason);
    }
  }
  return { score, reasons };
}

/**
 * Normalise untrusted text before it reaches the model: strip control
 * characters (except newlines/tabs), collapse runaway blank lines and enforce a
 * hard length cap so one message cannot flood the context window.
 */
/**
 * Remove control characters (except tab/newline) without a regex literal:
 * linters reject control characters inside regular expressions, and building
 * the pattern from a string gets normalised back by the formatter.
 */
function stripControlChars(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10) {
      out += char;
      continue;
    }
    if (code < 32 || code === 127) continue;
    out += char;
  }
  return out;
}

export function sanitizeUserText(text: string, maxChars = 4000): string {
  let cleaned = stripControlChars(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length > maxChars) {
    cleaned = `${cleaned.slice(0, maxChars)}…[truncated]`;
  }
  return cleaned;
}

/**
 * Delimit untrusted content so the model can tell data from instructions.
 * Paired with an explicit rule in the system prompt.
 */
export function wrapUserContent(text: string): string {
  return `<pesan_pengguna>\n${text}\n</pesan_pengguna>`;
}

/**
 * Remove credential-shaped strings from the model output before it is sent to
 * a customer (defence against the model echoing keys or headers).
 */
/**
 * Remove anything the model must never show a customer: credentials on one side,
 * and internal addressing on the other.
 *
 * The session identifier is operator-chosen and must never be echoed, so it is
 * always removed. Whole-token matching keeps it from rewriting a fragment of a
 * longer word; a short id can still collide with a standalone word, which is
 * the operator's choice of id, not a reason to leak it.
 */
export function scrubModelOutput(text: string, options?: { sessionId?: string }): string {
  let output = text
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b(?=\s*$)/g, "[redacted]")
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, "[redacted]")
    // Raw WhatsApp addresses are internal plumbing, never customer-facing text.
    .replace(
      /\b[\w.-]{2,}(?::\d+)?@(?:s\.whatsapp\.net|lid|g\.us|broadcast|newsletter)\b/gi,
      "[jid]",
    );

  const sessionId = options?.sessionId?.trim() ?? "";
  if (sessionId) output = replaceWholeToken(output, sessionId, "[session]");

  return output;
}

/** Replace one standalone token, never a fragment of a longer word. */
function replaceWholeToken(text: string, token: string, replacement: string): string {
  const wordChar = /[A-Za-z0-9_-]/;
  let out = "";
  let index = 0;

  for (;;) {
    const found = text.indexOf(token, index);
    if (found < 0) break;
    const before = text[found - 1];
    const after = text[found + token.length];
    const standalone = !(before && wordChar.test(before)) && !(after && wordChar.test(after));
    out += text.slice(index, found) + (standalone ? replacement : token);
    index = found + token.length;
  }

  return out + text.slice(index);
}
