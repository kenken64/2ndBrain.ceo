-- Starter grant + idle-instance reaping.
--
-- Provisioning is gated on available AI credits > 0 (proxy.ts and the provision
-- route both check it), and new profiles landed at 0, so nobody could provision
-- without an admin grant first. Give new accounts a small starter balance so the
-- existing gates simply pass, rather than adding an exception to them.
--
-- The grant alone would leak money: any balance > 0 unlocks a Lightsail instance
-- that bills ~$24/month whether or not it is used, and nothing tears it down
-- when the credits run out. So the grant ships with a reaper, and this migration
-- adds the timestamp the reaper needs.

alter table public.profiles
  alter column llm_token_quota set default 250000;

comment on column public.profiles.llm_token_quota is
  'Total AI credits granted. New profiles start at the 250k starter grant (~1 USD at the 7.5M-for-30-USD package rate), enough to provision and try the agent.';

alter table public.profiles
  add column if not exists ai_credits_exhausted_at timestamptz;

comment on column public.profiles.ai_credits_exhausted_at is
  'When available AI credits (llm_token_quota - llm_token_used) last reached zero; null while the account is funded. The reaper deletes OpenClaw instances that stay unfunded past the grace window.';

-- Credits move from several places: the token usage listener, admin grants,
-- admin drain, Solana purchases, and transfers. A trigger catches every writer
-- instead of patching each one and hoping the next writer remembers.
create or replace function public.sync_ai_credits_exhausted_at()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.llm_token_quota, 0) - coalesce(new.llm_token_used, 0) <= 0 then
    -- Preserve the original timestamp: the countdown must not restart on every
    -- unrelated profile write while the account stays at zero.
    if new.ai_credits_exhausted_at is null then
      new.ai_credits_exhausted_at := now();
    end if;
  else
    new.ai_credits_exhausted_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_ai_credits_exhausted on public.profiles;

create trigger profiles_sync_ai_credits_exhausted
  before insert or update on public.profiles
  for each row
  execute function public.sync_ai_credits_exhausted_at();

-- The reaper sweeps on an interval; only rows holding an instance can be reaped.
create index if not exists profiles_ai_credits_exhausted_at_idx
  on public.profiles (ai_credits_exhausted_at)
  where openclaw_instance is not null;

-- Grace period: accounts already at zero when this ships start their window now,
-- so nobody is reaped on the first sweep without the full warning period.
update public.profiles
  set ai_credits_exhausted_at = now()
  where llm_token_quota - llm_token_used <= 0
    and ai_credits_exhausted_at is null;

select pg_notify('pgrst', 'reload schema');
