import { z } from "zod";
import { roleSchema, memberCategorySchema } from "./enums.js";
import { idSchema, utf8ByteLength } from "./common.js";
import { teamMemberFields } from "./team.js";

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: roleSchema,
  createdAt: z.string(),
  teamMemberId: z.string().nullable(),
  teamMemberName: z.string().nullable(),
});
export type UserSummary = z.infer<typeof userSchema>;

export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt ignores everything past 72 bytes, so a longer password would be silently truncated. */
export const MAX_PASSWORD_BYTES = 72;

/** Emails are stored lower-case, so "A@x.org" and "a@x.org" can never be two accounts. */
export const emailField = z
  .string({ required_error: "Email is required.", invalid_type_error: "Email must be text." })
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .max(254, "Email is too long.")
  .email("Enter a valid email address.");

export const newPasswordField = z
  .string({ required_error: "Password is required.", invalid_type_error: "Password must be text." })
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  .refine((v) => utf8ByteLength(v) <= MAX_PASSWORD_BYTES, `Password is too long (at most ${MAX_PASSWORD_BYTES} bytes).`);

/**
 * Create-login modes (mirrors the reference admin dialog):
 *  - link an existing team member: `teamMemberId`
 *  - create a new team profile too: `name` + `initials` + `memberRole` + `category` (all four)
 *  - neither: a login with no team profile
 */
export const createUserSchema = z
  .object({
    email: emailField,
    password: newPasswordField,
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
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserRoleSchema = z.object({
  role: roleSchema,
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
