# Scenario fixtures

The fixtures describe gateway behavior independently of any telemetry representation. They are inputs to the deterministic gateway and expected behavioral outcomes, not OpenTelemetry conformance files.

## Versions

`scenarios/v0.1/` contains the initial synchronous contract:

- direct provider success;
- retryable primary failure followed by fallback success;
- all provider candidates failing.

The JSON Schema at `scenarios/v0.1/schema.json` is authoritative for fixture structure. Additive optional fields may stay within `v0.1`. A required field, changed meaning, or incompatible representation requires a new version directory.

Run `npm run fixtures:check` to validate the schema and execute every fixture.

## Privacy

Fixtures contain model aliases, provider aliases, deterministic durations, error categories, and token counts. Prompt content, generated content, credentials, authorization values, and raw request URLs are outside the schema.
