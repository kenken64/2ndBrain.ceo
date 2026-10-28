-- Keep batch PDF mapping requests separate in the itemized usage report.
alter table public.chat_credit_requests drop constraint if exists chat_credit_requests_request_kind_check;
alter table public.chat_credit_requests add constraint chat_credit_requests_request_kind_check
  check (request_kind in ('chat', 'image_ocr', 'pdf_ocr', 'spreadsheet', 'pdf_generation'));

create or replace function public.reserve_chat_credits_itemized(p_user_id uuid, p_model_id text, p_credits bigint, p_is_admin boolean, p_kind text, p_pdf_pages integer)
returns table(request_id uuid, llm_token_quota bigint, llm_token_used bigint)
language plpgsql security definer set search_path = public as $$
declare v_request record;
begin
  if p_kind not in ('chat', 'image_ocr', 'pdf_ocr', 'spreadsheet', 'pdf_generation') or p_kind is null or
    (p_kind = 'pdf_ocr' and (p_pdf_pages is null or p_pdf_pages < 1 or p_pdf_pages > 20)) or
    (p_kind <> 'pdf_ocr' and p_pdf_pages is not null) then raise exception 'invalid_chat_usage_details'; end if;
  select * into v_request from public.reserve_chat_credits(p_user_id, p_model_id, p_credits, p_is_admin);
  update public.chat_credit_requests set request_kind = p_kind, pdf_pages = p_pdf_pages where id = v_request.request_id and user_id = p_user_id;
  return query select v_request.request_id, v_request.llm_token_quota, v_request.llm_token_used;
end;
$$;
revoke all on function public.reserve_chat_credits_itemized(uuid,text,bigint,boolean,text,integer) from public, anon, authenticated;
grant execute on function public.reserve_chat_credits_itemized(uuid,text,bigint,boolean,text,integer) to service_role;
