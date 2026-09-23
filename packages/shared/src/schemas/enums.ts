import { z } from "zod";

/**
 * Account roles. What each may do lives in ../permissions.ts (the single source of
 * truth used by both the API and the UI); guests have no account and so no role.
 */
export const ROLES = ["ADMIN", "LAB_MANAGER", "MEMBER"] as const;
export const roleSchema = z.enum(ROLES, {
  errorMap: () => ({ message: "Role must be ADMIN, LAB_MANAGER or MEMBER." }),
});
export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  LAB_MANAGER: "Lab manager",
  MEMBER: "Member",
};

/**
 * Who may see a piece of content. PUBLIC = anyone, including logged-out visitors;
 * LAB_ONLY = any logged-in account. Server queries must allow-list these values
 * (never "everything except LAB_ONLY") so an unexpected value fails closed.
 */
export const VISIBILITIES = ["PUBLIC", "LAB_ONLY"] as const;
export const visibilitySchema = z.enum(VISIBILITIES, {
  errorMap: () => ({ message: "Visibility must be PUBLIC or LAB_ONLY." }),
});
export type Visibility = z.infer<typeof visibilitySchema>;

/** Site languages. English is the base: it lives in the entity's own columns; other locales live in Translation rows. */
export const LOCALES = ["en", "ja"] as const;
export const DEFAULT_LOCALE = "en" as const;
export const localeSchema = z.enum(LOCALES, {
  errorMap: () => ({ message: "Locale must be en or ja." }),
});
export type Locale = z.infer<typeof localeSchema>;

export const categorySchema = z.enum(["FACULTY", "PHD", "MSC", "BSC", "RESEARCH"], {
  errorMap: () => ({ message: "Category must be one of FACULTY, PHD, MSC, BSC or RESEARCH." }),
});
export type Category = z.infer<typeof categorySchema>;

export const CATEGORY_ORDER: Category[] = ["FACULTY", "PHD", "MSC", "BSC", "RESEARCH"];

export const CATEGORY_LABELS: Record<Category, string> = {
  FACULTY: "Faculty",
  PHD: "PhD Students",
  MSC: "MSc Students",
  BSC: "BSc Students",
  RESEARCH: "Research Students",
};
