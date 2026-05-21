import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { BackfillWikiIngestButton } from "@/components/backfill-wiki-ingest-button";
import { ChatInput } from "@/components/chat-input";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { DeleteWikiProjectButton } from "@/components/delete-wiki-project-button";
import { SetupCallout } from "@/components/setup-callout";
import { WikiEditor } from "@/components/wiki-editor";
import { hasSupabaseEnv } from "@/lib/env";
import { readOpenClawWikiPage, readOpenClawWikiTree } from "@/lib/openclaw";
import { getWikiContext, WikiContextError } from "@/lib/wiki-server";
import { normalizeWikiPath, type WikiPage, type WikiTreeItem } from "@/lib/wiki";

export const dynamic = "force-dynamic";

type WikiPageProps = {
  searchParams: Promise<{
    error?: string;
    page?: string;
    path?: string;
    projectId?: string;
    q?: string;
  }>;
};

type LlmWikiProject = {
  created_at: string;
  id: string;
  openclaw_generation_error: string | null;
  openclaw_project_slug: string | null;
  prompt: string;
  status: string;
  title: string;
};

type FailedIngestJob = {
  created_at: string;
  error: string | null;
  id: string;
  project_id: string;
  status: string;
};

const WIKI_PROJECTS_PAGE_SIZE = 6;
const WIKI_GENERATION_STALE_AFTER_MS = 60 * 60 * 1000;
const WIKI_GENERATION_STALE_MESSAGE =
  "Generation timed out before OpenClaw returned markdown. This stale job was closed automatically; create a new Nth Brain or delete this one.";

function formatProjectDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function normalizeSearchParam(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ").slice(0, 120) ?? "";
}

function parsePageParam(value: string | undefined) {
  const page = Number(value ?? "1");

  return Number.isInteger(page) && page > 0 ? page : 1;
}

function escapeIlikePattern(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function wikiListHref(searchQuery: string, page: number) {
  const query = new URLSearchParams();

  if (searchQuery) {
    query.set("q", searchQuery);
  }

  if (page > 1) {
    query.set("page", String(page));
  }

  const suffix = query.toString();

  return suffix ? `/dashboard/wiki?${suffix}` : "/dashboard/wiki";
}

function visiblePageNumbers(currentPage: number, totalPages: number) {
  const windowSize = 5;
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - windowSize + 1));
  const end = Math.min(totalPages, start + windowSize - 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

async function expireStaleRunningProjects(context: Awaited<ReturnType<typeof getWikiContext>>) {
  const staleCutoff = new Date(Date.now() - WIKI_GENERATION_STALE_AFTER_MS).toISOString();

  await context.supabase
    .from("projects")
    .update({
      openclaw_generation_completed_at: new Date().toISOString(),
      openclaw_generation_error: WIKI_GENERATION_STALE_MESSAGE,
      status: "failed"
    })
    .eq("user_id", context.userId)
    .eq("status", "running")
    .lt("created_at", staleCutoff);
}

function isStaleRunningProject(project: LlmWikiProject) {
  if (project.status !== "running") {
    return false;
  }

  const createdAt = new Date(project.created_at).getTime();

  return Number.isFinite(createdAt) && Date.now() - createdAt > WIKI_GENERATION_STALE_AFTER_MS;
}

function firstMarkdownFile(items: WikiTreeItem[]): WikiTreeItem | null {
  for (const item of items) {
    if (item.type === "file") {
      return item;
    }

    if (item.children) {
      const child = firstMarkdownFile(item.children);

      if (child) {
        return child;
      }
    }
  }

  return null;
}

export default async function DashboardWikiPage({ searchParams }: WikiPageProps) {
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
      redirect("/login?next=/dashboard/wiki");
    }

    redirect("/dashboard");
  }

  if (!params.projectId) {
    await expireStaleRunningProjects(context);

    const searchQuery = normalizeSearchParam(params.q);
    const currentPage = parsePageParam(params.page);
    const rangeStart = (currentPage - 1) * WIKI_PROJECTS_PAGE_SIZE;
    const rangeEnd = rangeStart + WIKI_PROJECTS_PAGE_SIZE - 1;
    let projectsQuery = context.supabase
      .from("projects")
      .select("id,title,prompt,status,created_at,openclaw_project_slug,openclaw_generation_error", {
        count: "exact"
      })
      .eq("user_id", context.userId);

    if (searchQuery) {
      projectsQuery = projectsQuery.ilike("title", `%${escapeIlikePattern(searchQuery)}%`);
    }

    const { count, data: projects } = await projectsQuery
      .order("created_at", { ascending: false })
      .range(rangeStart, rangeEnd);
    const wikiProjects = (projects ?? []) as LlmWikiProject[];
    const totalProjects = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalProjects / WIKI_PROJECTS_PAGE_SIZE));
    const firstVisibleProject = totalProjects === 0 ? 0 : rangeStart + 1;
    const lastVisibleProject = Math.min(rangeEnd + 1, totalProjects);
    const failedIngestJobsByProject = new Map<string, FailedIngestJob>();

    if (wikiProjects.length > 0) {
      const { data: failedIngestJobs } = await context.supabase
        .from("wiki_sync_jobs")
        .select("id,project_id,status,error,created_at")
        .eq("user_id", context.userId)
        .eq("job_type", "ingest")
        .eq("status", "failed")
        .in("project_id", wikiProjects.map((project) => project.id))
        .order("created_at", { ascending: false });

      for (const job of (failedIngestJobs ?? []) as FailedIngestJob[]) {
        if (!failedIngestJobsByProject.has(job.project_id)) {
          failedIngestJobsByProject.set(job.project_id, job);
        }
      }
    }

    if (currentPage > 1 && currentPage > totalPages) {
      redirect(wikiListHref(searchQuery, totalPages));
    }

    return (
      <>
        <Atmosphere />
        <div className="dashboard-layout">
          <DashboardSidebar
            activeItem="wiki"
            avatarName={context.profile.avatar_name}
            email={null}
            ownerName={context.profile.owner_name}
          />
          <main className="dashboard-main">
            <div className="dashboard-topbar">
              <AnnouncementPill>Nth Brain</AnnouncementPill>
              <a className="btn-primary" href="/auth/logout">
                Log out
              </a>
            </div>
            <section className="dashboard-workbench wiki-hub">
              <div className="wiki-empty-panel wiki-generator-panel">
                <h1>Generate a Nth Brain</h1>
                <p>Describe a new Nth Brain project. Each generated Nth Brain gets its own workspace, markdown pages, and graph-ready structure.</p>
                {params.error ? (
                  <p className="form-error">
                    Nth Brain generation failed on the previous attempt. Try again; the app will create a markdown scaffold even if Claude refinement is unavailable.
                  </p>
                ) : null}
                <ChatInput
                  className="wiki-empty-panel__chat"
                  pendingCopy="Generating the OpenClaw markdown Nth Brain, project scaffold, and graph-ready page structure."
                  pendingTitle="Generating Nth Brain"
                  placeholder="Describe the knowledge base, project, or operating system you want the Nth Brain to maintain..."
                  returnTo="/dashboard/wiki"
                />
              </div>

              <section className="projects-section wiki-projects-section" aria-labelledby="wiki-projects-title">
                <div className="projects-section__header">
                  <div>
                    <p className="workspace-status-card__eyebrow">Generated Nth Brains</p>
                    <h2 id="wiki-projects-title">Nth Brain - Augmented Memory</h2>
                  </div>
                  <span className="project-status project-status--ready">
                    {searchQuery ? `${totalProjects} matched` : `${totalProjects} total`}
                  </span>
                </div>
                <div className="wiki-projects-toolbar">
                  <form action="/dashboard/wiki" className="wiki-projects-search" method="get" noValidate>
                    <label htmlFor="wiki-title-search">Search by title</label>
                    <div className="wiki-projects-search__controls">
                      <input
                        defaultValue={searchQuery}
                        id="wiki-title-search"
                        name="q"
                        placeholder="Search generated Nth Brain title..."
                        type="search"
                      />
                      <button className="btn-primary btn-primary--compact" type="submit">
                        Search
                      </button>
                      {searchQuery ? (
                        <a className="btn-ghost" href="/dashboard/wiki">
                          Clear
                        </a>
                      ) : null}
                    </div>
                  </form>
                  <p>
                    Showing {firstVisibleProject}-{lastVisibleProject} of {totalProjects}
                  </p>
                </div>
                <div className="projects-grid">
                  {wikiProjects.length > 0 ? (
                    wikiProjects.map((project) => {
                      const isStale = isStaleRunningProject(project);
                      const displayStatus = isStale ? "failed" : project.status;
                      const failedIngestJob = failedIngestJobsByProject.get(project.id);
                      const displayError = project.openclaw_generation_error ?? failedIngestJob?.error ?? (isStale ? WIKI_GENERATION_STALE_MESSAGE : null);
                      const canBackfillIngest = displayStatus === "ready" && Boolean(project.openclaw_project_slug) && Boolean(failedIngestJob || project.openclaw_generation_error?.includes("wiki ingest JSON"));

                      return (
                        <article className="project-card wiki-project-card" key={project.id}>
                          <span className={`project-status project-status--${displayStatus}`}>
                            {displayStatus}
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
                          {displayError ? (
                            <details className="project-error" open>
                              <summary>Generation error</summary>
                              <pre>{displayError}</pre>
                            </details>
                          ) : null}
                          <div className="project-card__meta">
                            <time dateTime={project.created_at}>{formatProjectDate(project.created_at)}</time>
                          </div>
                          <div className="project-card__actions">
                            {displayStatus === "ready" && project.openclaw_project_slug ? (
                              <a className="btn-primary btn-primary--compact" href={`/dashboard/wiki?projectId=${project.id}`}>
                                Open markdown <span className="arrow">-&gt;</span>
                              </a>
                            ) : (
                              <span className="text-link is-disabled">
                                {displayStatus === "running" ? "Generating..." : "Markdown unavailable"}
                              </span>
                            )}
                            <DeleteWikiProjectButton
                              disabled={displayStatus === "running"}
                              projectId={project.id}
                              projectSlug={project.openclaw_project_slug}
                              title={project.title}
                            />
                            {canBackfillIngest ? <BackfillWikiIngestButton projectId={project.id} /> : null}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="empty-state">
                      {searchQuery
                        ? "No Nth Brain projects match that title search."
                        : "No generated Nth Brain projects yet. Create the first one from the prompt above."}
                    </div>
                  )}
                </div>
                {totalPages > 1 ? (
                  <nav aria-label="Nth Brain pagination" className="wiki-pagination">
                    {currentPage > 1 ? (
                      <a className="btn-ghost" href={wikiListHref(searchQuery, currentPage - 1)}>
                        Previous
                      </a>
                    ) : (
                      <span className="btn-ghost is-disabled">Previous</span>
                    )}
                    <div className="wiki-pagination__pages">
                      {visiblePageNumbers(currentPage, totalPages).map((page) =>
                        page === currentPage ? (
                          <span aria-current="page" className="wiki-page-link is-current" key={page}>
                            {page}
                          </span>
                        ) : (
                          <a className="wiki-page-link" href={wikiListHref(searchQuery, page)} key={page}>
                            {page}
                          </a>
                        )
                      )}
                    </div>
                    {currentPage < totalPages ? (
                      <a className="btn-ghost" href={wikiListHref(searchQuery, currentPage + 1)}>
                        Next
                      </a>
                    ) : (
                      <span className="btn-ghost is-disabled">Next</span>
                    )}
                  </nav>
                ) : null}
              </section>
            </section>
          </main>
        </div>
      </>
    );
  }

  if (!context.project?.openclaw_project_slug || context.project.status !== "ready") {
    redirect("/dashboard/wiki");
  }

  let tree: WikiTreeItem[] = [];
  let initialPage: WikiPage | null = null;
  let initialError: string | null = null;

  try {
    tree = await readOpenClawWikiTree({
      instance: context.instance,
      projectSlug: context.projectSlug
    });

    const firstFile = firstMarkdownFile(tree);
    let initialPath = firstFile?.path ?? null;

    if (params.path) {
      initialPath = normalizeWikiPath(params.path);
    }

    if (initialPath) {
      initialPage = await readOpenClawWikiPage({
        filePath: initialPath,
        instance: context.instance,
        projectSlug: context.projectSlug
      });
    }
  } catch (error) {
    initialError = error instanceof Error ? error.message : "wiki_tree_failed";
  }

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar
          activeItem="wiki"
          avatarName={context.profile.avatar_name}
          email={null}
          ownerName={context.profile.owner_name}
        />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill>{context.project?.title ?? "Nth Brain"}</AnnouncementPill>
            <a className="btn-primary" href="/auth/logout">
              Log out
            </a>
          </div>
          <section className="dashboard-workbench">
            <WikiEditor
              initialError={initialError}
              initialPage={initialPage}
              projectId={context.project?.id ?? null}
              tree={tree}
            />
          </section>
        </main>
      </div>
    </>
  );
}
