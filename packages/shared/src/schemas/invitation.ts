import { z } from "zod";
import { roleSchema, memberCategorySchema } from "./enums.js";
import { idSchema } from "./common.js";
import { teamMemberFields } from "./team.js";
import { emailField, newPasswordField } from "./user.js";

/**
 * Researcher onboarding (see apps/server/src/routes/invitations.routes.ts): an ADMIN creates an
 * invitation for an email address; the researcher who holds the resulting one-time link chooses
 * their own password to activate the account. The admin never sets, sees, or receives a password
 * at any point in this flow — `createInvitationSchema` deliberately has no `password` field.
 *
 * `teamMemberId` / `name`+`initials`+`memberRole`+`category` mirror `createUserSchema`'s three
 * modes exactly (link an existing unlinked profile / create a new one / no profile).
 */
export const createInvitationSchema = z
  .object({
    email: emailField,
    role: roleSchema.default("MEMBER"),
    teamMemberId: idSchema.optional(),
    name: teamMemberFields.name.optional(),
    initials: teamMemberFields.initials.optional(),
    memberRole: teamMemberFields.role.optional(),
    category: memberCategorySchema.optional(),
  })
  .superRefine((data, ctx) => {
    const newFieldsGiven = [data.name, data.initials, data.memberRole, data.category].filter((v) => v !== undefined).length;
    if (data.teamMemberId && newFieldsGiven > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose either an existing team member or new-member fields, not both.",
      });
    } else if (newFieldsGiven > 0 && newFieldsGiven < 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "To create a team profile, provide the name, initials, role and category.",
      });
    }
  });
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** The raw invitation token, as it appears in the `/invite/:token` URL — never persisted itself,
 * only its SHA-256 hash. Generated as 32 random bytes, base64url-encoded (see
 * lib/invitationToken.ts), so this is a generous upper bound, not an exact length check. */
export const invitationTokenSchema = z
  .string({ required_error: "Invitation token is required." })
  .trim()
  .min(20, "Invalid invitation link.")
  .max(100, "Invalid invitation link.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid invitation link.");

export const acceptInvitationSchema = z.object({
  password: newPasswordField,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

/** Returned by GET /api/invitations (admin) — deliberately has no token/tokenHash field: once
 * issued, the raw link is shown to the admin exactly once (at creation) and never again. */
export const invitationSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  role: roleSchema,
  teamMemberId: z.string().nullable(),
  teamMemberName: z.string().nullable(),
  status: z.enum(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]),
  invitedByEmail: z.string(),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type InvitationSummary = z.infer<typeof invitationSummarySchema>;

/** Returned by the public GET /api/invitations/:token/info — the minimum needed for the setup
 * page to greet the researcher and show a password form; never includes the role, admin email,
 * or anything beyond what the researcher themselves needs to see. */
export const invitationInfoSchema = z.object({
  valid: z.boolean(),
  email: z.string().nullable(),
});
export type InvitationInfo = z.infer<typeof invitationInfoSchema>;

/** Self-service password change (logged-in user, own account only). */
export const changePasswordSchema = z.object({
  currentPassword: z.string({ required_error: "Current password is required." }).min(1, "Current password is required."),
  newPassword: newPasswordField,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
