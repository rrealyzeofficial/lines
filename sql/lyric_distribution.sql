-- ============================================================
-- REALYZE LINES — LYRIC DISTRIBUTION MIGRATION
-- Chạy trên CÙNG Supabase project với REALYZE Team Space.
-- Không tạo lại team_members / team_member_profiles.
-- Có thể chạy lại an toàn.
-- ============================================================

create extension if not exists pgcrypto;

-- Bảo vệ khỏi việc chạy nhầm database.
do $$
begin
  if to_regclass('public.team_members') is null then
    raise exception 'Không tìm thấy public.team_members. Hãy chạy SQL này trên database Team Space hiện tại.';
  end if;
  if to_regclass('public.team_member_profiles') is null then
    raise exception 'Không tìm thấy public.team_member_profiles. Hãy cập nhật Team Space trước.';
  end if;
end $$;

create table if not exists public.lyric_songs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  audio_path text,
  cover_path text,
  created_by text references public.team_members(slug) on delete set null,
  status text not null default 'draft' check (status in ('draft','completed')),
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

create index if not exists lyric_song_members_song_idx on public.lyric_song_members(song_id);
create index if not exists lyric_song_lines_song_idx on public.lyric_song_lines(song_id, line_number);
create index if not exists lyric_line_members_line_idx on public.lyric_line_members(line_id);

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

-- RLS: mọi member Team Space đã đăng nhập có thể dùng workspace chia lời.
alter table public.lyric_songs enable row level security;
alter table public.lyric_song_members enable row level security;
alter table public.lyric_song_lines enable row level security;
alter table public.lyric_line_members enable row level security;

-- lyric_songs
drop policy if exists "team_read_lyric_songs" on public.lyric_songs;
create policy "team_read_lyric_songs" on public.lyric_songs for select to authenticated using (public.is_team_member());
drop policy if exists "team_insert_lyric_songs" on public.lyric_songs;
create policy "team_insert_lyric_songs" on public.lyric_songs for insert to authenticated with check (public.is_team_member());
drop policy if exists "team_update_lyric_songs" on public.lyric_songs;
create policy "team_update_lyric_songs" on public.lyric_songs for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists "team_delete_lyric_songs" on public.lyric_songs;
create policy "team_delete_lyric_songs" on public.lyric_songs for delete to authenticated using (public.is_team_member());

-- lyric_song_members
drop policy if exists "team_read_lyric_song_members" on public.lyric_song_members;
create policy "team_read_lyric_song_members" on public.lyric_song_members for select to authenticated using (public.is_team_member());
drop policy if exists "team_insert_lyric_song_members" on public.lyric_song_members;
create policy "team_insert_lyric_song_members" on public.lyric_song_members for insert to authenticated with check (public.is_team_member());
drop policy if exists "team_update_lyric_song_members" on public.lyric_song_members;
create policy "team_update_lyric_song_members" on public.lyric_song_members for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists "team_delete_lyric_song_members" on public.lyric_song_members;
create policy "team_delete_lyric_song_members" on public.lyric_song_members for delete to authenticated using (public.is_team_member());

-- lyric_song_lines
drop policy if exists "team_read_lyric_song_lines" on public.lyric_song_lines;
create policy "team_read_lyric_song_lines" on public.lyric_song_lines for select to authenticated using (public.is_team_member());
drop policy if exists "team_insert_lyric_song_lines" on public.lyric_song_lines;
create policy "team_insert_lyric_song_lines" on public.lyric_song_lines for insert to authenticated with check (public.is_team_member());
drop policy if exists "team_update_lyric_song_lines" on public.lyric_song_lines;
create policy "team_update_lyric_song_lines" on public.lyric_song_lines for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists "team_delete_lyric_song_lines" on public.lyric_song_lines;
create policy "team_delete_lyric_song_lines" on public.lyric_song_lines for delete to authenticated using (public.is_team_member());

-- lyric_line_members
drop policy if exists "team_read_lyric_line_members" on public.lyric_line_members;
create policy "team_read_lyric_line_members" on public.lyric_line_members for select to authenticated using (public.is_team_member());
drop policy if exists "team_insert_lyric_line_members" on public.lyric_line_members;
create policy "team_insert_lyric_line_members" on public.lyric_line_members for insert to authenticated with check (public.is_team_member());
drop policy if exists "team_update_lyric_line_members" on public.lyric_line_members;
create policy "team_update_lyric_line_members" on public.lyric_line_members for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists "team_delete_lyric_line_members" on public.lyric_line_members;
create policy "team_delete_lyric_line_members" on public.lyric_line_members for delete to authenticated using (public.is_team_member());

revoke all on public.lyric_songs, public.lyric_song_members, public.lyric_song_lines, public.lyric_line_members from anon;
grant select, insert, update, delete on public.lyric_songs, public.lyric_song_members, public.lyric_song_lines, public.lyric_line_members to authenticated;

-- Private Storage cho cover và audio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lyric-song-covers','lyric-song-covers',false,10485760,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/png','image/jpeg','image/webp'];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lyric-song-audio','lyric-song-audio',false,52428800,array['audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/x-m4a','audio/aac','audio/flac','audio/x-flac','audio/webm'])
on conflict (id) do update set public=false,file_size_limit=52428800,allowed_mime_types=array['audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4','audio/x-m4a','audio/aac','audio/flac','audio/x-flac','audio/webm'];

-- Xóa policy cũ nếu chạy lại.
do $$
declare p text;
begin
  foreach p in array array[
    'team_read_lyric_covers','team_upload_lyric_covers','team_update_lyric_covers','team_delete_lyric_covers',
    'team_read_lyric_audio','team_upload_lyric_audio','team_update_lyric_audio','team_delete_lyric_audio'
  ] loop execute format('drop policy if exists %I on storage.objects', p); end loop;
end $$;

create policy "team_read_lyric_covers" on storage.objects for select to authenticated using (bucket_id='lyric-song-covers' and public.is_team_member());
create policy "team_upload_lyric_covers" on storage.objects for insert to authenticated with check (bucket_id='lyric-song-covers' and public.is_team_member());
create policy "team_update_lyric_covers" on storage.objects for update to authenticated using (bucket_id='lyric-song-covers' and public.is_team_member()) with check (bucket_id='lyric-song-covers' and public.is_team_member());
create policy "team_delete_lyric_covers" on storage.objects for delete to authenticated using (bucket_id='lyric-song-covers' and public.is_team_member());
create policy "team_read_lyric_audio" on storage.objects for select to authenticated using (bucket_id='lyric-song-audio' and public.is_team_member());
create policy "team_upload_lyric_audio" on storage.objects for insert to authenticated with check (bucket_id='lyric-song-audio' and public.is_team_member());
create policy "team_update_lyric_audio" on storage.objects for update to authenticated using (bucket_id='lyric-song-audio' and public.is_team_member()) with check (bucket_id='lyric-song-audio' and public.is_team_member());
create policy "team_delete_lyric_audio" on storage.objects for delete to authenticated using (bucket_id='lyric-song-audio' and public.is_team_member());

-- Realtime, idempotent.
do $$
declare t text;
begin
  foreach t in array array['lyric_songs','lyric_song_members','lyric_song_lines','lyric_line_members'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

select 'REALYZE Lines migration ready' as result;
