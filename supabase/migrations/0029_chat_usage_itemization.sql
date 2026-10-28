-- Itemize OpenRouter requests without storing prompts, file names, or file contents.
alter table public.chat_credit_requests
  add column if not exists request_kind text not null default 'chat' check (request_kind in ('chat', 'image_ocr', 'pdf_ocr', 'spreadsheet')),
  add column if not exists pdf_pages integer check (pdf_pages is null or pdf_pages between 1 and 20),
  add column if not exists prompt_tokens bigint check (prompt_tokens is null or prompt_tokens >= 0),
  add column if not exists completion_tokens bigint check (completion_tokens is null or completion_tokens >= 0);

create or replace function public.reserve_chat_credits_itemized(p_user_id uuid, p_model_id text, p_credits bigint, p_is_admin boolean, p_kind text, p_pdf_pages integer)
returns table(request_id uuid, llm_token_quota bigint, llm_token_used bigint)
language plpgsql security definer set search_path = public as $$
declare v_request record;
begin
  if p_kind not in ('chat', 'image_ocr', 'pdf_ocr', 'spreadsheet') or p_kind is null or
    (p_kind = 'pdf_ocr' and (p_pdf_pages is null or p_pdf_pages < 1 or p_pdf_pages > 20)) or
    (p_kind <> 'pdf_ocr' and p_pdf_pages is not null) then raise exception 'invalid_chat_usage_details'; end if;
  select * into v_request from public.reserve_chat_credits(p_user_id, p_model_id, p_credits, p_is_admin);
  update public.chat_credit_requests set request_kind = p_kind, pdf_pages = p_pdf_pages where id = v_request.request_id and user_id = p_user_id;
  return query select v_request.request_id, v_request.llm_token_quota, v_request.llm_token_used;
end;
$$;

create or replace function public.settle_chat_credits_itemized(p_user_id uuid, p_request_id uuid, p_status text, p_actual_credits bigint, p_cost_usd numeric, p_provider_request_id text, p_prompt_tokens bigint, p_completion_tokens bigint)
returns table(llm_token_quota bigint, llm_token_used bigint, charged_credits bigint)
language plpgsql security definer set search_path = public as $$
declare v_result record;
begin
  if p_prompt_tokens < 0 or p_completion_tokens < 0 then raise exception 'invalid_chat_usage_details'; end if;
  select * into v_result from public.settle_chat_credits(p_user_id, p_request_id, p_status, p_actual_credits, p_cost_usd, p_provider_request_id);
  update public.chat_credit_requests set prompt_tokens = p_prompt_tokens, completion_tokens = p_completion_tokens where id = p_request_id and user_id = p_user_id;
  return query select v_result.llm_token_quota, v_result.llm_token_used, v_result.charged_credits;
end;
$$;
revoke all on function public.reserve_chat_credits_itemized(uuid,text,bigint,boolean,text,integer) from public, anon, authenticated;
revoke all on function public.settle_chat_credits_itemized(uuid,uuid,text,bigint,numeric,text,bigint,bigint) from public, anon, authenticated;
grant execute on function public.reserve_chat_credits_itemized(uuid,text,bigint,boolean,text,integer) to service_role;
grant execute on function public.settle_chat_credits_itemized(uuid,uuid,text,bigint,numeric,text,bigint,bigint) to service_role;
