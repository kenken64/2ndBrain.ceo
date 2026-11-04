-- Check the pause while holding the same profile lock used for credit reservations.
create or replace function public.reserve_chat_credits(p_user_id uuid, p_model_id text, p_credits bigint, p_is_admin boolean)
returns table(request_id uuid, llm_token_quota bigint, llm_token_used bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_request_id uuid;
  v_exempt boolean := coalesce(p_is_admin, false);
begin
  if p_user_id is null or nullif(trim(p_model_id), '') is null or p_credits is null or p_credits <= 0 then
    raise exception 'invalid_chat_reservation';
  end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile_not_found'; end if;
  if coalesce(v_profile.admin_disabled, false) or v_profile.admin_deleted_at is not null then
    raise exception 'account_disabled';
  end if;
  if coalesce(v_profile.openclaw_tokens_paused, false) then
    raise exception 'ai_usage_paused';
  end if;
  -- A crashed server cannot hold an in-flight slot indefinitely. Its credit
  -- reservation remains charged until an operator reconciles the request.
  update public.chat_credit_requests set status = 'uncertain', finished_at = now()
    where user_id = p_user_id and status = 'reserved' and created_at < now() - interval '10 minutes';
  if (select count(*) from public.chat_credit_requests where user_id = p_user_id and status = 'reserved') >= 3 then
    raise exception 'too_many_chat_requests';
  end if;
  if not v_exempt and v_profile.llm_token_quota - v_profile.llm_token_used < p_credits then
    raise exception 'insufficient_ai_credits';
  end if;
  if not v_exempt then
    update public.profiles set llm_token_used = profiles.llm_token_used + p_credits where id = p_user_id
      returning profiles.llm_token_quota, profiles.llm_token_used into v_profile.llm_token_quota, v_profile.llm_token_used;
  end if;
  insert into public.chat_credit_requests(user_id, model_id, reserved_credits, quota_exempt)
    values (p_user_id, p_model_id, case when v_exempt then 0 else p_credits end, v_exempt)
    returning id into v_request_id;
  return query select v_request_id, v_profile.llm_token_quota, v_profile.llm_token_used;
end;
$$;

