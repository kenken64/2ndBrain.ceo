import { redirect } from "next/navigation";
import { AnnouncementPill } from "@/components/announcement-pill";
import { Atmosphere } from "@/components/atmosphere";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { SetupCallout } from "@/components/setup-callout";
import { WorkspaceChat } from "@/components/workspace-chat";
import { canShowAdminWorkspaceLink } from "@/lib/admin";
import { hasSupabaseEnv } from "@/lib/env";
import { getUserIdFromClaims, isOnboardingComplete, onboardingPath, onboardingProfileSelect, type OnboardingProfile } from "@/lib/onboarding";
import { hasSupabaseServiceRoleEnv } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ chat?: string | string[] }> }) {
  if (!hasSupabaseEnv()) return <><Atmosphere /><main className="auth-page"><SetupCallout /></main></>;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = getUserIdFromClaims(data?.claims);
  if (error || !userId) redirect("/login?next=/dashboard/chat");
  const { data: profile } = await supabase.from("profiles").select(onboardingProfileSelect).eq("id", userId).maybeSingle();
  const onboardingProfile = profile as OnboardingProfile | null;
  if (!isOnboardingComplete(onboardingProfile)) redirect(onboardingPath("/dashboard/chat"));
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  const showAdmin = await canShowAdminWorkspaceLink({ email, userId });
  const chatConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim()) && hasSupabaseServiceRoleEnv();
  const { chat } = await searchParams;
  const initialChatId = typeof chat === "string" && chat.length <= 200 ? chat : undefined;
  return (
    <>
      <Atmosphere />
      <div className="dashboard-layout">
        <DashboardSidebar activeItem="chat" avatarName={onboardingProfile?.avatar_name} email={email} ownerName={onboardingProfile?.owner_name} showAdmin={showAdmin} showChatActions />
        <main className="dashboard-main">
          <div className="dashboard-topbar"><AnnouncementPill>AI Chat</AnnouncementPill><a className="text-link" href="/dashboard/settings?tab=payment">AI credits</a></div>
          <WorkspaceChat userId={userId} configured={chatConfigured} initialChatId={initialChatId} />
        </main>
      </div>
    </>
  );
}
