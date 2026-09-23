import { z } from "zod";

/** Cuid/uuid-style ids: letters, digits, "_" and "-" only. Rejects anything else before it reaches the database. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const idSchema = z
  .string({ required_error: "Id is required.", invalid_type_error: "Id must be a string." })
  .regex(ID_PATTERN, "Invalid id.");

const HTTP_URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/** Optional link field: "" is allowed (means "none"); otherwise it must be an http(s) URL. */
export function optionalHttpUrl(label: string) {
  return z
    .string({ invalid_type_error: `${label} must be a string.` })
    .trim()
    .max(2048, `${label} is too long.`)
    .refine((v) => v === "" || HTTP_URL_PATTERN.test(v), `${label} must be a valid URL starting with http:// or https://.`);
}

/** Required trimmed text with a max length and readable messages for missing/empty values. */
export function requiredText(label: string, max: number) {
  return z
    .string({ required_error: `${label} is required.`, invalid_type_error: `${label} must be text.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);
}

/** Optional trimmed text ("" allowed) with a max length; a non-string is rejected rather than coerced. */
export function optionalText(label: string, max: number) {
  return z
    .string({ invalid_type_error: `${label} must be text.` })
    .trim()
    .max(max, `${label} must be at most ${max} characters.`);
}

/** Display-order integer used by team members and history entries. */
export const sortOrderField = z
  .number({ invalid_type_error: "Sort order must be a number." })
  .int("Sort order must be a whole number.")
  .min(-100000, "Sort order is out of range.")
  .max(100000, "Sort order is out of range.");

/** Length of `value` once UTF-8 encoded (bcrypt only uses the first 72 bytes, so longer passwords are rejected). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) as number;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * A full set of team-member ids linked to a publication or news item.
 * Duplicates are rejected instead of silently collapsed so the client
 * notices a malformed request.
 */
export const teamMemberIdListSchema = z
  .array(idSchema, { invalid_type_error: "teamMemberIds must be an array of team member ids." })
  .max(200, "Too many team members.")
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate team members in the author list.");
