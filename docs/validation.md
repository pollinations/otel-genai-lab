# Trace validation policy

The validator turns this lab's scenario contract into executable assertions. It checks canonical traces for:

- one logical gateway span and the expected number of provider attempts;
- ordered parent-child relationships and deterministic timing;
- authoritative usage on the successful attempt without duplicate attribution;
- prompt, response, authorization, credential, and raw URL-query fields;
- bounded attribute names, strings, and arrays;
- the pinned fixture version, schema URL, experimental mapping marker, and GenAI attribute allowlist.

Every failure reports a category, normalized span identifier, field, and explanation. Run it directly with:

```bash
npm run traces:validate
```

The canonical fixtures must pass. `fixtures/traces/invalid/v0.1` contains one focused failure for each policy category and is exercised by the test suite.

## Scope

These rules are project assertions derived from the Pollinations gateway scenarios. Passing them does not establish official OpenTelemetry conformance. The GenAI attributes and the gateway span topology remain experimental while [semantic-conventions-genai#231](https://github.com/open-telemetry/semantic-conventions-genai/issues/231) is unresolved.

The validator deliberately uses a small pinned allowlist. A semantic-convention update requires an explicit fixture version or policy update instead of silently accepting a new telemetry shape.
