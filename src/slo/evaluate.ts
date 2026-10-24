import type {
  BucketFile,
  Counts,
  SloBucket,
  SloDefinition,
  TargetConfig,
} from "./model.js";

export type Severity = "page" | "ticket";

export interface AlertRule {
  severity: Severity;
  longMinutes: number;
  shortMinutes: number;
  burnRate: number;
}

/** Multi-window, multi-burn-rate rules for a 30-day budget. */
export const alertRules: readonly AlertRule[] = [
  { severity: "page", longMinutes: 60, shortMinutes: 5, burnRate: 14.4 },
  { severity: "page", longMinutes: 360, shortMinutes: 30, burnRate: 6 },
  { severity: "ticket", longMinutes: 4320, shortMinutes: 360, burnRate: 1 },
];

export type SloStatus = Severity | "ok" | "uncalibrated" | "insufficient-data";

export interface AlertEvaluation {
  severity: Severity;
  window: string;
  burnRate: number;
  longBurn: number | null;
  shortBurn: number | null;
  firing: boolean;
}

export interface SloResult {
  slo: string;
  sli: SloDefinition["sli"];
  eventType: string;
  model?: string;
  objective: number | null;
  status: SloStatus;
  valid: number;
  good: number;
  sliValue: number | null;
  budgetRemaining: number | null;
  /** Minutes of the SLO window the input actually covers. */
  coverageMinutes: number;
  alerts: AlertEvaluation[];
}

export interface SloReport {
  source: string;
  target: string;
  evaluatedAt: string;
  status: "alert" | "ok";
  summary: { slos: number; page: number; ticket: number };
  results: SloResult[];
}

const minute = 60_000;

export function evaluateSlos(
  file: BucketFile,
  target: TargetConfig,
  at?: Date,
): SloReport {
  const bucketMs = file.bucketSeconds * 1000;
  const starts = file.buckets.map(({ start }) => Date.parse(start));
  const end =
    at?.getTime() ??
    (starts.length === 0 ? Date.now() : Math.max(...starts) + bucketMs);
  const first = starts.length === 0 ? end : Math.min(...starts);

  const results = target.slos.flatMap((slo) =>
    groups(file.buckets, slo).map(([model, buckets]) =>
      evaluateGroup(slo, model, buckets, end, first),
    ),
  );
  const page = results.filter(({ status }) => status === "page").length;
  const ticket = results.filter(({ status }) => status === "ticket").length;
  return {
    source: file.source,
    target: target.name,
    evaluatedAt: new Date(end).toISOString(),
    status: page + ticket > 0 ? "alert" : "ok",
    summary: { slos: results.length, page, ticket },
    results,
  };
}

function groups(
  buckets: readonly SloBucket[],
  slo: SloDefinition,
): [string | undefined, SloBucket[]][] {
  const matching = buckets.filter(
    (bucket) => bucket.eventType === slo.eventType && bucket[slo.sli],
  );
  if (!slo.perModel) return [[undefined, matching]];
  const byModel = new Map<string, SloBucket[]>();
  for (const bucket of matching) {
    byModel.set(bucket.model, [...(byModel.get(bucket.model) ?? []), bucket]);
  }
  return [...byModel.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function evaluateGroup(
  slo: SloDefinition,
  model: string | undefined,
  buckets: readonly SloBucket[],
  end: number,
  first: number,
): SloResult {
  const total = (minutes: number): Counts => {
    const from = end - minutes * minute;
    let valid = 0;
    let good = 0;
    for (const bucket of buckets) {
      const start = Date.parse(bucket.start);
      const counts = bucket[slo.sli];
      if (start >= from && start < end && counts) {
        valid += counts.valid;
        good += counts.good;
      }
    }
    return { valid, good };
  };
  const burn = ({ valid, good }: Counts, objective: number): number | null =>
    valid === 0 ? null : (1 - good / valid) / (1 - objective);

  const windowMinutes = slo.windowDays * 24 * 60;
  const window = total(windowMinutes);
  const sliValue = window.valid === 0 ? null : window.good / window.valid;
  const coverageMinutes = Math.max(
    0,
    Math.min(windowMinutes, Math.round((end - first) / minute)),
  );
  const result: SloResult = {
    slo: slo.id,
    sli: slo.sli,
    eventType: slo.eventType,
    ...(model === undefined ? {} : { model }),
    objective: slo.objective,
    status: "ok",
    valid: window.valid,
    good: window.good,
    sliValue: round(sliValue, 5),
    budgetRemaining: null,
    coverageMinutes,
    alerts: [],
  };

  const { objective } = slo;
  if (objective === null) return { ...result, status: "uncalibrated" };
  if (window.valid < slo.minValid) {
    return { ...result, status: "insufficient-data" };
  }

  // Burn over the covered span, scaled to the share of the window it covers,
  // so three days of data never claim to have spent a whole 30-day budget.
  const spent =
    ((burn(window, objective) ?? 0) * coverageMinutes) / windowMinutes;
  // Primary health is a ticket-only signal: it must never page anyone.
  const rules = alertRules.filter(
    ({ severity }) => slo.sli !== "primary" || severity === "ticket",
  );
  const alerts = rules.map((rule): AlertEvaluation => {
    const long = total(rule.longMinutes);
    const longBurn = burn(long, objective);
    const shortBurn = burn(total(rule.shortMinutes), objective);
    return {
      severity: rule.severity,
      window: `${label(rule.longMinutes)}/${label(rule.shortMinutes)}`,
      burnRate: rule.burnRate,
      longBurn: round(longBurn, 3),
      shortBurn: round(shortBurn, 3),
      firing:
        long.valid >= slo.minValid &&
        longBurn !== null &&
        shortBurn !== null &&
        longBurn >= rule.burnRate &&
        shortBurn >= rule.burnRate,
    };
  });
  const firing = alerts.filter(({ firing }) => firing);
  return {
    ...result,
    status: firing.some(({ severity }) => severity === "page")
      ? "page"
      : firing.length > 0
        ? "ticket"
        : "ok",
    budgetRemaining: round(1 - spent, 4),
    alerts,
  };
}

function label(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function round(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
