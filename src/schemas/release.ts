import { z } from "zod";

/**
 * Plain `MAJOR.MINOR.PATCH` only — no leading `v`, no prerelease suffix, no build metadata. The
 * caller-supplied version is authoritative subject to `evaluateReleaseEligibility`'s own
 * reconciliation; nothing in this app infers, chooses, or increments a version.
 */
export const releaseVersionSchema = z
  .string()
  .trim()
  .regex(
    /^\d+\.\d+\.\d+$/,
    "Version must be plain MAJOR.MINOR.PATCH, with no leading v, prerelease suffix, or build metadata.",
  );

export const requestReleaseInputSchema = z.object({
  version: releaseVersionSchema,
  requestedBy: z.string().min(1),
});

export type RequestReleaseInput = z.infer<typeof requestReleaseInputSchema>;
