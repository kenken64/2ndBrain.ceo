import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { KnowledgeGraph } from "@/components/knowledge-graph";
import { SetupCallout } from "@/components/setup-callout";
import { hasSupabaseEnv } from "@/lib/env";
import { getWikiContext, WikiContextError } from "@/lib/wiki-server";

export const dynamic = "force-dynamic";

type GraphPageProps = {
  searchParams: Promise<{
    projectId?: string;
  }>;
};

type GraphNode = {
  id: string;
  label: string;
  node_type: string;
  slug: string;
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

function formatProjectDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
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
  let context: Awaited<ReturnType<typeof getWikiContext>>;

  try {
    context = await getWikiContext(params.projectId, { selectLatest: Boolean(params.projectId) });
  } catch (error) {
    if (error instanceof WikiContextError && error.status === 401) {
      redirect("/login?next=/dashboard/graph");
    }

    redirect("/dashboard");
  }

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
          />
          <main className="dashboard-main">
            <div className="dashboard-topbar">
              <AnnouncementPill>Knowledge Graph</AnnouncementPill>
              <a className="btn-primary" href="/dashboard/wiki">
                Second Brain
              </a>
            </div>
            <section className="graph-workbench">
              <div className="graph-workbench__header">
                <div>
                  <p className="workspace-status-card__eyebrow">Intent-scoped graphs</p>
                  <h1>Select a Second Brain intent</h1>
                </div>
                <span className="project-status project-status--ready">
                  {graphProjects.length} Second Brain projects
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
                          Open Second Brain
                        </a>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    No ready Second Brain projects yet. Generate a Second Brain from an intent before opening its graph.
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
    .select("id,label,slug,node_type")
    .eq("user_id", context.userId)
    .order("label", { ascending: true });
  const edgeQuery = context.supabase
    .from("wiki_edges")
    .select("id,from_node_id,to_node_id,relation,weight")
    .eq("user_id", context.userId);
  const filteredNodeQuery = nodeQuery.eq("project_id", projectId);
  const filteredEdgeQuery = edgeQuery.eq("project_id", projectId);
  const [{ data: nodes }, { data: edges }] = await Promise.all([filteredNodeQuery, filteredEdgeQuery]);

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar
          activeItem="graph"
          avatarName={context.profile.avatar_name}
          email={null}
          ownerName={context.profile.owner_name}
        />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill>{context.project?.title ?? "Knowledge Graph"}</AnnouncementPill>
            <a className="btn-primary" href="/dashboard/wiki">
              Second Brain
            </a>
          </div>
          <section className="graph-workbench">
            <div className="graph-workbench__header">
              <div>
                <p className="workspace-status-card__eyebrow">Knowledge Graph</p>
                <h1>Node map</h1>
              </div>
              <span className="project-status project-status--running">
                {(nodes ?? []).length} nodes
              </span>
            </div>
            <KnowledgeGraph
              edges={(edges ?? []) as GraphEdge[]}
              nodes={(nodes ?? []) as GraphNode[]}
              rootLabel={context.project?.title ?? "Selected Second Brain intent"}
            />
          </section>
        </main>
      </div>
    </>
  );
}
