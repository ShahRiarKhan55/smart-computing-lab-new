import { z } from "zod";
import { idSchema, optionalText, requiredText, teamMemberIdListSchema } from "./common.js";
import { DOI_INVALID_MESSAGE, normalizeDoi } from "../doi.js";
import { visibilitySchema } from "./enums.js";
import { MAX_PUBLICATION_YEAR, MIN_PUBLICATION_YEAR } from "./publication.js";

export const CANDIDATE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "DUPLICATE"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** One discovered publication waiting for (or already past) editorial review. Never public. */
export interface PublicationCandidate {
  id: string;
  provider: string;
  doi: string;
  title: string;
  authors: string;
  year: number;
  venue: string;
  url: string;
  workType: string;
  status: CandidateStatus;
  publicationId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Lab researchers whose ORCID record listed it. */
  researcherIds: string[];
  /** An existing publication with the same normalised title and year (a hint: the editor decides). */
  possibleDuplicateId: string | null;
}

export interface PublicationSyncStatus {
  lastRunAt: string | null;
  lastStatus: string;
  lastSummary: unknown;
  orcidResearchers: number;
}

export interface PublicationImportList {
  items: PublicationCandidate[];
  sync: PublicationSyncStatus;
}

export interface PublicationSyncResult {
  started: boolean;
  status?: "OK" | "PARTIAL" | "FAILED";
  summary?: {
    researchers: number;
    skipped: number;
    failed: { teamMemberId: string; code: string }[];
    discovered: number;
    created: number;
    duplicates: number;
    alreadyKnown: number;
    enriched: number;
  };
}

export const publicationImportQuerySchema = z.object({
  status: z.enum(CANDIDATE_STATUSES).optional().default("PENDING"),
});

export const publicationSyncBodySchema = z.object({ teamMemberId: idSchema.optional() }).strict();

/** The editor may correct anything before it becomes a public publication. Authors and venue are required by the publication record itself. */
export const approveCandidateSchema = z
  .object({
    title: requiredText("Title", 500).optional(),
    authors: requiredText("Authors", 1000).optional(),
    venue: requiredText("Venue", 500).optional(),
    year: z.number().int().min(MIN_PUBLICATION_YEAR).max(MAX_PUBLICATION_YEAR).optional(),
    teamMemberIds: teamMemberIdListSchema.optional(),
    visibility: visibilitySchema.optional(),
  })
  .strict();
export type ApproveCandidateInput = z.infer<typeof approveCandidateSchema>;

export const doiLookupQuerySchema = z.object({
  doi: optionalText("DOI", 2048).transform((v, ctx) => {
    const doi = normalizeDoi(v);
    if (!doi) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: DOI_INVALID_MESSAGE });
      return z.NEVER;
    }
    return doi;
  }),
});

/** Result of "fill from DOI": suggestions only, nothing is saved. */
export interface DoiLookupResult {
  doi: string;
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  doiUrl: string;
}
