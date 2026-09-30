# Cloudflare Workers staging harness

This isolated Worker reproduces direct success, fallback success, and one Durable Object alarm path without calling a model API. It enables native Workers tracing at 100% sampling because the smoke test sends only three controlled requests. Logs are disabled, and the handler never reads inbound request content.

The harness uses current native custom spans from `cloudflare:workers`. Provider calls are synthetic self-subrequests so the trace includes outbound fetch spans without credentials or paid inference.

## Local verification

```bash
npm run staging:check
npm run staging:dev
```

In another terminal, set the local URL printed by Wrangler and run:

```bash
STAGING_BASE_URL=http://localhost:8787 npm run staging:smoke
```

Local traces are useful for code validation, but the issue #8 evidence must come from an explicitly named staging deployment because native dashboard/export behavior is the subject of the experiment.

## Staging deployment

Authenticate Wrangler using your normal Cloudflare staging account, then review the target before deploying:

```bash
npx wrangler whoami
npx wrangler deploy --dry-run --config staging/cloudflare/wrangler.jsonc
npx wrangler deploy --config staging/cloudflare/wrangler.jsonc
```

Run the three requests against the emitted `workers.dev` URL:

```bash
STAGING_BASE_URL=https://otel-genai-lab-staging.<subdomain>.workers.dev npm run staging:smoke | tee /tmp/otel-genai-lab-staging-smoke.json
```

Wait a few minutes, inspect Workers Observability, and complete [the evidence report](../../docs/staging/cloudflare-report.md). To test OTLP export, first create a trace destination in the Cloudflare dashboard and add its exact name to `observability.traces.destinations`; keep destination credentials in the dashboard.

Remove the experiment when evidence collection is complete:

```bash
npx wrangler delete --config staging/cloudflare/wrangler.jsonc
```
