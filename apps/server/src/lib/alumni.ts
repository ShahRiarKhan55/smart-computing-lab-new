import { ALUMNI_CATEGORY, ALUMNI_MESSAGES } from "@scl/shared";
import { HttpError } from "./validate.js";

/**
 * Alumni (Phase 3B) are public directory entries, NEVER accounts. Every code path that could attach a login to a team
 * profile (admin account creation, linking an existing account, researcher invitations and their acceptance) calls
 * `assertProfileMayHaveAccount`, and moving a profile INTO alumni is refused while it still has a login
 * (`assertMayBecomeAlumni`). Together with the account-creation schemas, which do not accept ALUMNI as a category, an alumni
 * record cannot authenticate merely because a public profile exists. Google sign-in only ever signs in an EXISTING
 * account (it creates neither accounts nor profiles), so an alumni profile, which has none, cannot sign in through it.
 */
export const isAlumniCategory = (category: string | null | undefined): boolean => category === ALUMNI_CATEGORY;

/** Throws 409 when the profile is an alumni profile (it must not get a login). */
export function assertProfileMayHaveAccount(member: { category: string }): void {
  if (isAlumniCategory(member.category)) throw new HttpError(409, ALUMNI_MESSAGES.noAccount);
}

/** Throws 409 when a profile that has a linked account would become an alumni profile. */
export function assertMayBecomeAlumni(member: { userId: string | null }): void {
  if (member.userId !== null) throw new HttpError(409, ALUMNI_MESSAGES.hasAccount);
}
