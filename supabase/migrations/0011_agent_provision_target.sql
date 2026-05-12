alter table public.profiles
  add column if not exists provision_target text;

alter table public.profiles
  drop constraint if exists profiles_provision_target_check;

alter table public.profiles
  add constraint profiles_provision_target_check
  check (
    provision_target is null
    or provision_target in ('openclaw', 'hermes_agent')
  );
