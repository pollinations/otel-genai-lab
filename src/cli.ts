import path from "node:path";

import { validateOtlpSpans, type ConformanceReport } from "./conformance.js";
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
  if (args[0] !== "validate" || args[1] === undefined) {
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
    const report = validateOtlpSpans(readOtlpFile(filename));
    if (formatResult === "json") {
      io.stdout(
        JSON.stringify({ input: path.basename(filename), ...report }, null, 2),
      );
    } else {
      io.stdout(formatTextReport(path.basename(filename), report));
    }
    return report.status === "pass" ? 0 : 1;
  } catch (error) {
    io.stderr(
      `${path.basename(filename)}: ${error instanceof Error ? error.message : "validation failed"}`,
    );
    return 2;
  }
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
    "",
    "Validates OTLP/JSON Collector trace exports against the experimental",
    "GenAI gateway topology, usage, attribute-safety, and privacy policy.",
  ].join("\n");
}
