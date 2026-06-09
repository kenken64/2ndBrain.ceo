create index if not exists profiles_email_lower_idx
  on public.profiles (lower(email))
  where email is not null;

create or replace function public.find_ai_credit_transfer_recipient(
  p_sender_user_id uuid,
  p_recipient_email text
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  llm_token_quota bigint,
  llm_token_used bigint,
  available_tokens bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_recipient_email, '')));
  v_match_count integer;
begin
  if p_sender_user_id is null then
    raise exception 'sender_required';
  end if;

  if v_email = '' then
    raise exception 'recipient_email_required';
  end if;

  select count(*)
    into v_match_count
    from public.profiles p
    where lower(p.email) = v_email;

  if v_match_count = 0 then
    return;
  end if;

  if v_match_count > 1 then
    raise exception 'recipient_email_ambiguous';
  end if;

  if exists (
    select 1
      from public.profiles p
      where p.id = p_sender_user_id
        and lower(p.email) = v_email
  ) then
    raise exception 'recipient_is_sender';
  end if;

  return query
  select
    p.id,
    p.email,
    coalesce(
      nullif(trim(p.profile_name), ''),
      nullif(trim(p.owner_name), ''),
      nullif(split_part(p.email, '@', 1), ''),
      'User'
    ),
    p.llm_token_quota,
    p.llm_token_used,
    greatest(0::bigint, p.llm_token_quota - p.llm_token_used)
  from public.profiles p
  where lower(p.email) = v_email;
end;
$$;

create or replace function public.transfer_ai_credits(
  p_sender_user_id uuid,
  p_recipient_email text,
  p_amount_tokens bigint
)
returns table (
  transfer_id uuid,
  amount_tokens bigint,
  sender_user_id uuid,
  sender_email text,
  sender_llm_token_quota bigint,
  sender_llm_token_used bigint,
  sender_available_tokens bigint,
  recipient_user_id uuid,
  recipient_email text,
  recipient_display_name text,
  recipient_llm_token_quota bigint,
  recipient_llm_token_used bigint,
  recipient_available_tokens bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_recipient_email, '')));
  v_match_count integer;
  v_recipient_id uuid;
  v_profile public.profiles%rowtype;
  v_sender public.profiles%rowtype;
  v_recipient public.profiles%rowtype;
  v_sender_available bigint;
  v_transfer_id uuid := gen_random_uuid();
begin
  if p_sender_user_id is null then
    raise exception 'sender_required';
  end if;

  if v_email = '' then
    raise exception 'recipient_email_required';
  end if;

  if p_amount_tokens is null or p_amount_tokens <= 0 then
    raise exception 'invalid_transfer_amount';
  end if;

  select count(*)
    into v_match_count
    from public.profiles p
    where lower(p.email) = v_email;

  if v_match_count = 0 then
    raise exception 'recipient_not_found';
  end if;

  if v_match_count > 1 then
    raise exception 'recipient_email_ambiguous';
  end if;

  select id
    into v_recipient_id
    from public.profiles p
    where lower(p.email) = v_email
    limit 1;

  if v_recipient_id = p_sender_user_id then
    raise exception 'recipient_is_sender';
  end if;

  for v_profile in
    select *
      from public.profiles
      where id in (p_sender_user_id, v_recipient_id)
      order by id
      for update
  loop
    if v_profile.id = p_sender_user_id then
      v_sender := v_profile;
    elsif v_profile.id = v_recipient_id then
      v_recipient := v_profile;
    end if;
  end loop;

  if v_sender.id is null then
    raise exception 'sender_not_found';
  end if;

  if v_recipient.id is null then
    raise exception 'recipient_not_found';
  end if;

  v_sender_available := v_sender.llm_token_quota - v_sender.llm_token_used;

  if v_sender_available < p_amount_tokens then
    raise exception 'insufficient_ai_credits';
  end if;

  update public.profiles
    set llm_token_quota = llm_token_quota - p_amount_tokens
    where id = v_sender.id
    returning * into v_sender;

  update public.profiles
    set llm_token_quota = llm_token_quota + p_amount_tokens
    where id = v_recipient.id
    returning * into v_recipient;

  insert into public.credit_ledger (
    user_id,
    delta_tokens,
    balance_after,
    reason,
    metadata
  )
  values
    (
      v_sender.id,
      -p_amount_tokens,
      v_sender.llm_token_quota,
      'ai_credit_transfer_out',
      jsonb_build_object(
        'transfer_id', v_transfer_id,
        'recipient_user_id', v_recipient.id,
        'recipient_email', v_recipient.email
      )
    ),
    (
      v_recipient.id,
      p_amount_tokens,
      v_recipient.llm_token_quota,
      'ai_credit_transfer_in',
      jsonb_build_object(
        'transfer_id', v_transfer_id,
        'sender_user_id', v_sender.id,
        'sender_email', v_sender.email
      )
    );

  transfer_id := v_transfer_id;
  amount_tokens := p_amount_tokens;
  sender_user_id := v_sender.id;
  sender_email := v_sender.email;
  sender_llm_token_quota := v_sender.llm_token_quota;
  sender_llm_token_used := v_sender.llm_token_used;
  sender_available_tokens := greatest(0::bigint, v_sender.llm_token_quota - v_sender.llm_token_used);
  recipient_user_id := v_recipient.id;
  recipient_email := v_recipient.email;
  recipient_display_name := coalesce(
    nullif(trim(v_recipient.profile_name), ''),
    nullif(trim(v_recipient.owner_name), ''),
    nullif(split_part(v_recipient.email, '@', 1), ''),
    'User'
  );
  recipient_llm_token_quota := v_recipient.llm_token_quota;
  recipient_llm_token_used := v_recipient.llm_token_used;
  recipient_available_tokens := greatest(0::bigint, v_recipient.llm_token_quota - v_recipient.llm_token_used);
  return next;
end;
$$;

revoke all on function public.find_ai_credit_transfer_recipient(uuid, text)
  from public, anon, authenticated;

revoke all on function public.transfer_ai_credits(uuid, text, bigint)
  from public, anon, authenticated;

grant execute on function public.find_ai_credit_transfer_recipient(uuid, text)
  to service_role;

grant execute on function public.transfer_ai_credits(uuid, text, bigint)
  to service_role;

comment on function public.find_ai_credit_transfer_recipient(uuid, text) is
  'Looks up one internal AI credit transfer recipient by exact email for the authenticated sender.';

comment on function public.transfer_ai_credits(uuid, text, bigint) is
  'Atomically transfers unused AI credits from one profile quota to another and records both ledger entries.';
