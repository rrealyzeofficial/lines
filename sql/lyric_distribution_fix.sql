-- ============================================================
-- REALYZE LINES — FIX MISSING lyric_songs / SCHEMA CACHE
-- Chạy trên CHÍNH Supabase project đang dùng cho Team Space.
-- Có thể chạy lại nhiều lần.
-- ============================================================

create extension if not exists pgcrypto;

-- Đảm bảo đang chạy đúng database Team Space.
do $$
begin
  if to_regclass('public.team_members') is null then
    raise exception 'Không tìm thấy public.team_members. Bạn đang chạy nhầm Supabase project.';
  end if;

  if to_regclass('public.team_member_profiles') is null then
    raise exception 'Không tìm thấy public.team_member_profiles. Database Team Space chưa đúng phiên bản.';
  end if;

  if to_regprocedure('public.is_team_member()') is null then
    raise exception 'Không tìm thấy public.is_team_member(). Hãy dùng đúng database Team Space hiện tại.';
  end if;
end $$;

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.lyric_songs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  audio_path text,
  cover_path text,
  created_by text references public.team_members(slug) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lyric_song_members (
  song_id uuid not null references public.lyric_songs(id) on delete cascade,
  member_slug text not null references public.team_members(slug) on delete cascade,
  primary key (song_id, member_slug)
);

create table if not exists public.lyric_song_lines (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.lyric_songs(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  lyric_text text not null,
  is_all boolean not null default false,
  unique (song_id, line_number)
);

create table if not exists public.lyric_line_members (
  line_id uuid not null references public.lyric_song_lines(id) on delete cascade,
  member_slug text not null references public.team_members(slug) on delete cascade,
  primary key (line_id, member_slug)
);

create index if not exists lyric_song_members_song_idx
  on public.lyric_song_members(song_id);

create index if not exists lyric_song_lines_song_idx
  on public.lyric_song_lines(song_id, line_number);

create index if not exists lyric_line_members_line_idx
  on public.lyric_line_members(line_id);

-- ============================================================
-- UPDATED_AT
-- ============================================================

create or replace function public.lyric_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lyric_songs_updated_at on public.lyric_songs;
create trigger trg_lyric_songs_updated_at
before update on public.lyric_songs
for each row execute function public.lyric_touch_updated_at();

-- ============================================================
-- RLS
-- ============================================================

alter table public.lyric_songs enable row level security;
alter table public.lyric_song_members enable row level security;
alter table public.lyric_song_lines enable row level security;
alter table public.lyric_line_members enable row level security;

-- lyric_songs
drop policy if exists "team_read_lyric_songs" on public.lyric_songs;
create policy "team_read_lyric_songs"
on public.lyric_songs for select to authenticated
using (public.is_team_member());

drop policy if exists "team_insert_lyric_songs" on public.lyric_songs;
create policy "team_insert_lyric_songs"
on public.lyric_songs for insert to authenticated
with check (public.is_team_member());

drop policy if exists "team_update_lyric_songs" on public.lyric_songs;
create policy "team_update_lyric_songs"
on public.lyric_songs for update to authenticated
using (public.is_team_member())
with check (public.is_team_member());

drop policy if exists "team_delete_lyric_songs" on public.lyric_songs;
create policy "team_delete_lyric_songs"
on public.lyric_songs for delete to authenticated
using (public.is_team_member());

-- lyric_song_members
drop policy if exists "team_read_lyric_song_members" on public.lyric_song_members;
create policy "team_read_lyric_song_members"
on public.lyric_song_members for select to authenticated
using (public.is_team_member());

drop policy if exists "team_insert_lyric_song_members" on public.lyric_song_members;
create policy "team_insert_lyric_song_members"
on public.lyric_song_members for insert to authenticated
with check (public.is_team_member());

drop policy if exists "team_delete_lyric_song_members" on public.lyric_song_members;
create policy "team_delete_lyric_song_members"
on public.lyric_song_members for delete to authenticated
using (public.is_team_member());

-- lyric_song_lines
drop policy if exists "team_read_lyric_song_lines" on public.lyric_song_lines;
create policy "team_read_lyric_song_lines"
on public.lyric_song_lines for select to authenticated
using (public.is_team_member());

drop policy if exists "team_insert_lyric_song_lines" on public.lyric_song_lines;
create policy "team_insert_lyric_song_lines"
on public.lyric_song_lines for insert to authenticated
with check (public.is_team_member());

drop policy if exists "team_update_lyric_song_lines" on public.lyric_song_lines;
create policy "team_update_lyric_song_lines"
on public.lyric_song_lines for update to authenticated
using (public.is_team_member())
with check (public.is_team_member());

drop policy if exists "team_delete_lyric_song_lines" on public.lyric_song_lines;
create policy "team_delete_lyric_song_lines"
on public.lyric_song_lines for delete to authenticated
using (public.is_team_member());

-- lyric_line_members
drop policy if exists "team_read_lyric_line_members" on public.lyric_line_members;
create policy "team_read_lyric_line_members"
on public.lyric_line_members for select to authenticated
using (public.is_team_member());

drop policy if exists "team_insert_lyric_line_members" on public.lyric_line_members;
create policy "team_insert_lyric_line_members"
on public.lyric_line_members for insert to authenticated
with check (public.is_team_member());

drop policy if exists "team_delete_lyric_line_members" on public.lyric_line_members;
create policy "team_delete_lyric_line_members"
on public.lyric_line_members for delete to authenticated
using (public.is_team_member());

grant select, insert, update, delete
on public.lyric_songs,
   public.lyric_song_members,
   public.lyric_song_lines,
   public.lyric_line_members
to authenticated;

-- ============================================================
-- STORAGE
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lyric-song-covers',
  'lyric-song-covers',
  false,
  10485760,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/png','image/jpeg','image/webp'];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lyric-song-audio',
  'lyric-song-audio',
  false,
  52428800,
  array['audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/x-m4a','audio/aac','audio/flac','audio/x-flac','audio/webm']
)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/x-m4a','audio/aac','audio/flac','audio/x-flac','audio/webm'];

-- Policies storage: drop rồi tạo lại để file có thể chạy lại an toàn.
drop policy if exists "team_read_lyric_covers" on storage.objects;
drop policy if exists "team_upload_lyric_covers" on storage.objects;
drop policy if exists "team_update_lyric_covers" on storage.objects;
drop policy if exists "team_delete_lyric_covers" on storage.objects;
drop policy if exists "team_read_lyric_audio" on storage.objects;
drop policy if exists "team_upload_lyric_audio" on storage.objects;
drop policy if exists "team_update_lyric_audio" on storage.objects;
drop policy if exists "team_delete_lyric_audio" on storage.objects;

create policy "team_read_lyric_covers"
on storage.objects for select to authenticated
using (bucket_id = 'lyric-song-covers' and public.is_team_member());

create policy "team_upload_lyric_covers"
on storage.objects for insert to authenticated
with check (bucket_id = 'lyric-song-covers' and public.is_team_member());

create policy "team_update_lyric_covers"
on storage.objects for update to authenticated
using (bucket_id = 'lyric-song-covers' and public.is_team_member())
with check (bucket_id = 'lyric-song-covers' and public.is_team_member());

create policy "team_delete_lyric_covers"
on storage.objects for delete to authenticated
using (bucket_id = 'lyric-song-covers' and public.is_team_member());

create policy "team_read_lyric_audio"
on storage.objects for select to authenticated
using (bucket_id = 'lyric-song-audio' and public.is_team_member());

create policy "team_upload_lyric_audio"
on storage.objects for insert to authenticated
with check (bucket_id = 'lyric-song-audio' and public.is_team_member());

create policy "team_update_lyric_audio"
on storage.objects for update to authenticated
using (bucket_id = 'lyric-song-audio' and public.is_team_member())
with check (bucket_id = 'lyric-song-audio' and public.is_team_member());

create policy "team_delete_lyric_audio"
on storage.objects for delete to authenticated
using (bucket_id = 'lyric-song-audio' and public.is_team_member());

-- ============================================================
-- REALTIME — idempotent
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'lyric_songs',
    'lyric_song_members',
    'lyric_song_lines',
    'lyric_line_members'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Bắt PostgREST/Supabase API đọc lại schema ngay.
notify pgrst, 'reload schema';

-- Kiểm tra cuối cùng. Phải trả về 4 tên bảng, không được null.
select
  to_regclass('public.lyric_songs') as lyric_songs,
  to_regclass('public.lyric_song_members') as lyric_song_members,
  to_regclass('public.lyric_song_lines') as lyric_song_lines,
  to_regclass('public.lyric_line_members') as lyric_line_members;
