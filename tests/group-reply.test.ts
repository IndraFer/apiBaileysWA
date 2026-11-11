import { describe, expect, test } from "bun:test";
import {
  isStaticReplyAllowed,
  readGroupAddressing,
  resolveGroupReply,
  shouldReplyInGroup,
  shouldReplyToGroupMessage,
} from "@/services/groupReply";

const botPn = "628111111111@s.whatsapp.net";
const botLid = "111111111111111@lid";
const aliases: Record<string, string> = {
  [botPn]: botLid,
  [botLid]: botPn,
};
const context = {
  selfJids: [botPn, botLid],
  aliasOf: (identity: string) => (aliases[identity] ? [aliases[identity]] : []),
};

const group = "120363000000000000@g.us";

function message(participant: string, content: Record<string, unknown>) {
  return { key: { remoteJid: group, participant }, message: content as never };
}

function text(text: string, contextInfo?: Record<string, unknown>) {
  return {
    extendedTextMessage: { text, ...(contextInfo ? { contextInfo } : {}) },
  };
}

describe("group reply policy", () => {
  test("defaults to mention and ignores unknown modes", () => {
    expect(resolveGroupReply().mode).toBe("mention");
    expect(resolveGroupReply({}).mode).toBe("mention");
    expect(resolveGroupReply({ mode: "wildcard" as never }).mode).toBe("mention");
    expect(resolveGroupReply({ mode: "all" }).mode).toBe("all");
    expect(resolveGroupReply({ senders: [" 628123 ", "628123", ""] }).senders).toEqual(["628123"]);
  });

  test("all replies to every participant", () => {
    const decision = shouldReplyInGroup(
      { participant: "628999999999@s.whatsapp.net", mentioned: [], quotedParticipant: null },
      resolveGroupReply({ mode: "all" }),
      context,
    );
    expect(decision).toEqual({ reply: true, reason: "all" });
  });

  test("mention replies only when the bot is addressed", () => {
    const config = resolveGroupReply({ mode: "mention" });

    expect(
      shouldReplyInGroup(
        { participant: "628999999999@s.whatsapp.net", mentioned: [], quotedParticipant: null },
        config,
        context,
      ),
    ).toEqual({ reply: false, reason: "not_addressed" });

    expect(
      shouldReplyInGroup(
        {
          participant: "628999999999@s.whatsapp.net",
          mentioned: [botPn],
          quotedParticipant: null,
        },
        config,
        context,
      ),
    ).toEqual({ reply: true, reason: "mentioned" });

    // The member may mention the account's LID instead of its phone number.
    expect(
      shouldReplyInGroup(
        {
          participant: "628999999999@s.whatsapp.net",
          mentioned: [botLid],
          quotedParticipant: null,
        },
        config,
        context,
      ).reply,
    ).toBe(true);

    // Replying to one of the bot's messages counts as addressing it.
    expect(
      shouldReplyInGroup(
        {
          participant: "628999999999@s.whatsapp.net",
          mentioned: [],
          quotedParticipant: botLid,
        },
        config,
        context,
      ),
    ).toEqual({ reply: true, reason: "quoted_self" });

    // Quoting another member is not an address.
    expect(
      shouldReplyInGroup(
        {
          participant: "628999999999@s.whatsapp.net",
          mentioned: [],
          quotedParticipant: "628777777777@s.whatsapp.net",
        },
        config,
        context,
      ).reply,
    ).toBe(false);
  });

  test("senders matches phone numbers and both PN/LID identities", () => {
    const config = resolveGroupReply({
      mode: "senders",
      senders: ["628999999999", "628777777777@s.whatsapp.net"],
    });

    expect(
      shouldReplyInGroup(
        {
          participant: "628999999999:7@s.whatsapp.net",
          mentioned: [],
          quotedParticipant: null,
        },
        config,
        context,
      ),
    ).toEqual({ reply: true, reason: "sender_allowed" });

    // A LID participant must resolve to the allowlisted PN.
    expect(
      shouldReplyInGroup(
        {
          participant: "777777777777777@lid",
          mentioned: [],
          quotedParticipant: null,
        },
        config,
        {
          selfJids: [botPn, botLid],
          aliasOf: (identity: string) =>
            identity === "777777777777777@lid" ? ["628777777777@s.whatsapp.net"] : [],
        },
      ).reply,
    ).toBe(true);

    expect(
      shouldReplyInGroup(
        { participant: "628000000000@s.whatsapp.net", mentioned: [], quotedParticipant: null },
        config,
        context,
      ),
    ).toEqual({ reply: false, reason: "sender_not_allowed" });

    // An empty list cannot allow anyone.
    expect(
      shouldReplyInGroup(
        { participant: "628999999999@s.whatsapp.net", mentioned: [], quotedParticipant: null },
        resolveGroupReply({ mode: "senders" }),
        context,
      ),
    ).toEqual({ reply: false, reason: "sender_not_allowed" });
  });

  test("missing participant cannot satisfy the sender policy", () => {
    expect(
      shouldReplyInGroup(
        { participant: null, mentioned: [], quotedParticipant: null },
        resolveGroupReply({ mode: "senders", senders: ["628999999999"] }),
        context,
      ),
    ).toEqual({ reply: false, reason: "no_participant" });
  });

  test("addressing facts are read from any content type", () => {
    expect(
      readGroupAddressing(
        message("628999999999@s.whatsapp.net", {
          extendedTextMessage: {
            text: "hi",
            contextInfo: { mentionedJid: [botPn, botLid], participant: botPn },
          },
        }),
      ),
    ).toEqual({ mentioned: [botPn, botLid], quotedParticipant: botPn });

    // Plain conversation has no contextInfo.
    expect(
      readGroupAddressing(message("628999999999@s.whatsapp.net", { conversation: "hi" })),
    ).toEqual({ mentioned: [], quotedParticipant: null });

    // Media replies carry contextInfo too.
    expect(
      readGroupAddressing(
        message("628999999999@s.whatsapp.net", {
          imageMessage: { caption: "see", contextInfo: { participant: botLid } },
        }),
      ),
    ).toEqual({ mentioned: [], quotedParticipant: botLid });
  });

  test("wrapper reads the participant from the message key", () => {
    const decision = shouldReplyToGroupMessage(
      message("628999999999@s.whatsapp.net", text("halo", { mentionedJid: [botPn] })),
      resolveGroupReply({ mode: "mention" }),
      context,
    );
    expect(decision).toEqual({ reply: true, reason: "mentioned" });
  });
});

describe("static replies stay out of groups", () => {
  test("only direct chats may receive a static reply", () => {
    expect(isStaticReplyAllowed("628999999999@s.whatsapp.net")).toBe(true);
    expect(isStaticReplyAllowed("120363000000000000@lid")).toBe(true);
    expect(isStaticReplyAllowed(group)).toBe(false);
    expect(isStaticReplyAllowed(null)).toBe(true);
    expect(isStaticReplyAllowed(undefined)).toBe(true);
  });

  test("group permission does not make static eligible", () => {
    // Even with the most permissive AI gate, the group is still closed to static.
    const permissive = resolveGroupReply({ mode: "all" });
    const decision = shouldReplyInGroup(
      { participant: "628999999999@s.whatsapp.net", mentioned: [], quotedParticipant: null },
      permissive,
      context,
    );
    expect(decision.reply).toBe(true);
    expect(isStaticReplyAllowed(group)).toBe(false);
  });
});
