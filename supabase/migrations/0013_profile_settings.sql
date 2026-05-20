alter table public.profiles
  add column if not exists profile_name text,
  add column if not exists google_workspace_enabled boolean not null default false;

update public.profiles
set profile_name = owner_name
where profile_name is null
  and owner_name is not null
  and btrim(owner_name) <> '';

comment on column public.profiles.profile_name is
  'User-editable display name for the workspace profile.';

comment on column public.profiles.google_workspace_enabled is
  'Whether the user has enabled the Google Workspace integration in settings.';
