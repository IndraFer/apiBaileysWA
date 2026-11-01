import fs from "node:fs";
import path from "node:path";
import { swaggerUI } from "@hono/swagger-ui";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import config from "@/config";
import { loadDashboard } from "@/dashboard/loader";
import { generateOpenApiSpec } from "@/docs/openapi";
import appLogger from "@/lib/logger";
import { isSecureRequest } from "@/lib/request";
import { error, success } from "@/lib/response";
import { authMiddleware } from "@/middleware/auth";
import { generalRateLimit } from "@/middleware/rateLimit";
import chatRoutes from "@/routes/chat";
import groupRoutes from "@/routes/group";
import mediaRoutes from "@/routes/media";
import profileRoutes from "@/routes/profile";
import sessionRoutes from "@/routes/session";
import statusRoutes from "@/routes/status";
import storyRoutes from "@/routes/story";

const app = new Hono();

// ── Global Middleware ───────────────────────────────
// CORS: never reflect arbitrary origins. An explicit CORS_ORIGIN list is
// honoured as-is; with the default "*" only same-origin requests are reflected,
// which keeps the public API usable from its own host without allowing
// cross-site credentialed reads.
const resolveCorsOrigin = (origin: string, c: Context) => {
  if (!origin) return origin; // curl / server-to-server: no CORS needed
  const configured = config.corsOrigin;
  if (configured !== "*") {
    return Array.isArray(configured)
      ? configured.includes(origin)
        ? origin
        : null
      : configured === origin
        ? origin
        : null;
  }
  try {
    const host = c.req.header("host");
    return host && new URL(origin).host === host ? origin : null;
  } catch {
    return null;
  }
};

const corsMiddleware = cors({ origin: resolveCorsOrigin });
app.use("*", corsMiddleware);

// Request ID: echo an incoming x-request-id (for tracing across reverse
// proxies) or mint a short one; every response carries it back.
app.use("*", async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const requestId =
    incoming || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  c.header("x-request-id", requestId);
  await next();
});

// The dashboard ships inline handlers/styles, hence 'unsafe-inline' for those two
// directives only. Everything else stays same-origin; clickjacking, base-uri and
// form hijacking are blocked outright.
const DASHBOARD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

app.use("*", async (c, next) => {
  const applyHeaders = (target: Headers) => {
    target.set("X-Frame-Options", "DENY");
    target.set("X-Content-Type-Options", "nosniff");
    target.set("Referrer-Policy", "no-referrer");
    target.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    target.set("Content-Security-Policy", DASHBOARD_CSP);
    if (isSecureRequest(c)) {
      target.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
  };

  // Context headers: needed before the handler so streaming responses (SSE)
  // carry them when the stream starts.
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Content-Security-Policy", DASHBOARD_CSP);
  if (isSecureRequest(c)) {
    c.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  await next();

  // Static dashboard files return a raw Response, which discards context
  // headers, so apply them to the final response as well.
  try {
    if (c.res?.headers) applyHeaders(c.res.headers);
  } catch {
    // Immutable headers (stream already started): the pre-set ones apply.
  }
});

// Behind a trusted proxy, refuse plain HTTP for the dashboard (cookies use the
// Secure flag, so an http request would silently lose the session anyway).
if (config.env === "production" && config.trustProxy) {
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/dashboard") && !isSecureRequest(c)) {
      const host = c.req.header("host") ?? "";
      return c.redirect(`https://${host}${c.req.path}`, 308);
    }
    return next();
  });
}

// The dashboard is same-origin by design: reject requests that carry a foreign
// Origin header, so a compromised/malicious page cannot drive dashboard APIs.
app.use("/dashboard/*", async (c, next) => {
  const origin = c.req.header("origin");
  if (origin) {
    const host = c.req.header("host") ?? "";
    try {
      if (new URL(origin).host !== host) {
        return c.json({ success: false, message: "Cross-origin dashboard request rejected" }, 403);
      }
    } catch {
      return c.json({ success: false, message: "Invalid Origin header" }, 403);
    }
  }
  return next();
});

// Body size limit: 10MB max to prevent DoS
app.use("*", bodyLimit({ maxSize: 10 * 1024 * 1024 }));

// General rate limit: 100 req/min per IP (production only)
if (config.env === "production") {
  app.use("*", generalRateLimit);
}

if (config.env === "development") {
  app.use("*", honoLogger());
}

// ── Error Handler ───────────────────────────────────
app.onError((err, c) => {
  appLogger.error("Unhandled error: %s", err.stack || err.message);
  const message = config.env === "development" ? err.message : "Internal server error";
  return error(c, message, 500);
});

// ── OpenAPI / Swagger Documentation ─────────────────

// Cache package.json at startup instead of reading on every request
const pkgPath = path.join(process.cwd(), "package.json");
let cachedPkg: Record<string, unknown>;
try {
  cachedPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
} catch {
  cachedPkg = { name: "Baileys WA API", version: "1.0.0", description: "" };
}

app.get("/docs", swaggerUI({ url: "/openapi.json" }));

app.get("/openapi.json", (_c) => {
  const pkg = cachedPkg;
  const spec = generateOpenApiSpec(pkg, config.port);
  return new Response(JSON.stringify(spec, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
});

// ── Routes ──────────────────────────────────────────
app.route("/status", statusRoutes);
app.route("/sessions", sessionRoutes);
app.route("/chats", chatRoutes);
app.route("/groups", groupRoutes);
app.route("/profile", profileRoutes);
app.route("/media", mediaRoutes);
app.route("/story", storyRoutes);

// ── Config Endpoints ────────────────────────────────
app.get("/config/simulation", authMiddleware, (c) => {
  return success(c, {
    typingBeforeSend: config.simulation.typingBeforeSend,
    typingDelayMinMs: config.simulation.typingDelayMinMs,
    typingDelayMaxMs: config.simulation.typingDelayMaxMs,
    autoReadMessages: config.simulation.autoReadMessages,
    autoMarkOnline: config.simulation.autoMarkOnline,
    rejectCalls: config.simulation.rejectCalls,
  });
});

// ── Dashboard (modular — never breaks main API) ────
try {
  loadDashboard(app);
} catch (err) {
  appLogger.warn("Dashboard failed to load: %s", (err as Error).message);
}

// ── 404 Handler ─────────────────────────────────────
app.notFound((c) => {
  return c.json({ success: false, message: "Route not found" }, 404);
});

export default app;
