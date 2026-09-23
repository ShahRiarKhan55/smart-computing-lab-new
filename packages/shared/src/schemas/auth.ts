import { z } from "zod";
import { roleSchema } from "./enums.js";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: roleSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const meResponseSchema = z.object({
  user: sessionUserSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
