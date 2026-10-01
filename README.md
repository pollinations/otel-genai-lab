# OpenTelemetry GenAI Gateway Lab

This repository develops executable, vendor-neutral evidence for tracing GenAI gateways with OpenTelemetry. Pollinations is the first production case: one logical request can route across providers, fall back after an error, use cached or deduplicated work, or cross a detached Cloudflare Durable Object execution boundary.

The project starts with a question rather than a new convention:

> How should an OpenTelemetry trace represent one server-side GenAI gateway operation and its provider attempts when routing, fallback, caching, deduplication, or detached execution occurs, while keeping latency and usage attribution accurate and excluding prompt and response content by default?

Read the [project proposal](docs/project-proposal.md), [scenario contract](docs/scenarios.md), [experimental telemetry model](docs/telemetry-model.md), [extended scenarios](docs/extended-scenarios.md), [validation policy](docs/validation.md), [Cloudflare staging report](docs/staging/cloudflare-report.md), [agentgateway comparison](docs/research/agentgateway-comparison.md), and [project tracker](https://github.com/pollinations/otel-genai-lab/issues/10).

## Current phase

The project is building Gate 2: the portable reference lab. Its telemetry mapping remains experimental pending upstream feedback on [OpenTelemetry GenAI semantic conventions #231](https://github.com/open-telemetry/semantic-conventions-genai/issues/231#issuecomment-5863653044).

This is an independent Pollinations project. It is not an official OpenTelemetry conformance suite and does not imply CNCF or LFX endorsement.

## Principles

- Reproduce gateway behavior locally without paid model APIs.
- Emit standard OTLP and pin the schema and Collector versions used by fixtures.
- Reuse current semantic conventions before considering experimental attributes.
- Keep prompts, responses, credentials, and raw authorization data out of telemetry by default.
- Support claims with at least two gateway implementations before proposing portable semantics.

## Development

Use Node.js 24.21.0 and npm 11.19.0:

```sh
npm ci
npm run check
npm run build
```

The lab covers direct success, fallback, terminal failure, cache hits, concurrent deduplication, and detached completion. Start the pinned OpenTelemetry Collector with `docker compose up collector` when working on OTLP export; it accepts OTLP/gRPC on port 4317 and OTLP/HTTP on port 4318.

## Trace validator

Validate an OpenTelemetry Collector JSON file export locally:

```sh
npm run cli -- validate tmp/otel/traces.json
npm run cli -- validate tmp/otel/traces.json --format json
```

The command accepts an OTLP/JSON `resourceSpans` object, an array of those objects, or newline-delimited Collector batches. It returns exit code 0 for a clean file, 1 for conformance findings, and 2 for invalid input or command usage. Reports use stable labels such as `trace-1` and never print raw trace or span identifiers.

The validator is experimental project tooling, not an official OpenTelemetry or CNCF conformance certification. Release `0.1.0` is available from npm:

```sh
npx @elixpo/otel-genai-lab@0.1.0 validate traces.json
```

### GitHub Action

The repository also exposes a composite action. Pin the action to the release tag or an exact commit SHA:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@v7
  - name: Validate GenAI gateway traces
    id: otel-genai
    uses: pollinations/otel-genai-lab@v0.1.0
    with:
      traces: artifacts/traces.json
      report: artifacts/otel-genai-report.json
  - name: Upload trace report
    if: ${{ always() }}
    uses: actions/upload-artifact@v6
    with:
      name: otel-genai-report
      path: ${{ steps.otel-genai.outputs.report }}
```

The action builds the checked-out validator, emits the same deterministic text or JSON report as the CLI, and preserves its exit codes. Trace and report paths must remain inside `GITHUB_WORKSPACE`.

## License

[MIT](LICENSE)
