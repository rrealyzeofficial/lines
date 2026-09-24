-- ============================================================
-- REALYZE LINES — LINE DISTRIBUTION V5
-- Video member images + independent adlib timing.
-- Run once on the SAME Supabase project. Safe to run again.
-- ============================================================

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.lyric_songs') is null
     or to_regclass('public.lyric_song_members') is null
     or to_regclass('public.lyric_song_lines') is null then
    raise exception 'REALYZE Lines tables are missing. Run the previous migrations first.';
  end if;
end $$;

-- Per-song image override for each member shown in the exported video.
alter table public.lyric_song_members
  add column if not exists video_image_path text;

-- lyric_song_members previously did not need UPDATE RLS.
drop policy if exists "team_update_lyric_song_members" on public.lyric_song_members;
create policy "team_update_lyric_song_members"
on public.lyric_song_members for update to authenticated
using (public.is_team_member())
with check (public.is_team_member());

grant update on public.lyric_song_members to authenticated;

-- Adlibs are separate from the visible song lyrics.
-- They can overlap any normal line and can optionally show a small text label.
create table if not exists public.lyric_adlibs (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.lyric_songs(id) on delete cascade,
  label text not null default '',
  show_text boolean not null default false,
  member_slugs text[] not null default '{}',
  start_ms integer,
  end_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lyric_adlibs_start_ms_check check (start_ms is null or start_ms >= 0),
  constraint lyric_adlibs_end_ms_check check (end_ms is null or end_ms >= 0),
  constraint lyric_adlibs_time_order_check check (start_ms is null or end_ms is null or end_ms > start_ms)
);

create index if not exists lyric_adlibs_song_time_idx
  on public.lyric_adlibs(song_id, start_ms);

create or replace function public.lyric_adlib_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lyric_adlibs_updated_at on public.lyric_adlibs;
create trigger trg_lyric_adlibs_updated_at
before update on public.lyric_adlibs
for each row execute function public.lyric_adlib_touch_updated_at();

alter table public.lyric_adlibs enable row level security;

drop policy if exists "team_read_lyric_adlibs" on public.lyric_adlibs;
create policy "team_read_lyric_adlibs"
on public.lyric_adlibs for select to authenticated
using (public.is_team_member());

drop policy if exists "team_insert_lyric_adlibs" on public.lyric_adlibs;
create policy "team_insert_lyric_adlibs"
on public.lyric_adlibs for insert to authenticated
with check (public.is_team_member());

drop policy if exists "team_update_lyric_adlibs" on public.lyric_adlibs;
create policy "team_update_lyric_adlibs"
on public.lyric_adlibs for update to authenticated
using (public.is_team_member())
with check (public.is_team_member());

drop policy if exists "team_delete_lyric_adlibs" on public.lyric_adlibs;
create policy "team_delete_lyric_adlibs"
on public.lyric_adlibs for delete to authenticated
using (public.is_team_member());

grant select, insert, update, delete on public.lyric_adlibs to authenticated;

-- Persistent custom images used only by the line-distribution video.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lyric-video-member-images',
  'lyric-video-member-images',
  false,
  10485760,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists "team_read_line_video_images" on storage.objects;
drop policy if exists "team_upload_line_video_images" on storage.objects;
drop policy if exists "team_update_line_video_images" on storage.objects;
drop policy if exists "team_delete_line_video_images" on storage.objects;

create policy "team_read_line_video_images"
on storage.objects for select to authenticated
using (bucket_id = 'lyric-video-member-images' and public.is_team_member());

create policy "team_upload_line_video_images"
on storage.objects for insert to authenticated
with check (bucket_id = 'lyric-video-member-images' and public.is_team_member());

create policy "team_update_line_video_images"
on storage.objects for update to authenticated
using (bucket_id = 'lyric-video-member-images' and public.is_team_member())
with check (bucket_id = 'lyric-video-member-images' and public.is_team_member());

create policy "team_delete_line_video_images"
on storage.objects for delete to authenticated
using (bucket_id = 'lyric-video-member-images' and public.is_team_member());

-- Realtime is optional for this page, but adding adlibs is safe/idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lyric_adlibs'
  ) then
    alter publication supabase_realtime add table public.lyric_adlibs;
  end if;
end $$;

notify pgrst, 'reload schema';

select
  to_regclass('public.lyric_adlibs') as lyric_adlibs,
  exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='lyric_song_members' and column_name='video_image_path'
  ) as has_video_image_path;
