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
import chatRoutes from "@/routes/chat";
import type { ResolvedSendMessageConfig } from "@/services/aiSendTool";
import type { ConversationRouter, RouterGeneration } from "@/services/conversationRouter";
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
    sendMessage: async (jid: string, _message?: unknown, options?: { messageId?: string }) => {
      sent.push(jid);
      return { key: { id: options?.messageId ?? randomUUID() } };
    },
  };
  const inbound = session as unknown as {
    _isConnected: boolean;
    aiRouter: ConversationRouter;
    socket: typeof socket;
    generateAiReply: (input: {
      conversationId: string;
      texts: string[];
    }) => Promise<RouterGeneration>;
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
  const dashboardReply = (receiver: string) =>
    dashboardApi.request(`/sessions/${id}/chats/send-text`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ receiver, text: "Operator reply" }),
    });
  const generate = spyOn(inbound, "generateAiReply").mockResolvedValue({
    ok: true,
    text: "AI reply",
  });
  // Drive the real debounce flush without waiting for its wall-clock timer.
  const flush = (jid: string) =>
    (inbound.aiRouter as unknown as { flush: (jid: string) => Promise<void> }).flush(jid);
  return {
    id,
    session,
    sent,
    webhook,
    socket,
    takeover,
    receive,
    tool,
    dashboardReply,
    generate,
    flush,
  };
}

function message(
  jid: string,
  content: WAMessage["message"] = { conversation: "Hello" },
): WAMessage {
  return { key: { id: randomUUID(), remoteJid: jid, fromMe: false }, message: content };
}

const humanIdleMs = 15 * 60_000;
const handoffPauseMs = 7 * 60_000;
const routingOptions: Partial<SessionOptions> = {
  ai: {
    enabled: true,
    mode: "always",
    driver: "webhook",
    agentUrl: "https://example.invalid/agent",
    model: "fixture",
  },
  routing: {
    batchIdleMs: 60_000,
    batchMaxWaitMs: 60_000,
    maxBatchMessages: 10,
    humanIdleMs,
    handoffPauseMs,
  },
};

function fakeClock() {
  const start = Math.floor(Date.now() / 1_000) * 1_000;
  const clock = spyOn(Date, "now").mockReturnValue(start);
  cleanup.push(() => clock.mockRestore());
  return { start, advance: (ms: number) => clock.mockReturnValue(start + ms) };
}

function operatorMessage(jid: string): WAMessage {
  const manual = message(jid, { conversation: "Operator on phone or Web" });
  manual.key.fromMe = true;
  manual.messageTimestamp = Math.floor(Date.now() / 1_000);
  return manual;
}

test("a phone or Web reply drops the pending batch and renews human idle from the latest reply", async () => {
  const f = await fixture(routingOptions);
  const clock = fakeClock();
  await f.receive(message(lid));
  expect(f.session.aiPending).toBe(1);
  await f.receive(operatorMessage(phone));
  expect(f.session.humanOwnedUntil(lid)).toBe(clock.start + humanIdleMs);
  expect(f.session.aiPending).toBe(0);
  const later = 5 * 60_000;
  clock.advance(later);
  await f.receive(operatorMessage(lid));
  expect(f.session.humanOwnedUntil(phone)).toBe(clock.start + later + humanIdleMs);
  clock.advance(later + humanIdleMs - 1);
  await f.receive(message(lid, { conversation: "During hold" }));
  expect(f.session.aiPending).toBe(0);
  clock.advance(later + humanIdleMs);
  await f.flush(lid);
  expect(f.generate).not.toHaveBeenCalled();
  await f.receive(message(lid, { conversation: "Fresh after hold" }));
  await f.flush(lid);
  expect(f.generate.mock.calls.map(([input]) => input.texts)).toEqual([["Fresh after hold"]]);
  expect(f.sent).toEqual([lid]);
});

test("a phone reply while AI generation is in flight blocks delivery and failure fallback", async () => {
  const f = await fixture(routingOptions);
  for (const result of [
    { ok: true, text: "AI reply" },
    { ok: false, error: "Model failed" },
  ]) {
    const clock = fakeClock();
    const started = Promise.withResolvers<void>();
    const model = Promise.withResolvers<RouterGeneration>();
    f.generate.mockImplementationOnce(() => {
      started.resolve();
      return model.promise;
    });
    await f.receive(message(lid));
    const job = f.flush(lid);
    try {
      await started.promise;
      await f.receive(operatorMessage(phone));
    } finally {
      model.resolve(result);
      await job;
    }
    expect(f.sent).toEqual([]);
    clock.advance(humanIdleMs);
  }
});

test("expiry does not revive an AI generation superseded by a manual reply", async () => {
  const f = await fixture(routingOptions);
  const clock = fakeClock();
  const started = Promise.withResolvers<void>();
  const model = Promise.withResolvers<RouterGeneration>();
  f.generate.mockImplementationOnce(() => {
    started.resolve();
    return model.promise;
  });
  await f.receive(message(lid));
  const job = f.flush(lid);
  try {
    await started.promise;
    await f.receive(operatorMessage(phone));
    await job;
    clock.advance(humanIdleMs);
    expect(f.sent).toEqual([]);
    await f.receive(message(lid));
    await f.flush(lid);
    expect(f.sent).toEqual([lid]);
  } finally {
    model.resolve({ ok: true, text: "Stale model response" });
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(f.sent).toEqual([lid]);
});

test("history recovery honors a recent phone reply under the other room address", async () => {
  const f = await fixture(routingOptions);
  const clock = fakeClock();
  const reply = operatorMessage(phone);
  f.session.getStore().messages.set(phone, new Map([[reply.key.id ?? "", reply]]));
  await f.receive(message(lid));
  expect(f.session.humanOwnedUntil(lid)).toBe(clock.start + humanIdleMs);
  expect(f.session.aiPending).toBe(0);
  expect(f.sent).toEqual([]);
});

test("dashboard reply suppresses both addresses before routing, without answering a late webhook backlog", async () => {
  const f = await fixture(routingOptions);
  const clock = fakeClock();
  await f.receive(message(lid));
  const reply = await f.dashboardReply(phone);
  expect(reply.status).toBe(200);
  expect((await reply.json()).data.pausedUntil).toBe(clock.start + humanIdleMs);
  expect(f.session.aiPending).toBe(0);
  await f.receive(message(phone), message(lid, { locationMessage: {} }));
  expect(f.session.aiPending).toBe(0);
  expect(f.sent).toEqual([phone]);

  const webhook = Promise.withResolvers<string>();
  f.webhook.mockReturnValueOnce(webhook.promise);
  const late = f.receive(message(lid, { conversation: "Received during hold" }));
  clock.advance(humanIdleMs);
  webhook.resolve("failed");
  await late;
  await f.flush(phone);
  await f.flush(lid);
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.sent).toEqual([phone]);
});

test("an API send echo does not trigger the human idle timer even before the send returns", async () => {
  const f = await fixture(routingOptions);
  const transport = spyOn(f.socket, "sendMessage").mockImplementation(
    async (jid, _message, options) => {
      const echo = operatorMessage(jid);
      echo.key.id = options?.messageId ?? randomUUID();
      await f.receive(echo);
      return { key: { id: echo.key.id } };
    },
  );
  await f.session.sendMessage(phone, { text: "Transactional send" });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(f.session.humanOwnedUntil(lid)).toBe(0);
  await f.receive(message(lid));
  expect(f.session.aiPending).toBe(1);
});

test("human handover uses the configured timer, drops the pending batch and honors an explicit duration", async () => {
  const f = await fixture(routingOptions);
  const clock = fakeClock();
  const enabled = spyOn(connectionManager, "hasSession").mockReturnValue(true);
  const globalToken = config.auth.globalToken;
  config.auth.globalToken = "fixture-handoff-token";
  cleanup.push(() => {
    enabled.mockRestore();
    config.auth.globalToken = globalToken;
  });
  const handoff = (pauseMinutes?: number) =>
    chatRoutes.request(`/${f.id}/handoff`, {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-handoff-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversationId: "628111001001", pauseMinutes }),
    });
  await f.receive(message(lid));
  expect(f.session.aiPending).toBe(1);
  const result = await handoff();
  expect(result.status).toBe(200);
  expect((await result.json()).data.pausedUntil).toBe(clock.start + handoffPauseMs);
  expect(f.session.humanOwnedUntil(lid)).toBe(clock.start + handoffPauseMs);
  expect(f.session.aiPending).toBe(0);
  await f.receive(message(lid, { locationMessage: {} }));
  expect(f.sent).toEqual([]);
  clock.advance(handoffPauseMs);
  await f.flush(lid);
  expect(f.generate).not.toHaveBeenCalled();
  await f.receive(message(lid, { conversation: "Fresh after handover" }));
  await f.flush(lid);
  expect(f.generate.mock.calls.map(([input]) => input.texts)).toEqual([["Fresh after handover"]]);
  const override = await handoff(3);
  expect(override.status).toBe(200);
  expect((await override.json()).data.pausedUntil).toBe(clock.start + handoffPauseMs + 180_000);
});

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
