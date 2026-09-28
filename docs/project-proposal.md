# GenAI Gateway Telemetry Reference Lab

## Problem

Applications send one logical GenAI request to a gateway, while the gateway may route it across providers, retry or fall back, serve a cached result, deduplicate concurrent callers, or finish work in a detached execution context. Current OpenTelemetry GenAI conventions define logical client inference operations, but the correct portable representation of the gateway boundary and its provider attempts is still under discussion.

The project will answer this question with executable evidence:

> How should an OpenTelemetry trace represent one server-side GenAI gateway operation and its provider attempts when routing, fallback, caching, deduplication, or detached execution occurs, while keeping latency and usage attribution accurate and excluding prompt and response content by default?

Pollinations is the first production case. The reference lab must remain portable and must compare its model with at least one other open-source AI gateway before proposing any new semantic convention.

## Upstream context

- [OpenTelemetry GenAI #231](https://github.com/open-telemetry/semantic-conventions-genai/issues/231) discusses server-side and inference-engine span conventions.
- [OpenTelemetry GenAI #403](https://github.com/open-telemetry/semantic-conventions-genai/issues/403) discusses usage attribution for background execution and polling.
- [OpenTelemetry GenAI #476](https://github.com/open-telemetry/semantic-conventions-genai/issues/476) records the operation-versus-attempt accounting question and was closed pending a concrete case.

The lab will follow the repository's current development schema and reference-scenario rules. It will not describe itself as an official conformance suite unless an upstream project adopts the assertions.

## Why Pollinations is a useful case

Pollinations has a real multi-provider request path with ordered fallback, attempt-level tracking, caching, concurrent request deduplication, streaming, and Durable Object execution. These paths expose operational questions that a single-provider SDK example cannot reproduce.

The work should help Pollinations answer concrete incident questions:

- Which provider attempt consumed the latency budget?
- Did a request succeed directly, through fallback, or from cache?
- Did detached execution preserve useful correlation?
- Can usage be attributed without double-counting repeated observations?
- Can operators diagnose failures without exporting prompts, responses, credentials, or high-cardinality identifiers?

## Technical direction

- Use TypeScript to stay close to the Pollinations gateway and its Cloudflare Workers runtime.
- Use OTLP as the portable boundary.
- Pin the OpenTelemetry Collector and semantic-convention schema used by fixtures.
- Start with existing HTTP, RPC, FaaS, and GenAI conventions; keep experimental gateway facts in a clearly isolated namespace until upstream guidance exists.
- Use Cloudflare Workers native tracing and custom spans for the production experiment. Verify its behavior instead of assuming that detached invocations share trace context.
- Keep local scenarios deterministic and free of paid provider credentials.
- Exclude prompt and response content by default and test that invariant.

## Success criteria

1. Every scenario is reproducible locally and produces a canonical OTLP fixture.
2. A validator detects incorrect parentage, duplicate usage attribution, sensitive content, and unsafe cardinality.
3. The trace model works for Pollinations and at least one independent gateway.
4. Upstream maintainers confirm the appropriate contribution shape: reference scenario, documentation, tests, or a focused semantic-convention proposal.
5. A Pollinations staging experiment demonstrates operational value before production instrumentation is proposed.

## Non-goals

- Building a generic observability backend or dashboard.
- Creating Pollinations-specific semantic conventions.
- Replacing Pollinations billing or analytics with traces.
- Claiming CNCF, OpenTelemetry, or LFX endorsement before upstream acceptance.
- Exporting prompts or model responses as part of the default telemetry path.

## Delivery gates

### Gate 1: upstream alignment

Document the Pollinations topology, present the focused question to the OpenTelemetry GenAI SIG, survey a second gateway, and agree on the expected artifact.

### Gate 2: portable reference lab

Implement deterministic providers, gateway scenarios, OTLP capture, canonical fixtures, and validation.

### Gate 3: production evidence

Run a bounded Pollinations staging experiment using Cloudflare native tracing. Measure diagnostic value, overhead, trace continuity, data exposure, and cardinality.

### Gate 4: upstream contribution

Submit the smallest artifact requested by maintainers. Consider an LFX mentorship proposal only with an existing CNCF project maintainer willing to sponsor and mentor it.
