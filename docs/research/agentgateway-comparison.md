# Cross-gateway comparison: agentgateway

- Reviewed project: [agentgateway](https://github.com/agentgateway/agentgateway)
- Reviewed revision: [`7e47ceb576aa9d3300cb0d2c7c35848fb0af048f`](https://github.com/agentgateway/agentgateway/tree/7e47ceb576aa9d3300cb0d2c7c35848fb0af048f)
- Review date: 2026-09-28
- Pollinations comparison basis: production gateway architecture reviewed at `8a6fcad4aa640a30e7601213ff524fbcfcab9f5e`

## Selection

Agentgateway is the second implementation for this lab. It is actively maintained, supports several LLM providers, implements priority-based provider failover, and emits OpenTelemetry GenAI attributes.

Kgateway was considered first because it is a CNCF Sandbox project and previously hosted an LFX project for AI gateway tracing. It is not the current runtime comparison: kgateway states that its agentgateway control plane moved to the agentgateway repository starting in version 2.3.0, and its Envoy-based AI Gateway path is deprecated. See the current [kgateway README](https://github.com/kgateway-dev/kgateway/blob/48fea466b1cbb38bc0c753df1e53d6f588f4abd5/README.md#L42-L44) and [deprecated AI quick start](https://github.com/kgateway-dev/kgateway/blob/48fea466b1cbb38bc0c753df1e53d6f588f4abd5/devel/debugging/quick-start-ai-gateway-locally.md#L1-L7).

This distinction affects project positioning. OpenTelemetry remains the prospective CNCF upstream for portable telemetry semantics. Agentgateway supplies current cross-implementation evidence; it does not by itself make this an LFX project.

## Source-backed behavior

### Provider selection and failover

Agentgateway represents an AI backend as prioritized provider buckets. More than one priority group enables default health eviction and failover ([source](https://github.com/agentgateway/agentgateway/blob/7e47ceb576aa9d3300cb0d2c7c35848fb0af048f/crates/agentgateway/src/llm/mod.rs#L68-L88)). The controller has fixtures that translate multiple providers and priority levels into provider groups ([fixture](https://github.com/agentgateway/agentgateway/blob/7e47ceb576aa9d3300cb0d2c7c35848fb0af048f/controller/pkg/syncer/backend/testdata/MultiPool_backend_with_multiple_priority_levels_-_creates_separate_provider_groups.yaml)).

Each upstream attempt selects a currently healthy provider ([source](https://github.com/agentgateway/agentgateway/blob/7e47ceb576aa9d3300cb0d2c7c35848fb0af048f/crates/agentgateway/src/proxy/httpproxy.rs#L2460-L2485)). Its retry loop replays a buffered request, sets `retry.attempt` after the first attempt, and can retry according to route policy ([source](https://github.com/agentgateway/agentgateway/blob/7e47ceb576aa9d3300cb0d2c7c35848fb0af048f/crates/agentgateway/src/proxy/httpproxy.rs#L1185-L1248)).

This supports the same three synchronous behavioral cases as the Pollinations lab:

1. a direct provider success;
2. a retryable failure followed by a different provider or model;
3. all eligible attempts failing.

The selection algorithms differ. Pollinations uses an application-level ordered fallback list. Agentgateway combines provider priority groups, health state, endpoint selection, and retry policy. A portable trace model must describe observed operations and attempts without assuming either routing algorithm.

### Current telemetry boundary

Agentgateway emits a request-level set of GenAI attributes including operation, provider, requested and response model, and usage ([source](https://github.com/agentgateway/agentgateway/blob/7e47ceb576aa9d3300cb0d2c7c35848fb0af048f/crates/agentgateway/src/telemetry/log.rs#L1818-L1875)). It also emits the final `retry.attempt` value on that telemetry record ([source](https://github.com/agentgateway/agentgateway/blob/7e47ceb576aa9d3300cb0d2c7c35848fb0af048f/crates/agentgateway/src/telemetry/log.rs#L1975-L1983)).

The retry loop mutates one request log across attempts, and LLM request details are updated during provider-specific processing. Source inspection therefore does not prove that a consumer receives a complete, portable GenAI record for every failed provider attempt. Runtime fixtures are needed to determine which attempt details survive and how generic HTTP client spans relate to the final GenAI record.

Agentgateway also separates project attributes under `agw.ai.*` and comments when a `gen_ai.*` field is outside the official convention. That is a useful precedent for this lab: implementation-specific facts must not be presented as standardized attributes.

### Cache, deduplication, and detached execution

Agentgateway records provider prompt-cache token categories. That is different from Pollinations serving an entire cached generation, so it does not satisfy the lab's cache-hit scenario.

The reviewed source did not establish equivalents for Pollinations' concurrent generation deduplication or Durable Object execution. These remain Pollinations-specific evidence until another implementation demonstrates the same behavior. They should be extensions to the shared synchronous model, not requirements imposed on every gateway.

## Scenario matrix

| Scenario                            | Pollinations                  | Agentgateway                               | Portable baseline                                      |
| ----------------------------------- | ----------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Direct success                      | Yes                           | Yes                                        | One logical request and one provider attempt           |
| Fallback success                    | Ordered application fallback  | Priority, health, and retry based failover | One logical request and two or more ordered attempts   |
| Terminal failure                    | Fallback candidates exhausted | Eligible attempts exhausted or retry stops | Final failure plus observable attempted calls          |
| Whole-response cache hit            | Yes                           | No equivalent established                  | Extension; zero new provider attempts                  |
| Concurrent generation deduplication | Yes                           | No equivalent established                  | Extension; several callers may observe one generation  |
| Detached generation execution       | Durable Object path           | No equivalent established                  | Extension; correlation may require links or stable IDs |
| Provider prompt-cache token usage   | Provider-dependent            | Yes                                        | Usage detail, separate from whole-response caching     |

## Result

The original project direction is **revised and retained**.

The shared, portable core is synchronous multi-provider execution:

- one caller-visible gateway operation;
- zero or more actual provider attempts;
- ordered attempt outcomes and durations;
- authoritative usage only where the provider exposes it;
- no prompt or response content by default.

Cache hits, caller deduplication, and detached execution form a second layer. They are valuable Pollinations cases and relevant to OpenTelemetry discussions, but they cannot yet be claimed as universal gateway behavior.

## Runtime evidence method

Issue [#31](https://github.com/pollinations/otel-genai-lab/issues/31) adds an opt-in runtime harness for `ghcr.io/agentgateway/agentgateway:v1.5.0`. It uses a deterministic local OpenAI-compatible provider on Node.js `24.15.0-alpine`, exports OTLP/HTTP protobuf through Collector `0.161.0`, and retains Collector JSON only under the ignored `tmp/` directory. The Compose profile pins all three image indexes by digest.

The harness sends one direct success and one deterministic provider error, with prompt and response capture disabled. The `inspect` command retains only the bounded GenAI operation, provider, model, usage, and HTTP outcome fields needed for comparison; it reports `agw.*` and `agentgateway.*` attribute names separately and applies the lab's privacy and attribute-safety checks.

### Runtime result

The 2026-10-01 capture produced two traces and four spans with no safety findings. The normalized, identifier-free evidence is committed at [`fixtures/interop/agentgateway-v1.5.0.json`](../../fixtures/interop/agentgateway-v1.5.0.json).

Agentgateway v1.5.0 puts the standard GenAI operation, provider, model, and successful usage fields on the inbound `SERVER` span. Its outbound provider call is a child HTTP `CLIENT` span with `agentgateway.outbound.*` classification but no `gen_ai.*` fields. Both spans retain the provider HTTP outcome (`200` or `503`), while their OpenTelemetry span status remains `UNSET`.

This confirms that the shared behavioral concepts exist but the emitted topology is not the lab's proposed one-GenAI-client-span-per-provider-attempt baseline. In particular, the direct and failed provider calls are visible, but attempt-level GenAI identity and usage are not attached to the client spans. A multi-provider fallback capture remains necessary to determine whether separate failed and successful HTTP client spans survive under one gateway server span.

## Consequences for implementation

1. Canonical fixtures start with direct success, fallback success, and terminal failure.
2. Fixtures describe behavior independently of Pollinations' fallback list or agentgateway's priority groups.
3. The first OTLP mapping uses current HTTP and GenAI conventions and marks project-only fields as experimental.
4. The lab must capture every provider attempt even if another gateway exposes only a final request record.
5. Cache, deduplication, and detached execution are added after the synchronous validator is working.
6. Upstream discussion remains focused on OpenTelemetry GenAI issue #231.
