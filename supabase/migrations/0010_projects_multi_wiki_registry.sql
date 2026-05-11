comment on table public.projects is
  'Registry of generated LLM wiki projects. Each row maps one project UUID and human title/prompt to one OpenClaw workspace folder slug.';

comment on column public.projects.id is
  'Stable project UUID used by the app routes and Supabase wiki graph tables.';

comment on column public.projects.title is
  'Human-readable LLM wiki project title shown in the dashboard.';

comment on column public.projects.prompt is
  'Original user intent sentence used to generate the LLM wiki.';

comment on column public.projects.openclaw_project_slug is
  'OpenClaw workspace directory name for the generated markdown wiki.';

create index if not exists projects_user_created_at_idx
  on public.projects(user_id, created_at desc);

create index if not exists projects_user_status_created_at_idx
  on public.projects(user_id, status, created_at desc);

create unique index if not exists projects_user_openclaw_project_slug_uidx
  on public.projects(user_id, openclaw_project_slug)
  where openclaw_project_slug is not null;
