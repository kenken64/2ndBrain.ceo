import { createClient } from "@/lib/supabase/server";
import { parseWikiMarkdown, type ParsedWikiGraph, type WikiPage } from "@/lib/wiki";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type SyncWikiPageInput = {
  page: WikiPage;
  parsed?: ParsedWikiGraph;
  projectId?: string | null;
  supabase: SupabaseServerClient;
  userId: string;
};

type WikiPageNodeRow = {
  node_id: string;
  page_id: string;
  project_id: string | null;
  role: "page" | "mention" | "tag";
  user_id: string;
};

type WikiEdgeRow = {
  evidence_page_id: string;
  from_node_id: string;
  project_id: string | null;
  relation: string;
  to_node_id: string;
  user_id: string;
  weight: number;
};

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

export async function syncWikiPageGraph({
  page,
  parsed = parseWikiMarkdown(page.content, page.filePath),
  projectId,
  supabase,
  userId
}: SyncWikiPageInput) {
  const syncedAt = new Date().toISOString();
  const { data: storedPage, error: pageError } = await supabase
    .from("wiki_pages")
    .upsert(
      {
        file_path: page.filePath,
        file_sha: page.sha ?? null,
        last_synced_at: syncedAt,
        page_type: parsed.frontmatter.type ?? "page",
        project_id: projectId ?? null,
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
    project_id: projectId ?? null,
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

  const nodeIds = new Map<string, string>(
    (storedNodes as Array<{ id: string; slug: string }>).map((node) => [node.slug, node.id])
  );

  await supabase.from("wiki_page_nodes").delete().eq("page_id", storedPage.id);

  const pageNodeRows: WikiPageNodeRow[] = parsed.nodes
    .map((node) => {
      const nodeId = nodeIds.get(node.slug);

      return nodeId
        ? {
            node_id: nodeId,
            page_id: storedPage.id,
            project_id: projectId ?? null,
            role: node.role,
            user_id: userId
          }
        : null;
    })
    .filter(isPresent);

  if (pageNodeRows.length > 0) {
    const { error } = await supabase.from("wiki_page_nodes").insert(pageNodeRows);

    if (error) {
      throw new Error(error.message);
    }
  }

  await supabase.from("wiki_edges").delete().eq("evidence_page_id", storedPage.id);

  const edgeRows: WikiEdgeRow[] = parsed.edges
    .map((edge) => {
      const fromNodeId = nodeIds.get(edge.fromSlug);
      const toNodeId = nodeIds.get(edge.toSlug);

      return fromNodeId && toNodeId
        ? {
            evidence_page_id: storedPage.id,
            from_node_id: fromNodeId,
            project_id: projectId ?? null,
            relation: edge.relation,
            to_node_id: toNodeId,
            user_id: userId,
            weight: edge.weight
          }
        : null;
    })
    .filter(isPresent);

  if (edgeRows.length > 0) {
    const { error } = await supabase.from("wiki_edges").insert(edgeRows);

    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    edgeCount: edgeRows.length,
    nodeCount: parsed.nodes.length,
    pageId: storedPage.id,
    syncedAt
  };
}
