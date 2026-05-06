alter table public.profiles
  add column if not exists avatar_name text,
  add column if not exists telegram_bot_token text,
  add column if not exists onboarding_completed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Profiles are created by their owner'
  ) then
    create policy "Profiles are created by their owner"
      on public.profiles
      for insert
      with check (auth.uid() = id);
  end if;
end
$$;
