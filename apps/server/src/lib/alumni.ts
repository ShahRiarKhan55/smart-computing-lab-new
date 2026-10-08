import { HttpError } from "./validate.js";

/**
 * Alumni (Phase 27 / P27.8) are public directory entries, NEVER accounts. Every code path that
 * could attach a login to a team profile (admin account creation, account linking, researcher
 * invitations and their acceptance) calls this, and moving a profile INTO alumni is refused while it
 * still has a login. Together with the schema change that stops an account being created together
 * with an ALUMNI profile, an alumni record cannot authenticate merely because a public profile exists.
 */
export const ALUMNI_NO_ACCOUNT_MESSAGE = "Alumni profiles can't have a login account.";

export function assertProfileMayHaveAccount(member: { category: string }): void {
  if (member.category === "ALUMNI") throw new HttpError(409, ALUMNI_NO_ACCOUNT_MESSAGE);
}
