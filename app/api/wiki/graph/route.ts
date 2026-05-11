import { NextResponse } from "next/server";
import { getWikiContext, wikiApiError } from "@/lib/wiki-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedProjectId = url.searchParams.get("projectId");

    if (!requestedProjectId) {
      return NextResponse.json({ error: "project_id_required" }, { status: 400 });
    }

    const context = await getWikiContext(requestedProjectId, { selectLatest: false });
    const projectId = context.project?.id;

    if (!projectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const nodeQuery = context.supabase
      .from("wiki_nodes")
      .select("id,label,slug,node_type,summary,source_page_id")
      .eq("user_id", context.userId)
      .order("label", { ascending: true });
    const edgeQuery = context.supabase
      .from("wiki_edges")
      .select("id,from_node_id,to_node_id,relation,weight,evidence_page_id")
      .eq("user_id", context.userId);
    const filteredNodeQuery = nodeQuery.eq("project_id", projectId);
    const filteredEdgeQuery = edgeQuery.eq("project_id", projectId);
    const [{ data: nodes, error: nodesError }, { data: edges, error: edgesError }] = await Promise.all([
      filteredNodeQuery,
      filteredEdgeQuery
    ]);

    if (nodesError || edgesError) {
      return NextResponse.json(
        { error: nodesError?.message ?? edgesError?.message ?? "wiki_graph_failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      edges: edges ?? [],
      nodes: nodes ?? [],
      project: context.project
    });
  } catch (error) {
    return wikiApiError(error);
  }
}
