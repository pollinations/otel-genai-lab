import path from "node:path";

import { validateOtlpSpans, type ConformanceReport } from "./conformance.js";
import { inspectOtlpSpans, type InspectionReport } from "./inspection.js";
import { readOtlpFile } from "./otlp.js";

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
      if (span.implementationAttributes.length > 0) {
        details.push(
          `implementation=${span.implementationAttributes.join(",")}`,
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
    "",
    "Validates OTLP/JSON Collector trace exports against the experimental",
    "GenAI gateway topology, usage, attribute-safety, and privacy policy.",
    "Inspect reports cross-gateway topology and retained safe fields without",
    "requiring the input to match the experimental topology.",
  ].join("\n");
}
