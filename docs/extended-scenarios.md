# Cache, deduplication, and detached execution

The v0.2 fixtures extend the synchronous lab with result observations that do not necessarily own generation work. Their topology and `otel_genai_lab.*` attributes are experimental project assertions, not OpenTelemetry semantic conventions.

## Cache hit

The cache-hit trace contains one gateway server span and no generation or provider span. The observation is marked `cache_hit`, and no historical token usage is copied onto it. This distinguishes low-latency reuse from a new inference without turning previously observed usage into new billable usage.

## Concurrent deduplication

The first caller initiates one internal generation span and its provider attempt. The second caller is a separate root trace with a span link to the already-running generation. Both callers observe the result, while token usage remains on the single provider attempt.

```text
trace-1: observation-1 -> generation -> attempt-1 (usage owner)
trace-2: observation-2 --link--> generation
```

The link says that the second operation joined existing work. It does not make that caller a child of the first request or duplicate the provider call.

## Detached completion

The scheduling request, detached generation, and later result observation are separate roots in separate traces. The fixture does not invent parentage or trace links because the target Cloudflare runtime has not yet demonstrated that span context survives the detached boundary.

```text
trace-1: scheduling observation
trace-2: detached generation -> attempt-1 (usage owner)
trace-3: result observation
```

The roots share a short synthetic `otel_genai_lab.correlation.id`. A production experiment must replace this fixture value with a bounded, non-secret representation and test its cardinality. If the runtime proves that valid span context survives, an OpenTelemetry span link is preferable to a project correlation attribute.

## Usage and metrics

Result observations never repeat `gen_ai.usage.*`. The provider attempt owns the authoritative usage in these fixtures. This follows the double-counting concern in [OpenTelemetry GenAI #403](https://github.com/open-telemetry/semantic-conventions-genai/issues/403): a later fetch should not repeat usage already captured for the generation, while a background system still needs one terminal owner when no earlier span captured it.

Every fixture declares `metricAccountingGuarantee: "not_asserted"`. Traces can demonstrate one modeled usage owner, but they cannot prove exactly-once metric delivery across retries, process failure, or exporter replay. Production metrics require their own idempotency and aggregation design.
