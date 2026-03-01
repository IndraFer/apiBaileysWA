# Baileys WA API

**Production-ready WhatsApp REST API** powered by [Baileys 7.0.0-rc.9](https://github.com/WhiskeySockets/Baileys). Built with **Hono + TypeScript** and features **Dual-Runtime Support** (runs natively on **Bun** or **Node.js**). Includes a beautiful built-in Visual Dashboard for easy management.

---

## ✨ Features

| Feature                    | Description                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| **Dual Runtime Support**   | Run on ultra-fast Bun or standard Node.js (cPanel/VPS compatible) |
| **Visual Dashboard**       | Built-in UI to manage sessions, webhooks, and send messages       |
| **Multi-Session**          | Manage multiple WhatsApp accounts simultaneously                  |
| **QR Code & Pairing Code** | Connect via QR scan or 8-digit pairing code                       |
| **Complete Chat API**      | Send text, media, forward, delete, read messages                  |
| **Broadcast Queue**        | Bulk message sending with anti-spam delays                        |
| **Group & Profile**        | Full management (create, participants, status, picture)           |
| **Media Handling**         | Download, process, retrieve, and auto-cleanup old media           |
| **Webhook System**         | Event notifications with retry & exponential backoff              |
| **Dual Auth State**        | Save session data to Files (dev) or Redis (production)            |
| **API Authentication**     | Bearer token or Redis-stored API keys with roles                  |
| **Swagger/OpenAPI**        | Built-in interactive API documentation at `/docs`                 |
| **Docker Support**         | Ready-to-use Dockerfiles for both Bun and Node.js                 |

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

## 🐳 Docker Deployment

The project provides configurations for both runtimes. Redis is highly recommended and included in the `docker-compose` setups.

#### Option A: Docker with Bun (Default & Recommended)

```bash
docker compose up -d
docker compose logs -f api
```

#### Option B: Docker with Node.js

If you prefer forcing the native Node.js container:

```bash
docker compose -f docker-compose.node.yml up -d
docker compose -f docker-compose.node.yml logs -f api
```

To stop containers: `docker compose down`

---

## 🖥️ Visual Dashboard

The API includes an intuitive, modular web dashboard to manage everything visually without touching the CLI.

### Dashboard Configuration (`.env`)

```env
DASHBOARD_ENABLED=true
DASHBOARD_REGISTRATION_ENABLED=true
DASHBOARD_JWT_SECRET=super-secret-key-change-me
```

### Initial Setup

1. Open `http://localhost:3000/dashboard/` in your browser.
2. If `data/dashboard-users.json` is empty, you will be prompted to create the very first **Admin Account**.
3. Create your account with a secure password (hashed via `bcryptjs`).
4. Once created, recommended to set `DASHBOARD_REGISTRATION_ENABLED=false` in `.env` to prevent public sign-ups.

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

Use header: `Authorization: Bearer your-secret-token-here`

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
├── src/
│   ├── index.ts                    # Conditional entry point (loads Bun or Node server).
│   ├── app.ts                      # Hono app + Swagger + routes
│   ├── config.ts                   # Centralized .env config
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
│   ├── lib/
│   │   ├── runtime.ts              # The magic abstraction layer that enables dual-runtime compatibility for file reading & bcrypt hashing.
│   ├── dashboard/                   # Modular backend APIs for the visual UI.
│   ├── dashboard-ui/                # Modular Frontend SPA for the visual UI.
│   ├── routes/
│   │   ├── session.ts              # Session CRUD
│   │   ├── chat.ts                 # Chat operations
│   │   ├── group.ts                # Group management
│   │   ├── profile.ts              # Profile management
│   │   ├── media.ts                # Media handling
│   │   ├── story.ts                # Story broadcasting
│   │   └── status.ts               # Server health
│   ├── middleware/
│   │   ├── auth.ts                 # API authentication
│   │   └── sessionValidator.ts     # Session existence check
│   ├── services/
│   │   ├── broadcastQueue.ts       # Broadcast queue with delays
│   │   └── mediaCleanup.ts         # Media file cleanup
│   ├── lib/
│   │   ├── redis.ts                # Redis client
│   │   ├── logger.ts               # Pino logger
│   │   └── response.ts             # API response helpers
│   └── utils/
│       ├── asyncSleep.ts           # Async sleep utilities
│       ├── phone.ts                # Phone/JID formatting
│       └── validation.ts           # Validation utilities
├── data/                            # JSON storage for Dashboard Users and Webhooks.
├── media/                           # Auto-downloaded media files from chats.
├── scripts/
│   └── manage-api-keys.ts          # API key management CLI
├── sessions/                        # Auto-generated auth state & JSON stores per session.
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── biome.jsonc
└── README.md
```

---

## ⚙️ Configuration Reference (`.env`)

| Variable                         | Default                  | Description                                  |
| -------------------------------- | ------------------------ | -------------------------------------------- |
| `NODE_ENV`                       | `development`            | Environment (`development` / `production`)   |
| `HOST`                           | `0.0.0.0`                | Server host                                  |
| `PORT`                           | `3000`                   | Server port                                  |
| `LOG_LEVEL`                      | `info`                   | Log level (`debug`, `info`, `warn`, `error`) |
| `AUTH_GLOBAL_TOKEN`              | —                        | Simple auth token                            |
| `REDIS_ENABLED`                  | `false`                  | Enable Redis integration                     |
| `REDIS_URL`                      | `redis://localhost:6379` | Redis connection URL                         |
| `REDIS_PASSWORD`                 | —                        | Redis password                               |
| `BAILEYS_LOG_LEVEL`              | `warn`                   | Baileys internal log level                   |
| `MAX_RETRIES`                    | `5`                      | Max reconnection attempts                    |
| `RECONNECT_INTERVAL`             | `5000`                   | Reconnection delay (ms)                      |
| `WEBHOOK_URL`                    | —                        | Default webhook URL                          |
| `WEBHOOK_ALLOWED_EVENTS`         | `ALL`                    | Comma-separated event filter                 |
| `WEBHOOK_RETRY_MAX`              | `3`                      | Webhook delivery retry count                 |
| `BROADCAST_MIN_DELAY_MS`         | `1500`                   | Min delay between bulk messages              |
| `BROADCAST_MAX_DELAY_MS`         | `3000`                   | Max delay between bulk messages              |
| `BROADCAST_BATCH_SIZE`           | `10`                     | Messages per batch before pause              |
| `BROADCAST_BATCH_PAUSE_MS`       | `5000`                   | Pause between batches                        |
| `MEDIA_INCLUDE_BASE64`           | `false`                  | Include media in webhooks                    |
| `MEDIA_CLEANUP_ENABLED`          | `true`                   | Auto-delete old media files                  |
| `MEDIA_MAX_AGE_HOURS`            | `24`                     | Max age of media files                       |
| `CORS_ORIGIN`                    | `*`                      | CORS allowed origins                         |
| `DASHBOARD_ENABLED`              | `true`                   | Enable internal UI dashboard                 |
| `DASHBOARD_REGISTRATION_ENABLED` | `true`                   | Allow account creation                       |

---

## 📝 License

MIT
