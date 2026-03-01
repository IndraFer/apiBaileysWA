import { Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import { authMiddleware } from "@/middleware/auth";
import { sessionValidator } from "@/middleware/sessionValidator";
import { formatPhone, formatGroup } from "@/utils/phone";
import { success, error } from "@/lib/response";

const groupRoutes = new Hono();

groupRoutes.use("*", authMiddleware);

/**
 * POST /groups/:sessionId/create
 */
groupRoutes.post("/:sessionId/create", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { groupName, participants } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const formatted = (participants as string[]).map(formatPhone);
    const group = await session.groupCreate(groupName, formatted);
    return success(c, group, "Group created successfully");
  } catch (err) {
    return error(c, `Failed to create group: ${(err as Error).message}`);
  }
});

/**
 * GET /groups/:sessionId/list
 */
groupRoutes.get("/:sessionId/list", sessionValidator, (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    const session = connectionManager.getSession(sessionId);
    const groups = session.getStore().getChatList(true);
    return success(c, groups);
  } catch (err) {
    return error(c, `Failed to get groups: ${(err as Error).message}`);
  }
});

/**
 * GET /groups/:sessionId/list-all
 * List all groups with participants (direct from WhatsApp).
 */
groupRoutes.get("/:sessionId/list-all", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    const session = connectionManager.getSession(sessionId);
    const groups = await session.groupFetchAllParticipating();
    return success(c, groups);
  } catch (err) {
    return error(c, `Failed to fetch groups: ${(err as Error).message}`);
  }
});

/**
 * GET /groups/:sessionId/metadata/:jid
 */
groupRoutes.get("/:sessionId/metadata/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = formatGroup(c.req.param("jid"));

  try {
    const session = connectionManager.getSession(sessionId);
    const meta = await session.groupMetadata(jid);
    if (!meta?.id) return error(c, "Group not found", 404);
    return success(c, meta);
  } catch (err) {
    return error(c, `Failed to get group metadata: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/send
 * Send a message to a group.
 */
groupRoutes.post("/:sessionId/send", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { receiver, message } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const jid = formatGroup(receiver);
    await session.sendMessage(jid, message);
    return success(c, null, "Message sent to group");
  } catch (err) {
    return error(c, `Failed to send group message: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/participants/:jid
 * Update participants (add/remove/promote/demote).
 */
groupRoutes.post("/:sessionId/participants/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = formatGroup(c.req.param("jid"));
  const body = await c.req.json();
  const { participants, action } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const formatted = (participants as string[]).map(formatPhone);
    const result = await session.groupParticipantsUpdate(jid, formatted, action);
    return success(c, result, "Participants updated successfully");
  } catch (err) {
    return error(c, `Failed to update participants: ${(err as Error).message}`);
  }
});

/**
 * PATCH /groups/:sessionId/subject/:jid
 */
groupRoutes.patch("/:sessionId/subject/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = formatGroup(c.req.param("jid"));
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.groupUpdateSubject(jid, body.subject);
    return success(c, null, "Group subject updated");
  } catch (err) {
    return error(c, `Failed to update subject: ${(err as Error).message}`);
  }
});

/**
 * PATCH /groups/:sessionId/description/:jid
 */
groupRoutes.patch("/:sessionId/description/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = formatGroup(c.req.param("jid"));
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.groupUpdateDescription(jid, body.description);
    return success(c, null, "Group description updated");
  } catch (err) {
    return error(c, `Failed to update description: ${(err as Error).message}`);
  }
});

/**
 * PATCH /groups/:sessionId/settings/:jid
 * Update group settings (announcement/not_announcement/locked/unlocked).
 */
groupRoutes.patch("/:sessionId/settings/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = formatGroup(c.req.param("jid"));
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.groupSettingUpdate(jid, body.setting);
    return success(c, null, "Group settings updated");
  } catch (err) {
    return error(c, `Failed to update settings: ${(err as Error).message}`);
  }
});

/**
 * PATCH /groups/:sessionId/profile-picture/:jid
 */
groupRoutes.patch("/:sessionId/profile-picture/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = formatGroup(c.req.param("jid"));
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.updateProfilePicture(jid, { url: body.url });
    return success(c, null, "Group profile picture updated");
  } catch (err) {
    return error(c, `Failed to update profile picture: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/leave/:jid
 */
groupRoutes.post("/:sessionId/leave/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = formatGroup(c.req.param("jid"));

  try {
    const session = connectionManager.getSession(sessionId);
    await session.groupLeave(jid);
    return success(c, null, "Left group successfully");
  } catch (err) {
    return error(c, `Failed to leave group: ${(err as Error).message}`);
  }
});

/**
 * GET /groups/:sessionId/invite-code/:jid
 */
groupRoutes.get("/:sessionId/invite-code/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = formatGroup(c.req.param("jid"));

  try {
    const session = connectionManager.getSession(sessionId);
    const code = await session.groupInviteCode(jid);
    return success(c, { inviteCode: code });
  } catch (err) {
    return error(c, `Failed to get invite code: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/accept-invite
 */
groupRoutes.post("/:sessionId/accept-invite", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    const result = await session.groupAcceptInvite(body.inviteCode);
    return success(c, result, "Invite accepted");
  } catch (err) {
    return error(c, `Failed to accept invite: ${(err as Error).message}`);
  }
});

/**
 * POST /groups/:sessionId/revoke-invite/:jid
 */
groupRoutes.post("/:sessionId/revoke-invite/:jid", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = formatGroup(c.req.param("jid"));

  try {
    const session = connectionManager.getSession(sessionId);
    const result = await session.groupRevokeInvite(jid);
    return success(c, result, "Invite revoked");
  } catch (err) {
    return error(c, `Failed to revoke invite: ${(err as Error).message}`);
  }
});

export default groupRoutes;
