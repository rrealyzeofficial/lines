-- ============================================================
-- REALYZE LINES — LINE TIMING
-- Chạy MỘT LẦN trên đúng database Team Space / REALYZE Lines.
-- Có thể chạy lại an toàn.
-- ============================================================

do $$
begin
  if to_regclass('public.lyric_song_lines') is null then
    raise exception 'Không tìm thấy public.lyric_song_lines. Hãy chạy SQL REALYZE Lines trước.';
  end if;
end $$;

alter table public.lyric_song_lines
  add column if not exists start_ms integer,
  add column if not exists end_ms integer,
  add column if not exists timing_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lyric_song_lines_start_ms_check'
  ) then
    alter table public.lyric_song_lines
      add constraint lyric_song_lines_start_ms_check
      check (start_ms is null or start_ms >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lyric_song_lines_end_ms_check'
  ) then
    alter table public.lyric_song_lines
      add constraint lyric_song_lines_end_ms_check
      check (end_ms is null or end_ms >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lyric_song_lines_time_order_check'
  ) then
    alter table public.lyric_song_lines
      add constraint lyric_song_lines_time_order_check
      check (start_ms is null or end_ms is null or end_ms > start_ms);
  end if;
end $$;

create index if not exists lyric_song_lines_timing_idx
  on public.lyric_song_lines(song_id, start_ms)
  where start_ms is not null;

grant select, insert, update, delete on public.lyric_song_lines to authenticated;

notify pgrst, 'reload schema';

select id, song_id, line_number, lyric_text, start_ms, end_ms
from public.lyric_song_lines
order by song_id, line_number
limit 10;
