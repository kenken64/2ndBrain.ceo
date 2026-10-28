import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { ChatHistoryBrowser } from "@/components/chat-history-browser";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { SetupCallout } from "@/components/setup-callout";
import { canShowAdminWorkspaceLink } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims, isOnboardingComplete, onboardingPath, onboardingProfileSelect, type OnboardingProfile } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ChatHistoryPageProps = {
  searchParams: Promise<{ page?: string | string[]; q?: string | string[] }>;
};

export default async function ChatHistoryPage({ searchParams }: ChatHistoryPageProps) {
  if (!hasSupabaseEnv()) return <><Atmosphere /><main className="auth-page"><SetupCallout /></main></>;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) redirect("/login?next=/dashboard/chat/history");
  const { data: profile } = await supabase.from("profiles").select(onboardingProfileSelect).eq("id", userId).maybeSingle();
  const onboardingProfile = profile as OnboardingProfile | null;
  if (!isOnboardingComplete(onboardingProfile)) redirect(onboardingPath("/dashboard/chat/history"));
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  const showAdmin = await canShowAdminWorkspaceLink({ email, userId });
  const params = await searchParams;
  const initialQuery = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  const requestedPage = typeof params.page === "string" ? Number.parseInt(params.page, 10) : 1;
  const initialPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar activeItem="chat" avatarName={onboardingProfile?.avatar_name} email={email} ownerName={onboardingProfile?.owner_name} showAdmin={showAdmin} />
        <main className="dashboard-main">
          <div className="dashboard-topbar"><AnnouncementPill>Chat history</AnnouncementPill><a className="text-link" href="/dashboard/chat">Back to chat</a></div>
          <ChatHistoryBrowser initialPage={initialPage} initialQuery={initialQuery} userId={userId} />
        </main>
      </div>
    </>
  );
}
