import { redirect } from "next/navigation";
import { AdminMfaPanel } from "@/components/admin-mfa-panel";
import { Atmosphere } from "@/components/atmosphere";
import { requireAdminPage } from "@/lib/admin";
import { getSupabaseEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type AdminMfaPageProps = {
  searchParams?: Promise<{
    next?: string;
  }>;
};

function safeAdminNext(value: string | undefined) {
  if (!value || !value.startsWith("/admin")) {
    return "/admin";
  }

  return value;
}

export default async function AdminMfaPage({ searchParams }: AdminMfaPageProps) {
  const params = await searchParams;
  const nextPath = safeAdminNext(params?.next);
  const access = await requireAdminPage({
    next: nextPath,
    requireMfa: false,
    requireServiceRole: false
  });

  if (!access.ok) {
    return (
      <>
        <Atmosphere />
        <main className="auth-page">
          <section className="auth-panel">
            <h1>Admin unavailable</h1>
            <p>{access.message}</p>
          </section>
        </main>
      </>
    );
  }

  if (access.aal === "aal2") {
    redirect(nextPath);
  }

  const { supabasePublishableKey, supabaseUrl } = getSupabaseEnv();

  return (
    <>
      <Atmosphere />
      <main className="auth-page">
        <AdminMfaPanel
          nextPath={nextPath}
          supabasePublishableKey={supabasePublishableKey}
          supabaseUrl={supabaseUrl}
        />
      </main>
    </>
  );
}
