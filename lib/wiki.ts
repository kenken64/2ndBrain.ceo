import path from "node:path";

export type WikiTreeItem = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WikiTreeItem[];
  sha?: string | null;
  updatedAt?: string | null;
};

export type WikiPage = {
  content: string;
  filePath: string;
  sha?: string | null;
  title: string;
  updatedAt?: string | null;
};

export type WikiFrontmatter = {
  aliases: string[];
  tags: string[];
  title?: string;
  type?: string;
};

export type ParsedWikiNode = {
  label: string;
  nodeType: string;
  role: "page" | "mention" | "tag";
  slug: string;
};

export type ParsedWikiEdge = {
  fromSlug: string;
  relation: string;
  toSlug: string;
  weight: number;
};

export type ParsedWikiGraph = {
  aliases: string[];
  edges: ParsedWikiEdge[];
  frontmatter: WikiFrontmatter;
  nodes: ParsedWikiNode[];
  page: ParsedWikiNode;
  slug: string;
  tags: string[];
  title: string;
};

const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

export function wikiSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "untitled";
}

export function normalizeWikiPath(value: string) {
  const normalized = path.posix.normalize(value.trim().replace(/\\/g, "/"));

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    !/\.(md|mdx)$/i.test(normalized)
  ) {
    throw new Error("invalid_wiki_path");
  }

  return normalized;
}

export function titleFromWikiPath(filePath: string) {
  const parsed = path.posix.parse(filePath);

  return parsed.name
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Untitled";
}

function parseListLine(value: string) {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export function parseFrontmatter(markdown: string): { body: string; frontmatter: WikiFrontmatter } {
  const frontmatter: WikiFrontmatter = {
    aliases: [],
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
  const lines = raw.split("\n");
  let listKey: "aliases" | "tags" | null = null;

  for (const line of lines) {
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
      }

      continue;
    }

    const listItem = trimmed.match(/^-\s+(.+)$/);

    if (listKey && listItem) {
      frontmatter[listKey].push(listItem[1].replace(/^['"]|['"]$/g, ""));
    }
  }

  return { body, frontmatter };
}

function firstHeading(markdown: string) {
  const match = markdown.match(/^#\s+(.+)$/m);

  return match?.[1]?.trim() ?? null;
}

function uniqueBySlug(nodes: ParsedWikiNode[]) {
  const bySlug = new Map<string, ParsedWikiNode>();

  for (const node of nodes) {
    if (!bySlug.has(node.slug)) {
      bySlug.set(node.slug, node);
    }
  }

  return [...bySlug.values()];
}

function uniqueEdges(edges: ParsedWikiEdge[]) {
  const byKey = new Map<string, ParsedWikiEdge>();

  for (const edge of edges) {
    const key = `${edge.fromSlug}:${edge.toSlug}:${edge.relation}`;

    if (!byKey.has(key)) {
      byKey.set(key, edge);
    }
  }

  return [...byKey.values()];
}

export function parseWikiMarkdown(markdown: string, filePath: string): ParsedWikiGraph {
  const normalizedPath = normalizeWikiPath(filePath);
  const { body, frontmatter } = parseFrontmatter(markdown);
  const title = frontmatter.title || firstHeading(body) || titleFromWikiPath(normalizedPath);
  const pageSlug = wikiSlug(title);
  const pageNode: ParsedWikiNode = {
    label: title,
    nodeType: frontmatter.type || "page",
    role: "page",
    slug: pageSlug
  };
  const nodes: ParsedWikiNode[] = [pageNode];
  const edges: ParsedWikiEdge[] = [];

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

  return {
    aliases: frontmatter.aliases,
    edges: uniqueEdges(edges),
    frontmatter,
    nodes: uniqueBySlug(nodes),
    page: pageNode,
    slug: pageSlug,
    tags: frontmatter.tags,
    title
  };
}
