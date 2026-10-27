const { copyFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const [major, minor, patch] = process.versions.node.split(".").map(Number);
if (major !== 26 || minor < 12 || (minor === 12 && patch < 1)) {
  console.error("Node.js 26.12.1 or a newer 26.x security release is required.");
  process.exit(1);
}
const source = path.dirname(require.resolve("@duckdb/duckdb-wasm"));
const destination = path.join(__dirname, "..", "public", "duckdb");
mkdirSync(destination, { recursive: true });
for (const file of ["duckdb-mvp.wasm", "duckdb-eh.wasm", "duckdb-browser-mvp.worker.js", "duckdb-browser-eh.worker.js"]) {
  copyFileSync(path.join(source, file), path.join(destination, file));
}
console.log("Prepared local DuckDB browser assets.");
