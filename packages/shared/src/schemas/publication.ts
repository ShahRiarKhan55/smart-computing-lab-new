import { z } from "zod";
import { optionalHttpUrl, requiredText, teamMemberIdListSchema } from "./common.js";
import { visibilitySchema } from "./enums.js";

export const MIN_PUBLICATION_YEAR = 1900;
export const MAX_PUBLICATION_YEAR = 2100;

export const publicationSchema = z.object({
  id: z.string(),
  year: z.number(),
  title: z.string(),
  authors: z.string(),
  venue: z.string(),
  pdfUrl: z.string(),
  doiUrl: z.string(),
  extraUrl: z.string(),
  extraLabel: z.string(),
  /** Only sent to accounts that may change visibility (lab managers, admins). */
  visibility: visibilitySchema.optional(),
});
export type Publication = z.infer<typeof publicationSchema>;

// The form sends the year as text; accept a numeric string but nothing else
// (so null, booleans and arrays do not silently coerce into a year; "" counts as missing).
const yearField = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v),
  z
    .number({ required_error: "Year is required.", invalid_type_error: "Year must be a number." })
    .int("Year must be a whole number.")
    .min(MIN_PUBLICATION_YEAR, `Year must be between ${MIN_PUBLICATION_YEAR} and ${MAX_PUBLICATION_YEAR}.`)
    .max(MAX_PUBLICATION_YEAR, `Year must be between ${MIN_PUBLICATION_YEAR} and ${MAX_PUBLICATION_YEAR}.`),
);

const publicationFields = {
  year: yearField,
  title: requiredText("Title", 500),
  authors: requiredText("Authors", 1000),
  venue: requiredText("Venue", 500),
  pdfUrl: optionalHttpUrl("PDF URL"),
  doiUrl: optionalHttpUrl("DOI URL"),
  extraUrl: optionalHttpUrl("Extra link URL"),
  extraLabel: z.string().trim().max(60, "Extra link label must be at most 60 characters."),
};

export const createPublicationSchema = z.object({
  year: publicationFields.year,
  title: publicationFields.title,
  authors: publicationFields.authors,
  venue: publicationFields.venue,
  pdfUrl: publicationFields.pdfUrl.optional().default(""),
  doiUrl: publicationFields.doiUrl.optional().default(""),
  extraUrl: publicationFields.extraUrl.optional().default(""),
  extraLabel: publicationFields.extraLabel.optional().default(""),
  /** Lab managers and admins only (403 for anyone else); omitted = PUBLIC. */
  visibility: visibilitySchema.optional(),
  /** Optional team members to link as authors, applied in the same transaction as the create. */
  teamMemberIds: teamMemberIdListSchema.optional(),
});
export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;

export const updatePublicationSchema = z
  .object({
    year: publicationFields.year.optional(),
    title: publicationFields.title.optional(),
    authors: publicationFields.authors.optional(),
    venue: publicationFields.venue.optional(),
    pdfUrl: publicationFields.pdfUrl.optional(),
    doiUrl: publicationFields.doiUrl.optional(),
    extraUrl: publicationFields.extraUrl.optional(),
    extraLabel: publicationFields.extraLabel.optional(),
    /** Lab managers and admins only (403 for anyone else). */
    visibility: visibilitySchema.optional(),
    /** When present, replaces the full set of linked team members (same transaction as the field update). */
    teamMemberIds: teamMemberIdListSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update.");
export type UpdatePublicationInput = z.infer<typeof updatePublicationSchema>;

export const setPublicationAuthorsSchema = z.object({ teamMemberIds: teamMemberIdListSchema });
export type SetPublicationAuthorsInput = z.infer<typeof setPublicationAuthorsSchema>;

export const publicationAuthorsResponseSchema = z.object({ teamMemberIds: z.array(z.string()) });
export type PublicationAuthorsResponse = z.infer<typeof publicationAuthorsResponseSchema>;
