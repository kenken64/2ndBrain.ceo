#!/usr/bin/env node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const ROOT = process.cwd();
const SEMANTIC_RELATION_LABELS = {
  decision_from: ["decision from", "decided from", "decision based on"],
  depends_on: ["depends on", "depends upon", "requires", "blocked by"],
  mentions: ["mentions", "mentioned in", "references"],
  owned_by: ["owned by", "owner", "accountable to"],
  related_to: ["related to", "relates to", "connected to", "associated with"],
  source_for: ["source for", "input for", "evidence for"]
};
const SEMANTIC_RELATION_BY_KEY = new Map(
  Object.entries(SEMANTIC_RELATION_LABELS).flatMap(([relation, labels]) => [
    [relation, relation],
    [wikiSlug(relation), relation],
    ...labels.map((label) => [wikiSlug(label), relation])
  ])
);

function parseArgs(argv) {
  const flags = {
    dbDirect: false,
    dryRun: false,
    email: "",
    includeNonReady: false,
    projectId: "",
    reset: false,
    userId: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--db-direct") {
      flags.dbDirect = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg === "--include-non-ready") {
      flags.includeNonReady = true;
    } else if (arg === "--reset") {
      flags.reset = true;
    } else if (arg === "--email") {
      flags.email = argv[++index] ?? "";
    } else if (arg === "--project-id") {
      flags.projectId = argv[++index] ?? "";
    } else if (arg === "--user-id") {
      flags.userId = argv[++index] ?? "";
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
Backfill Supabase wiki graph tables from OpenClaw markdown.

Usage:
  npm run wiki:backfill -- --email bunnyppl@gmail.com --reset
  npm run wiki:backfill -- --project-id <project-uuid>

Required env:
  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY

Options:
  --email <email>          Backfill projects owned by a profile email.
  --user-id <uuid>         Backfill projects owned by a user id.
  --project-id <uuid>      Backfill one project.
  --reset                  Delete existing graph rows for selected project(s) first.
  --dry-run                Read and parse markdown without writing Supabase rows.
  --include-non-ready      Include projects not marked ready.
  --db-direct              Use DATABASE_URL with psql instead of Supabase HTTP APIs.
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

function sqlQuote(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return `'${String(value).replace(/'/g, "''")}'`;
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
    throw new Error(`Missing env var: ${names.join(" or ")}`);
  }

  return value;
}

function wikiSlug(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

function normalizeWikiPath(value) {
  const normalized = path.posix.normalize(value.trim().replace(/\\/g, "/"));

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    !/\.(md|mdx)$/i.test(normalized)
  ) {
    throw new Error(`invalid_wiki_path:${value}`);
  }

  return normalized;
}

function titleFromWikiPath(filePath) {
  const parsed = path.posix.parse(filePath);

  return (
    parsed.name
      .split(/[-_]+/g)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ") || "Untitled"
  );
}

function parseListLine(value) {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function normalizeRelationTarget(value) {
  return value
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/#.+$/, "")
    .replace(/\|.+$/, "")
    .trim();
}

function parseRelationListLine(value) {
  return parseListLine(value)
    .flatMap((item) => item.split(/\s*;\s*/g))
    .map(normalizeRelationTarget)
    .filter(Boolean);
}

function semanticRelationFromHeading(value) {
  return SEMANTIC_RELATION_BY_KEY.get(wikiSlug(value.replace(/^#+\s*/, ""))) ?? null;
}

function parseFrontmatter(markdown) {
  const frontmatter = {
    aliases: [],
    relations: {},
    tags: []
  };

  if (!markdown.startsWith("---\n")) {
    return { body: markdown, frontmatter };
  }

  const endIndex = markdown.indexOf("\n---", 4);

  if (endIndex === -1) {
    return { body: markdown, frontmatter };
  }

  const raw = markdown.slice(4, endIndex).trim();
  const body = markdown.slice(endIndex + 4).replace(/^\n/, "");
  let listKey = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const pair = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);

    if (pair) {
      const key = pair[1];
      const value = pair[2].trim();

      listKey = null;

      if (key === "title") {
        frontmatter.title = value.replace(/^['"]|['"]$/g, "");
      } else if (key === "type") {
        frontmatter.type = value.replace(/^['"]|['"]$/g, "");
      } else if (key === "aliases" || key === "tags") {
        listKey = key;
        frontmatter[key] = value ? parseListLine(value) : [];
      } else {
        const relation = SEMANTIC_RELATION_BY_KEY.get(wikiSlug(key));

        if (relation) {
          listKey = relation;
          frontmatter.relations[relation] = value ? parseRelationListLine(value) : [];
        }
      }

      continue;
    }

    const listItem = trimmed.match(/^-\s+(.+)$/);

    if (listKey && listItem) {
      if (listKey === "aliases" || listKey === "tags") {
        frontmatter[listKey].push(listItem[1].replace(/^['"]|['"]$/g, ""));
      } else {
        frontmatter.relations[listKey] = [
          ...(frontmatter.relations[listKey] ?? []),
          normalizeRelationTarget(listItem[1])
        ].filter(Boolean);
      }
    }
  }

  return { body, frontmatter };
}

function firstHeading(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function uniqueBySlug(nodes) {
  return [...new Map(nodes.map((node) => [node.slug, node])).values()];
}

function uniqueEdges(edges) {
  const byKey = new Map();

  for (const edge of edges) {
    byKey.set(`${edge.fromSlug}:${edge.toSlug}:${edge.relation}`, edge);
  }

  return [...byKey.values()];
}

function semanticRelationNodeType(relation) {
  if (relation === "owned_by") {
    return "owner";
  }

  if (relation === "decision_from") {
    return "decision";
  }

  if (relation === "source_for") {
    return "source";
  }

  return "concept";
}

function pushSemanticEdge({ edges, label, nodes, pageSlug, relation }) {
  const normalizedLabel = normalizeRelationTarget(label);

  if (!normalizedLabel) {
    return;
  }

  const slug = wikiSlug(normalizedLabel);

  nodes.push({
    label: normalizedLabel,
    nodeType: semanticRelationNodeType(relation),
    role: "mention",
    slug
  });

  if (slug !== pageSlug) {
    edges.push({
      fromSlug: pageSlug,
      relation,
      toSlug: slug,
      weight: relation === "related_to" || relation === "mentions" ? 1 : 2
    });
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSemanticBodyRelations(body) {
  const relations = [];
  const lines = body.split("\n");
  let activeRelation = null;

  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+)$/);

    if (heading) {
      activeRelation = semanticRelationFromHeading(heading[1]);
      continue;
    }

    if (activeRelation) {
      for (const match of line.matchAll(WIKI_LINK_PATTERN)) {
        relations.push({
          label: match[1],
          relation: activeRelation
        });
      }
    }

    for (const [relation, labels] of Object.entries(SEMANTIC_RELATION_LABELS)) {
      for (const label of labels) {
        const pattern = new RegExp(
          `${escapeRegex(label).replace(/\s+/g, "\\s+")}\\s+\\[\\[([^\\]|#]+)(?:#[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\]`,
          "gi"
        );

        for (const match of line.matchAll(pattern)) {
          relations.push({
            label: match[1],
            relation
          });
        }
      }
    }
  }

  return relations;
}

function parseWikiMarkdown(markdown, filePath) {
  const normalizedPath = normalizeWikiPath(filePath);
  const { body, frontmatter } = parseFrontmatter(markdown);
  const title = frontmatter.title || firstHeading(body) || titleFromWikiPath(normalizedPath);
  const pageSlug = wikiSlug(title);
  const pageNode = {
    label: title,
    nodeType: frontmatter.type || "page",
    role: "page",
    slug: pageSlug
  };
  const nodes = [pageNode];
  const edges = [];

  for (const match of body.matchAll(WIKI_LINK_PATTERN)) {
    const label = match[1].trim();

    if (!label) {
      continue;
    }

    const slug = wikiSlug(label);

    nodes.push({
      label,
      nodeType: "concept",
      role: "mention",
      slug
    });

    if (slug !== pageSlug) {
      edges.push({
        fromSlug: pageSlug,
        relation: "links_to",
        toSlug: slug,
        weight: 1
      });
    }
  }

  for (const tag of frontmatter.tags) {
    const slug = wikiSlug(tag);

    nodes.push({
      label: tag,
      nodeType: "tag",
      role: "tag",
      slug
    });
    edges.push({
      fromSlug: pageSlug,
      relation: "tagged",
      toSlug: slug,
      weight: 1
    });
  }

  for (const [relation, labels] of Object.entries(frontmatter.relations)) {
    for (const label of labels) {
      pushSemanticEdge({
        edges,
        label,
        nodes,
        pageSlug,
        relation
      });
    }
  }

  for (const { label, relation } of extractSemanticBodyRelations(body)) {
    pushSemanticEdge({
      edges,
      label,
      nodes,
      pageSlug,
      relation
    });
  }

  return {
    edges: uniqueEdges(edges),
    frontmatter,
    nodes: uniqueBySlug(nodes),
    page: pageNode,
    slug: pageSlug,
    title
  };
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
    const objectStart = output.indexOf("{");
    const objectEnd = output.lastIndexOf("}");
    const arrayStart = output.indexOf("[");
    const arrayEnd = output.lastIndexOf("]");

    if (objectStart !== -1 && objectEnd > objectStart && (arrayStart === -1 || objectStart < arrayStart)) {
      return JSON.parse(output.slice(objectStart, objectEnd + 1));
    }

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      return JSON.parse(output.slice(arrayStart, arrayEnd + 1));
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

async function runAws(args) {
  const region = envValue("AWS_REGION", "AWS_DEFAULT_REGION");
  const { stdout } = await execFileAsync("aws", args, {
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: requireEnv("AWS_ACCESS_KEY_ID"),
      AWS_SECRET_ACCESS_KEY: requireEnv("AWS_SECRET_ACCESS_KEY"),
      AWS_DEFAULT_REGION: region,
      AWS_REGION: region
    },
    maxBuffer: 1024 * 1024 * 4
  });

  return JSON.parse(stdout);
}

function isIpAddress(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

async function resolveInstanceTarget(instance) {
  if (!instance || isIpAddress(instance)) {
    return instance;
  }

  const region = requireEnv("AWS_REGION", "AWS_DEFAULT_REGION");
  const result = await runAws([
    "lightsail",
    "get-instance",
    "--instance-name",
    instance,
    "--region",
    region,
    "--output",
    "json"
  ]);
  const publicIp = result?.instance?.publicIpAddress;

  if (!publicIp) {
    throw new Error(`No public IP found for Lightsail instance: ${instance}`);
  }

  return publicIp;
}

async function runPsql(databaseUrl, sql) {
  const { stdout, stderr } = await execFileAsync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    {
      env: process.env,
      maxBuffer: 1024 * 1024 * 16
    }
  );

  const output = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
  return output;
}

async function psqlJson(databaseUrl, sql, fallback) {
  const output = await runPsql(
    databaseUrl,
    `select coalesce(json_agg(row_to_json(t))::text, '${Array.isArray(fallback) ? "[]" : "null"}') from (${sql}) as t;`
  );

  return JSON.parse(output || JSON.stringify(fallback));
}

function withProjectArgs(args, projectSlug) {
  if (projectSlug?.trim()) {
    args.push("--project", projectSlug.trim());
  }

  return args;
}

function flattenTree(items) {
  const files = [];

  function walk(nodes) {
    for (const node of nodes) {
      if (typeof node === "string") {
        if (/\.(md|mdx)$/i.test(node)) {
          files.push({ path: normalizeWikiPath(node), type: "file" });
        }

        continue;
      }

      if (node?.type === "file" && typeof node.path === "string" && /\.(md|mdx)$/i.test(node.path)) {
        files.push({ path: normalizeWikiPath(node.path), type: "file" });
      }

      if (Array.isArray(node?.children)) {
        walk(node.children);
      }
    }
  }

  walk(items);

  return [...new Map(files.map((file) => [file.path, file])).values()].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
}

function normalizeTreeOutput(parsed) {
  if (Array.isArray(parsed)) {
    return flattenTree(parsed);
  }

  const source = parsed?.tree ?? parsed?.files ?? [];

  return flattenTree(Array.isArray(source) ? source : [source]);
}

async function readWikiTree({ instance, projectSlug }) {
  const target = await resolveInstanceTarget(instance);
  const output = await runClawmacdo(
    withProjectArgs(["wiki-tree", "--instance", target, "--agent", envValue("OPENCLAW_AGENT_ID") || "main", "--json"], projectSlug)
  );

  return normalizeTreeOutput(parseJsonOutput(output));
}

async function readWikiPage({ filePath, instance, projectSlug }) {
  const normalizedPath = normalizeWikiPath(filePath);
  const target = await resolveInstanceTarget(instance);
  const output = await runClawmacdo(
    withProjectArgs(
      [
        "wiki-read",
        "--instance",
        target,
        "--agent",
        envValue("OPENCLAW_AGENT_ID") || "main",
        "--path",
        normalizedPath,
        "--json"
      ],
      projectSlug
    )
  );
  const parsed = parseJsonOutput(output);
  const content = typeof parsed.content === "string" ? parsed.content : "";

  return {
    content,
    filePath: parsed.file_path ?? parsed.path ?? normalizedPath,
    sha: parsed.sha ?? parsed.sha256 ?? null,
    title: parsed.title ?? titleFromWikiPath(normalizedPath),
    updatedAt: parsed.updated_at ?? null
  };
}

async function resolveUserIdByEmail(supabase, email) {
  if (!email) {
    return "";
  }

  const { data, error } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.id) {
    throw new Error(`No profile found for email: ${email}`);
  }

  return data.id;
}

async function resolveUserIdByEmailDb(databaseUrl, email) {
  if (!email) {
    return "";
  }

  const rows = await psqlJson(
    databaseUrl,
    `select id from public.profiles where email = ${sqlQuote(email)} limit 1`,
    []
  );

  if (!rows[0]?.id) {
    throw new Error(`No profile found for email: ${email}`);
  }

  return rows[0].id;
}

async function loadProjects(supabase, flags) {
  const userId = flags.userId || (await resolveUserIdByEmail(supabase, flags.email));
  let query = supabase
    .from("projects")
    .select("id,user_id,title,prompt,status,openclaw_instance,openclaw_project_slug,created_at")
    .not("openclaw_project_slug", "is", null)
    .order("created_at", { ascending: false });

  if (!flags.includeNonReady) {
    query = query.eq("status", "ready");
  }

  if (flags.projectId) {
    query = query.eq("id", flags.projectId);
  }

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadProjectsDb(databaseUrl, flags) {
  const userId = flags.userId || (await resolveUserIdByEmailDb(databaseUrl, flags.email));
  const conditions = ["openclaw_project_slug is not null"];

  if (!flags.includeNonReady) {
    conditions.push(`status = 'ready'`);
  }

  if (flags.projectId) {
    conditions.push(`id = ${sqlQuote(flags.projectId)}`);
  }

  if (userId) {
    conditions.push(`user_id = ${sqlQuote(userId)}`);
  }

  return await psqlJson(
    databaseUrl,
    `
      select
        id::text,
        user_id::text,
        title,
        prompt,
        status,
        openclaw_instance,
        openclaw_project_slug,
        created_at
      from public.projects
      where ${conditions.join(" and ")}
      order by created_at desc
    `,
    []
  );
}

async function loadProfilesByUserId(supabase, userIds) {
  if (userIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,openclaw_instance")
    .in("id", [...new Set(userIds)]);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((profile) => [profile.id, profile]));
}

async function loadProfilesByUserIdDb(databaseUrl, userIds) {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await psqlJson(
    databaseUrl,
    `
      select
        id::text,
        email,
        openclaw_instance
      from public.profiles
      where id in (${[...new Set(userIds)].map((value) => sqlQuote(value)).join(", ")})
    `,
    []
  );

  return new Map(rows.map((profile) => [profile.id, profile]));
}

async function resetProjectGraph(supabase, projectId) {
  for (const table of ["wiki_edges", "wiki_page_nodes", "wiki_nodes", "wiki_pages"]) {
    const { error } = await supabase.from(table).delete().eq("project_id", projectId);

    if (error) {
      throw new Error(`Failed to reset ${table}: ${error.message}`);
    }
  }
}

async function resetProjectGraphDb(databaseUrl, projectId) {
  await runPsql(
    databaseUrl,
    `
      delete from public.wiki_edges where project_id = ${sqlQuote(projectId)};
      delete from public.wiki_page_nodes where project_id = ${sqlQuote(projectId)};
      delete from public.wiki_nodes where project_id = ${sqlQuote(projectId)};
      delete from public.wiki_pages where project_id = ${sqlQuote(projectId)};
    `
  );
}

async function syncWikiPageGraph({ dryRun, page, parsed, projectId, supabase, userId }) {
  if (dryRun) {
    return {
      edgeCount: parsed.edges.length,
      nodeCount: parsed.nodes.length,
      pageId: "dry-run"
    };
  }

  const syncedAt = new Date().toISOString();
  const { data: storedPage, error: pageError } = await supabase
    .from("wiki_pages")
    .upsert(
      {
        file_path: page.filePath,
        file_sha: page.sha ?? null,
        last_synced_at: syncedAt,
        page_type: parsed.frontmatter.type ?? "page",
        project_id: projectId,
        slug: parsed.slug,
        title: parsed.title,
        user_id: userId
      },
      { onConflict: "project_id,file_path" }
    )
    .select("id")
    .single();

  if (pageError || !storedPage) {
    throw new Error(pageError?.message ?? "wiki_page_sync_failed");
  }

  const nodeRows = parsed.nodes.map((node) => ({
    label: node.label,
    node_type: node.nodeType,
    project_id: projectId,
    slug: node.slug,
    source_page_id: node.role === "page" ? storedPage.id : null,
    user_id: userId
  }));
  const { data: storedNodes, error: nodeError } = await supabase
    .from("wiki_nodes")
    .upsert(nodeRows, { onConflict: "project_id,slug" })
    .select("id,slug");

  if (nodeError || !storedNodes) {
    throw new Error(nodeError?.message ?? "wiki_node_sync_failed");
  }

  const nodeIds = new Map(storedNodes.map((node) => [node.slug, node.id]));
  const { error: deletePageNodesError } = await supabase.from("wiki_page_nodes").delete().eq("page_id", storedPage.id);

  if (deletePageNodesError) {
    throw new Error(deletePageNodesError.message);
  }

  const pageNodeRows = parsed.nodes
    .map((node) => {
      const nodeId = nodeIds.get(node.slug);

      return nodeId
        ? {
            node_id: nodeId,
            page_id: storedPage.id,
            project_id: projectId,
            role: node.role,
            user_id: userId
          }
        : null;
    })
    .filter(Boolean);

  if (pageNodeRows.length > 0) {
    const { error } = await supabase.from("wiki_page_nodes").insert(pageNodeRows);

    if (error) {
      throw new Error(error.message);
    }
  }

  const { error: deleteEdgesError } = await supabase.from("wiki_edges").delete().eq("evidence_page_id", storedPage.id);

  if (deleteEdgesError) {
    throw new Error(deleteEdgesError.message);
  }

  const edgeRows = parsed.edges
    .map((edge) => {
      const fromNodeId = nodeIds.get(edge.fromSlug);
      const toNodeId = nodeIds.get(edge.toSlug);

      return fromNodeId && toNodeId
        ? {
            evidence_page_id: storedPage.id,
            from_node_id: fromNodeId,
            project_id: projectId,
            relation: edge.relation,
            to_node_id: toNodeId,
            user_id: userId,
            weight: edge.weight
          }
        : null;
    })
    .filter(Boolean);

  if (edgeRows.length > 0) {
    const { error } = await supabase.from("wiki_edges").insert(edgeRows);

    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    edgeCount: edgeRows.length,
    nodeCount: parsed.nodes.length,
    pageId: storedPage.id
  };
}

async function syncWikiPageGraphDb({ databaseUrl, dryRun, page, parsed, projectId, userId }) {
  if (dryRun) {
    return {
      edgeCount: parsed.edges.length,
      nodeCount: parsed.nodes.length,
      pageId: "dry-run"
    };
  }

  const syncedAt = new Date().toISOString();
  const pageRows = await psqlJson(
    databaseUrl,
    `
      insert into public.wiki_pages (
        file_path,
        file_sha,
        last_synced_at,
        page_type,
        project_id,
        slug,
        title,
        user_id
      )
      values (
        ${sqlQuote(page.filePath)},
        ${sqlQuote(page.sha ?? null)},
        ${sqlQuote(syncedAt)},
        ${sqlQuote(parsed.frontmatter.type ?? "page")},
        ${sqlQuote(projectId)},
        ${sqlQuote(parsed.slug)},
        ${sqlQuote(parsed.title)},
        ${sqlQuote(userId)}
      )
      on conflict (project_id, file_path)
      do update set
        file_sha = excluded.file_sha,
        last_synced_at = excluded.last_synced_at,
        page_type = excluded.page_type,
        slug = excluded.slug,
        title = excluded.title,
        user_id = excluded.user_id,
        updated_at = now()
      returning id::text
    `,
    []
  );
  const storedPageId = pageRows[0]?.id;

  if (!storedPageId) {
    throw new Error("wiki_page_sync_failed");
  }

  const values = parsed.nodes
    .map(
      (node) =>
        `(${sqlQuote(node.label)}, ${sqlQuote(node.nodeType)}, ${sqlQuote(projectId)}, ${sqlQuote(node.slug)}, ${sqlQuote(node.role === "page" ? storedPageId : null)}, ${sqlQuote(userId)})`
    )
    .join(", ");

  const storedNodes = await psqlJson(
    databaseUrl,
    `
      insert into public.wiki_nodes (
        label,
        node_type,
        project_id,
        slug,
        source_page_id,
        user_id
      )
      values ${values}
      on conflict (project_id, slug)
      do update set
        label = excluded.label,
        node_type = excluded.node_type,
        source_page_id = coalesce(excluded.source_page_id, public.wiki_nodes.source_page_id),
        user_id = excluded.user_id,
        updated_at = now()
      returning id::text, slug
    `,
    []
  );
  const nodeIds = new Map(storedNodes.map((node) => [node.slug, node.id]));

  await runPsql(
    databaseUrl,
    `delete from public.wiki_page_nodes where page_id = ${sqlQuote(storedPageId)};`
  );

  const pageNodeRows = parsed.nodes
    .map((node) => {
      const nodeId = nodeIds.get(node.slug);

      return nodeId
        ? `(${sqlQuote(storedPageId)}, ${sqlQuote(nodeId)}, ${sqlQuote(userId)}, ${sqlQuote(projectId)}, ${sqlQuote(node.role)})`
        : null;
    })
    .filter(Boolean);

  if (pageNodeRows.length > 0) {
    await runPsql(
      databaseUrl,
      `
        insert into public.wiki_page_nodes (
          page_id,
          node_id,
          user_id,
          project_id,
          role
        )
        values ${pageNodeRows.join(", ")}
      `
    );
  }

  await runPsql(
    databaseUrl,
    `delete from public.wiki_edges where evidence_page_id = ${sqlQuote(storedPageId)};`
  );

  const edgeRows = parsed.edges
    .map((edge) => {
      const fromNodeId = nodeIds.get(edge.fromSlug);
      const toNodeId = nodeIds.get(edge.toSlug);

      return fromNodeId && toNodeId
        ? `(${sqlQuote(userId)}, ${sqlQuote(projectId)}, ${sqlQuote(fromNodeId)}, ${sqlQuote(toNodeId)}, ${sqlQuote(edge.relation)}, ${sqlQuote(edge.weight)}, ${sqlQuote(storedPageId)})`
        : null;
    })
    .filter(Boolean);

  if (edgeRows.length > 0) {
    await runPsql(
      databaseUrl,
      `
        insert into public.wiki_edges (
          user_id,
          project_id,
          from_node_id,
          to_node_id,
          relation,
          weight,
          evidence_page_id
        )
        values ${edgeRows.join(", ")}
        on conflict (project_id, from_node_id, to_node_id, relation, evidence_page_id)
        do update set
          weight = excluded.weight,
          user_id = excluded.user_id,
          updated_at = now()
      `
    );
  }

  return {
    edgeCount: edgeRows.length,
    nodeCount: parsed.nodes.length,
    pageId: storedPageId
  };
}

async function countRows(supabase, table, projectId) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function countRowsDb(databaseUrl, table, projectId) {
  const rows = await psqlJson(
    databaseUrl,
    `select count(*)::int as count from public.${table} where project_id = ${sqlQuote(projectId)}`,
    []
  );

  return rows[0]?.count ?? 0;
}

async function backfillProject({ dryRun, instance, project, reset, supabase }) {
  if (!instance) {
    throw new Error(`Project ${project.id} has no OpenClaw instance on project or profile`);
  }

  if (reset && !dryRun) {
    console.log(`[backfill] reset project graph: ${project.id}`);
    await resetProjectGraph(supabase, project.id);
  }

  const treeFiles = await readWikiTree({
    instance,
    projectSlug: project.openclaw_project_slug
  });
  let edgeCount = 0;
  let nodeCount = 0;
  let pageCount = 0;

  console.log(`[backfill] ${project.title} (${project.id}) files=${treeFiles.length}`);

  for (const file of treeFiles) {
    const page = await readWikiPage({
      filePath: file.path,
      instance,
      projectSlug: project.openclaw_project_slug
    });
    const parsed = parseWikiMarkdown(page.content, page.filePath);
    const sync = await syncWikiPageGraph({
      dryRun,
      page,
      parsed,
      projectId: project.id,
      supabase,
      userId: project.user_id
    });

    edgeCount += sync.edgeCount;
    nodeCount += sync.nodeCount;
    pageCount += 1;
    console.log(`[backfill] indexed ${page.filePath} nodes=${sync.nodeCount} edges=${sync.edgeCount}`);
  }

  return {
    edgeCount,
    nodeCount,
    pageCount,
    storedEdges: dryRun ? 0 : await countRows(supabase, "wiki_edges", project.id),
    storedNodes: dryRun ? 0 : await countRows(supabase, "wiki_nodes", project.id)
  };
}

async function backfillProjectDb({ databaseUrl, dryRun, instance, project, reset }) {
  if (!instance) {
    throw new Error(`Project ${project.id} has no OpenClaw instance on project or profile`);
  }

  if (reset && !dryRun) {
    console.log(`[backfill] reset project graph: ${project.id}`);
    await resetProjectGraphDb(databaseUrl, project.id);
  }

  const treeFiles = await readWikiTree({
    instance,
    projectSlug: project.openclaw_project_slug
  });
  let edgeCount = 0;
  let nodeCount = 0;
  let pageCount = 0;

  console.log(`[backfill] ${project.title} (${project.id}) files=${treeFiles.length}`);

  for (const file of treeFiles) {
    const page = await readWikiPage({
      filePath: file.path,
      instance,
      projectSlug: project.openclaw_project_slug
    });
    const parsed = parseWikiMarkdown(page.content, page.filePath);
    const sync = await syncWikiPageGraphDb({
      databaseUrl,
      dryRun,
      page,
      parsed,
      projectId: project.id,
      userId: project.user_id
    });

    edgeCount += sync.edgeCount;
    nodeCount += sync.nodeCount;
    pageCount += 1;
    console.log(`[backfill] indexed ${page.filePath} nodes=${sync.nodeCount} edges=${sync.edgeCount}`);
  }

  return {
    edgeCount,
    nodeCount,
    pageCount,
    storedEdges: dryRun ? 0 : await countRowsDb(databaseUrl, "wiki_edges", project.id),
    storedNodes: dryRun ? 0 : await countRowsDb(databaseUrl, "wiki_nodes", project.id)
  };
}

async function main() {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");

  const flags = parseArgs(process.argv.slice(2));
  const databaseUrl = envValue("DATABASE_URL");

  if (flags.dbDirect) {
    if (!databaseUrl) {
      throw new Error("Missing env var: DATABASE_URL");
    }

    const projects = await loadProjectsDb(databaseUrl, flags);
    const profilesByUserId = await loadProfilesByUserIdDb(
      databaseUrl,
      projects.map((project) => project.user_id)
    );

    if (projects.length === 0) {
      console.log("[backfill] no matching projects found");
      return;
    }

    console.log(`[backfill] projects=${projects.length} dryRun=${flags.dryRun} reset=${flags.reset} dbDirect=true`);

    for (const project of projects) {
      const profile = profilesByUserId.get(project.user_id);
      const instance = project.openclaw_instance || profile?.openclaw_instance || "";
      const summary = await backfillProjectDb({
        databaseUrl,
        dryRun: flags.dryRun,
        instance,
        project,
        reset: flags.reset
      });

      console.log(
        `[backfill] done ${project.id} pages=${summary.pageCount} parsedNodes=${summary.nodeCount} parsedEdges=${summary.edgeCount} storedNodes=${summary.storedNodes} storedEdges=${summary.storedEdges}`
      );
    }

    return;
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  const projects = await loadProjects(supabase, flags);
  const profilesByUserId = await loadProfilesByUserId(
    supabase,
    projects.map((project) => project.user_id)
  );

  if (projects.length === 0) {
    console.log("[backfill] no matching projects found");
    return;
  }

  console.log(`[backfill] projects=${projects.length} dryRun=${flags.dryRun} reset=${flags.reset}`);

  for (const project of projects) {
    const profile = profilesByUserId.get(project.user_id);
    const instance = project.openclaw_instance || profile?.openclaw_instance || "";
    const summary = await backfillProject({
      dryRun: flags.dryRun,
      instance,
      project,
      reset: flags.reset,
      supabase
    });

    console.log(
      `[backfill] done ${project.id} pages=${summary.pageCount} parsedNodes=${summary.nodeCount} parsedEdges=${summary.edgeCount} storedNodes=${summary.storedNodes} storedEdges=${summary.storedEdges}`
    );
  }
}

main().catch((error) => {
  console.error("[backfill] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
