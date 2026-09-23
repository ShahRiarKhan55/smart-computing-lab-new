import type { ZodType, ZodTypeDef } from "zod";

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Parses `data` against `schema`, throwing a ValidationError with a readable message on failure. */
export function parseOrThrow<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    // A missing, null or array body fails at the root; say so instead of zod's bare "Required".
    const message =
      first && first.path.length === 0 && first.code === "invalid_type"
        ? "Request body must be a JSON object."
        : first
          ? first.message
          : "Invalid request.";
    throw new ValidationError(message);
  }
  return result.data;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const notFound = (message = "Not found") => new HttpError(404, message);
export const forbidden = (message = "Forbidden") => new HttpError(403, message);
export const badRequest = (message = "Bad request") => new HttpError(400, message);
export const conflict = (message = "Conflict") => new HttpError(409, message);
