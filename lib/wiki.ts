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
  relations: Partial<Record<SemanticRelation, string[]>>;
  tags: string[];
  title?: string;
  type?: string;
};

export type SemanticRelation = "depends_on" | "related_to" | "mentions" | "owned_by" | "source_for" | "decision_from";

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
const SEMANTIC_RELATION_LABELS: Record<SemanticRelation, string[]> = {
  decision_from: ["decision from", "decided from", "decision based on"],
  depends_on: ["depends on", "depends upon", "requires", "blocked by"],
  mentions: ["mentions", "mentioned in", "references"],
  owned_by: ["owned by", "owner", "accountable to"],
  related_to: ["related to", "relates to", "connected to", "associated with"],
  source_for: ["source for", "input for", "evidence for"]
};
const SEMANTIC_RELATION_BY_KEY = new Map<string, SemanticRelation>(
  Object.entries(SEMANTIC_RELATION_LABELS).flatMap(([relation, labels]) => [
    [relation, relation as SemanticRelation],
    [wikiSlug(relation), relation as SemanticRelation],
    ...labels.map((label) => [wikiSlug(label), relation as SemanticRelation] as const)
  ])
);

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

function normalizeRelationTarget(value: string) {
  return value
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/#.+$/, "")
    .replace(/\|.+$/, "")
    .trim();
}

function parseRelationListLine(value: string) {
  return parseListLine(value)
    .flatMap((item) => item.split(/\s*;\s*/g))
    .map(normalizeRelationTarget)
    .filter(Boolean);
}

function semanticRelationFromHeading(value: string) {
  return SEMANTIC_RELATION_BY_KEY.get(wikiSlug(value.replace(/^#+\s*/, ""))) ?? null;
}

export function parseFrontmatter(markdown: string): { body: string; frontmatter: WikiFrontmatter } {
  const frontmatter: WikiFrontmatter = {
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
  const lines = raw.split("\n");
  let listKey: "aliases" | "tags" | SemanticRelation | null = null;

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

function semanticRelationNodeType(relation: SemanticRelation) {
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

function pushSemanticEdge({
  edges,
  label,
  nodes,
  pageSlug,
  relation
}: {
  edges: ParsedWikiEdge[];
  label: string;
  nodes: ParsedWikiNode[];
  pageSlug: string;
  relation: SemanticRelation;
}) {
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

function extractSemanticBodyRelations(body: string) {
  const relations: Array<{ label: string; relation: SemanticRelation }> = [];
  const lines = body.split("\n");
  let activeRelation: SemanticRelation | null = null;

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

    for (const [relation, labels] of Object.entries(SEMANTIC_RELATION_LABELS) as Array<[SemanticRelation, string[]]>) {
      for (const label of labels) {
        const pattern = new RegExp(`${label.replace(/\s+/g, "\\s+")}\\s+\\[\\[([^\\]|#]+)(?:#[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\]`, "gi");

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

  for (const [relation, labels] of Object.entries(frontmatter.relations) as Array<[SemanticRelation, string[]]>) {
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
