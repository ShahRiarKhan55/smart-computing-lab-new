/**
 * Unit test of the pure parts of private messaging + notifications (Phase 12): the request
 * schemas, and the serializer helpers that don't need a database. No server, no database.
 *   npm run test:unit -w apps/server
 */
import {
  MESSAGE_BODY_MAX,
  createConversationSchema,
  createMessageSchema,
  notificationTypeSchema,
} from "@scl/shared";
import { previewOf, toMessage, toMessageParticipant } from "../src/lib/messagingSerializers.js";
import { toNotification } from "../src/lib/notificationSerializers.js";

let ok = 0;
const failures: string[] = [];
const t = (name: string, cond: boolean) => (cond ? ok++ : failures.push(name));

// ---- request schemas --------------------------------------------------------------
t("createConversationSchema accepts a plausible id", createConversationSchema.safeParse({ teamMemberId: "cabc123" }).success);
t("createConversationSchema rejects a missing teamMemberId", !createConversationSchema.safeParse({}).success);
t("createConversationSchema rejects an id with a path separator", !createConversationSchema.safeParse({ teamMemberId: "../etc/passwd" }).success);

t("createMessageSchema accepts a normal message", createMessageSchema.safeParse({ body: "hello" }).success);
t("createMessageSchema rejects an empty body", !createMessageSchema.safeParse({ body: "" }).success);
t("createMessageSchema rejects a whitespace-only body", !createMessageSchema.safeParse({ body: "   " }).success);
t("createMessageSchema rejects a non-string body", !createMessageSchema.safeParse({ body: 12345 }).success);
t("createMessageSchema rejects a missing body", !createMessageSchema.safeParse({}).success);
t(`createMessageSchema accepts exactly ${MESSAGE_BODY_MAX} characters`, createMessageSchema.safeParse({ body: "a".repeat(MESSAGE_BODY_MAX) }).success);
t(`createMessageSchema rejects ${MESSAGE_BODY_MAX + 1} characters (oversized body)`, !createMessageSchema.safeParse({ body: "a".repeat(MESSAGE_BODY_MAX + 1) }).success);
t("createMessageSchema trims surrounding whitespace", createMessageSchema.parse({ body: "  hi  " }).body === "hi");

// Hostile content is accepted as ORDINARY TEXT by the schema (rejecting it would be pointless —
// the point is that it is never executed). Rendering safety is a frontend concern (React text
// nodes, never dangerouslySetInnerHTML — see MessageBubble.tsx); this only proves the string
// itself round-trips unchanged, byte for byte, rather than being "sanitised" into something else
// that could paper over a real escaping bug.
for (const hostile of ["<script>alert(1)</script>", '<img src=x onerror=alert(1)>', "<iframe></iframe>", "javascript:alert(1)"]) {
  const parsed = createMessageSchema.safeParse({ body: hostile });
  t(`createMessageSchema accepts hostile text unchanged: ${hostile}`, parsed.success && parsed.data.body === hostile);
}

t("notificationTypeSchema accepts MESSAGE_RECEIVED", notificationTypeSchema.safeParse("MESSAGE_RECEIVED").success);
t("notificationTypeSchema accepts FORUM_MODERATION", notificationTypeSchema.safeParse("FORUM_MODERATION").success);
t("notificationTypeSchema rejects an unknown type", !notificationTypeSchema.safeParse("SOMETHING_ELSE").success);

// ---- toMessageParticipant / toMessage / toNotification: never the account id ----------------
const withAccount = { teamMember: { id: "tm1", name: "Ada Lovelace", initials: "AL", photoUrl: "" } };
const noProfile = { teamMember: null };
t("toMessageParticipant: linked account -> real ref", toMessageParticipant(withAccount).teamMemberId === "tm1");
t("toMessageParticipant: account with no team profile -> null id, readable name", toMessageParticipant(noProfile).teamMemberId === null && toMessageParticipant(noProfile).name === "Lab member");
t("toMessageParticipant: deleted account (null user) -> null id, readable name", toMessageParticipant(null).teamMemberId === null && toMessageParticipant(null).name === "Former member");
t("toMessageParticipant output never contains an account/user id string", !JSON.stringify(toMessageParticipant(withAccount)).includes("userId"));

const now = new Date();
const msgRow = { id: "m1", senderId: "user-a", body: "hi", deletedAt: null, editedAt: null, createdAt: now };
t("toMessage: sender sees mine=true", toMessage(msgRow, "user-a").mine === true);
t("toMessage: recipient sees mine=false", toMessage(msgRow, "user-b").mine === false);
t("toMessage: a deleted message's body is blanked regardless of viewer", toMessage({ ...msgRow, deletedAt: now, body: "secret" }, "user-a").body === "");
t("toMessage: a deleted message is flagged deleted", toMessage({ ...msgRow, deletedAt: now }, "user-a").deleted === true);

t("previewOf: short body is unchanged", previewOf("hello there") === "hello there");
t("previewOf: long body is cut with an ellipsis, never the full text", previewOf("x".repeat(200)).length < 200 && previewOf("x".repeat(200)).endsWith("…"));
t("previewOf: internal newlines/whitespace collapse to single spaces", previewOf("line one\n\nline two") === "line one line two");

const notifRow = { id: "n1", type: "MESSAGE_RECEIVED", actor: withAccount, targetPath: "/messages/c1", payload: JSON.stringify({ title: "hi" }), readAt: null, createdAt: now };
const notif = toNotification(notifRow);
t("toNotification: unread when readAt is null", notif.read === false);
t("toNotification: read when readAt is set", toNotification({ ...notifRow, readAt: now }).read === true);
t("toNotification: payload round-trips", notif.payload.title === "hi");
t("toNotification: malformed payload JSON never throws, falls back to {}", JSON.stringify(toNotification({ ...notifRow, payload: "not json" }).payload) === "{}");
t("toNotification output never contains an account/user id string", !JSON.stringify(notif).includes("userId"));

console.log(`${ok} messaging unit checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
