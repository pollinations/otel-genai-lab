import path from "node:path";

import { validateOtlpSpans, type ConformanceReport } from "./conformance.js";
import { inspectOtlpSpans, type InspectionReport } from "./inspection.js";
import { readOtlpFile } from "./otlp.js";
import { evaluateSlos, type SloReport } from "./slo/evaluate.js";
import { readBucketFile, readTargetConfig } from "./slo/model.js";

interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const defaultIo: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

export function runCli(args: readonly string[], io: CliIo = defaultIo): number {
  if (args.includes("--help") || args.includes("-h")) {
    io.stdout(helpText());
    return 0;
  }
  const command = args[0];
  if (command === "slo") return runSlo(args.slice(1), io);
  if (
    (command !== "validate" && command !== "inspect") ||
    args[1] === undefined
  ) {
    io.stderr(helpText());
    return 2;
  }

  const filename = args[1];
  const formatResult = readFormat(args.slice(2));
  if (typeof formatResult !== "string") {
    io.stderr(formatResult.error);
    return 2;
  }

  try {
    const input = path.basename(filename);
    const spans = readOtlpFile(filename);
    if (command === "validate") {
      const report = validateOtlpSpans(spans);
      io.stdout(
        formatResult === "json"
          ? JSON.stringify({ input, ...report }, null, 2)
          : formatTextReport(input, report),
      );
      return report.status === "pass" ? 0 : 1;
    }

    const report = inspectOtlpSpans(spans);
    io.stdout(
      formatResult === "json"
        ? JSON.stringify({ input, ...report }, null, 2)
        : formatInspectionReport(input, report),
    );
    return report.status === "pass" ? 0 : 1;
  } catch (error) {
    io.stderr(
      `${path.basename(filename)}: ${error instanceof Error ? error.message : "validation failed"}`,
    );
    return 2;
  }
}

function runSlo(args: readonly string[], io: CliIo): number {
  const filename = args[0];
  let target: string | undefined;
  let at: Date | undefined;
  let format: "text" | "json" = "text";
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value === undefined) {
      io.stderr(`${flag} needs a value`);
      return 2;
    }
    if (flag === "--target") target = value;
    else if (flag === "--at" && !Number.isNaN(Date.parse(value))) {
      at = new Date(value);
    } else if (flag === "--format" && (value === "text" || value === "json")) {
      format = value;
    } else {
      io.stderr(`unexpected ${flag} ${value}`);
      return 2;
    }
  }
  if (filename === undefined || target === undefined) {
    io.stderr(helpText());
    return 2;
  }

  try {
    const report = evaluateSlos(
      readBucketFile(filename),
      readTargetConfig(target),
      at,
    );
    io.stdout(
      format === "json"
        ? JSON.stringify(report, null, 2)
        : formatSloReport(path.basename(filename), report),
    );
    return report.status === "ok" ? 0 : 1;
  } catch (error) {
    io.stderr(
      `${path.basename(filename)}: ${error instanceof Error ? error.message : "SLO evaluation failed"}`,
    );
    return 2;
  }
}

function formatSloReport(input: string, report: SloReport): string {
  const { slos, page, ticket } = report.summary;
  const lines = [
    `${report.status.toUpperCase()} ${input} (${report.target} at ${report.evaluatedAt}): ${slos} SLO(s), ${page} page, ${ticket} ticket`,
  ];
  for (const result of report.results) {
    const name = result.model
      ? `${result.slo} model=${result.model}`
      : result.slo;
    const details = [
      `sli=${result.sliValue ?? "n/a"}`,
      `objective=${result.objective ?? "uncalibrated"}`,
      `valid=${result.valid}`,
    ];
    if (result.budgetRemaining !== null) {
      details.push(`budget=${(result.budgetRemaining * 100).toFixed(1)}%`);
    }
    for (const alert of result.alerts.filter(({ firing }) => firing)) {
      details.push(
        `${alert.window} burn ${alert.longBurn}/${alert.shortBurn} >= ${alert.burnRate}`,
      );
    }
    lines.push(
      `  ${result.status.toUpperCase().padEnd(17)} ${name} [${details.join("; ")}]`,
    );
  }
  return lines.join("\n");
}

function formatInspectionReport(
  input: string,
  report: InspectionReport,
): string {
  const { traces, spans, genAiSpans, safetyIssues } = report.summary;
  const lines = [
    `${report.status.toUpperCase()} ${input}: ${traces} trace(s), ${spans} span(s), ${genAiSpans} GenAI span(s), ${safetyIssues} safety issue(s)`,
  ];
  for (const trace of report.traces) {
    lines.push(`  ${trace.trace}: ${trace.spans.length} span(s)`);
    for (const span of trace.spans) {
      const details = Object.entries(span.genAi).map(
        ([name, value]) => `${name}=${JSON.stringify(value)}`,
      );
      details.push(
        ...Object.entries(span.outcome).map(
          ([name, value]) => `${name}=${JSON.stringify(value)}`,
        ),
      );
      if (span.implementationAttributes.length > 0) {
        details.push(
          `implementation=${Object.entries(span.implementation)
            .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
            .join(",")}`,
        );
      }
      lines.push(
        `    ${span.span}: ${span.kind} ${span.status} ${span.name}${details.length > 0 ? ` [${details.join("; ")}]` : ""}`,
      );
    }
  }
  for (const issue of report.safetyIssues) {
    lines.push(
      `  [${issue.code}] ${issue.trace}.${issue.span}.${issue.field}: ${issue.message}`,
    );
  }
  return lines.join("\n");
}

function readFormat(
  args: readonly string[],
): "text" | "json" | { error: string } {
  if (args.length === 0) return "text";
  if (
    args.length === 2 &&
    args[0] === "--format" &&
    (args[1] === "text" || args[1] === "json")
  ) {
    return args[1];
  }
  return { error: "expected --format text or --format json" };
}

function formatTextReport(input: string, report: ConformanceReport): string {
  const { traces, spans, providerAttempts, issues } = report.summary;
  const lines = [
    `${report.status.toUpperCase()} ${input}: ${traces} trace(s), ${spans} span(s), ${providerAttempts} provider attempt(s), ${issues} issue(s)`,
  ];
  for (const trace of report.traces) {
    lines.push(
      `  ${trace.trace}: ${trace.spans} span(s), ${trace.providerAttempts} provider attempt(s)`,
    );
    for (const issue of trace.issues) {
      lines.push(
        `    [${issue.code}] ${issue.span}.${issue.field}: ${issue.message}`,
      );
    }
  }
  return lines.join("\n");
}

function helpText(): string {
  return [
    "Usage: otel-genai-lab validate <traces.json> [--format text|json]",
    "       otel-genai-lab inspect <traces.json> [--format text|json]",
    "       otel-genai-lab slo <buckets.json> --target <target.json> [--at <iso>] [--format text|json]",
    "",
    "Validates OTLP/JSON Collector trace exports against the experimental",
    "GenAI gateway topology, usage, attribute-safety, and privacy policy.",
    "Inspect reports cross-gateway topology and retained safe fields without",
    "requiring the input to match the experimental topology.",
    "Slo evaluates SLO burn-rate alerts over exported good/valid buckets.",
  ].join("\n");
}
