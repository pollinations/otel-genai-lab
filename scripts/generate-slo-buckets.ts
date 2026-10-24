import fs from "node:fs";
import path from "node:path";

import { syntheticIncidentBuckets } from "../src/slo/synthetic.js";

const output = path.resolve(process.argv[2] ?? "tmp/slo/local-buckets.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  `${JSON.stringify(syntheticIncidentBuckets(new Date()), null, 2)}\n`,
);
console.log(`wrote ${path.relative(process.cwd(), output)}`);
