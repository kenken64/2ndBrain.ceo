export function SetupCallout() {
  return (
    <section className="setup-callout">
      <h2>Supabase is not configured yet</h2>
      <p>
        Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to <code>.env.local</code>.
        If Supabase only shows a legacy anon key, use{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> instead.
        On Railway, add the same variables to the service Variables tab and set{" "}
        <code>NEXT_PUBLIC_SITE_URL</code> to the generated public URL.
      </p>
    </section>
  );
}
