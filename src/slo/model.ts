import fs from "node:fs";

export type SliName = "availability" | "latency" | "primary";

export const sliNames: readonly SliName[] = [
  "availability",
  "latency",
  "primary",
];

export interface Counts {
  valid: number;
  good: number;
}

/**
 * Good and valid counts for one time bucket. Every data source (Pollinations
 * Tinybird, a D1 client log, the synthetic generator) is exported to this
 * shape so one evaluator serves all of them.
 */
export interface SloBucket {
  start: string;
  eventType: string;
  model: string;
  availability?: Counts;
  latency?: Counts;
  primary?: Counts;
}

export interface BucketFile {
  source: string;
  bucketSeconds: number;
  buckets: SloBucket[];
}

export interface SloDefinition {
  id: string;
  sli: SliName;
  eventType: string;
  /** Evaluate each model separately instead of the whole event type. */
  perModel?: boolean;
  /** Null until calibrated; uncalibrated SLOs report values but never alert. */
  objective: number | null;
  windowDays: number;
  minValid: number;
}

export interface TargetConfig {
  name: string;
  description: string;
  latencyThresholdsMs?: Record<string, number>;
  slos: SloDefinition[];
}

export function readBucketFile(filename: string): BucketFile {
  return parseBucketFile(readJson(filename));
}

export function readTargetConfig(filename: string): TargetConfig {
  return parseTargetConfig(readJson(filename));
}

export function parseBucketFile(value: unknown): BucketFile {
  const file = object(value, "bucket file");
  const bucketSeconds = positiveInteger(file.bucketSeconds, "bucketSeconds");
  if (!Array.isArray(file.buckets)) throw new Error("buckets must be an array");
  return {
    source: text(file.source, "source"),
    bucketSeconds,
    buckets: file.buckets.map((entry, index) => {
      const bucket = object(entry, `buckets[${index}]`);
      const start = text(bucket.start, `buckets[${index}].start`);
      if (Number.isNaN(Date.parse(start))) {
        throw new Error(`buckets[${index}].start must be an ISO timestamp`);
      }
      const parsed: SloBucket = {
        start,
        eventType: text(bucket.eventType, `buckets[${index}].eventType`),
        model: text(bucket.model, `buckets[${index}].model`),
      };
      for (const sli of sliNames) {
        if (bucket[sli] !== undefined) {
          parsed[sli] = counts(bucket[sli], `buckets[${index}].${sli}`);
        }
      }
      return parsed;
    }),
  };
}

export function parseTargetConfig(value: unknown): TargetConfig {
  const config = object(value, "target config");
  if (!Array.isArray(config.slos)) throw new Error("slos must be an array");
  const target: TargetConfig = {
    name: text(config.name, "name"),
    description: text(config.description, "description"),
    slos: config.slos.map((entry, index) => {
      const slo = object(entry, `slos[${index}]`);
      const sli = slo.sli;
      if (!sliNames.includes(sli as SliName)) {
        throw new Error(
          `slos[${index}].sli must be one of ${sliNames.join(", ")}`,
        );
      }
      const objective = slo.objective;
      if (
        objective !== null &&
        (typeof objective !== "number" || objective <= 0 || objective >= 1)
      ) {
        throw new Error(
          `slos[${index}].objective must be null or between 0 and 1`,
        );
      }
      const definition: SloDefinition = {
        id: text(slo.id, `slos[${index}].id`),
        sli: sli as SliName,
        eventType: text(slo.eventType, `slos[${index}].eventType`),
        objective,
        windowDays: positiveInteger(
          slo.windowDays,
          `slos[${index}].windowDays`,
        ),
        minValid: positiveInteger(slo.minValid, `slos[${index}].minValid`),
      };
      if (slo.perModel === true) definition.perModel = true;
      return definition;
    }),
  };
  if (config.latencyThresholdsMs !== undefined) {
    const thresholds = object(
      config.latencyThresholdsMs,
      "latencyThresholdsMs",
    );
    target.latencyThresholdsMs = Object.fromEntries(
      Object.entries(thresholds).map(([eventType, threshold]) => [
        eventType,
        positiveInteger(threshold, `latencyThresholdsMs.${eventType}`),
      ]),
    );
  }
  return target;
}

function readJson(filename: string): unknown {
  return JSON.parse(fs.readFileSync(filename, "utf8")) as unknown;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value as number;
}

function counts(value: unknown, field: string): Counts {
  const entry = object(value, field);
  const { valid, good } = entry;
  if (
    !Number.isInteger(valid) ||
    !Number.isInteger(good) ||
    (good as number) < 0 ||
    (good as number) > (valid as number)
  ) {
    throw new Error(`${field} needs integer counts with 0 <= good <= valid`);
  }
  return { valid: valid as number, good: good as number };
}
