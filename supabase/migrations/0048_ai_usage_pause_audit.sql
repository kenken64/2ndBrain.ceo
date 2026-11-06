-- Keep each pause/resume in the existing service-only audit trail, atomically
-- with the profile update. Resuming must never overwrite previous pause events.
create or replace function public.audit_ai_usage_pause_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_events (
    admin_user_id, admin_email, target_user_id, target_email,
    action, status, details
  ) values (
    coalesce(auth.uid(), new.openclaw_tokens_pause_actor_id),
    case when auth.uid() is not null then auth.jwt() ->> 'email'
      else new.openclaw_tokens_pause_actor_email end,
    new.id,
    new.email,
    case when new.openclaw_tokens_paused then 'ai_usage_paused' else 'ai_usage_resumed' end,
    'success',
    jsonb_build_object(
      'paused', new.openclaw_tokens_paused,
      'previous_paused', old.openclaw_tokens_paused,
      'user_name', new.full_name,
      'pause_reason', new.openclaw_tokens_pause_reason,
      'recorded_at', case when new.openclaw_tokens_paused then new.openclaw_tokens_paused_at else new.openclaw_tokens_resumed_at end,
      'source', 'profile_transition'
    )
  );
  return new;
end;
$$;

revoke all on function public.audit_ai_usage_pause_change() from public, anon, authenticated;

drop trigger if exists audit_ai_usage_pause_change on public.profiles;
create trigger audit_ai_usage_pause_change
  after update of openclaw_tokens_paused on public.profiles
  for each row
  when (old.openclaw_tokens_paused is distinct from new.openclaw_tokens_paused)
  execute function public.audit_ai_usage_pause_change();

create index if not exists admin_audit_ai_usage_pause_history_idx
  on public.admin_audit_events(created_at desc, id desc)
  where action in ('ai_usage_paused', 'ai_usage_resumed');

-- Import only the latest known timestamps. Older pause cycles are unavailable;
-- label imported rows explicitly and do not infer who performed those actions.
insert into public.admin_audit_events (
  target_user_id, target_email, action, status, details, created_at
)
select p.id, p.email, event.action, 'success',
  jsonb_build_object('user_name', p.full_name, 'source', 'existing_timestamp'), event.recorded_at
from public.profiles p
cross join lateral (values
  ('ai_usage_paused', p.openclaw_tokens_paused_at),
  ('ai_usage_resumed', p.openclaw_tokens_resumed_at)
) as event(action, recorded_at)
where event.recorded_at is not null
  and not exists (
    select 1 from public.admin_audit_events a
    where a.target_user_id = p.id and a.action = event.action
      and (a.created_at = event.recorded_at or a.details -> 'recorded_at' = to_jsonb(event.recorded_at))
  );
