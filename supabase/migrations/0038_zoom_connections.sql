-- Zoom is a connected provider. It never replaces the primary auth.users identity.
create table public.zoom_provider_settings (
  id boolean primary key default true check (id),
  credentials_cipher text not null,
  revision uuid not null default gen_random_uuid(),
  webhook_id uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
create table public.zoom_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  generation uuid not null default gen_random_uuid(),
  zoom_user_id text,
  display_name text,
  email text,
  token_cipher text,
  expires_at timestamptz,
  scopes text,
  provider_revision uuid,
  refresh_owner uuid,
  refresh_until timestamptz
);
create table public.zoom_link_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  generation uuid not null,
  provider_revision uuid not null,
  browser_hash text not null,
  pkce_cipher text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index zoom_link_attempts_expiry on public.zoom_link_attempts(expires_at);
alter table public.zoom_provider_settings enable row level security;
alter table public.zoom_accounts enable row level security;
alter table public.zoom_link_attempts enable row level security;
revoke all on public.zoom_provider_settings, public.zoom_accounts, public.zoom_link_attempts from anon, authenticated;
grant all on public.zoom_provider_settings, public.zoom_accounts, public.zoom_link_attempts to service_role;

create function public.zoom_save_provider(p_cipher text, p_expected_revision uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare current_revision uuid; next_revision uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(738038);
  select revision into current_revision from zoom_provider_settings where id = true for update;
  if current_revision is distinct from p_expected_revision then raise exception 'zoom_settings_conflict'; end if;
  insert into zoom_provider_settings(id,credentials_cipher,revision) values(true,p_cipher,next_revision)
    on conflict(id) do update set credentials_cipher = excluded.credentials_cipher, revision = excluded.revision, updated_at = now();
  update zoom_accounts set generation = gen_random_uuid(), token_cipher = null, expires_at = null, refresh_owner = null, refresh_until = null;
  delete from zoom_link_attempts;
  return next_revision;
end $$;

create function public.zoom_begin_link(p_user_id uuid, p_attempt_id uuid, p_browser_hash text, p_pkce_cipher text, p_provider_revision uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from zoom_provider_settings where revision = p_provider_revision for share;
  if not found then raise exception 'zoom_settings_conflict'; end if;
  insert into zoom_accounts(user_id) values(p_user_id) on conflict(user_id) do nothing;
  delete from zoom_link_attempts where user_id = p_user_id or expires_at < now();
  insert into zoom_link_attempts(id,user_id,generation,provider_revision,browser_hash,pkce_cipher)
    select p_attempt_id,p_user_id,generation,p_provider_revision,p_browser_hash,p_pkce_cipher from zoom_accounts where user_id = p_user_id;
end $$;

create function public.zoom_consume_link(p_id uuid, p_user_id uuid, p_browser_hash text)
returns setof public.zoom_link_attempts language sql security definer set search_path = public as $$
  delete from zoom_link_attempts where id = p_id and user_id = p_user_id and browser_hash = p_browser_hash and expires_at > now() returning *;
$$;

create function public.zoom_store_tokens(p_user_id uuid, p_generation uuid, p_provider_revision uuid, p_cipher text, p_zoom_id text, p_name text, p_email text, p_expires_at timestamptz, p_scopes text, p_refresh_owner uuid default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform 1 from zoom_provider_settings where revision = p_provider_revision for share;
  if not found then return false; end if;
  update zoom_accounts set token_cipher = p_cipher, zoom_user_id = p_zoom_id, display_name = p_name, email = p_email,
    expires_at = p_expires_at, scopes = p_scopes, provider_revision = p_provider_revision, refresh_owner = null, refresh_until = null
    where user_id = p_user_id and generation = p_generation and (p_refresh_owner is null or refresh_owner = p_refresh_owner);
  return found;
end $$;

create function public.zoom_lock_refresh(p_user_id uuid, p_generation uuid, p_lock uuid)
returns setof public.zoom_accounts language sql security definer set search_path = public as $$
  update zoom_accounts set refresh_owner = p_lock, refresh_until = now() + interval '45 seconds'
    where user_id = p_user_id and generation = p_generation and (refresh_until is null or refresh_until < now()) returning *;
$$;

create function public.zoom_disconnect(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update zoom_accounts set generation = gen_random_uuid(), token_cipher = null, expires_at = null, refresh_owner = null, refresh_until = null where user_id = p_user_id;
  delete from zoom_link_attempts where user_id = p_user_id;
end $$;

revoke all on function public.zoom_save_provider(text,uuid), public.zoom_begin_link(uuid,uuid,text,text,uuid), public.zoom_consume_link(uuid,uuid,text), public.zoom_store_tokens(uuid,uuid,uuid,text,text,text,text,timestamptz,text,uuid), public.zoom_lock_refresh(uuid,uuid,uuid), public.zoom_disconnect(uuid) from public, anon, authenticated;
grant execute on function public.zoom_save_provider(text,uuid), public.zoom_begin_link(uuid,uuid,text,text,uuid), public.zoom_consume_link(uuid,uuid,text), public.zoom_store_tokens(uuid,uuid,uuid,text,text,text,text,timestamptz,text,uuid), public.zoom_lock_refresh(uuid,uuid,uuid), public.zoom_disconnect(uuid) to service_role;
select pg_notify('pgrst','reload schema');
