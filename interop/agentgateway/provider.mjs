import http from "node:http";

const usage = {
  prompt_tokens: 10,
  completion_tokens: 4,
  total_tokens: 14,
};
const attempts = [];

function reply(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

http
  .createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      reply(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "GET" && request.url === "/attempts") {
      reply(response, 200, attempts);
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      reply(response, 404, { error: { message: "not found" } });
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      let model;
      try {
        model = JSON.parse(body).model;
      } catch {
        reply(response, 400, { error: { message: "invalid JSON" } });
        return;
      }

      const status =
        model === "synthetic-primary"
          ? 429
          : model === "synthetic-error"
            ? 503
            : 200;
      attempts.push({
        model,
        retryAttempt: request.headers["x-retry-attempt"] ?? null,
        status,
      });

      if (status !== 200) {
        reply(response, status, {
          error: { message: "synthetic provider failure", type: "test_error" },
        });
        return;
      }

      reply(response, 200, {
        id: "chatcmpl-synthetic",
        created: 1700000000,
        model,
        object: "chat.completion",
        usage,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "synthetic reply" },
            finish_reason: "stop",
          },
        ],
      });
    });
  })
  .listen(8080, "0.0.0.0");
