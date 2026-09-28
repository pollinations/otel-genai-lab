# ADR 0001: Validate the telemetry model upstream before defining attributes

- Status: Accepted
- Date: 2026-09-28

## Context

OpenTelemetry GenAI semantic conventions are in development. The GenAI SIG is already discussing server-side gateway spans, background execution, and usage attribution. Pollinations has concrete routing, fallback, caching, deduplication, and detached-execution behavior, but its internal analytics schema is not evidence that the same vocabulary applies across gateways.

Cloudflare Workers now offers native tracing, custom spans, and OTLP export, but the tracing feature remains beta and does not propagate trace context to external services. Platform behavior may therefore constrain one adapter without defining a portable model.

## Decision

The project will define behavioral scenarios first, ask the OpenTelemetry GenAI SIG how those scenarios should map to current conventions, and compare the result with a second open-source gateway.

Until that work is complete:

- existing HTTP, RPC, FaaS, and GenAI attributes take precedence;
- project-only fields remain explicitly experimental;
- the repository uses “reference lab” rather than “conformance suite”;
- Cloudflare native tracing is treated as an adapter to measure, not the portable telemetry specification.

## Consequences

The Pollinations staging adapter follows the portable fixtures rather than leading them. Some implementation can proceed immediately, including deterministic providers and OTLP infrastructure, while the normative mapping remains blocked on upstream feedback.
