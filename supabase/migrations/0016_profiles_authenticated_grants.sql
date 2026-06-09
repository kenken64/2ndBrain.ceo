grant select, insert, update on table public.profiles to authenticated;

select pg_notify('pgrst', 'reload schema');
