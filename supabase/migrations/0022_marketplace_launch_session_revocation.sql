alter table public.profiles
  add column if not exists marketplace_launch_revoked_at timestamptz;

create index if not exists profiles_marketplace_launch_revoked_idx
  on public.profiles(marketplace_launch_revoked_at desc)
  where marketplace_launch_revoked_at is not null;

comment on column public.profiles.marketplace_launch_revoked_at is
  'Invalidates external marketplace workflow launch sessions issued at or before this timestamp.';

select pg_notify('pgrst', 'reload schema');
