const previewHeaders = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export function previewResponse(): Response {
  return new Response(previewDocument, { headers: previewHeaders });
}

export const previewDocument = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>OTel GenAI Lab · Staging</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #f7f4ec;
        background: #0b0e12;
        font-synthesis: none;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 15% 5%, rgba(255, 203, 82, .14), transparent 33rem),
          radial-gradient(circle at 90% 80%, rgba(116, 224, 189, .11), transparent 30rem),
          #0b0e12;
      }
      main { width: min(70rem, calc(100% - 2rem)); margin: 0 auto; padding: 4rem 0 5rem; }
      header { max-width: 48rem; margin-bottom: 2.5rem; }
      .eyebrow { color: #ffcb52; font: 700 .75rem/1.2 ui-monospace, monospace; letter-spacing: .13em; text-transform: uppercase; }
      h1 { margin: .75rem 0 1rem; font-size: clamp(2.4rem, 7vw, 5rem); line-height: .98; letter-spacing: -.055em; }
      .lede { color: #b7bec9; font-size: 1.08rem; line-height: 1.65; }
      .notice {
        display: flex; gap: .7rem; align-items: flex-start; margin: 1.5rem 0 0; padding: 1rem 1.1rem;
        border: 1px solid #29313b; border-radius: .9rem; background: rgba(16, 21, 27, .72); color: #cad0d8;
      }
      .notice strong { color: #74e0bd; white-space: nowrap; }
      .toolbar { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
      button {
        border: 1px solid #49515d; border-radius: 999px; padding: .72rem 1rem; color: #f7f4ec;
        background: #171c23; font: inherit; font-weight: 700; cursor: pointer;
      }
      button:hover { border-color: #ffcb52; }
      button:focus-visible { outline: 3px solid #ffcb52; outline-offset: 3px; }
      button:disabled { cursor: wait; opacity: .65; }
      #run-all { background: #ffcb52; border-color: #ffcb52; color: #15120a; }
      #summary { min-height: 1.5rem; color: #9ba5b2; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
      article { min-height: 17rem; padding: 1.35rem; border: 1px solid #29313b; border-radius: 1rem; background: rgba(16, 21, 27, .9); }
      article h2 { margin: 0 0 .7rem; font-size: 1.25rem; }
      article p { min-height: 4.5rem; color: #9ba5b2; line-height: 1.5; }
      .result { margin-top: 1.2rem; padding-top: 1rem; border-top: 1px solid #29313b; color: #cad0d8; font: .82rem/1.65 ui-monospace, monospace; }
      .result[data-state="success"] { color: #74e0bd; }
      .result[data-state="error"] { color: #ff8c82; }
      footer { margin-top: 2rem; color: #737e8b; font-size: .85rem; line-height: 1.55; }
      @media (max-width: 48rem) {
        main { padding-top: 2.5rem; }
        .grid { grid-template-columns: 1fr; }
        article { min-height: auto; }
        article p { min-height: auto; }
        .toolbar { align-items: flex-start; flex-direction: column; }
      }
      @media (prefers-reduced-motion: no-preference) {
        article { transition: border-color .2s ease, transform .2s ease; }
        article:has(button:hover) { border-color: #49515d; transform: translateY(-2px); }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="eyebrow">Pollinations · CNCF observability experiment</div>
        <h1>See a GenAI request become a trace.</h1>
        <p class="lede">Run three bounded scenarios that test direct inference, provider fallback, and detached completion across a Durable Object alarm.</p>
        <div class="notice"><strong>Synthetic only</strong><span>No model is called. No prompt, response, request body, credential, or personal data is collected by this harness.</span></div>
      </header>
      <section aria-labelledby="controls-title">
        <h2 id="controls-title" class="eyebrow">Scenario controls</h2>
        <div class="toolbar">
          <button id="run-all" type="button">Run all scenarios</button>
          <span id="summary" role="status" aria-live="polite">Ready for a controlled staging run.</span>
        </div>
        <div class="grid">
          <article data-scenario="direct">
            <h2>Direct success</h2>
            <p>One synthetic provider attempt succeeds and exercises the Workers Cache API.</p>
            <button type="button" data-run="direct">Run direct</button>
            <div class="result" data-result="direct" aria-live="polite">Not run</div>
          </article>
          <article data-scenario="fallback">
            <h2>Provider fallback</h2>
            <p>The first synthetic attempt fails, then a second provider succeeds.</p>
            <button type="button" data-run="fallback">Run fallback</button>
            <div class="result" data-result="fallback" aria-live="polite">Not run</div>
          </article>
          <article data-scenario="detached">
            <h2>Detached completion</h2>
            <p>A Durable Object stores bounded state and schedules an alarm for later work.</p>
            <button type="button" data-run="detached">Run detached</button>
            <div class="result" data-result="detached" aria-live="polite">Not run</div>
          </article>
        </div>
      </section>
      <footer>Trace persistence is enabled for this staging Worker at a bounded 100% sample rate. Inspect the resulting native and custom spans in Cloudflare Workers Observability.</footer>
    </main>
    <script>
      const scenarios = ["direct", "fallback", "detached"];
      const summary = document.querySelector("#summary");

      async function runScenario(name) {
        const output = document.querySelector('[data-result="' + name + '"]');
        const button = document.querySelector('[data-run="' + name + '"]');
        output.dataset.state = "running";
        output.textContent = "Running…";
        button.disabled = true;
        const started = performance.now();
        try {
          const response = await fetch("/scenario/" + name, { method: "POST", body: "{}" });
          const data = await response.json();
          const elapsed = Math.round(performance.now() - started);
          if (!response.ok) throw new Error(data.error || "Request failed");
          output.dataset.state = "success";
          output.textContent = response.status + " · " + elapsed + " ms · " + data.result + (data.attempts ? " · " + data.attempts + " attempt(s)" : "");
          return true;
        } catch (error) {
          output.dataset.state = "error";
          output.textContent = error instanceof Error ? error.message : "Request failed";
          return false;
        } finally {
          button.disabled = false;
        }
      }

      document.querySelectorAll("[data-run]").forEach((button) => {
        button.addEventListener("click", async () => {
          summary.textContent = "Running " + button.dataset.run + "…";
          const passed = await runScenario(button.dataset.run);
          summary.textContent = passed ? "Scenario completed. Inspect Workers Observability." : "Scenario failed. Check the Worker deployment.";
        });
      });

      document.querySelector("#run-all").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        summary.textContent = "Running three bounded scenarios…";
        const results = [];
        for (const scenario of scenarios) results.push(await runScenario(scenario));
        const passed = results.filter(Boolean).length;
        summary.textContent = passed + "/3 scenarios completed. Inspect Workers Observability for the traces.";
        event.currentTarget.disabled = false;
      });
    </script>
  </body>
</html>`;
