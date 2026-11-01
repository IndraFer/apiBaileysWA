# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.9.0] - 2026-11-01

### Added

- versioned path, public schema, per-session keys and file-backed storage

## [1.8.1] - 2026-11-01

### Added

- structured, actionable errors on the send endpoint

## [1.8.0] - 2026-11-01

### Added

- scoped hashed API keys and an inbound audit log

## [1.7.0] - 2026-11-01

### Added

- unified send endpoint for third-party integrations

## [1.6.2] - 2026-11-01

### Changed

- track CHANGELOG.md
- adopt tags, changelog and a release helper

### Fixed

- show one eye icon in the settings password fields
- only skip version-shaped release commits

## [1.6.1] - 2026-11-01

### Added

- Bounded AI prompt history: message count, age window (default 6 hours) and
  character budget, configurable through `AI_HISTORY_MAX_MESSAGES`,
  `AI_HISTORY_MAX_AGE_MS` and `AI_HISTORY_MAX_CHARS`.

### Fixed

- The vendored DOMPurify build was ignored by `.gitignore` (`vendor/`), so a
  fresh clone — and therefore a Docker deployment — shipped no sanitizer and
  every dashboard page rendered as text. The asset now lives in
  `src/dashboard-ui/js/lib/purify.min.js` and is tracked.

## [1.6.0] - 2026-11-01

### Added

- AI auto-response per number: responder chain (AI → static → webhook),
  time-window routing, OpenAI-compatible driver, tool-calling RAG, debounce,
  human takeover/handoff, prompt-injection guard and routing metrics, plus the
  **AI & Routing** dashboard page.
- Admin user management: create users, approvals, roles, session ownership
  (`ownerId`), per-role quotas (`MAX_SESSIONS_PER_USER`,
  `MAX_SESSIONS_PER_MANAGER`) and delete-with-revoke of sessions/credentials.
- CSP violation reporting (`POST /dashboard/csp-report`) and the
  `CSP_REPORT_ONLY` switch.
- Explicit auth-state backend (`AUTH_STATE_BACKEND`) with a persisted choice and
  a confirmed switch flow.

### Changed

- Dashboard sessions use an HttpOnly cookie instead of a token in
  `localStorage`; SSE authenticates through the same cookie.
- Dashboard markup is rendered through a DOMPurify-sanitized helper; no inline
  styles or handlers remain and `style-src` stays at `'self'`.
- Navigation is gated by real capabilities (session/webhook/role) instead of
  always-visible entries.

### Fixed

- WebKit attaches an inline style to native `<select>`; CSP no longer blocks it
  (`style-src-attr`), removing the Safari console flood.
- CSP reports were rejected with 403 because browsers send an opaque origin.
- The users table rendered empty because `<tr>` fragments were parsed outside a
  table context.
- Malformed `localStorage` no longer throws during navigation.
- Redis is configured with `noeviction`, and an auth-backend mismatch fails fast
  instead of silently starting with an empty session store.

## [1.5.0] - 2026-09-04

### Added

- Gzip compression for large webhook payloads (`WEBHOOK_GZIP_THRESHOLD`).
- Per-receiver-URL circuit breaker so a dead endpoint is paused instead of
  retried forever.
- Standardized error codes and `requestId` tracing in API responses.

### Changed

- A single header/signature builder is shared by test and live webhook sends.

## [1.4.0] - 2026-09-04

### Added

- Webhook dead-letter buffer with replay and an optional SSRF guard.
- Per-receiver-URL outbound rate limit (token bucket).
- Smart retry by HTTP status with `Retry-After` support.
- Humanized WhatsApp interaction engine and human-like broadcast pacing.

### Fixed

- Webhook delivery now times out after 30 seconds instead of locking the queue.
- Unbounded presence map replaced with an LRU cache; synchronous filesystem
  calls removed from hot paths.
