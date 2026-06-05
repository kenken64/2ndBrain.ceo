#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();

function parseArgs(argv) {
  const flags = {
    dryRun: false,
    emails: [],
    file: "",
    replace: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--replace") {
      flags.replace = true;
    } else if (arg === "--email" || arg === "--emails") {
      flags.emails.push(...splitEmails(argv[++index] ?? ""));
    } else if (arg === "--file") {
      flags.file = argv[++index] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return flags;
}

function printHelp() {
  console.log(`
Load the Supabase admin allowlist used by /admin.

Usage:
  npm run admin:load -- --email owner@example.com
  npm run admin:load -- --emails owner@example.com,ops@example.com --replace
  ADMIN_EMAILS=owner@example.com,ops@example.com npm run admin:load -- --replace

Required env:
  DATABASE_URL
    or
  NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

Options:
  --email <email>       Add one email, or a comma-separated list.
  --emails <emails>     Alias for --email.
  --file <path>         Load one email per line. Blank lines and # comments are ignored.
  --replace             Disable existing admin rows not in this load set.
  --dry-run             Print the normalized load set without writing.
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

function splitEmails(value) {
  return value
    .split(/[,\s]+/g)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmails(values) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const unique = [...new Set(values.flatMap(splitEmails))];

  for (const email of unique) {
    if (!emailPattern.test(email)) {
      throw new Error(`Invalid email: ${email}`);
    }
  }

  return unique.sort((a, b) => a.localeCompare(b));
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function adminLoadSql(emails, { replace }) {
  const valuesSql = emails.map((email) => `(${sqlQuote(email)})`).join(",\n    ");
  const replaceSql = replace
    ? `
update public.admin_users
set enabled = false,
    updated_at = now()
where email not in (select email from incoming_admins);`
    : "";

  return `
begin;

create temporary table incoming_admins (
  email text primary key
) on commit drop;

insert into incoming_admins (email)
values
    ${valuesSql};

insert into public.admin_users (email, user_id, enabled, role)
select incoming_admins.email,
       auth.users.id,
       true,
       'admin'
from incoming_admins
left join auth.users on lower(auth.users.email) = incoming_admins.email
on conflict (email) do update
set enabled = true,
    role = 'admin',
    user_id = coalesce(excluded.user_id, public.admin_users.user_id),
    updated_at = now();
${replaceSql}

commit;
`;
}

async function readEmailFile(filePath) {
  if (!filePath) {
    return [];
  }

  const content = await fs.readFile(path.resolve(ROOT, filePath), "utf8");

  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
}

async function runPsql(sql) {
  const databaseUrl = envValue("DATABASE_URL", "SUPABASE_DB_URL");

  if (!databaseUrl) {
    return false;
  }

  await new Promise((resolve, reject) => {
    const child = spawn("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-q"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `psql exited with code ${code}`));
    });

    child.stdin.end(sql);
  });

  return true;
}

async function runSupabaseApi(emails, { replace }) {
  const supabaseUrl = envValue("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing DATABASE_URL or Supabase URL plus SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false
    }
  });

  for (const email of emails) {
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();

    if (authError) {
      throw authError;
    }

    const authUser = authUsers.users.find((user) => user.email?.toLowerCase() === email);
    const { error } = await supabase.from("admin_users").upsert(
      {
        email,
        enabled: true,
        role: "admin",
        user_id: authUser?.id ?? null
      },
      { onConflict: "email" }
    );

    if (error) {
      throw error;
    }
  }

  if (replace) {
    const { error } = await supabase
      .from("admin_users")
      .update({ enabled: false })
      .not("email", "in", `(${emails.map((email) => `"${email}"`).join(",")})`);

    if (error) {
      throw error;
    }
  }
}

async function main() {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");

  const flags = parseArgs(process.argv.slice(2));
  const fileEmails = await readEmailFile(flags.file);
  const envEmails = splitEmails(envValue("ADMIN_EMAILS"));
  const emails = normalizeEmails([...flags.emails, ...fileEmails, ...envEmails]);

  if (emails.length === 0) {
    throw new Error("Provide at least one admin email with --email, --file, or ADMIN_EMAILS.");
  }

  console.log(`Admin emails: ${emails.join(", ")}`);
  console.log(flags.replace ? "Mode: replace existing allowlist" : "Mode: upsert only");

  if (flags.dryRun) {
    return;
  }

  const usedPsql = await runPsql(adminLoadSql(emails, { replace: flags.replace }));

  if (!usedPsql) {
    await runSupabaseApi(emails, { replace: flags.replace });
  }

  console.log("Admin allowlist loaded into public.admin_users.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
