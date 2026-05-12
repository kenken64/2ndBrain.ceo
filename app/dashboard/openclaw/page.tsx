import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { OpenClawGatewayButton } from "@/components/openclaw-gateway-button";
import { SetupCallout } from "@/components/setup-callout";
import { WikiEditor } from "@/components/wiki-editor";
import { hasSupabaseEnv } from "@/lib/env";
import { readOpenClawWikiPage, readOpenClawWikiTree } from "@/lib/openclaw";
import { getWikiContext, WikiContextError } from "@/lib/wiki-server";
import type { WikiPage, WikiTreeItem } from "@/lib/wiki";

export const dynamic = "force-dynamic";

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

export default async function DashboardOpenClawPage() {
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

  let context: Awaited<ReturnType<typeof getWikiContext>>;

  try {
    context = await getWikiContext();
  } catch (error) {
    if (error instanceof WikiContextError && error.status === 401) {
      redirect("/login?next=/dashboard/openclaw");
    }

    redirect("/dashboard");
  }

  let tree: WikiTreeItem[] = [];
  let initialPage: WikiPage | null = null;
  let initialError: string | null = null;
  const gatewayUrl = context.profile.openclaw_gateway_url?.trim() ?? null;

  try {
    tree = await readOpenClawWikiTree({
      instance: context.instance,
      projectSlug: null
    });

    const firstFile = firstMarkdownFile(tree);

    if (firstFile) {
      initialPage = await readOpenClawWikiPage({
        filePath: firstFile.path,
        instance: context.instance,
        projectSlug: null
      });
    }
  } catch (error) {
    initialError = error instanceof Error ? error.message : "openclaw_markdown_failed";
  }

  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar
          activeItem="gateway"
          avatarName={context.profile.avatar_name}
          email={null}
          ownerName={context.profile.owner_name}
        />
        <main className="dashboard-main">
          <div className="dashboard-topbar">
            <AnnouncementPill>OpenClaw workspace</AnnouncementPill>
            <OpenClawGatewayButton initialGatewayUrl={gatewayUrl} />
          </div>
          <section className="dashboard-workbench">
            <WikiEditor
              apiBase="/api/openclaw/markdown"
              eyebrow="OpenClaw Settings"
              graphHref={null}
              initialError={initialError}
              initialPage={initialPage}
              projectId={null}
              showExport={false}
              showSync={false}
              tree={tree}
            />
          </section>
        </main>
      </div>
    </>
  );
}
