-- REALYZE Lines — safe audio versioning + distribution style
-- Run on the SAME Supabase project after the existing line timing/adlib migrations.
-- Safe to run again.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.lyric_songs') is null
     or to_regclass('public.lyric_song_lines') is null
     or to_regclass('public.lyric_adlibs') is null then
    raise exception 'REALYZE Lines timing/adlib tables are missing. Run the previous migrations first.';
  end if;
end $$;

alter table public.lyric_songs
  add column if not exists distribution_style text default 'classic',
  add column if not exists distribution_style_chosen boolean not null default false,
  add column if not exists current_audio_version_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='lyric_songs_distribution_style_check') then
    alter table public.lyric_songs
      add constraint lyric_songs_distribution_style_check
      check (distribution_style in ('classic','chat'));
  end if;
end $$;

create table if not exists public.lyric_audio_versions (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.lyric_songs(id) on delete cascade,
  label text not null default 'Original',
  audio_path text not null,
  duration_seconds numeric,
  timing_snapshot jsonb not null default '{}'::jsonb,
  adlib_snapshot jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lyric_audio_versions
  add column if not exists timing_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists adlib_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname='lyric_songs_current_audio_version_fk') then
    alter table public.lyric_songs
      add constraint lyric_songs_current_audio_version_fk
      foreign key (current_audio_version_id)
      references public.lyric_audio_versions(id)
      on delete set null;
  end if;
end $$;

create or replace function public.lyric_audio_version_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lyric_audio_versions_updated_at on public.lyric_audio_versions;
create trigger trg_lyric_audio_versions_updated_at
before update on public.lyric_audio_versions
for each row execute function public.lyric_audio_version_touch_updated_at();

alter table public.lyric_audio_versions enable row level security;

drop policy if exists "team_read_lyric_audio_versions" on public.lyric_audio_versions;
create policy "team_read_lyric_audio_versions"
on public.lyric_audio_versions for select to authenticated
using (public.is_team_member());

drop policy if exists "team_insert_lyric_audio_versions" on public.lyric_audio_versions;
create policy "team_insert_lyric_audio_versions"
on public.lyric_audio_versions for insert to authenticated
with check (public.is_team_member());

drop policy if exists "team_update_lyric_audio_versions" on public.lyric_audio_versions;
create policy "team_update_lyric_audio_versions"
on public.lyric_audio_versions for update to authenticated
using (public.is_team_member())
with check (public.is_team_member());

drop policy if exists "team_delete_lyric_audio_versions" on public.lyric_audio_versions;
create policy "team_delete_lyric_audio_versions"
on public.lyric_audio_versions for delete to authenticated
using (public.is_team_member());

grant select, insert, update, delete on public.lyric_audio_versions to authenticated;

-- Seed one audio version for every existing song that does not have one yet.
do $$
declare
  s record;
  v_id uuid;
  v_timing jsonb;
  v_adlibs jsonb;
begin
  for s in select * from public.lyric_songs loop
    select coalesce(
      jsonb_object_agg(
        l.id::text,
        jsonb_build_object('start_ms', l.start_ms, 'end_ms', l.end_ms)
      ),
      '{}'::jsonb
    )
    into v_timing
    from public.lyric_song_lines l
    where l.song_id = s.id;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'label', a.label,
          'show_text', a.show_text,
          'member_slugs', a.member_slugs,
          'start_ms', a.start_ms,
          'end_ms', a.end_ms
        ) order by a.created_at
      ),
      '[]'::jsonb
    )
    into v_adlibs
    from public.lyric_adlibs a
    where a.song_id = s.id;

    if s.current_audio_version_id is null then
      select id into v_id
      from public.lyric_audio_versions
      where song_id = s.id and audio_path = s.audio_path
      order by created_at
      limit 1;

      if v_id is null and s.audio_path is not null and s.audio_path <> '' then
        insert into public.lyric_audio_versions(
          song_id, label, audio_path, timing_snapshot, adlib_snapshot, created_by
        ) values (
          s.id, 'Original', s.audio_path, v_timing, v_adlibs, s.created_by
        ) returning id into v_id;
      end if;

      if v_id is not null then
        update public.lyric_songs
        set current_audio_version_id = v_id
        where id = s.id;
      end if;
    else
      update public.lyric_audio_versions
      set timing_snapshot = case
            when timing_snapshot is null or timing_snapshot = '{}'::jsonb then v_timing
            else timing_snapshot
          end,
          adlib_snapshot = case
            when adlib_snapshot is null or adlib_snapshot = '[]'::jsonb then v_adlibs
            else adlib_snapshot
          end
      where id = s.current_audio_version_id;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

select
  to_regclass('public.lyric_audio_versions') as lyric_audio_versions,
  exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='lyric_songs' and column_name='distribution_style_chosen'
  ) as has_style_choice;
