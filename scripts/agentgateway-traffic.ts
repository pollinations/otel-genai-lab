import net from "node:net";

const baseUrl = process.env.AGENTGATEWAY_BASE_URL ?? "http://127.0.0.1:13000";

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

async function request(model: string): Promise<number> {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "synthetic test input" }],
    }),
  });
  await response.body?.cancel();
  return response.status;
}

await waitUntilReady();
const direct = await request("synthetic-success");
const failure = await request("synthetic-error");

if (direct !== 200 || failure !== 503) {
  throw new Error(`unexpected statuses: direct=${direct}, failure=${failure}`);
}

console.log(JSON.stringify({ direct, failure }, null, 2));
