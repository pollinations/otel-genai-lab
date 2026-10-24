import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { evaluateSlos } from "../src/slo/evaluate.js";
import {
  parseBucketFile,
  readTargetConfig,
  type TargetConfig,
} from "../src/slo/model.js";
import { syntheticIncidentBuckets } from "../src/slo/synthetic.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const end = new Date("2026-10-24T12:00:00Z");
const local = readTargetConfig(path.join(root, "slo/targets/local.json"));

describe("SLO burn-rate evaluation", () => {
  const report = evaluateSlos(syntheticIncidentBuckets(end), local);
  const status = (slo: string, model?: string) =>
    report.results.find(
      (result) => result.slo === slo && result.model === model,
    )?.status;

  it("pages on a fast availability outage", () => {
    expect(status("availability:generate.image")).toBe("page");
    const image = report.results.find(
      ({ slo }) => slo === "availability:generate.image",
    );
    expect(
      image?.alerts.filter(({ firing }) => firing).map(({ window }) => window),
    ).toEqual(["1h/5m"]);
  });

  it("opens a ticket when fallback hides a failing primary", () => {
    expect(status("primary:generate.image", "kontext")).toBe("ticket");
    expect(status("primary:generate.image", "flux")).toBe("ok");
    const kontext = report.results.find(
      ({ slo, model }) =>
        slo === "primary:generate.image" && model === "kontext",
    );
    expect(kontext?.alerts.map(({ severity }) => severity)).toEqual(["ticket"]);
  });

  it("stays quiet for healthy traffic", () => {
    expect(status("availability:generate.text")).toBe("ok");
    expect(status("latency:generate.text")).toBe("ok");
    expect(status("latency:generate.image")).toBe("ok");
    expect(status("primary:generate.text", "openai")).toBe("ok");
    expect(report.summary).toEqual({ slos: 7, page: 1, ticket: 1 });
    expect(report.evaluatedAt).toBe(end.toISOString());
  });

  it("reports coverage shorter than the SLO window", () => {
    const text = report.results.find(
      ({ slo }) => slo === "availability:generate.text",
    );
    expect(text?.coverageMinutes).toBe(3 * 24 * 60);
  });

  it("never alerts on uncalibrated or low-volume SLOs", () => {
    const uncalibrated: TargetConfig = {
      ...local,
      slos: local.slos.map((slo) => ({ ...slo, objective: null })),
    };
    expect(
      evaluateSlos(syntheticIncidentBuckets(end), uncalibrated).status,
    ).toBe("ok");

    const quiet: TargetConfig = {
      ...local,
      slos: local.slos.map((slo) => ({ ...slo, minValid: 10_000_000 })),
    };
    const result = evaluateSlos(syntheticIncidentBuckets(end), quiet);
    expect(result.status).toBe("ok");
    expect(new Set(result.results.map(({ status }) => status))).toEqual(
      new Set(["insufficient-data"]),
    );
  });

  it("keeps every shipped target config valid", () => {
    for (const name of ["pollinations", "elixpo-blogs", "local"]) {
      const target = readTargetConfig(
        path.join(root, `slo/targets/${name}.json`),
      );
      expect(target.name).toBe(name);
    }
  });

  it("rejects counts where good exceeds valid", () => {
    expect(() =>
      parseBucketFile({
        source: "bad",
        bucketSeconds: 300,
        buckets: [
          {
            start: end.toISOString(),
            eventType: "generate.text",
            model: "openai",
            availability: { valid: 1, good: 2 },
          },
        ],
      }),
    ).toThrow("0 <= good <= valid");
  });
});

describe("slo CLI", () => {
  it("exits 1 with a stable report while an alert fires", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slo-"));
    const buckets = path.join(dir, "buckets.json");
    fs.writeFileSync(buckets, JSON.stringify(syntheticIncidentBuckets(end)));
    const stdout: string[] = [];
    const code = runCli(
      ["slo", buckets, "--target", path.join(root, "slo/targets/local.json")],
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
    );
    expect(code).toBe(1);
    expect(stdout[0]).toMatch(/^ALERT buckets\.json \(local at /);
    expect(stdout[0]).toContain("1 page, 1 ticket");
  });

  it("exits 2 without a target", () => {
    const stderr: string[] = [];
    expect(
      runCli(["slo", "buckets.json"], {
        stdout: () => undefined,
        stderr: (line) => stderr.push(line),
      }),
    ).toBe(2);
  });
});
