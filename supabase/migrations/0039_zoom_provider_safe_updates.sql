-- Supabase's safe-update extension requires explicit predicates for bulk changes.
-- Both predicates match every row because these columns are primary keys.
create or replace function public.zoom_save_provider(p_cipher text, p_expected_revision uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare current_revision uuid; next_revision uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(738038);
  select revision into current_revision from zoom_provider_settings where id = true for update;
  if current_revision is distinct from p_expected_revision then raise exception 'zoom_settings_conflict'; end if;
  insert into zoom_provider_settings(id,credentials_cipher,revision) values(true,p_cipher,next_revision)
    on conflict(id) do update set credentials_cipher = excluded.credentials_cipher, revision = excluded.revision, updated_at = now();
  update zoom_accounts set generation = gen_random_uuid(), token_cipher = null, expires_at = null, refresh_owner = null, refresh_until = null where user_id is not null;
  delete from zoom_link_attempts where id is not null;
  return next_revision;
end $$;

select pg_notify('pgrst','reload schema');
