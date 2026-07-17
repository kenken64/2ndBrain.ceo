#!/usr/bin/env node

/**
 * Reports objects that `supabase/migrations` expects but the live database is
 * missing. Migrations here are applied by hand (see docs/supabase-railway.md),
 * so a skipped file stays invisible until a write fails at runtime — PostgREST
 * rejects an entire PATCH when a single column is unknown.
 *
 * Read-only: runs introspection queries and never writes.
 *
 * Usage:
 *   node scripts/check-schema-drift.mjs            # human-readable report
 *   node scripts/check-schema-drift.mjs --json     # machine-readable
 *   node scripts/check-schema-drift.mjs --sql      # emit SQL for missing pieces
 *
 * Requires DATABASE_URL and a psql binary on PATH.
 * Exits 1 when drift is found, so CI can gate on it.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

const CONSTRAINT_KEYWORDS = new Set([
  "primary",
  "foreign",
  "unique",
  "check",
  "constraint",
  "exclude",
  "like"
]);

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Splits on commas that sit at paren depth 0. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const char of body) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
}

/** Reads the parenthesised body of a `create table ... (...)` starting at `open`. */
function readParenBody(sql, open) {
  let depth = 0;

  for (let index = open; index < sql.length; index += 1) {
    if (sql[index] === "(") {
      depth += 1;
    } else if (sql[index] === ")") {
      depth -= 1;

      if (depth === 0) {
        return sql.slice(open + 1, index);
      }
    }
  }

  return "";
}

function parseMigration(sql, file, expected) {
  const clean = stripSqlComments(sql);

  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
  let match;

  while ((match = createRe.exec(clean)) !== null) {
    const table = match[1];
    expected.tables.set(table, expected.tables.get(table) ?? file);

    const body = readParenBody(clean, createRe.lastIndex - 1);

    for (const raw of splitTopLevel(body)) {
      const line = raw.trim();

      if (!line) {
        continue;
      }

      const first = line.split(/\s+/)[0].toLowerCase().replace(/"/g, "");

      if (CONSTRAINT_KEYWORDS.has(first) || !/^[a-z0-9_]+$/.test(first)) {
        continue;
      }

      const key = `${table}.${first}`;
      expected.columns.set(key, expected.columns.get(key) ?? file);
    }
  }

  const alterRe = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?);/gi;

  while ((match = alterRe.exec(clean)) !== null) {
    const table = match[1];
    const addRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi;
    let add;

    while ((add = addRe.exec(match[2])) !== null) {
      const key = `${table}.${add[1]}`;
      expected.columns.set(key, expected.columns.get(key) ?? file);
    }
  }
}

async function loadExpected() {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
  const expected = { columns: new Map(), tables: new Map() };

  for (const file of files) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    parseMigration(sql, file, expected);
  }

  return { expected, files };
}

async function queryLive(databaseUrl) {
  const sql = `
    select 'table:' || table_name from information_schema.tables
      where table_schema = 'public'
    union all
    select 'column:' || table_name || '.' || column_name from information_schema.columns
      where table_schema = 'public';
  `;

  const { stdout } = await execFileAsync(
    "psql",
    [databaseUrl, "-X", "-A", "-t", "--set=ON_ERROR_STOP=1", "-c", sql],
    { maxBuffer: 32 * 1024 * 1024 }
  );

  const tables = new Set();
  const columns = new Set();

  for (const line of stdout.split("\n")) {
    const value = line.trim();

    if (value.startsWith("table:")) {
      tables.add(value.slice(6));
    } else if (value.startsWith("column:")) {
      columns.add(value.slice(7));
    }
  }

  return { columns, tables };
}

function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("DATABASE_URL is required (it is read from your environment, not committed).");
    process.exit(2);
  }

  return run(databaseUrl);
}

async function run(databaseUrl) {
  const asJson = process.argv.includes("--json");
  const asSql = process.argv.includes("--sql");

  const [{ expected, files }, live] = await Promise.all([loadExpected(), queryLive(databaseUrl)]);

  const missingTables = [...expected.tables]
    .filter(([table]) => !live.tables.has(table))
    .map(([table, file]) => ({ file, table }));

  const missingTableNames = new Set(missingTables.map((entry) => entry.table));

  // A column on an absent table is noise — the table itself is the finding.
  const missingColumns = [...expected.columns]
    .filter(([key]) => !live.columns.has(key))
    .map(([key, file]) => {
      const [table, column] = key.split(".");
      return { column, file, table };
    })
    .filter((entry) => !missingTableNames.has(entry.table));

  const byFile = new Map();

  for (const entry of [...missingTables, ...missingColumns]) {
    if (!byFile.has(entry.file)) {
      byFile.set(entry.file, []);
    }

    byFile.get(entry.file).push(entry);
  }

  if (asJson) {
    console.log(JSON.stringify({ missingColumns, missingTables, migrationsScanned: files.length }, null, 2));
  } else if (asSql) {
    if (byFile.size === 0) {
      console.log("-- no drift; nothing to apply");
    } else {
      // Inlined rather than \i: this is meant to be pasted into the Supabase
      // SQL Editor, which has no psql meta-commands.
      console.log("-- Paste into the Supabase SQL Editor, in this order.");
      console.log("-- Idempotent (add column if not exists / create table if not exists).");

      for (const file of [...byFile.keys()].sort()) {
        const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
        console.log(`\n-- ─── ${file} ───`);
        console.log(sql.trim());
      }

      console.log("\nselect pg_notify('pgrst', 'reload schema');");
    }
  } else {
    console.log(`Scanned ${files.length} migrations against the live database.`);
    console.log(`Expecting ${expected.tables.size} tables and ${expected.columns.size} columns.\n`);

    if (byFile.size === 0) {
      console.log("No drift found — every migrated table and column is present.");
    } else {
      console.log(`Drift found in ${byFile.size} migration(s):\n`);

      for (const file of [...byFile.keys()].sort()) {
        const entries = byFile.get(file);
        console.log(`  ${file}`);

        for (const entry of entries) {
          const label = entry.column ? `column  ${entry.table}.${entry.column}` : `table   ${entry.table}`;
          console.log(`      missing ${label}`);
        }

        console.log("");
      }

      console.log("Re-run the listed files in the Supabase SQL Editor (they are idempotent),");
      console.log("or run: node scripts/check-schema-drift.mjs --sql");
    }
  }

  process.exit(byFile.size === 0 ? 0 : 1);
}

await main();
