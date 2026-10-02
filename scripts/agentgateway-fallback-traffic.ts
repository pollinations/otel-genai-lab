import net from "node:net";

const baseUrl = process.env.AGENTGATEWAY_BASE_URL ?? "http://127.0.0.1:13001";
const providerUrl =
  process.env.AGENTGATEWAY_PROVIDER_URL ?? "http://127.0.0.1:18080";

async function waitUntilReady(): Promise<void> {
  const target = new URL(baseUrl);
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: target.hostname, port });
        socket.once("connect", () => {
          socket.end();
          resolve();
        });
        socket.once("error", reject);
      });
      return;
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`agentgateway did not become ready at ${baseUrl}`);
}

await waitUntilReady();
const response = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "synthetic-route",
    messages: [{ role: "user", content: "synthetic fallback test input" }],
  }),
});
await response.body?.cancel();

const attemptsResponse = await fetch(`${providerUrl}/attempts`);
const attempts: unknown = await attemptsResponse.json();
const expectedAttempts = [
  { model: "synthetic-primary", retryAttempt: null, status: 429 },
  { model: "synthetic-fallback", retryAttempt: "1", status: 200 },
];

if (response.status !== 200) {
  throw new Error(`expected fallback status 200, received ${response.status}`);
}
if (JSON.stringify(attempts) !== JSON.stringify(expectedAttempts)) {
  throw new Error(`unexpected provider attempts: ${JSON.stringify(attempts)}`);
}

console.log(JSON.stringify({ result: response.status, attempts }, null, 2));
