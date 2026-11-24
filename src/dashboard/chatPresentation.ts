import type { proto, WAMessage } from "@whiskeysockets/baileys";
import type { MediaKind } from "@/services/inboundMedia";

type Action = { label: string; href?: string };

const safeMime: Record<MediaKind, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"],
  sticker: ["image/webp", "image/png"],
  video: ["video/mp4", "video/webm", "video/quicktime", "video/3gpp"],
  audio: [
    "audio/ogg",
    "audio/opus",
    "audio/mpeg",
    "audio/mp4",
    "audio/aac",
    "audio/wav",
    "audio/webm",
    "audio/amr",
  ],
  document: ["application/pdf"],
};

const mediaLabels: Record<MediaKind, string> = {
  image: "Image",
  sticker: "Sticker",
  video: "Video",
  audio: "Audio",
  document: "Document",
};

function mediaOf(content: proto.IMessage | null) {
  if (!content) return null;
  const headers = [
    content,
    content.interactiveMessage?.header,
    content.templateMessage?.hydratedTemplate ?? content.templateMessage?.hydratedFourRowTemplate,
    content.buttonsMessage,
  ];
  for (const header of headers) {
    if (!header) continue;
    if (header.imageMessage) return { kind: "image", data: header.imageMessage } as const;
    if (header.videoMessage) return { kind: "video", data: header.videoMessage } as const;
    if (header.documentMessage) return { kind: "document", data: header.documentMessage } as const;
  }
  if (content.ptvMessage) return { kind: "video", data: content.ptvMessage } as const;
  if (content.stickerMessage) return { kind: "sticker", data: content.stickerMessage } as const;
  if (content.audioMessage) return { kind: "audio", data: content.audioMessage } as const;
  return null;
}

// Only unwrap envelopes used for display. In particular, do not unwrap view-once media.
function presentedContent(raw?: proto.IMessage | null) {
  let content = raw;
  for (let depth = 0; content && depth < 10; depth++) {
    if (
      content.viewOnceMessage ||
      content.viewOnceMessageV2 ||
      content.viewOnceMessageV2Extension
    ) {
      return { content: null, viewOnce: true };
    }
    const inner =
      content.ephemeralMessage?.message ??
      content.documentWithCaptionMessage?.message ??
      content.deviceSentMessage?.message ??
      content.editedMessage?.message ??
      content.groupMentionedMessage?.message;
    if (!inner) return { content, viewOnce: false };
    content = inner;
  }
  return { content: null, viewOnce: false };
}

function actionsOf(content: proto.IMessage): Action[] {
  const actions: Action[] = [];
  const add = (value: unknown, link?: unknown) => {
    if (typeof value !== "string" || !value.trim() || actions.length >= 20) return;
    const label = value.trim().slice(0, 200);
    if (typeof link === "string" && link.length <= 2048) {
      try {
        const url = new URL(link);
        if (
          (url.protocol === "https:" || url.protocol === "http:") &&
          !url.username &&
          !url.password
        ) {
          actions.push({ label, href: url.href });
          return;
        }
      } catch {
        // Keep the label without a link when the destination is invalid.
      }
    }
    actions.push({ label });
  };

  const template =
    content.templateMessage?.hydratedTemplate ?? content.templateMessage?.hydratedFourRowTemplate;
  for (const btn of template?.hydratedButtons?.slice(0, 20) ?? []) {
    add(
      btn.urlButton?.displayText ??
        btn.quickReplyButton?.displayText ??
        btn.callButton?.displayText,
      btn.urlButton?.url,
    );
  }
  for (const btn of content.buttonsMessage?.buttons?.slice(0, 20) ?? [])
    add(btn.buttonText?.displayText);
  add(content.listMessage?.buttonText);
  for (const btn of content.interactiveMessage?.nativeFlowMessage?.buttons?.slice(0, 20) ?? []) {
    let params: Record<string, unknown> | null = null;
    if (btn.buttonParamsJson && btn.buttonParamsJson.length <= 16_384) {
      try {
        params = JSON.parse(btn.buttonParamsJson);
      } catch {
        // Malformed parameters must not hide the rest of the message.
      }
    }
    add(
      params?.display_text ?? (btn.name === "cta_url" ? "Open Link" : "Unsupported Action"),
      btn.name === "cta_url" ? params?.url : undefined,
    );
  }
  return actions;
}

function mimeOf(attachment: NonNullable<ReturnType<typeof mediaOf>>) {
  const mime =
    attachment.data.mimetype?.split(";", 1)[0]?.trim().toLowerCase() ||
    (attachment.kind === "sticker" ? "image/webp" : "");
  return safeMime[attachment.kind].includes(mime) ? mime : null;
}

export function describeChatMessage(message: WAMessage) {
  const { content, viewOnce } = presentedContent(message.message);
  const attachment = mediaOf(content);
  if (viewOnce || (attachment && "viewOnce" in attachment.data && attachment.data.viewOnce)) {
    return { text: "[View Once Message]", actions: [], media: null };
  }
  const interactive = content?.interactiveMessage;
  const template =
    content?.templateMessage?.hydratedTemplate ?? content?.templateMessage?.hydratedFourRowTemplate;
  const list = content?.listMessage;
  const buttons = content?.buttonsMessage;
  const poll =
    content?.pollCreationMessage ??
    content?.pollCreationMessageV2 ??
    content?.pollCreationMessageV3;
  const selected =
    content?.buttonsResponseMessage?.selectedDisplayText ||
    content?.templateButtonReplyMessage?.selectedDisplayText ||
    content?.listResponseMessage?.title ||
    content?.interactiveResponseMessage?.body?.text;
  const interactiveText = [
    interactive?.header?.title || template?.hydratedTitleText || list?.title || buttons?.text,
    interactive?.header?.subtitle,
    interactive?.body?.text ||
      template?.hydratedContentText ||
      list?.description ||
      buttons?.contentText,
    interactive?.footer?.text ||
      template?.hydratedFooterText ||
      list?.footerText ||
      buttons?.footerText,
  ]
    .filter(Boolean)
    .join("\n");
  const caption = attachment && "caption" in attachment.data ? attachment.data.caption : "";
  const text =
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    interactiveText ||
    caption ||
    (selected ? `Selected: ${selected}` : "") ||
    (content?.locationMessage || content?.liveLocationMessage ? "[Location]" : "") ||
    (content?.contactMessage || content?.contactsArrayMessage ? "[Contact]" : "") ||
    (poll ? `[Poll] ${poll.name || ""}`.trim() : "") ||
    (content?.reactionMessage ? `[Reaction] ${content.reactionMessage.text || ""}`.trim() : "") ||
    (interactive || buttons || list || content?.templateMessage ? "[Interactive Message]" : "") ||
    (attachment
      ? ""
      : content?.protocolMessage || message.messageStubType != null
        ? "[System Message]"
        : "[Unsupported Message]");
  const mime = attachment && mimeOf(attachment);
  return {
    text,
    actions: content ? actionsOf(content) : [],
    media: attachment
      ? {
          kind: attachment.kind,
          name:
            ("fileName" in attachment.data && attachment.data.fileName) ||
            (attachment.kind === "audio" && attachment.data.ptt
              ? "Voice Note"
              : mediaLabels[attachment.kind]),
          preview:
            mime === "application/pdf"
              ? "pdf"
              : mime
                ? mime.startsWith("image/")
                  ? "image"
                  : attachment.kind
                : null,
          ...(attachment.kind === "audio" ? { duration: attachment.data.seconds ?? 0 } : {}),
          available: Boolean(
            message.key.id &&
              attachment.data.mediaKey &&
              (attachment.data.directPath || attachment.data.url),
          ),
        }
      : null,
  };
}

export function getChatAttachment(message: WAMessage) {
  const { content } = presentedContent(message.message);
  const attachment = mediaOf(content);
  if (!attachment || ("viewOnce" in attachment.data && attachment.data.viewOnce)) return null;
  return { ...attachment, mime: mimeOf(attachment) };
}

export function chatMessageContext(message: WAMessage): proto.IContextInfo | null {
  const { content } = presentedContent(message.message);
  for (const value of Object.values(content ?? {})) {
    if (value && typeof value === "object" && "contextInfo" in value && value.contextInfo) {
      return value.contextInfo as proto.IContextInfo;
    }
  }
  return null;
}
