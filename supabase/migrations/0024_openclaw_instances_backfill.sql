-- Backfill openclaw_instances from the legacy single-instance columns on profiles so existing users
-- see their current OpenClaw instance in the Gyne Agent instance list. The Redis owner map
-- (openclaw:owners:{user_id}) is populated lazily on the next Gyne Agent launch by
-- reconcileGyneConsumerOwners in app/api/marketplace/launch/route.ts, so it is not written here.
insert into public.openclaw_instances (
  user_id,
  consumer_name,
  label,
  instance,
  region,
  snapshot_name,
  provision_status,
  provision_completed_at
)
select
  p.id,
  coalesce(nullif(trim(p.profile_name), ''), 'legacy-' || left(p.id::text, 8)),
  nullif(trim(p.profile_name), ''),
  nullif(trim(p.openclaw_instance), ''),
  nullif(trim(p.openclaw_region), ''),
  nullif(trim(p.openclaw_snapshot_name), ''),
  'ready',
  coalesce(p.openclaw_provision_completed_at, now())
from public.profiles p
where nullif(trim(p.openclaw_instance), '') is not null
  and not exists (
    select 1
    from public.openclaw_instances oi
    where oi.user_id = p.id
  )
on conflict (user_id, consumer_name) do nothing;
