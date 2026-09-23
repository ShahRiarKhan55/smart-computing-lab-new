import { z } from "zod";

export const apiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
