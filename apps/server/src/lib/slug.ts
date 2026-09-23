import type { Prisma } from "@prisma/client";
import { SLUG_PATTERN } from "@scl/shared";

/**
 * "Computer Vision for Satellites!" -> "computer-vision-for-satellites". Text with no
 * ASCII letters or digits (e.g. a Japanese-only title) falls back to `fallback`.
 */
export function slugify(text: string, fallback: string): string {
  const slug = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/g, "");
  return SLUG_PATTERN.test(slug) ? slug : fallback;
}

/**
 * First free slug: `base`, `base-2`, `base-3`, ... The UNIQUE index on `slug` still
 * backs this up if two requests race (the loser gets a 409 from the error handler).
 */
export async function uniqueSlug(
  tx: Prisma.TransactionClient,
  table: "researchProject" | "researchGroup" | "forumCategory",
  base: string,
): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken =
      table === "researchProject"
        ? await tx.researchProject.findUnique({ where: { slug: candidate }, select: { id: true } })
        : table === "researchGroup"
          ? await tx.researchGroup.findUnique({ where: { slug: candidate }, select: { id: true } })
          : await tx.forumCategory.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new Error("Could not find a free slug.");
}
