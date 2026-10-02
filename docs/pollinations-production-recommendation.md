# Pollinations production instrumentation recommendation

- Status: **staging only; production rollout is not yet recommended**
- Evidence cutoff: 2026-10-02
- Scope: Pollinations server-side GenAI gateway tracing

## Decision

Continue the vendor-neutral lab and bounded staging work. Do not enable the current Cloudflare native tracing configuration across Pollinations production.

A production canary becomes reasonable only after Pollinations owns the telemetry data policy, establishes an untraced performance baseline, and chooses a detached-execution correlation design. The trace mapping remains experimental while the OpenTelemetry GenAI SIG considers server-side gateways in [semantic-conventions-genai#231](https://github.com/open-telemetry/semantic-conventions-genai/issues/231).

This recommendation does not imply Pollinations production approval or CNCF, OpenTelemetry, or LFX endorsement.

## Evidence

| Evidence                                                                                 | Finding                                                                                                                                           | Production implication                                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [Canonical scenarios](../fixtures/README.md) and [validation policy](validation.md)      | Direct, fallback, terminal failure, cache, deduplication, and detached behavior are deterministic; content and unsafe attributes fail validation. | Keep the scenario and privacy checks as CI gates for every instrumentation adapter.                                          |
| [Cloudflare staging report](staging/cloudflare-report.md)                                | Direct and fallback paths were diagnostically useful. Detached Durable Object work split across independent traces.                               | Do not claim end-to-end detached traces with the current native API.                                                         |
| [Cloudflare staging report](staging/cloudflare-report.md#privacy-and-cardinality-result) | Project fields were bounded and content-free, but platform telemetry persisted request, network, IP-derived location, and client metadata.        | Approve collection, retention, access, and deletion rules before sending production traffic.                                 |
| [Cloudflare staging report](staging/cloudflare-report.md#trace-continuity-and-timing)    | Traced CPU values were small, but no untraced baseline existed.                                                                                   | The experiment cannot establish tracing overhead. Benchmark before rollout.                                                  |
| [Agentgateway direct/error evidence](../fixtures/interop/agentgateway-v1.5.0.json)       | Agentgateway put GenAI operation and usage data on the server span and represented the provider call as generic HTTP.                             | Do not assume gateways currently emit one common GenAI span topology.                                                        |
| [Agentgateway fallback evidence](../fixtures/interop/agentgateway-v1.5.0-fallback.json)  | Separate failed and successful provider calls survived, usage appeared once, and attempt client spans lacked provider/model identity.             | Preserve physical attempts, outcome, and usage ownership in Pollinations' internal model even if the export mapping changes. |

## Instrumentation boundary

Pollinations should maintain two observable concepts:

1. **Logical gateway operation:** the caller-visible request, final outcome, total latency, requested model, and whether the result was direct, fallback, cached, deduplicated, or detached.
2. **Provider attempt:** every outbound provider call that actually ran, in order, with resolved provider/model, duration, outcome, error category, and authoritative usage when returned.

The lab currently represents the logical operation as an HTTP `SERVER` span and each provider call as a GenAI `CLIENT` span. That mapping is an experiment, not an agreed OpenTelemetry convention. Production code should keep operation and attempt facts separate from the exporter so SIG guidance can change the emitted topology without rewriting routing or settlement logic.

Use current standard HTTP and GenAI attributes where their meanings fit. Do not introduce new project-defined `gen_ai.*` fields. Until upstream guidance distinguishes caller-requested and resolved attempt models, retain that distinction in Pollinations' existing bounded internal analytics rather than labeling a custom trace field as standard.

## Usage and outcome rules

- Record usage only from an authoritative provider response.
- Attach one additive usage observation to the generation owner; cache reads and deduplicated observations must not repeat it as new usage.
- Keep failed attempts even when a later provider succeeds.
- Do not invent token counts for errors or providers that omit usage.
- Preserve the final logical outcome separately from each attempt outcome.
- Treat trace export as diagnostic telemetry, not billing or settlement authority.

## Privacy and cardinality controls

The production adapter must satisfy all of these controls:

- Prompt, completion, request body, authorization, cookies, credentials, and raw query strings are disabled by default.
- Header capture uses an explicit allowlist. A denylist is insufficient for provider and client credentials.
- Provider names, model aliases, route names, status classes, and error categories come from bounded registries.
- User IDs, request IDs, generation IDs, Durable Object IDs, IP addresses, and arbitrary URLs are not metric labels.
- Access, retention, deletion, and incident-response owners are documented for both the configured exporter and Cloudflare's native persisted telemetry.
- A sampled trace is checked with the repository validator before each rollout increase.

The Cloudflare experiment's native metadata finding applies even when custom span fields pass the validator. A production review must inspect the complete stored/exported envelope, not only application-defined attributes.

## Detached execution

Current Workers custom spans cannot read or manually wire span context across the Durable Object alarm boundary. The route, alarm, and alarm-side provider call therefore appeared as separate traces.

Before production, choose and test one of these designs:

- an instrumentation path that can propagate OpenTelemetry context and create a link from detached work;
- a platform-supported trace-context feature if Cloudflare adds one; or
- explicitly separate traces joined only in an access-controlled diagnostic store through a bounded correlation design.

Do not fabricate parent-child relationships. Do not place raw Durable Object or generation identifiers into metric labels. Any correlation value requires retention, access, collision, and deletion review.

## Rollout gates

| Gate                 | Pass evidence                                                                                                                                        | Failure condition                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Data governance      | Named owner approves fields, native Cloudflare metadata, destination, retention, access, and deletion.                                               | Ownership is missing or stored metadata is broader than the approved policy.                 |
| Content safety       | Synthetic and representative sampled exports pass the CLI privacy and attribute-safety checks.                                                       | Any prompt, completion, credential, authorization value, request body, or raw query appears. |
| Cardinality          | A bounded inventory exists for every metric label and indexed trace field.                                                                           | Arbitrary IDs, URLs, prompts, or unbounded model/provider values become labels.              |
| Detached correlation | A test proves context propagation, a valid span link, or explicitly documented separate-trace behavior.                                              | Telemetry implies parentage that the runtime did not preserve.                               |
| Overhead             | Traced and untraced runs use the same workload and report latency, CPU, memory, export volume, and error-rate deltas with a pre-agreed budget.       | Only traced measurements exist, or a budget is exceeded.                                     |
| Diagnostic value     | Operators can answer provider-attempt latency, fallback path, terminal error, cache/deduplication, and usage-owner questions from sampled telemetry. | The canary cannot answer the agreed incident questions.                                      |
| Export reliability   | Backpressure, exporter failure, and destination outage tests do not change gateway correctness or expose secrets in retries/logs.                    | Telemetry failure affects request correctness or leaks protected data.                       |

## Rollout sequence

1. Keep deterministic fixtures and the validator required in CI.
2. Run staging with synthetic traffic and a complete stored-envelope privacy review.
3. Establish an untraced staging baseline, then compare an otherwise identical traced run.
4. Resolve or explicitly accept detached traces as separate before a production canary.
5. Define a low, budget-derived initial sampling rate, retention window, exporter limits, and rollback trigger.
6. Run a bounded production canary only after every gate above has an owner and passing evidence.
7. Increase coverage only when cost, latency, error rate, privacy review, and diagnostic-value evidence remain within the approved budgets.

## Upstream dependency

Pollinations can implement the behavioral boundary and safeguards now. The final standard span mapping remains blocked on OpenTelemetry GenAI SIG guidance about:

- GenAI identity on gateway-to-provider client spans;
- caller-requested versus resolved provider models;
- usage ownership when gateways, providers, and clients all emit telemetry; and
- detached internal execution versus provider background APIs.

Until that guidance arrives, keep the exporter versioned, label the mapping experimental, and avoid describing validator success as OpenTelemetry conformance.
