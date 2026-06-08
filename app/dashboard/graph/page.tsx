import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { SetupCallout } from "@/components/setup-callout";
import { canShowAdminWorkspaceLink } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { normalizeWikiPath } from "@/lib/wiki";
import { getWikiContext, WikiContextError } from "@/lib/wiki-server";

export const dynamic = "force-dynamic";

type GraphPageProps = {
  searchParams: Promise<{
    path?: string;
    projectId?: string;
  }>;
};

type GraphNode = {
  id: string;
  label: string;
  node_type: string;
  slug: string;
  source_page_id?: string | null;
  source_path?: string | null;
};

type GraphEdge = {
  from_node_id: string;
  id: string;
  relation: string;
  to_node_id: string;
  weight: number;
};

type GraphProject = {
  created_at: string;
  id: string;
  openclaw_project_slug: string | null;
  prompt: string;
  status: string;
  title: string;
};

type GraphPageRow = {
  file_path: string;
  id: string;
};

type GraphPageNodeRow = {
  node_id: string;
  page_id: string;
  role: string;
};

function formatProjectDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function pageNodePriority(role: string) {
  if (role === "page") {
    return 0;
  }

  if (role === "mention") {
    return 1;
  }

  return 2;
}

function withGraphNodeSourcePaths(
  nodes: GraphNode[],
  pages: GraphPageRow[],
  pageNodes: GraphPageNodeRow[]
) {
  const pathByPageId = new Map(pages.map((page) => [page.id, page.file_path]));
  const pathByNodeId = new Map<string, string>();

  for (const node of nodes) {
    const sourcePath = node.source_page_id ? pathByPageId.get(node.source_page_id) : null;

    if (sourcePath) {
      pathByNodeId.set(node.id, sourcePath);
    }
  }

  for (const pageNode of [...pageNodes].sort((left, right) => pageNodePriority(left.role) - pageNodePriority(right.role))) {
    const sourcePath = pathByPageId.get(pageNode.page_id);

    if (sourcePath && (!pathByNodeId.has(pageNode.node_id) || pageNode.role === "page")) {
      pathByNodeId.set(pageNode.node_id, sourcePath);
    }
  }

  return nodes.map((node) => ({
    ...node,
    source_path: pathByNodeId.get(node.id) ?? null
  }));
}

function normalizeHighlightPath(value?: string) {
  if (!value) {
    return null;
  }

  try {
    return normalizeWikiPath(value);
  } catch {
    return null;
  }
}

export default async function DashboardGraphPage({ searchParams }: GraphPageProps) {
  if (!hasSupabaseEnv()) {
    return (
      <>
        <Atmosphere />
        <main className="auth-page">
          <SetupCallout />
        </main>
      </>
    );
  }

  const params = await searchParams;
  const highlightPath = normalizeHighlightPath(params.path);
  let context: Awaited<ReturnType<typeof getWikiContext>>;

  try {
    context = await getWikiContext(params.projectId, { selectLatest: Boolean(params.projectId) });
  } catch (error) {
    if (error instanceof WikiContextError && error.status === 401) {
      redirect("/login?next=/dashboard/graph");
    }

    redirect("/dashboard");
  }

  const showAdmin = await canShowAdminWorkspaceLink();

  if (!params.projectId) {
    const { data: projects } = await context.supabase
      .from("projects")
      .select("id,title,prompt,status,created_at,openclaw_project_slug")
      .eq("user_id", context.userId)
      .eq("status", "ready")
      .not("openclaw_project_slug", "is", null)
      .order("created_at", { ascending: false });
    const graphProjects = (projects ?? []) as GraphProject[];

    return (
      <>
        <Atmosphere />
        <div className="dashboard-layout">
          <DashboardSidebar
            activeItem="graph"
            avatarName={context.profile.avatar_name}
            email={null}
            ownerName={context.profile.owner_name}
            showAdmin={showAdmin}
          />
          <main className="dashboard-main">
            <div className="dashboard-topbar">
              <AnnouncementPill>Knowledge Graph</AnnouncementPill>
              <a className="btn-primary" href="/dashboard/wiki">
                Nth Brain
              </a>
            </div>
            <section className="graph-workbench">
              <div className="graph-workbench__header">
                <div>
                  <p className="workspace-status-card__eyebrow">Intent-scoped graphs</p>
                  <h1>Select a Nth Brain intent</h1>
                </div>
                <span className="project-status project-status--ready">
                  {graphProjects.length} Nth Brain projects
                </span>
              </div>
              <div className="projects-grid">
                {graphProjects.length > 0 ? (
                  graphProjects.map((project) => (
                    <article className="project-card wiki-project-card" key={project.id}>
                      <span className={`project-status project-status--${project.status}`}>
                        {project.status}
                      </span>
                      <h3>{project.title}</h3>
                      <p>{project.prompt}</p>
                      <dl className="project-card__details">
                        <div>
                          <dt>Project UUID</dt>
                          <dd>{project.id}</dd>
                        </div>
                        <div>
                          <dt>OpenClaw folder</dt>
                          <dd>{project.openclaw_project_slug ?? "Pending"}</dd>
                        </div>
                      </dl>
                      <div className="project-card__meta">
                        <time dateTime={project.created_at}>{formatProjectDate(project.created_at)}</time>
                      </div>
                      <div className="project-card__actions">
                        <a className="btn-primary btn-primary--compact" href={`/dashboard/graph?projectId=${project.id}`}>
                          Open graph <span className="arrow">-&gt;</span>
                        </a>
                        <a className="btn-ghost" href={`/dashboard/wiki?projectId=${project.id}`}>
                          Open Nth Brain
                        </a>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    No ready Nth Brain projects yet. Generate a Nth Brain from an intent before opening its graph.
                  </div>
                )}
              </div>
            </section>
          </main>
        </div>
      </>
    );
  }

  if (!context.project?.id) {
    redirect("/dashboard/graph");
  }

  const projectId = context.project.id;
  const nodeQuery = context.supabase
    .from("wiki_nodes")
    .select("id,label,slug,node_type,source_page_id")
    .eq("user_id", context.userId)
    .order("label", { ascending: true });
  const edgeQuery = context.supabase
    .from("wiki_edges")
    .select("id,from_node_id,to_node_id,relation,weight")
    .eq("user_id", context.userId);
  const pageQuery = context.supabase
    .from("wiki_pages")
    .select("id,file_path")
    .eq("user_id", context.userId);
  const pageNodeQuery = context.supabase
    .from("wiki_page_nodes")
    .select("node_id,page_id,role")
    .eq("user_id", context.userId);
  const filteredNodeQuery = nodeQuery.eq("project_id", projectId);
  const filteredEdgeQuery = edgeQuery.eq("project_id", projectId);
  const filteredPageQuery = pageQuery.eq("project_id", projectId);
  const filteredPageNodeQuery = pageNodeQuery.eq("project_id", projectId);
  const [{ data: nodes }, { data: edges }, { data: pages }, { data: pageNodes }] = await Promise.all([
    filteredNodeQuery,
    filteredEdgeQuery,
    filteredPageQuery,
    filteredPageNodeQuery
  ]);
  const graphNodes = withGraphNodeSourcePaths(
    (nodes ?? []) as GraphNode[],
    (pages ?? []) as GraphPageRow[],
    (pageNodes ?? []) as GraphPageNodeRow[]
  );

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar
          activeItem="graph"
          avatarName={context.profile.avatar_name}
          email={null}
          ownerName={context.profile.owner_name}
          showAdmin={showAdmin}
        />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill>{context.project?.title ?? "Knowledge Graph"}</AnnouncementPill>
            <a className="btn-primary" href="/dashboard/wiki">
              Nth Brain
            </a>
          </div>
          <section className="graph-workbench">
            <div className="graph-workbench__header">
              <div>
                <p className="workspace-status-card__eyebrow">Knowledge Graph</p>
                <h1>Node map</h1>
              </div>
              <span className="project-status project-status--running">
                {graphNodes.length} nodes
              </span>
            </div>
            <KnowledgeGraph
              edges={(edges ?? []) as GraphEdge[]}
              nodes={graphNodes}
              highlightPath={highlightPath}
              projectId={projectId}
              rootLabel={context.project?.title ?? "Selected Nth Brain intent"}
            />
          </section>
        </main>
      </div>
    </>
  );
}
