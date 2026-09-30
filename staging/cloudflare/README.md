# Cloudflare Workers staging harness

This isolated Worker reproduces direct success, fallback success, and one Durable Object alarm path without calling a model API. It enables native Workers tracing at 100% sampling because the smoke test sends only three controlled requests. Logs are disabled, and the handler never reads inbound request content.

The harness uses current native custom spans from `cloudflare:workers`. Provider calls are synthetic self-subrequests so the trace includes outbound fetch spans without credentials or paid inference.

The Worker root serves a small, responsive control surface for running the same bounded scenarios from a browser. It has no content fields, external assets, analytics, or third-party requests. A restrictive Content Security Policy limits connections to the Worker itself.

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

Wrangler OAuth is sufficient when `npx wrangler whoami` already shows the intended account. For unattended CLI use, create a scoped API token for the existing `otel-genai-lab-staging` Worker and store only these values in the gitignored root `.env.local`:

```dotenv
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<scoped-token>
```

The existing Worker needs edit access and observability read access. The `workers.dev` deployment does not need zone or DNS permissions. Creating or deleting Workers requires broader access and should use a separate token if that operation is needed.

Load the local environment, verify the target, and deploy:

```bash
set -a
source .env.local
set +a
npx wrangler whoami
npx wrangler deploy --dry-run --config staging/cloudflare/wrangler.jsonc
npx wrangler deploy --config staging/cloudflare/wrangler.jsonc
```

Open the emitted `workers.dev` URL to use the browser preview, or run the CLI smoke test below. Never commit `.env.local` or paste its values into an issue, pull request, trace, or report.

Run the three requests against the emitted `workers.dev` URL:

```bash
STAGING_BASE_URL=https://otel-genai-lab-staging.<subdomain>.workers.dev npm run staging:smoke | tee /tmp/otel-genai-lab-staging-smoke.json
```

Wait a few minutes, inspect Workers Observability, and complete [the evidence report](../../docs/staging/cloudflare-report.md). To test OTLP export, first create a trace destination in the Cloudflare dashboard and add its exact name to `observability.traces.destinations`; keep destination credentials in the dashboard.

If the staging Worker should be removed after evidence collection, run:

```bash
npx wrangler delete --config staging/cloudflare/wrangler.jsonc
```
