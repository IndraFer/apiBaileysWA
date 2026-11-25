import { afterEach, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { BaileysEventMap, WAMessage } from "@whiskeysockets/baileys";
import { sign } from "hono/jwt";
import { BaileysConnection } from "@/baileys/connection";
import connectionManager from "@/baileys/connectionManager";
import type { SessionOptions } from "@/baileys/types";
import config from "@/config";
import dashboardApi from "@/dashboard/api";
import agentRoutes from "@/routes/agent";
import type { ResolvedSendMessageConfig } from "@/services/aiSendTool";
import { clearTakeover } from "@/services/manualTakeover";

const phone = "628111001001@s.whatsapp.net";
const lid = "901001001@lid";
const other = "628111001002@s.whatsapp.net";
const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const restore of cleanup.splice(0).reverse()) await restore();
});

async function fixture(options: Partial<SessionOptions> = {}, webhookFailed = false) {
  const id = `takeover_test_${randomUUID()}`;
  const session = new BaileysConnection(id, {
    autoReadMessages: false,
    autoMarkOnline: false,
    simulateTyping: false,
    autoReply: { enabled: true, message: "Static reply", type: "always", policy: "both" },
    routing: { batchIdleMs: 60_000, batchMaxWaitMs: 60_000, maxBatchMessages: 10 },
    ai: { enabled: false },
    ...options,
  });
  const sent: string[] = [];
  const socket = {
    presenceSubscribe: async (_jid: string) => {},
    sendMessage: async (jid: string) => {
      sent.push(jid);
      return { key: { id: randomUUID() } };
    },
  };
  const inbound = session as unknown as {
    _isConnected: boolean;
    socket: typeof socket;
    sendToWebhook: () => Promise<string>;
    humanizeReadStep: () => Promise<void>;
    handleMessagesUpsert: (payload: BaileysEventMap["messages.upsert"]) => Promise<void>;
    runAiSendTool: (
      payload: { receiver?: string; text: string },
      jid: string,
      settings: ResolvedSendMessageConfig,
    ) => Promise<{ ok: boolean }>;
  };
  inbound.socket = socket;
  inbound._isConnected = true;
  const webhook = spyOn(inbound, "sendToWebhook").mockResolvedValue(
    webhookFailed ? "failed" : "success",
  );
  spyOn(inbound, "humanizeReadStep").mockResolvedValue(undefined);
  session.getStore().registerLidMapping(lid, phone);
  const lookup = spyOn(connectionManager, "getSession").mockReturnValue(session);
  cleanup.push(async () => {
    lookup.mockRestore();
    session.markDeleted();
    await session.destroy();
    for (const jid of [phone, lid, other]) clearTakeover(id, jid);
    rmSync(`sessions/md_${id}`, { recursive: true, force: true });
  });
  const token = await sign(
    { sub: "operator", username: "operator", role: "admin" },
    config.dashboard.jwtSecret,
  );
  const takeover = async (method = "POST") => {
    const response = await dashboardApi.request(`/sessions/${id}/chats/${phone}/takeover`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
  };
  const receive = (...messages: WAMessage[]) =>
    inbound.handleMessagesUpsert({ type: "notify", messages });
  const tool = (origin: string, receiver: string) =>
    inbound.runAiSendTool({ receiver, text: "AI tool reply" }, origin, {
      enabled: true,
      scope: "allowlist",
      allowlist: [lid, other],
      maxPerHour: 10,
    });
  return { id, session, sent, webhook, socket, takeover, receive, tool };
}

function message(
  jid: string,
  content: WAMessage["message"] = { conversation: "Hello" },
): WAMessage {
  return { key: { id: randomUUID(), remoteJid: jid, fromMe: false }, message: content };
}

test("dashboard takeover blocks AI queueing for the same contact under its LID", async () => {
  const f = await fixture({
    ai: {
      enabled: true,
      mode: "always",
      driver: "webhook",
      agentUrl: "https://example.invalid/agent",
      model: "fixture",
    },
  });
  // Confirm that the configured driver can enqueue before claiming the room.
  await f.receive(message(lid));
  expect(f.session.aiPending).toBe(1);
  await f.takeover();
  await f.receive(message(lid));
  expect(f.session.aiPending).toBe(0);
  expect(f.sent).toEqual([]);
  expect(f.webhook).toHaveBeenCalledTimes(2);
});

test("held location messages cannot trigger fallback on webhook failure, even in a mixed batch", async () => {
  const f = await fixture(
    {
      autoReply: {
        enabled: true,
        message: "Static reply",
        type: "on_webhook_fail",
        policy: "fallback",
      },
    },
    true,
  );
  await f.takeover();
  await f.receive(message(phone, { locationMessage: {} }), message(other));
  expect(f.sent).toEqual([other]);
  await f.takeover("DELETE");
  await f.receive(message(phone, { locationMessage: {} }));
  expect(f.sent).toEqual([other, phone]);
});

test("takeover during simulated typing blocks socket delivery but not operator sends", async () => {
  const f = await fixture({ simulateTyping: true });
  const started = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const thinkMin = config.humanize.thinkMinMs;
  config.humanize.thinkMinMs = 0;
  cleanup.push(() => {
    config.humanize.thinkMinMs = thinkMin;
  });
  spyOn(f.socket, "presenceSubscribe").mockImplementation(async () => {
    started.resolve();
    await resume.promise;
    throw new Error("Fixture does not send real typing presence");
  });
  const pending = f.receive(message(phone));
  try {
    await started.promise;
    await f.takeover();
  } finally {
    resume.resolve();
    await pending;
  }
  expect(f.sent).toEqual([]);
  await f.session.sendMessage(phone, { text: "Manual reply" }, { simulateTyping: false });
  expect(f.sent).toEqual([phone]);
});

test("the AI send tool refuses automation from or into a held room", async () => {
  const f = await fixture();
  const exists = spyOn(f.session, "isOnWhatsApp").mockResolvedValue(true);
  await f.takeover();
  expect((await f.tool(lid, other)).ok).toBe(false);
  expect((await f.tool(other, lid)).ok).toBe(false);
  expect(f.sent).toEqual([]);
  expect(exists).not.toHaveBeenCalled();
  await f.takeover("DELETE");
  expect((await f.tool(lid, other)).ok).toBe(true);
  expect(f.sent).toEqual([other]);
});

test("agent replies with a bare number are refused while the room is held", async () => {
  const f = await fixture();
  const enabled = spyOn(connectionManager, "hasSession").mockReturnValue(true);
  const exists = spyOn(f.session, "isOnWhatsApp").mockResolvedValue(true);
  const token = config.ai.serviceToken;
  const globalToken = config.auth.globalToken;
  config.ai.serviceToken = "fixture-agent-token";
  config.auth.globalToken = "fixture-global-token";
  cleanup.push(() => {
    enabled.mockRestore();
    exists.mockRestore();
    config.ai.serviceToken = token;
    config.auth.globalToken = globalToken;
  });
  const reply = (receiver = "628111001001") =>
    agentRoutes.request(`/${f.id}/reply`, {
      method: "POST",
      headers: { Authorization: "Bearer fixture-agent-token", "Content-Type": "application/json" },
      body: JSON.stringify({ receiver, message: { text: "Agent reply" } }),
    });
  await f.takeover();
  expect((await reply()).status).toBe(409);
  expect((await reply(lid)).status).toBe(409);
  expect(f.sent).toEqual([]);
  await f.takeover("DELETE");

  // The hold can start after the first guard while the phone lookup awaits.
  const started = Promise.withResolvers<void>();
  const registration = Promise.withResolvers<boolean>();
  exists.mockImplementationOnce(() => {
    started.resolve();
    return registration.promise;
  });
  const pending = reply();
  try {
    await started.promise;
    await f.takeover();
  } finally {
    registration.resolve(true);
  }
  expect((await pending).status).toBe(409);
  expect(f.sent).toEqual([]);

  await f.takeover("DELETE");
  expect((await reply()).status).toBe(200);
  expect(f.sent).toEqual([phone]);
});
