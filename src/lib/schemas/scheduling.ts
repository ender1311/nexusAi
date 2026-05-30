import { z } from "zod";

/**
 * Zod schemas for the JSON columns on `SchedulingRule`. Prisma types these as
 * opaque `JsonValue`, so reads must be parsed at the boundary rather than cast
 * with `as unknown as`. Each parser is lenient: unknown shapes (including null)
 * yield `null`, and unrecognized keys are stripped — old records written before
 * a field existed still parse cleanly.
 */

export const quietHoursSchema = z
  .object({
    mode: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    timezone: z.string().optional(),
    quietDays: z.array(z.number()).optional(),
    deliverAtHour: z.number().optional(),
  })
  .nullable();

export type QuietHours = z.infer<typeof quietHoursSchema>;

export const frequencyCapSchema = z
  .object({
    maxSends: z.number().optional(),
    period: z.string().optional(),
  })
  .nullable();

export type FrequencyCap = z.infer<typeof frequencyCapSchema>;

/** Parse an opaque DB JSON value, returning `null` when it doesn't match. */
export function parseQuietHours(value: unknown): QuietHours {
  const result = quietHoursSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseFrequencyCap(value: unknown): FrequencyCap {
  const result = frequencyCapSchema.safeParse(value);
  return result.success ? result.data : null;
}
