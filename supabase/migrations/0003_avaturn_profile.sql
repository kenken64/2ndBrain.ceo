alter table public.profiles
  add column if not exists avaturn_avatar_url text,
  add column if not exists avaturn_avatar_payload jsonb,
  add column if not exists avatar_glb_path text,
  add column if not exists avatar_glb_bytes integer,
  add column if not exists avatar_glb_downloaded_at timestamptz;
