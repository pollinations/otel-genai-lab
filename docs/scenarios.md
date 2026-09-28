# Gateway scenario contract

This document defines the behavior the reference lab must reproduce before it defines a telemetry representation. Timings and usage values are fixtures, not performance targets.

## Shared terms

- **Logical operation:** one request made by a caller to the gateway.
- **Provider attempt:** one outbound inference call selected by the gateway.
- **Generation:** the underlying work that produces one result. Concurrent callers may share a generation.
- **Observation:** a caller receiving or re-reading a generation result.

Logical operation and provider attempt are project terms until upstream guidance establishes the corresponding telemetry vocabulary.

## S1: direct success

The caller requests `model-a`. The gateway selects provider `alpha`. The first attempt succeeds after 40 ms and returns authoritative usage of 10 input tokens and 4 output tokens.

Expected behavior:

- one logical operation;
- one generation;
- one provider attempt;
- final status is successful;
- one authoritative usage observation.

## S2: fallback success

The caller requests `model-a`. Provider `alpha` fails with a retryable upstream error after 20 ms. The gateway selects provider `beta`, which succeeds after 40 ms and returns 10 input tokens and 4 output tokens.

Expected behavior:

- one logical operation;
- one generation;
- two ordered provider attempts;
- the first attempt records its error and no invented usage;
- final status is successful through fallback;
- authoritative usage comes from the successful attempt.

## S3: terminal failure

Providers `alpha` and `beta` each return retryable upstream errors. No candidate remains.

Expected behavior:

- one logical operation;
- one generation;
- two ordered provider attempts;
- final status is failed;
- no usage is fabricated.

## S4: cache hit

The requested generation is already cached. The gateway returns the stored result without calling a provider.

Expected behavior:

- one logical operation;
- zero new generations;
- zero provider attempts;
- the observation is identified as a cache hit;
- previously recorded usage is not emitted as new billable usage.

## S5: concurrent deduplication

Two callers request the same uncached generation while the first is in flight. Both receive the same result from one provider execution.

Expected behavior:

- two logical operations;
- one generation;
- one provider attempt;
- two result observations;
- provider usage is not counted twice merely because two callers observed it.

## S6: detached completion

The inbound execution schedules or delegates generation work to a durable execution context. That context performs one provider attempt and stores the result before the caller observes it.

Expected behavior:

- one logical operation and one generation;
- one provider attempt in the detached context;
- stable correlation survives even if platform trace context does not;
- telemetry does not pretend the invocations share a parent-child relationship when the runtime cannot preserve it;
- usage has a documented owner and is not repeated as additive usage on later observations.

## S7: streaming interruption

The provider begins streaming and then fails before a terminal usage record is available. This scenario is deferred until the synchronous and detached cases are validated, unless upstream feedback requires it earlier.

## Global invariants

- Prompts, completions, credentials, authorization values, and raw URL queries are absent.
- Attempt order and outcome are observable.
- No fixture treats the sum of repeated usage observations as authoritative.
- Dynamic trace identifiers and timestamps are normalized before fixtures are compared.
- Project-only fields are distinguishable from standardized OpenTelemetry attributes.
