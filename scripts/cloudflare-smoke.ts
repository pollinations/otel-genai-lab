const baseUrl = process.env.STAGING_BASE_URL?.replace(/\/$/, "");
if (baseUrl === undefined) {
  throw new Error("Set STAGING_BASE_URL to the deployed staging Worker URL");
}

const results: Array<{
  scenario: string;
  status: number;
  durationMs: number;
  response: unknown;
}> = [];

for (const scenario of ["direct", "fallback", "detached"] as const) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/scenario/${scenario}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const value: unknown = await response.json();
  results.push({
    scenario,
    status: response.status,
    durationMs: Math.round((performance.now() - started) * 100) / 100,
    response: value,
  });
  if (!response.ok) {
    throw new Error(`${scenario} returned HTTP ${response.status}`);
  }
}

console.log(
  JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2),
);
