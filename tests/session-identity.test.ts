import { expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sign } from "hono/jwt";
import * as authState from "@/baileys/authState";
import { BaileysConnection } from "@/baileys/connection";
import connectionManager from "@/baileys/connectionManager";
import config from "@/config";
import dashboardApi from "@/dashboard/api";
import * as sessionOwners from "@/dashboard/sessionOwners";
import messageRoutes from "@/routes/messages";
import * as apiKeys from "@/services/apiKeys";

async function dashboardHeaders(role: "admin" | "manager") {
  const jwt = await sign(
    { sub: `fixture-${role}`, username: "fixture", role, exp: Math.floor(Date.now() / 1000) + 60 },
    config.dashboard.jwtSecret,
  );
  return { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
}

function jsonRequest(headers: Record<string, string>, body: unknown) {
  return { method: "POST", headers, body: JSON.stringify(body) };
}

test("dashboard managers can create the same display name without proposing an ID", async () => {
  const create = spyOn(connectionManager, "createSession").mockResolvedValue({ qrCode: "fixture" });
  const owner = spyOn(sessionOwners, "setSessionOwner").mockResolvedValue(undefined);
  const headers = { ...(await dashboardHeaders("manager")), "x-request-id": "fixture" };
  const admin = await dashboardHeaders("admin");
  const name = `Pesan WA ${randomUUID()}`;
  try {
    const first = await dashboardApi.request(
      "/sessions",
      jsonRequest(admin, { sessionName: name }),
    );
    const second = await dashboardApi.request(
      "/sessions",
      jsonRequest(headers, { sessionName: name, sessionId: "ignored", freshAuth: true }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const { data: a } = await first.json();
    const { data: b } = await second.json();
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(b.sessionId).not.toBe("ignored");
    expect(create.mock.calls.map(([id, options]) => [id, options.sessionName])).toEqual([
      [a.sessionId, name],
      [b.sessionId, name],
    ]);
    expect(owner).toHaveBeenCalledWith(b.sessionId, "fixture-manager");
    const existing = await dashboardApi.request(
      `/sessions/${a.sessionId}`,
      jsonRequest(headers, {}),
    );
    const absent = await dashboardApi.request("/sessions/does-not-exist", jsonRequest(headers, {}));
    expect(existing.status).toBe(403);
    expect(absent.status).toBe(403);
    expect(await existing.json()).toEqual(await absent.json());
    expect(create).toHaveBeenCalledTimes(2);
  } finally {
    create.mockRestore();
    owner.mockRestore();
  }
});

test("Pair reopens an unpaired session with its saved name; renaming keeps its ID and settings", async () => {
  const sessionId = `unpaired-${randomUUID()}`;
  const path = `/sessions/${sessionId}`;
  const admin = await dashboardHeaders("admin");
  const known = spyOn(authState, "listKnownSessions").mockResolvedValue([
    {
      id: sessionId,
      paired: false,
      metadata: { sessionName: "Original Name", syncFullHistory: true },
    },
  ]);
  const connect = spyOn(BaileysConnection.prototype, "connect").mockResolvedValue({
    qrCode: "fixture",
  });
  const logout = spyOn(BaileysConnection.prototype, "logout").mockImplementation(function (
    this: BaileysConnection,
  ) {
    return this.destroy();
  });
  const persist = spyOn(authState, "updateSessionMetadata").mockResolvedValue(undefined);
  const deleteAuth = spyOn(authState, "deleteAuthState").mockResolvedValue(undefined);
  const revoke = spyOn(apiKeys, "revokeApiKeysForSession").mockResolvedValue(0);
  try {
    expect(connectionManager.hasSession(sessionId)).toBe(false);
    const paired = await dashboardApi.request(`${path}/reconnect`, jsonRequest(admin, {}));
    expect(paired.status).toBe(200);
    expect((await paired.json()).data.qrCode).toBe("fixture");
    expect(connectionManager.getSession(sessionId).getOptions().sessionName).toBe("Original Name");
    const renamed = await dashboardApi.request(`${path}/settings`, {
      ...jsonRequest(admin, { sessionName: "New Name" }),
      method: "PATCH",
    });
    expect(renamed.status).toBe(200);
    expect(persist).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        sessionName: "New Name",
        syncFullHistory: true,
      }),
    );
    const list = await dashboardApi.request("/sessions", { headers: admin });
    const { data } = await list.json();
    expect(
      data.find((session: { sessionId: string }) => session.sessionId === sessionId),
    ).toMatchObject({
      sessionName: "New Name",
      paired: false,
    });
  } finally {
    if (connectionManager.hasSession(sessionId)) await connectionManager.deleteSession(sessionId);
    known.mockRestore();
    connect.mockRestore();
    logout.mockRestore();
    persist.mockRestore();
    deleteAuth.mockRestore();
    revoke.mockRestore();
  }
});

test("unified send ignores from and sends only from the authenticated key's one session", async () => {
  const sessionId = `bound-${randomUUID()}`;
  const token = `fixture-${randomUUID()}`;
  const configEnv = config.env;
  const originalGlobalToken = config.auth.globalToken;
  config.env = "production";
  config.auth.globalToken = "legacy-global-token";
  const lookup = spyOn(apiKeys, "findApiKeyByToken").mockImplementation(async (value) =>
    value === token
      ? { id: token, label: "fixture", role: "user", sessions: [sessionId] }
      : value === "global-fixture"
        ? { id: "global-fixture", label: "fixture", role: "user", sessions: ["*"] }
        : null,
  );
  const status = spyOn(connectionManager, "getSessionStatus").mockImplementation((id) => ({
    exists: id === sessionId,
    connected: id === sessionId,
    user: null,
    qrCode: null,
  }));
  // SAFETY: The route only calls isOnWhatsApp and sendMessage on this connection double.
  const conn = spyOn(connectionManager, "getSession").mockReturnValue({
    isOnWhatsApp: async () => true,
    sendMessage: async () => ({ key: { id: "sent" } }),
  } as unknown as ReturnType<typeof connectionManager.getSession>);
  const send = (from?: unknown, credential = token) =>
    messageRoutes.request(
      "/",
      jsonRequest(
        { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
        { receiver: "628123450033", messages: "fixture", ...(from === undefined ? {} : { from }) },
      ),
    );
  try {
    for (const from of [undefined, "another-session", { arbitrary: true }]) {
      expect((await send(from)).status).toBe(200);
      expect(conn).toHaveBeenLastCalledWith(sessionId);
    }
    for (const from of [undefined, sessionId]) {
      const global = await send(from, "global-fixture");
      expect(global.status).toBe(403);
      expect((await global.json()).code).toBe("SESSION_KEY_REQUIRED");
    }
    expect((await send(sessionId, "legacy-global-token")).status).toBe(403);
    expect((await send(sessionId, "invalid-fixture")).status).toBe(401);
    config.env = "development";
    expect((await send()).status).toBe(200);
    status.mockReturnValueOnce({ exists: true, connected: false, user: null, qrCode: null });
    const offline = await send("another-session");
    expect(offline.status).toBe(409);
    expect((await offline.json()).code).toBe("SESSION_NOT_CONNECTED");
    expect(conn).toHaveBeenCalledTimes(4);
    const contract = await (await messageRoutes.request("/schema")).json();
    expect(contract.properties.from).toBeUndefined();
  } finally {
    config.env = configEnv;
    config.auth.globalToken = originalGlobalToken;
    lookup.mockRestore();
    status.mockRestore();
    conn.mockRestore();
  }
});
