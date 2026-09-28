cat > /tmp/otel-lab-issue.md <<'EOF'
## What I tested

Describe the scenario and commands you ran.

## Expected behavior

Describe the expected result.

## Actual behavior

Describe what happened, including the complete error message.

## Environment

- OS:
- Architecture:
- Node.js version:
- npm version:
- Docker version:

## Reproduction

```sh
npm ci
npm run check
npm run build
```

Additional context
Add logs, trace output, or other relevant information. Remove credentials, prompts, and generated responses.
EOF

gh issue create 
  --repo pollinations/otel-genai-lab 
  --title "Test report: describe the result" 
  --body-file /tmp/otel-lab-issue.md