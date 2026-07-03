#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const CONTENT_MAX_CHARS = 200_000;

function parseArgs(argv) {
  const flags = {
    all: false,
    delayMs: 500,
    dryRun: false,
    email: "",
    instance: "",
    limit: 0,
    localRoot: "",
    project: "",
    userId: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--all") {
      flags.all = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--instance") {
      flags.instance = argv[++index] ?? "";
    } else if (arg === "--local-root") {
      flags.localRoot = argv[++index] ?? "";
    } else if (arg === "--email") {
      flags.email = argv[++index] ?? "";
    } else if (arg === "--user-id") {
      flags.userId = argv[++index] ?? "";
    } else if (arg === "--project") {
      flags.project = argv[++index] ?? "";
    } else if (arg === "--limit") {
      flags.limit = Number.parseInt(argv[++index] ?? "0", 10) || 0;
    } else if (arg === "--delay-ms") {
      flags.delayMs = Number.parseInt(argv[++index] ?? "500", 10) || 0;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return flags;
}

function printHelp() {
  console.log(`
Backfill wiki_pages.content_text from OpenClaw markdown (one SSH read per page,
rate-limited). Pages that already have content_text are skipped unless --all is set.

Usage:
  node scripts/backfill-wiki-content.mjs --instance <name-or-ip> --email bunnyppl@gmail.com
  node scripts/backfill-wiki-content.mjs --local-root /path/to/workspace-mirror --email ...

Required env:
  DATABASE_URL

Options:
  --instance <name|ip>     OpenClaw instance to read pages from via clawmacdo (its deploy
                           registry must know the instance).
  --local-root <dir>       Read pages from a local directory mirror of the OpenClaw
                           workspace instead of over SSH (file_path is resolved under it).
  --email <email>          Scope to the profile with this email.
  --user-id <uuid>         Scope to this user id.
  --project <slug>         Pass a project slug to clawmacdo wiki-read.
  --all                    Re-read pages that already have content_text.
  --limit <n>              Stop after n pages.
  --delay-ms <n>           Pause between SSH reads (default 500).
  --dry-run                Read and strip markdown without writing.
`);
}

async function loadEnvFile(fileName) {
  try {
    const content = await fs.readFile(path.join(ROOT, fileName), "utf8");

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

      if (!match || process.env[match[1]]) {
        continue;
      }

      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  return "";
}

function requireEnv(...names) {
  const value = envValue(...names);

  if (!value) {
    throw new Error(`Missing required env: ${names.join(" or ")}`);
  }

  return value;
}

function sqlQuote(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runPsql(databaseUrl, sql) {
  const { stdout } = await execFileAsync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { env: process.env, maxBuffer: 1024 * 1024 * 16 }
  );

  return (stdout ?? "").trim();
}

/** Runs SQL from a temp file so multi-hundred-KB page bodies never hit argv limits. */
async function runPsqlFile(databaseUrl, sql) {
  const file = path.join(
    os.tmpdir(),
    `wiki-content-${process.pid}-${Math.random().toString(36).slice(2)}.sql`
  );
  await fs.writeFile(file, sql, "utf8");

  try {
    await execFileAsync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], {
      env: process.env,
      maxBuffer: 1024 * 1024 * 16
    });
  } finally {
    await fs.rm(file, { force: true });
  }
}

async function psqlJson(databaseUrl, sql) {
  const output = await runPsql(
    databaseUrl,
    `select coalesce(json_agg(row_to_json(t))::text, '[]') from (${sql}) as t;`
  );

  return JSON.parse(output || "[]");
}

function clawmacdoBinaryPath() {
  const configured = process.env.CLAWMACDO_BIN_PATH?.trim();

  if (configured) {
    return configured;
  }

  return path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "clawmacdo.cmd" : "clawmacdo"
  );
}

function parseJsonOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");

    if (start !== -1 && end > start) {
      return JSON.parse(output.slice(start, end + 1));
    }
  }

  throw new Error("openclaw_json_parse_failed");
}

async function runClawmacdo(args) {
  const timeout = Number(process.env.CLAWMACDO_TIMEOUT_MS ?? "") || 15 * 60 * 1000;
  const region = envValue("AWS_REGION", "AWS_DEFAULT_REGION");
  const { stdout, stderr } = await execFileAsync(clawmacdoBinaryPath(), args, {
    env: {
      ...process.env,
      AWS_DEFAULT_REGION: region || process.env.AWS_DEFAULT_REGION,
      AWS_REGION: region || process.env.AWS_REGION
    },
    maxBuffer: 1024 * 1024 * 16,
    timeout
  });

  return `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
}

async function readWikiPage({ filePath, projectSlug, target }) {
  const args = [
    "wiki-read",
    "--instance",
    target,
    "--agent",
    envValue("OPENCLAW_AGENT_ID") || "main",
    "--path",
    filePath,
    "--json"
  ];

  if (projectSlug?.trim()) {
    args.push("--project", projectSlug.trim());
  }

  const parsed = parseJsonOutput(await runClawmacdo(args));

  return typeof parsed.content === "string" ? parsed.content : "";
}

// Keep in sync with wikiPlainText in lib/wiki.ts.
function wikiPlainText(markdown) {
  let body = markdown;

  if (body.startsWith("---\n")) {
    const endIndex = body.indexOf("\n---", 4);

    if (endIndex !== -1) {
      body = body.slice(endIndex + 4).replace(/^\n/, "");
    }
  }

  const normalized = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, label) =>
      String(label ?? target)
    )
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_>#|~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.length > CONTENT_MAX_CHARS ? normalized.slice(0, CONTENT_MAX_CHARS) : normalized;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");

  if (!flags.instance && !flags.localRoot) {
    throw new Error("--instance or --local-root is required");
  }

  const databaseUrl = requireEnv("DATABASE_URL");
  let userId = flags.userId;

  if (!userId && flags.email) {
    const rows = await psqlJson(
      databaseUrl,
      `select id from public.profiles where email = ${sqlQuote(flags.email)} limit 1`
    );
    userId = rows[0]?.id ?? "";

    if (!userId) {
      throw new Error(`No profile found for email: ${flags.email}`);
    }
  }

  const conditions = [];

  if (!flags.all) {
    conditions.push("content_text is null");
  }

  if (userId) {
    conditions.push(`user_id = ${sqlQuote(userId)}`);
  }

  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
  const pages = await psqlJson(
    databaseUrl,
    `select id, file_path from public.wiki_pages ${where} order by file_path${
      flags.limit > 0 ? ` limit ${flags.limit}` : ""
    }`
  );

  if (pages.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  console.log(`Backfilling content_text for ${pages.length} page(s)...`);
  // clawmacdo resolves --instance against its own deploy registry (deploy ID, hostname, or
  // instance name) — pass the value through untouched.
  const target = flags.instance;
  let updated = 0;
  let failed = 0;

  for (const page of pages) {
    try {
      const markdown = flags.localRoot
        ? await fs.readFile(path.join(flags.localRoot, page.file_path), "utf8")
        : await readWikiPage({
            filePath: page.file_path,
            projectSlug: flags.project,
            target
          });
      const text = wikiPlainText(markdown);

      if (flags.dryRun) {
        console.log(`[dry-run] ${page.file_path}: ${text.length} chars`);
      } else {
        await runPsqlFile(
          databaseUrl,
          `update public.wiki_pages set content_text = ${sqlQuote(text)} where id = ${sqlQuote(page.id)};`
        );
        console.log(`${page.file_path}: ${text.length} chars`);
      }

      updated += 1;
    } catch (error) {
      failed += 1;
      console.error(`FAILED ${page.file_path}: ${error.message}`);
    }

    if (flags.delayMs > 0) {
      await sleep(flags.delayMs);
    }
  }

  console.log(`Done. ${updated} updated, ${failed} failed.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
