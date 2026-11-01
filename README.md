# API Baileys WA Socket

**WhatsApp REST API** powered by [Baileys WA Sockets](https://github.com/WhiskeySockets/Baileys). Built with **Hono + TypeScript** and features **Dual-Runtime Support** (runs natively on **Bun** or **Node.js**). Includes a built-in Visual Dashboard for easy management, keep clean simple and avoid heavy over-engineering.

> [!NOTE]
> This project is not meant to be a full-fledged WhatsApp server. It is a wrapper around the Baileys library, providing an HTTP interface for easier integration with other applications, don't use it for spamming or any activities that's prohibited by **WhatsApp META**.
>
> **Disclaimer:** This project is 100% AI-assisted and intended for educational purposes only. It will be maintained as a side project in spare time only, with no guarantees of ongoing support, updates, or production readiness.
>
> Thus, we do not store WhatsApp messages or any other data (aside from credentials for auto-reconnecting).

---

## ✨ Features

| Feature                     | Description                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| **Dual Runtime Support**    | Run on ultra-fast Bun or standard Node.js (cPanel/VPS compatible) |
| **Visual Dashboard**        | Built-in UI to manage sessions, webhooks, and send messages       |
| **Dashboard RBAC**          | Role-based access (`admin`, `manager`, `assistant`) + approvals   |
| **Session Assignment ACL**  | Optional per-user assigned sessions (dashboard scope only)        |
| **Multi-Session**           | Manage multiple WhatsApp accounts simultaneously                  |
| **QR Code & Pairing Code**  | Connect via QR scan or 8-digit pairing code                       |
| **Complete Chat API**       | Send text, media, forward, delete, read messages                  |
| **Broadcast Queue**         | Bulk message sending with anti-spam delays                        |
| **Group & Profile**         | Full management (create, participants, status, picture)           |
| **Media Handling**          | Download, process, retrieve, and auto-cleanup old media           |
| **Webhook System**          | Retries, exponential backoff, and signature modes                 |
| **Dual Auth State**         | Save session data to Files (dev) or Redis (production)            |
| **API Authentication**      | Bearer token or Redis-stored API keys with roles                  |
| **Hardened Dashboard Auth** | JWT auth, stream token for SSE, password policy, approval flow    |
| **Swagger/OpenAPI**         | Built-in interactive API documentation at `/docs`                 |
| **Docker Support**          | Ready-to-use Dockerfiles for both Bun and Node.js                 |

---

## 🚀 Quick Start

### 1. Prerequisite (Choose One Runtime)

- **Bun**: Ultra-fast, ideal for VPS or Home Servers (Recommended).
- **Node.js**: Standard, portable, ideal for cPanel VPS or traditional Node.js hosting.
- **Docker**: Containerized deployment. Ensure you have Docker Compose installed.

### 2. Local Setup (Bun OR Node.js)

```bash
# Clone the repository
git clone <repository-url>
cd baileys-wa-api

# Configure Environment
cp .env.example .env
# Edit .env and configure DASHBOARD_JWT_SECRET
```

#### Running with Bun (Fastest)

```bash
bun install

# Development (Auto-reload)
bun run dev

# Production Build
bun run start
```

#### Running with Node.js (Highest Compatibility)

```bash
npm install

# Development (via tsx watch)
npm run dev:node

# Production Build
npm run start:node
```

The API will start at `http://localhost:3000`. Access the following default routes:

- 🖥️ **Dashboard**: `http://localhost:3000/dashboard/`
- 📖 **Swagger Docs**: `http://localhost:3000/docs`
- 💚 **Health Check**: `http://localhost:3000/status`

---

## 🤖 AI Auto-Response (time-based routing + RAG tools)

Inside a configured window the AI answers; outside it humans do. Per-number
settings live in the session metadata (dashboard), so every WhatsApp number has
its own window, model, instruction and knowledge endpoints.

**Routing rule** — the AI only replies when all are true:

1. `ai.enabled` is on for that number (dashboard).
2. The current time is inside `AI_WINDOW_START`–`AI_WINDOW_END`, evaluated in
   `ROUTING_TZ` (cross-midnight supported: `16:00`→`08:00`).
3. **No human replied recently** in that conversation. A reply typed on the
   phone, WhatsApp Web or the dashboard counts; messages sent through this API
   do not. Silence lasts `ROUTING_HUMAN_IDLE_MS` (default 15 min).

If a call fails, the static away message (`AUTO_REPLY_*`) is used instead, so
the customer is never left without an answer.

#### Response modes: static vs LLM

The static auto-reply and the LLM coexist; the mode decides who answers.

| Setting | Behaviour |
|---|---|
| `ai.mode = "off"` (or `ai.enabled = false`) | Static rules (`AUTO_REPLY_*`) own the conversation |
| `ai.mode = "window"` (default) | LLM inside the window; outside it the static rules apply |
| `ai.mode = "always"` | LLM answers 24/7 — “full handle” |

Humans win in every mode: a reply typed from the phone, WhatsApp Web or the
dashboard pauses the AI for `ROUTING_HUMAN_IDLE_MS`, and
`POST /chats/:id/handoff` pauses it longer — including in `always` mode.

Precedence: **AI path → static rules → nothing**. If the AI call fails, the
static away message is sent instead, so the customer always gets an answer.

#### Drivers

| `AI_DRIVER` | Talks to | Needs |
|---|---|---|
| `openai` (default) | any OpenAI-compatible `/chat/completions` — OpenRouter, OpenAI, Groq, Together, Ollama | `AI_BASE_URL`, `AI_MODEL`, per-number key |
| `webhook` | your own agent gateway (e.g. `apiLLM`) | `AI_AGENT_URL` |

Both drivers produce the same output (one reply text), so switching later is a
configuration change.

The dashboard exposes the OpenAI-compatible driver only. The `webhook` driver is
an advanced/env-only option for gateways that speak the custom event contract
instead of OpenAI's; if your gateway is OpenAI-compatible, point `Base URL` at
it and keep the default driver.

Default sampling values: `temperature 0.6`, `top_p 0.95`, `min_p 0.05`
(sent only when the base URL is OpenRouter), penalties `0`, `max_tokens 1024`.
Empty fields fall back to these, so a provider's own defaults apply only when
you clear a value on purpose.

#### Per-number configuration

```http
GET   /dashboard/api/sessions/:sessionId/ai-config
PATCH /dashboard/api/sessions/:sessionId/ai-config
```

`PATCH` body (every field optional, merged):

```jsonc
{
  "routing": { "aiWindowStart": "16:00", "aiWindowEnd": "08:00", "timezone": "Asia/Jakarta",
               "humanIdleMs": 900000, "handoffPauseMs": 1800000 },
  "ai": {
    "enabled": true,
    "driver": "openai",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "openai/gpt-4o-mini",
    "systemInstruction": "Anda CS IKA UI. Jawab ramah, singkat, Bahasa Indonesia.",
    "ragEndpoints": [],
    "credentialsJson": "{\"apiKey\":\"sk-or-...\",\"endpoints\":{}}"
  }
}
```

Credentials are **encrypted before persisting** (AES-256-GCM) using
`CONFIG_ENC_KEY` and are never returned by the API — reads only report
`credentialsSet` / `credentialsEncrypted`. Logs redact them by key name.

#### Knowledge endpoints (simple RAG, no vector DB)

Each endpoint declares **its own parameters** — nothing is hardcoded. They are
converted into tool schemas, so the model decides when to call them.

```jsonc
{
  "name": "cek_anggota",
  "description": "Cek status anggota IKA UI berdasarkan nama atau nomor anggota.",
  "method": "GET",
  "url": "https://ika.ui.ac.id/api/members/search",
  "params": [
    { "name": "q", "type": "string", "description": "Nama lengkap atau nomor anggota (min 2 karakter)", "required": true }
  ],
  "timeoutMs": 6000,
  "maxResponseChars": 1500
}
```

```jsonc
{
  "name": "cari_artikel",
  "description": "Cari artikel atau agenda kegiatan.",
  "method": "GET",
  "url": "https://ika.ui.ac.id/api/articles/search",
  "params": [
    { "name": "q", "type": "string", "description": "Kata kunci", "required": true },
    { "name": "type", "type": "string", "description": "article atau event", "enum": ["article", "event"] },
    { "name": "date_from", "type": "string", "description": "Tanggal awal (YYYY-MM-DD)" },
    { "name": "per_page", "type": "integer", "description": "Jumlah hasil (1-50)", "default": 10 }
  ]
}
```

```jsonc
{
  "name": "kirim_aduan",
  "description": "Kirim aduan anggota. Gunakan hanya setelah data lengkap.",
  "method": "POST",
  "url": "https://ika.ui.ac.id/api/complaints",
  "params": [
    { "name": "name", "type": "string", "description": "Nama pelapor", "required": true },
    { "name": "content", "type": "string", "description": "Isi aduan (min 10 karakter)", "required": true },
    { "name": "category", "type": "string", "description": "Kategori", "required": true,
      "enum": ["fasilitas", "pelayanan", "keanggotaan", "iuran", "kegiatan", "lainnya"] },
    { "name": "source", "type": "string", "description": "Sumber", "default": "whatsapp" }
  ]
}
```

Parameter can target `query`, `body` or `path` (`in`). Path placeholders use
`{name}`, e.g. `/api/members/{member_number}/detail`.

Prefer the provider's own contract? Pass a raw JSON Schema instead of the
`params` list — it is forwarded to the model untouched:

```jsonc
{
  "name": "search_members",
  "method": "GET",
  "url": "https://api.example.com/v1/members/search",
  "parameters": {
    "type": "object",
    "properties": {
      "q": { "type": "string", "description": "Nama atau nomor anggota" }
    },
    "required": ["q"]
  }
}
```

With `parameters`, every argument the model produces is sent as a query string
for GET and as the JSON body otherwise — no per-parameter metadata is needed.

Credentials per endpoint live in the encrypted blob, never in the prompt:

```jsonc
{ "apiKey": "sk-or-...", "endpoints": { "kirim_aduan": { "headers": { "X-API-Key": "..." } } } }
```

Safety limits: URL always comes from configuration (never from the model),
optional private-host block (`AI_TOOL_BLOCK_INTERNAL`), per-endpoint timeout,
response truncation (`AI_TOOL_MAX_RESPONSE_CHARS`) and `AI_TOOL_MAX_ROUNDS` to
stop tool loops.

> **Status:** routing window, human-activity detection, idle **debounce**,
> provider call, tool-calling and AI→human handoff are implemented.
>
> - Messages are collected until the chat is idle for `ROUTING_BATCH_IDLE_MS`
>   (reset on every new message), capped by `ROUTING_BATCH_MAX_WAIT_MS` from the
>   first message and by `ROUTING_MAX_BATCH_MESSAGES`. One idle window → one
>   prompt → one reply.
> - After human activity the conversation stays human-owned for
>   `ROUTING_HUMAN_IDLE_MS`; the backlog that arrived meanwhile is answered in a
>   single prompt when the pause expires.
> - Exactly one timer is armed per conversation; a stale timer can never fire a
>   reply (epoch guard), so there is no periodic polling.

#### AI → human takeover

The model (or your gateway) can stop the bot for one conversation:

```http
POST /chats/:sessionId/handoff
{ "conversationId": "628xxx@s.whatsapp.net", "reason": "customer_minta_manusia", "pauseMinutes": 30 }
```

While paused, inbound messages accumulate but the AI stays silent; when the
pause expires the backlog is answered once. A human reply in the meantime
extends the pause automatically. `pauseMinutes` is clamped to 1..1440 (default
30).

#### Prompt-injection & abuse control

Layers, weakest to strongest:

1. **Tripwire (heuristics)** — obvious override / jailbreak / secret-probe
   patterns are refused before any provider call (`AI_GUARD_BLOCK_SCORE`,
   default 50). Heuristics are a signal, not a boundary.
2. **Instruction hierarchy** — customer text is wrapped in
   `<pesan_pengguna>…</pesan_pengguna>` and the system prompt states that this
   is data, never instructions.
3. **Least privilege** — tools only come from the configured allowlist, the URL
   is never model-controlled, credentials never enter the prompt, and tool
   rounds plus response size are bounded.
4. **Output scrubbing** — credential-shaped strings (API keys, bearer tokens,
   private keys) are redacted from the reply before it is sent.
5. **Abuse control** — after `AI_GUARD_MAX_STRIKES` blocked messages the
   conversation is muted for `AI_GUARD_MUTE_MS`. Messages received during a
   mute are ignored and **not queued**, so nothing stale is answered when the
   mute expires; the next genuine message resumes normal handling.

Honest limit: heuristics can be rephrased, so layers 3–5 carry the real
protection — the tripwire mainly stops scripted abuse and produces the signal
used for muting.

#### Dashboard page

A dedicated **AI & Routing** page (`#ai`, requires `manageSessions`) configures
everything per number — responder mode, window, model/credentials, system
instruction and knowledge endpoints — and shows live routing metrics. It reuses
the existing dashboard components (cards, form groups, badges, tables), so it
looks and behaves like the rest of the dashboard.

#### Routing metrics

```http
GET  /dashboard/api/ai/metrics?sessionId=<optional>
POST /dashboard/api/ai/metrics/reset
```

Counters are kept **in memory** (no database): AI replies, human-handled,
static replies, failures, tool calls, tokens and latency, plus 24 hourly
buckets and the most recent decisions. They are visible while the app is
running and reset on restart. Redis-backed persistence can be added later
without changing the endpoints.

## 🐳 Docker Deployment

The project provides configurations for both runtimes. Everything runs in a single
API container; Redis is optional and never published to the host.

First, create your environment file:

```bash
cp .env.example .env
# edit .env (secrets, dashboard JWT, webhook flags, …)
```

#### Option A: Docker with Bun (Default & Recommended)

```bash
docker compose up -d
docker compose logs -f api
```

#### Option B: Docker with Node.js

The Node image compiles the TypeScript sources with Bun at build time and then
runs the plain-JS bundle on native Node.js.

```bash
docker compose -f docker-compose.node.yml up -d
docker compose -f docker-compose.node.yml logs -f api
```

#### Redis options

Redis is **optional** and resolved at runtime from `REDIS_ENABLED` / `REDIS_URL`:

| Scenario | What to do |
|---|---|
| No Redis (file-based storage) | `REDIS_ENABLED=false` in `.env` (default) — just run compose |
| Redis already on the VPS host | `REDIS_ENABLED=true` and `REDIS_URL=redis://host.docker.internal:6379` |
| Redis already on the VPS in another container | `REDIS_ENABLED=true` and `REDIS_URL=redis://<host-or-container>:6379` |
| Bundled Redis container | `REDIS_ENABLED=true`, `REDIS_URL=redis://redis:6379`, then run compose with `--profile redis` |

```bash
# bundled Redis (isolated: no host port is published)
docker compose --profile redis up -d
docker compose -f docker-compose.node.yml --profile redis up -d   # Node variant
```

The bundled Redis has no published port, so it never collides with a Redis
already running on the VPS. Stop it with the same profile flag:

```bash
docker compose --profile redis down
```

#### Changing the port

`PORT` in `.env` is honored on both sides of the mapping, and the container
health check follows it:

```bash
PORT=8080   # → host 8080 → container 8080, healthy
```

To stop containers: `docker compose down`

---

## 🖥️ Visual Dashboard

The API includes an intuitive, modular web dashboard to manage everything visually without touching the CLI.

### Dashboard Configuration (`.env`)

```env
DASHBOARD_ENABLED=true
DASHBOARD_REGISTRATION_ENABLED=false
DASHBOARD_REGISTRATION_REQUIRE_APPROVAL=true
DASHBOARD_JWT_SECRET=super-secret-key-change-me
DASHBOARD_PASSWORD_MIN_LENGTH=6
```

### Initial Setup

1. Open `http://localhost:3000/dashboard/` in your browser.
2. If `data/dashboard-users.json` is empty, you will be prompted to create the very first **Admin Account**.
3. Create your account with a secure password (hashed via `bcryptjs`).
4. Once created, recommended to set `DASHBOARD_REGISTRATION_ENABLED=false` in `.env` to prevent public sign-ups.

### Role & Access Model

- `admin`: full dashboard access (users/approval/roles, session lifecycle, webhooks, all messaging).
- `manager`: operational access for chats/outbound/groups, without admin-level account controls.
- `assistant`: reply-focused dashboard role (no proactive outbound), for safer delegated handling.
- Optional `assignedSessions`: per-user session scoping in dashboard APIs/UI only.

### Registration & Approval Behavior

- `DASHBOARD_REGISTRATION_ENABLED=false`: registration form is disabled for additional users.
- `DASHBOARD_REGISTRATION_REQUIRE_APPROVAL=true`: newly registered users remain pending until approved by admin.
- The first bootstrap admin (when user file is empty) is created immediately.

### Features

- **Sessions**: Add WhatsApp accounts (QR/Pairing Code), Delete accounts safely (auto-cleans media/logs).
- **Messaging**: Test sending texts, images, and bulk broadcasts interactively.
- **Webhooks**: Configure webhook URLs and event subscriptions per-session.
- **Events**: Real-time SSE (Server-Sent Events) live log for WhatsApp events.

---

## 🔐 API Authentication

The raw REST API `/chats`, `/groups`, etc., supports two authentication methods:

### 1. Simple Token (Dev / Single-User)

Set `AUTH_GLOBAL_TOKEN` in `.env`:

```env
AUTH_GLOBAL_TOKEN=your-secret-token-here
```

Supported headers for simple token mode:

- `Authorization: Bearer <token>`
- `x-api-key: <token>`
- `x-access-token: <token>`
- `token: <token>`

Use in requests:

```bash
curl -H "Authorization: Bearer your-secret-token-here" http://localhost:3000/sessions
```

### 2. Redis API Keys (Production / Multi-User)

Requires `REDIS_ENABLED=true`. Manage keys using the CLI:

```bash
# Bun Runtime
bun run manage-api-keys create user

# Node.js Runtime
npm run manage-api-keys:node create admin
```

Use header: `x-api-key: <your-api-key>`

```bash
# Create user API key
bun run manage-api-keys create user

# Create admin API key
bun run manage-api-keys create admin

# List all keys
bun run manage-api-keys list

# Delete a key
bun run manage-api-keys delete <api-key>
```

Use in requests:

```bash
curl -H "x-api-key: <your-api-key>" http://localhost:3000/sessions
```

> **Note**: In `development` mode (`NODE_ENV=development`), API authentication is skipped entirely.

### Dashboard Authentication (UI)

- Dashboard endpoints (`/dashboard/api/*`) use JWT-based auth.
- SSE/Event stream endpoints use short-lived stream-scoped tokens.
- Stream token endpoint: `GET /dashboard/api/auth/stream-token`

---

## 📱 API Usage Examples

### Create Session (Pairing Code)

```bash
POST /sessions/my-session
Content-Type: application/json

{
  "usePairingCode": true,
  "phoneNumber": "+6281234567890",
  "webhookUrl": "http://your-server.com/webhook"
}
```

### Send an Image

```bash
POST /chats/my-session/send
Content-Type: application/json

{
  "receiver": "6281234567890",
  "message": {
    "image": { "url": "https://example.com/image.jpg" },
    "caption": "Check this out!"
  }
}
```

### Send Bulk Messages (Anti-Spam)

```bash
POST /chats/my-session/send-bulk
Content-Type: application/json

{
  "messages": [
    { "receiver": "6281234567890", "message": { "text": "Hello #1" } },
    { "receiver": "6281234567891", "message": { "text": "Hello #2" } }
  ]
}
```

Response:

```json
{
 "success": true,
 "message": "Broadcast job created",
 "data": { "jobId": "bc_1709271000_abc123", "total": 3, "status": "pending" }
}
```

Track progress:

```bash
GET /chats/my-session/broadcast/bc_1709271000_abc123
```

### Standard response envelope (`code` & `requestId`)

Every public API response (success or error) is a stable JSON envelope:

- **Success** — `{ success, message, data?, requestId }`
- **Error** — `{ success: false, message, code, requestId }`

`code` is a machine-readable error code derived from the HTTP status so
integrators can branch programmatically instead of parsing free-text
messages:

| HTTP | `code` |
| --- | --- |
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 422 | `UNPROCESSABLE_ENTITY` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |
| 503 | `SERVICE_UNAVAILABLE` |
| … | `HTTP_<status>` fallback |

`requestId` lets you trace a request end-to-end across logs and reverse
proxies. Send your own id in the `x-request-id` header to have it echoed
back, or omit it and one is generated for you.

Example:

```bash
curl -i -X POST /chats/missing-session/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-request-id: req_12345" \
  -H "Content-Type: application/json" \
  -d '{"receiver":"6281234567890","message":{"text":"hi"}}'
```

```json
HTTP/1.1 404 Not Found
{ "success": false, "message": "Session 'missing-session' not found", "code": "NOT_FOUND", "requestId": "req_12345" }
```

### Create a Group

```bash
POST /groups/my-session/create
Content-Type: application/json

{
  "groupName": "API Test Group",
  "participants": ["6281234567890", "6281234567891"]
}
```

### Webhook Events

Set `WEBHOOK_URL` in `.env` or per-session. Events are sent as POST:

```json
{
  "sessionId": "my-session",
  "event": "messages.upsert",
  "data": { "messages": [...], "type": "notify" }
}
```

Webhook requests are authenticated with the configured secret sent in **two headers**
so both legacy and standard receivers work (this is deliberate, kept in a single
header builder):

- `x-webhook-secret: <secret>` — legacy receivers built for this API
- `Authorization: Bearer <secret>` — standard receivers / API gateways

When signature mode is enabled, webhook requests also include:

- `x-webhook-timestamp`
- `x-webhook-signature: sha256=<hmac>`

(The signature uses the *same* secret — a shared-secret HMAC over
`"<timestamp>.<body>"`, not a separate signing key — so only verify it if you
control the receiver and trust the shared secret.)

Controlled by:

- `WEBHOOK_SIGNATURE_MODE=off|optional|required`
- `WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK=true|false`

Fallback order for webhook auth/signing secret:

1. Per-session webhook secret
2. `AUTH_GLOBAL_TOKEN` (only when fallback is enabled)

#### Delivery hardening (retries, rate limit, circuit breaker, dead-letter)

Outbound delivery is hardened per receiver URL (see `.env.example`):

- **Smart retry** — non-retryable 4xx give up immediately; 429/503 honor
  `Retry-After` (capped); 5xx/408/425/network retry with backoff
  (`WEBHOOK_RETRY_MAX`, `WEBHOOK_RETRY_INTERVAL`, `WEBHOOK_BACKOFF_FACTOR`,
  `WEBHOOK_RETRYABLE_STATUSES`).
- **Per-URL rate limit** — `WEBHOOK_RATE_PER_MIN` (0 = off) token-bucket per
  receiver; extra events wait (bounded, fail-open) instead of being dropped.
- **Circuit breaker** — `WEBHOOK_CIRCUIT_FAILURES` (default 5) consecutive
  genuine failures (retryable 5xx / network errors — not 4xx or healthy 429s)
  pause delivery to that endpoint for `WEBHOOK_CIRCUIT_RESET_MS` (default
  30s). Paused deliveries are logged as `skipped` and never silently dropped.
- **Gzip** — bodies larger than `WEBHOOK_GZIP_THRESHOLD` bytes (default
  16 KB; 0 = off) are sent with `Content-Encoding: gzip`. The signature is
  computed over the *uncompressed* JSON, so receivers decompress first, then
  verify.
- **Dead-letter** — `WEBHOOK_DEAD_LETTER_ENABLED` keeps deliveries that
  exhausted retries (in-memory, optionally persisted as JSONL to
  `WEBHOOK_DEAD_LETTER_DIR`) for manual replay via the dashboard.
- **SSRF guard** — `WEBHOOK_BLOCK_INTERNAL=true` rejects webhook URLs
  pointing at localhost / private networks (off by default so local testing
  works).

Available events:

- `connection.update` — Connection state changes (QR, open, close)
- `messages.upsert` — New messages received
- `messages.update` — Message status updates (sent, delivered, read)
- `messages.delete` — Messages deleted
- `messages.reaction` — Reactions added/removed
- `chats.upsert`, `chats.update`, `chats.delete`
- `contacts.upsert`, `contacts.update`
- `groups.upsert`, `groups.update`
- `group-participants.update`
- `presence.update`
- `blocklist.set`, `blocklist.update`

---

## 📂 Project Structure

```
baileys-wa-api/
├── data/                           # Dashboard users and internal dashboard data (JSON)
├── media/                          # Downloaded media files
├── sessions/                       # Auth/session state per WhatsApp session
├── scripts/
│   └── manage-api-keys.ts          # API key management CLI
├── src/
│   ├── index.ts                    # Runtime entry point (Bun/Node)
│   ├── app.ts                      # Hono app bootstrap + routes + docs
│   ├── config.ts                   # Centralized environment config
│   ├── baileys/
│   │   ├── connection.ts           # BaileysConnection class
│   │   ├── connectionManager.ts    # Multi-session manager
│   │   ├── types.ts                # Type definitions
│   │   ├── authState/
│   │   │   ├── index.ts            # Auth state factory
│   │   │   ├── file.ts             # File-based auth
│   │   │   └── redis.ts            # Redis-based auth
│   │   ├── store/
│   │   │   └── memoryStore.ts      # In-memory message store
│   │   └── helpers/
│   │       ├── downloadMedia.ts    # Media download utilities
│   │       └── shouldIgnoreJid.ts  # JID filtering
│   ├── dashboard/
│   │   ├── api.ts                  # Dashboard backend APIs (stats/events/webhooks)
│   │   ├── auth.ts                 # Dashboard auth + users/roles/approval
│   │   ├── eventBus.ts             # In-process event bus for SSE
│   │   └── loader.ts               # Dashboard route/static loader
│   ├── dashboard-ui/
│   │   ├── index.html              # Dashboard SPA shell
│   │   ├── css/
│   │   │   └── styles.css
│   │   └── js/
│   │       ├── api.js
│   │       ├── app.js
│   │       ├── auth.js
│   │       ├── theme.js
│   │       ├── components/
│   │       │   ├── modal.js
│   │       │   └── toast.js
│   │       └── pages/              # overview/sessions/chatrooms/groups/webhooks/events/settings
│   ├── lib/
│   │   ├── logger.ts               # Pino logger
│   │   ├── redis.ts                # Redis client helpers
│   │   ├── response.ts             # API response helpers
│   │   └── runtime.ts              # Bun/Node runtime abstraction
│   ├── middleware/
│   │   ├── auth.ts                 # API authentication
│   │   ├── rateLimit.ts            # API rate limiting
│   │   └── sessionValidator.ts     # Session existence check
│   ├── routes/
│   │   ├── session.ts              # Session CRUD
│   │   ├── chat.ts                 # Chat operations
│   │   ├── group.ts                # Group management
│   │   ├── profile.ts              # Profile management
│   │   ├── media.ts                # Media handling
│   │   ├── story.ts                # Story broadcasting
│   │   └── status.ts               # Server health
│   ├── schemas/
│   │   ├── chat.ts                 # Chat schemas
│   │   ├── group.ts                # Group schemas
│   │   └── session.ts              # Session schemas
│   ├── services/
│   │   ├── broadcastQueue.ts       # Broadcast queue with delays
│   │   └── mediaCleanup.ts         # Media file cleanup
│   │   └── webhookLog.ts           # Webhook delivery log storage
│   └── utils/
│       ├── asyncSleep.ts           # Async sleep utilities
│       ├── phone.ts                # Phone/JID formatting
│       └── validation.ts           # Validation utilities
├── .env.example
├── biome.jsonc
├── docker-compose.yml
├── docker-compose.node.yml
├── Dockerfile
├── Dockerfile.node
├── package.json
├── tsconfig.json
└── README.md
```

---

## ⚙️ Configuration Reference (`.env`)

| Variable                                  | Default                          | Description                                                              |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`                                | `development`                    | Environment (`development` / `production`)                               |
| `HOST`                                    | `0.0.0.0`                        | Server host                                                              |
| `PORT`                                    | `3000`                           | Server port                                                              |
| `LOG_LEVEL`                               | `info`                           | Log level (`debug`, `info`, `warn`, `error`)                             |
| `AUTH_GLOBAL_TOKEN`                       | —                                | Simple auth token                                                        |
| `REDIS_ENABLED`                           | `false`                          | Enable Redis integration                                                 |
| `REDIS_URL`                               | `redis://localhost:6379`         | Redis connection URL                                                     |
| `REDIS_PASSWORD`                          | —                                | Redis password                                                           |
| `BAILEYS_LOG_LEVEL`                       | `warn`                           | Baileys internal log level                                               |
| `MAX_RETRIES`                             | `5`                              | Max reconnection attempts                                                |
| `RECONNECT_INTERVAL`                      | `5000`                           | Reconnection delay (ms)                                                  |
| `MAX_SESSIONS`                            | `50`                             | Maximum concurrent WhatsApp sessions                                     |
| `WEBHOOK_URL`                             | —                                | Default webhook URL                                                      |
| `WEBHOOK_CONCURRENCY`                     | `20`                             | Max concurrent outbound webhook requests globally                        |
| `WEBHOOK_SIGNATURE_MODE`                  | `off`                            | Webhook signature mode (`off`, `optional`, `required`)                   |
| `WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK`     | `true`                           | Allow fallback to `AUTH_GLOBAL_TOKEN` for webhook secret/signature       |
| `WEBHOOK_ALLOWED_EVENTS`                  | `ALL`                            | Comma-separated event filter                                             |
| `WEBHOOK_RETRY_MAX`                       | `3`                              | Webhook delivery retry count                                             |
| `WEBHOOK_RETRY_INTERVAL`                  | `5000`                           | Initial webhook retry delay (ms)                                         |
| `WEBHOOK_BACKOFF_FACTOR`                  | `3`                              | Exponential backoff multiplier                                           |
| `BROADCAST_MIN_DELAY_MS`                  | `1500`                           | Min delay between bulk messages                                          |
| `BROADCAST_MAX_DELAY_MS`                  | `3000`                           | Max delay between bulk messages                                          |
| `BROADCAST_BATCH_SIZE`                    | `10`                             | Messages per batch before pause                                          |
| `BROADCAST_BATCH_PAUSE_MS`                | `5000`                           | Pause between batches                                                    |
| `BROADCAST_TYPING_SIMULATION`             | `false`                          | Show a per-recipient "composing…" bubble during broadcasts (default: false — safer/less bot-like; adds typing delay per recipient) |
| `BROADCAST_DELAY_DISTRIBUTION`            | `uniform`                        | Delay pattern between messages: `uniform` (random min–max, legacy) or `human` (short gaps + occasional longer pauses) |
| `BROADCAST_BATCH_CHECK_WA`                | `false`                          | Check recipient WA-registration in batches (fewer usync queries) instead of 1-by-1 |
| `BROADCAST_CHECK_WA_BATCH_SIZE`           | `50`                             | Batch size when `BROADCAST_BATCH_CHECK_WA=true`                          |
| `MEDIA_INCLUDE_BASE64`                    | `false`                          | Include media in webhooks                                                |
| `MEDIA_CLEANUP_ENABLED`                   | `true`                           | Auto-delete old media files                                              |
| `MEDIA_CLEANUP_INTERVAL_MS`               | `3600000`                        | Media cleanup interval (ms)                                              |
| `MEDIA_MAX_AGE_HOURS`                     | `24`                             | Max age of media files                                                   |
| `CORS_ORIGIN`                             | `*`                              | CORS allowed origins                                                     |
| `TRUST_PROXY`                             | `false`                          | Trust `x-forwarded-for`/`x-real-ip`/`cf-connecting-ip` for client IP. Enable ONLY behind a trusted reverse proxy/LB; when `false` the socket address is used so spoofed headers cannot bypass rate limits |
| `DASHBOARD_ENABLED`                       | `true`                           | Enable internal UI dashboard                                             |
| `DASHBOARD_REGISTRATION_ENABLED`          | `false`                          | Allow account creation                                                   |
| `DASHBOARD_REGISTRATION_REQUIRE_APPROVAL` | `true`                           | Require admin approval before new user can login                         |
| `DASHBOARD_PASSWORD_MIN_LENGTH`           | `6`                              | Minimum password length for dashboard users                              |
| `DASHBOARD_JWT_SECRET`                    | `change-this-to-a-random-secret` | JWT secret for dashboard auth. **In production**: if unset/still default, dashboard auth is disabled (fail-closed, 503) — generate with `openssl rand -base64 48` |
| `SIMULATE_TYPING_BEFORE_SEND`             | `true`                           | Auto-send "composing" presence before each message (default: true)       |
| `SIMULATE_TYPING_DELAY_MIN_MS`            | `1500`                           | Typing delay range in ms (random between min-max)                        |
| `SIMULATE_TYPING_DELAY_MAX_MS`            | `3000`                           | Typing delay range in ms (random between min-max)                        |
| `AUTO_READ_MESSAGES`                      | `false`                          | **⚠ RISK**: auto-mark incoming as read. Instant 0ms reads on 100% of chats is a bot signature & may trigger bans. Leave `false` unless required; if enabled also set `AUTO_READ_DELAY_ENABLED=true` for a natural delay |
| `AUTO_READ_DELAY_ENABLED`                 | `true`                           | Wait a natural "opened chat" delay before marking read (only when `AUTO_READ_MESSAGES=true`); `false` = read instantly (legacy) |
| `AUTO_READ_DELAY_MIN_MS`                  | `1500`                           | Min random "opened chat" delay before read receipt (ms)                 |
| `AUTO_READ_DELAY_MAX_MS`                  | `4000`                           | Max random "opened chat" delay before read receipt (ms)                 |
| `AUTO_MARK_ONLINE`                        | `true`                           | Auto-set presence to "available" when sending messages (default: true)   |
| `REJECT_CALLS`                            | `false`                          | Auto-reject incoming calls across all sessions                           |
| `HUMANIZE_READ_BEFORE_REPLY`              | `false`                          | Before auto-replying to a 1-on-1 chat, wait a natural "reading" gap then mark as read (bot-like instant replies without prior read = risky) |
| `HUMANIZE_READ_DELAY_MIN_MS`              | `800`                            | Min random "reading" gap before the read receipt (ms)                   |
| `HUMANIZE_READ_DELAY_MAX_MS`              | `2500`                           | Max random "reading" gap before the read receipt (ms)                   |
| `HUMANIZE_THINK_MIN_MS`                   | `800`                            | Min random "thinking" gap before typing starts (ms)                     |
| `HUMANIZE_THINK_MAX_MS`                   | `2000`                           | Max random "thinking" gap before typing starts (ms)                     |
| `HUMANIZE_TYPING_PROPORTIONAL`            | `false`                          | When `true`, typing ("composing") duration scales with reply length instead of a fixed random range. Default `false` = legacy fixed random typing delay (controlled by `SIMULATE_TYPING_DELAY_*`) |
| `HUMANIZE_PRESENCE_DEDUPE_MS`             | `0`                              | Min gap between repeated composing/paused to the same chat (ms); `0` = always send (legacy) |
| `HUMANIZE_GLOBAL_PACING_MIN_MS`           | `0`                              | Min random gap between ANY outbound actions within a session (ms); `0` = off (legacy) |
| `HUMANIZE_GLOBAL_PACING_MAX_MS`           | `0`                              | Max random gap between ANY outbound actions within a session (ms); `0` = off (legacy) |
| `HUMANIZE_DELAY_DISTRIBUTION`             | `uniform`                        | Delay pattern for humanize read/think gaps: `uniform` (random min–max, legacy) or `human` (short gaps + occasional longer pauses) |

### CORS & reverse-proxy notes

- **`CORS_ORIGIN=*`** (default) is safe for a token-based public API: CORS only controls which browser origins may *read responses*, it is **not** authentication — requests still need `AUTH_GLOBAL_TOKEN` / API keys. Restrict it (comma-separated origins) when a browser dashboard on another domain must talk to this API, or when you never want other sites to read responses.
- **`TRUST_PROXY=false`** (default) uses the socket address for rate limiting — spoofed `x-forwarded-for` headers cannot bypass limits. Set `TRUST_PROXY=true` **only** behind a trusted reverse proxy / load balancer (Nginx, Caddy, Cloudflare, AWS ALB) so the real client IP is used.

---

## 🧪 Useful Scripts

Use these commands for validation and maintenance:

```bash
# Type-check only
npm run build-check

# Lint with error-level gate
npm run lint

# Full lint diagnostics
npm run lint:all

# Auto-format/fix source files
npm run format
```

API key helper:

```bash
# Bun runtime
bun run manage-api-keys create admin

# Node runtime
npm run manage-api-keys:node create admin
```

---

## 📝 License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.
