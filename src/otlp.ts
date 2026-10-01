import fs from "node:fs";

export interface OtlpAttributeMap {
  [key: string]: OtlpAttributeValue;
}

export type OtlpAttributeValue =
  string | number | boolean | OtlpAttributeValue[] | OtlpAttributeMap | null;

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: number | string;
  statusCode: number | string;
  attributes: Record<string, OtlpAttributeValue>;
}

export function readOtlpFile(filename: string): OtlpSpan[] {
  const source = fs.readFileSync(filename, "utf8").trim();
  if (source.length === 0) throw new Error("input file is empty");

  let documents: unknown[];
  try {
    const parsed: unknown = JSON.parse(source);
    documents = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    documents = source
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          throw new Error(`line ${index + 1} is not valid JSON`);
        }
      });
  }

  const spans = documents.flatMap(extractDocumentSpans);
  if (spans.length === 0) {
    throw new Error("input contains no OTLP resourceSpans");
  }
  return spans;
}

function extractDocumentSpans(document: unknown): OtlpSpan[] {
  if (!isRecord(document) || !Array.isArray(document.resourceSpans)) {
    throw new Error("expected an OTLP/JSON object with resourceSpans");
  }

  const spans: OtlpSpan[] = [];
  for (const resource of document.resourceSpans) {
    if (!isRecord(resource) || !Array.isArray(resource.scopeSpans)) continue;
    for (const scope of resource.scopeSpans) {
      if (!isRecord(scope) || !Array.isArray(scope.spans)) continue;
      for (const raw of scope.spans) spans.push(parseSpan(raw));
    }
  }
  return spans;
}

function parseSpan(value: unknown): OtlpSpan {
  if (!isRecord(value)) throw new Error("OTLP span must be an object");
  const traceId = requiredString(value, "traceId");
  const spanId = requiredString(value, "spanId");
  const name = requiredString(value, "name");
  const parentSpanId =
    typeof value.parentSpanId === "string" && value.parentSpanId.length > 0
      ? value.parentSpanId
      : null;
  const kind =
    typeof value.kind === "number" || typeof value.kind === "string"
      ? value.kind
      : 0;
  const status = isRecord(value.status) ? value.status.code : 0;
  const statusCode =
    typeof status === "number" || typeof status === "string" ? status : 0;

  const attributes: Record<string, OtlpAttributeValue> = {};
  if (Array.isArray(value.attributes)) {
    for (const attribute of value.attributes) {
      if (!isRecord(attribute) || typeof attribute.key !== "string") continue;
      attributes[attribute.key] = parseAnyValue(attribute.value);
    }
  }

  return {
    traceId,
    spanId,
    parentSpanId,
    name,
    kind,
    statusCode,
    attributes,
  };
}

function parseAnyValue(value: unknown): OtlpAttributeValue {
  if (!isRecord(value)) return null;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.boolValue === "boolean") return value.boolValue;
  if (typeof value.doubleValue === "number") return value.doubleValue;
  if (
    typeof value.intValue === "number" ||
    typeof value.intValue === "string"
  ) {
    const parsed = Number(value.intValue);
    return Number.isSafeInteger(parsed) ? parsed : String(value.intValue);
  }
  if (isRecord(value.arrayValue) && Array.isArray(value.arrayValue.values)) {
    return value.arrayValue.values.map(parseAnyValue);
  }
  if (isRecord(value.kvlistValue) && Array.isArray(value.kvlistValue.values)) {
    return Object.fromEntries(
      value.kvlistValue.values.flatMap(
        (entry): [string, OtlpAttributeValue][] =>
          isRecord(entry) && typeof entry.key === "string"
            ? [[entry.key, parseAnyValue(entry.value)]]
            : [],
      ),
    );
  }
  if (typeof value.bytesValue === "string") return "<bytes>";
  return null;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`OTLP span is missing ${key}`);
  }
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
