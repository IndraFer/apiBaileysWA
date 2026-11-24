import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createCipheriv, createHmac, randomUUID } from "node:crypto";
import { getMediaKeys, type WAMessage } from "@whiskeysockets/baileys";
import { sign } from "hono/jwt";
import connectionManager from "@/baileys/connectionManager";
import config from "@/config";
import dashboardApi from "@/dashboard/api";

const sessionId = `media-test-${randomUUID()}`;
const jid = "628111222333@s.whatsapp.net";
const path = `/sessions/${sessionId}/chats/${encodeURIComponent(jid)}`;
const plain = Buffer.from("sample image bytes");

async function auth(role: "admin" | "assistant" = "admin") {
  const token = await sign(
    { sub: "media-test", username: "test", role, exp: Math.floor(Date.now() / 1000) + 60 },
    config.dashboard.jwtSecret,
  );
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

afterEach(() => {
  // Scope integration doubles to this file; the store and auth contracts stay real.
  sessionSpy?.mockRestore();
  statusSpy?.mockRestore();
  fetchSpy?.mockRestore();
  sessionSpy = undefined;
  statusSpy = undefined;
  fetchSpy = undefined;
});

let sessionSpy: ReturnType<typeof spyOn<typeof connectionManager, "getSession">> | undefined;
let statusSpy: ReturnType<typeof spyOn<typeof connectionManager, "getSessionStatus">> | undefined;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;

function withPreconnect(
  implementation: (...args: Parameters<typeof fetch>) => Promise<Response>,
): typeof fetch {
  return Object.assign(implementation, { preconnect: globalThis.fetch.preconnect });
}

async function fixture() {
  const key = Buffer.alloc(32, 28);
  const { cipherKey, iv, macKey } = await getMediaKeys(key, "image");
  if (!macKey) throw new Error("Fixture requires a MAC key");
  const cipher = createCipheriv("aes-256-cbc", cipherKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const mac = createHmac("sha256", macKey).update(iv).update(ciphertext).digest().subarray(0, 10);
  const wire = Buffer.concat([ciphertext, mac]);
  const image = {
    message: {
      imageMessage: {
        directPath: "/v/media-fixture",
        mimetype: "image/png",
        mediaKey: key,
      },
    },
    key: { remoteJid: jid, id: "image" },
  } satisfies WAMessage;
  const messages: WAMessage[] = [
    image,
    {
      key: { remoteJid: jid, id: "cta" },
      message: {
        interactiveMessage: {
          body: { text: "Appointment details" },
          nativeFlowMessage: {
            buttons: [
              {
                name: "cta_url",
                buttonParamsJson: '{"display_text":"See details","url":"https://example.com/"}',
              },
              {
                name: "cta_url",
                buttonParamsJson: '{"display_text":"Unsafe","url":"data:text/html,hidden"}',
              },
            ],
          },
        },
      },
    },
    {
      key: { remoteJid: jid, id: "once" },
      message: { viewOnceMessageV2: { message: image.message } },
    },
    {
      key: { remoteJid: jid, id: "document" },
      message: { documentMessage: { fileName: "report.html", mimetype: "text/html" } },
    },
    {
      key: { remoteJid: jid, id: "unknown" },
      message: { keepInChatMessage: {} },
    },
  ];
  const store = {
    getMessage: (room: string, id: string) =>
      room === jid ? messages.find((msg) => msg.key.id === id) : undefined,
    loadMessages: (room: string) => (room === jid ? messages : []),
    identityFor: () => ({ name: "", phone: "" }),
    lidToPn: new Map<string, string>(),
    pnToLid: new Map<string, string>(),
    clearChat: () => messages.splice(0).length,
  };
  // SAFETY: The dashboard handlers under test only call getStore and chatModify on this double.
  sessionSpy = spyOn(connectionManager, "getSession").mockReturnValue({
    getStore: () => store,
    chatModify: async () => {},
  } as unknown as ReturnType<typeof connectionManager.getSession>);
  statusSpy = spyOn(connectionManager, "getSessionStatus").mockReturnValue({
    exists: true,
    connected: true,
    user: null,
    qrCode: null,
  });
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    withPreconnect(async () => new Response(wire)),
  );
  return { fetchSpy };
}

async function endChat(headers: HeadersInit, action = "end") {
  return dashboardApi.request(`/sessions/${sessionId}/chats/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jid }),
  });
}

describe("Chat Rooms attachment workflow", () => {
  test("renders media and CTA metadata without fetching bytes; keeps view-once/unknown placeholders", async () => {
    const { fetchSpy } = await fixture();
    const response = await dashboardApi.request(`${path}/messages`, { headers: await auth() });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.map((msg: { presentation: unknown }) => msg.presentation)).toEqual([
      expect.objectContaining({
        media: expect.objectContaining({ kind: "image", preview: "image" }),
      }),
      expect.objectContaining({
        text: "Appointment details",
        actions: [{ label: "See details", href: "https://example.com/" }, { label: "Unsafe" }],
      }),
      expect.objectContaining({ text: "[View Once Message]" }),
      expect.objectContaining({
        media: expect.objectContaining({ kind: "document", preview: null }),
      }),
      expect.objectContaining({ text: "[Unsupported Message]" }),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("scopes byte access, caches on demand, purges on End Chat and Clear Chat", async () => {
    const { fetchSpy } = await fixture();
    const request = `${path}/media/image`;
    const headers = await auth();
    try {
      expect((await dashboardApi.request(request)).status).toBe(401);
      expect(
        (await dashboardApi.request(request, { headers: await auth("assistant") })).status,
      ).toBe(403);
      expect((await dashboardApi.request(`${path}/media/once`, { headers })).status).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
      const preview = await dashboardApi.request(request, { headers });
      expect(preview.status).toBe(200);
      expect(preview.headers.get("Content-Type")).toBe("image/png");
      expect(preview.headers.get("Cache-Control")).toBe("private, no-store");
      expect(Buffer.from(await preview.arrayBuffer())).toEqual(plain);
      const range = await dashboardApi.request(request, {
        headers: { ...headers, Range: "bytes=1-3" },
      });
      expect(range.status).toBe(206);
      expect(await range.text()).toBe("amp");
      const download = await dashboardApi.request(`${request}?download=1`, { headers });
      expect(download.headers.get("Content-Disposition")).toStartWith("attachment;");
      expect(Buffer.from(await download.arrayBuffer())).toEqual(plain);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect((await endChat(headers)).status).toBe(200);
      const retry = await dashboardApi.request(request, { headers });
      expect(retry.status).toBe(200);
      expect(Buffer.from(await retry.arrayBuffer())).toEqual(plain);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect((await endChat(headers, "clear")).status).toBe(200);
      expect((await dashboardApi.request(request, { headers })).status).toBe(404);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      await endChat(headers);
    }
  });

  test("expires bytes three days from fetch, not from the last access", async () => {
    const { fetchSpy } = await fixture();
    const request = `${path}/media/image`;
    const headers = await auth();
    const start = Date.now();
    const clock = spyOn(Date, "now");
    const ttl = 3 * 24 * 60 * 60 * 1_000;
    const load = async () => {
      // JWT verification also uses the clock; mint a token for this instant.
      const result = await dashboardApi.request(request, { headers: await auth() });
      expect(result.status).toBe(200);
      expect(Buffer.from(await result.arrayBuffer())).toEqual(plain);
    };
    try {
      clock.mockReturnValue(start);
      await load();
      clock.mockReturnValue(start + ttl - 1_000);
      await load();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(start + ttl);
      await load();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
      await endChat(headers);
    }
  });

  test("does not keep an interrupted fetch after End Chat and signals expired upstream media", async () => {
    const { fetchSpy } = await fixture();
    const request = `${path}/media/image`;
    const headers = await auth();
    const started = Promise.withResolvers<void>();
    fetchSpy.mockImplementationOnce(
      withPreconnect(
        (_url, options) =>
          new Promise<Response>((_, reject) => {
            options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
              once: true,
            });
            started.resolve();
          }),
      ),
    );
    try {
      const interrupted = dashboardApi.request(request, { headers });
      await started.promise;
      expect((await endChat(headers)).status).toBe(200);
      expect((await interrupted).status).toBe(409);
      fetchSpy.mockImplementationOnce(
        withPreconnect(async () => new Response(null, { status: 410 })),
      );
      const unavailable = await dashboardApi.request(request, { headers });
      expect(unavailable.status).toBe(404);
      expect((await unavailable.json()).message).toBe("Media Unavailable");
      const retry = await dashboardApi.request(request, { headers });
      expect(retry.status).toBe(200);
      expect(Buffer.from(await retry.arrayBuffer())).toEqual(plain);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally {
      await endChat(headers);
    }
  });
});

test("the shared dashboard list sorts by name, then ID only for equal names", async () => {
  const live = spyOn(connectionManager, "listSessions").mockReturnValue(
    [
      { sessionId: "z-media-test", sessionName: "Alpha" },
      { sessionId: "b-media-test" },
      { sessionId: "A-media-test", sessionName: "Sales" },
      { sessionId: "a-media-test", sessionName: "sales" },
    ].map(({ sessionId, sessionName }, i) => ({
      sessionId,
      sessionName,
      ownerId: "",
      connected: i % 2 === 0,
      user: null,
      webhookUrl: "",
      hasWebhookSecret: false,
      webhookSecretLast4: "",
      webhookEvents: [],
      autoReply: undefined,
      autoReadMessages: undefined,
      autoMarkOnline: undefined,
      rejectCalls: undefined,
      lastActiveAt: i + 1,
      aiPending: 0,
    })),
  );
  try {
    const response = await dashboardApi.request("/sessions", { headers: await auth() });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(
      data
        .map((s: { sessionId: string }) => s.sessionId)
        .filter((id: string) => id.endsWith("-media-test")),
    ).toEqual(["z-media-test", "b-media-test", "A-media-test", "a-media-test"]);
    expect(
      data.find((entry: { sessionId: string }) => entry.sessionId === "b-media-test")?.sessionName,
    ).toBe("b-media-test");
  } finally {
    live.mockRestore();
  }
});
