import type { BucketFile, SloBucket } from "./model.js";

const bucketSeconds = 300;

/**
 * Three deterministic days of five-minute buckets with known incidents:
 *
 * - `flux` image requests fail 50 of 120 for the final 20 minutes, which
 *   must page through the 1h/5m rule.
 * - `kontext` primary calls fail 5% of the time throughout, but every failure
 *   is rescued by fallback, so availability stays perfect while primary
 *   health must open a ticket.
 * - `openai` text traffic stays healthy and must not alert.
 */
export function syntheticIncidentBuckets(end: Date): BucketFile {
  const endMs =
    Math.floor(end.getTime() / (bucketSeconds * 1000)) * bucketSeconds * 1000;
  const count = (3 * 24 * 60 * 60) / bucketSeconds;
  const buckets: SloBucket[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = new Date(
      endMs - (count - index) * bucketSeconds * 1000,
    ).toISOString();
    const fromEnd = count - index;

    const textBad = index % 4 === 0 ? 1 : 0;
    buckets.push({
      start,
      eventType: "generate.text",
      model: "openai",
      availability: { valid: 300, good: 300 - textBad },
      latency: { valid: 300 - textBad, good: 297 - textBad },
      primary: { valid: 300, good: 300 - textBad },
    });

    const fluxBad = fromEnd <= 4 ? 50 : 0;
    buckets.push({
      start,
      eventType: "generate.image",
      model: "flux",
      availability: { valid: 120, good: 120 - fluxBad },
      latency: { valid: 120 - fluxBad, good: 118 - fluxBad },
      primary: { valid: 120, good: 120 - fluxBad },
    });

    buckets.push({
      start,
      eventType: "generate.image",
      model: "kontext",
      availability: { valid: 60, good: 60 },
      latency: { valid: 60, good: 59 },
      primary: { valid: 60, good: 57 },
    });
  }
  return { source: "synthetic-incident", bucketSeconds, buckets };
}
