/**
 * Mint opaque cold-start IDs using ULID.
 * Usage: bun scripts/cold-start-id.ts <entity-kind> [count]
 * Example: bun scripts/cold-start-id.ts agent       → prints 1 agent ID
 *          bun scripts/cold-start-id.ts dataset 5    → prints 5 dataset IDs
 */
import { ulid } from "ulid";

const PREFIXES: Record<string, string> = {
  variable: "var", series: "ser", observation: "obs", agent: "ag",
  catalog: "cat", "catalog-record": "cr", dataset: "ds",
  distribution: "dist", "data-service": "svc", "dataset-series": "dser", candidate: "cand",
};

const kind = process.argv[2];
const count = parseInt(process.argv[3] || "1", 10);
if (!kind || !PREFIXES[kind]) {
  console.error("Usage: bun scripts/cold-start-id.ts <entity-kind> [count]");
  console.error("Kinds:", Object.keys(PREFIXES).join(", "));
  process.exit(1);
}

const prefix = PREFIXES[kind];
for (let i = 0; i < count; i++) {
  console.log(`https://id.skygest.io/${kind}/${prefix}_${ulid()}`);
}
