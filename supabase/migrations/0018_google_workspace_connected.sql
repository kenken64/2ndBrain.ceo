alter table public.profiles
  add column if not exists google_workspace_connected_at timestamptz;

grant update (google_workspace_connected_at) on public.profiles to authenticated;

-- Profiles that already enabled the integration connected before this column
-- existed; treat them as connected so login stops re-prompting them.
update public.profiles
  set google_workspace_connected_at = now()
  where google_workspace_enabled and google_workspace_connected_at is null;

comment on column public.profiles.google_workspace_connected_at is
  'Set when Google Workspace OAuth credentials were last installed on the OpenClaw instance; cleared when the integration is disabled or the workspace is destroyed.';

select pg_notify('pgrst', 'reload schema');
