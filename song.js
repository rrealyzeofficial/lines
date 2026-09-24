(async () => {
  const { $, db, requireMember, getMembers, signedUrl, songIdFromUrl, escapeHtml, toast } = RLZ;
  const songId = songIdFromUrl();
  if (!songId) { location.replace('playlist.html'); return; }

  let song;
  let members = [];
  let lines = [];
  let assignments = new Map();
  let filter = 'all';
  let lastActiveId = null;

  const audio = $('#viewAudio');
  const isBlank = line => !String(line?.lyric_text || '').trim();

  try {
    await requireMember();
    await load();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Không thể tải bài.', 'error');
  }

  async function load() {
    const sr = await db.from('lyric_songs').select('*').eq('id', songId).single();
    if (sr.error) throw sr.error;
    song = sr.data;

    const sm = await db.from('lyric_song_members').select('member_slug').eq('song_id', songId);
    if (sm.error) throw sm.error;

    const roster = await getMembers();
    const sel = new Set((sm.data || []).map(x => x.member_slug));
    members = roster.filter(m => sel.has(m.slug));

    const lr = await db.from('lyric_song_lines')
      .select('id,line_number,lyric_text,is_all,start_ms,end_ms')
      .eq('song_id', songId)
      .order('line_number');
    if (lr.error) throw lr.error;
    lines = (lr.data || []).map(l => ({
      ...l,
      start_ms: l.start_ms == null ? null : Number(l.start_ms),
      end_ms: l.end_ms == null ? null : Number(l.end_ms)
    }));
    lines.forEach(l => assignments.set(l.id, new Set()));

    const ids = lines.map(l => l.id);
    if (ids.length) {
      const ar = await db.from('lyric_line_members').select('line_id,member_slug').in('line_id', ids);
      if (ar.error) throw ar.error;
      (ar.data || []).forEach(x => assignments.get(x.line_id)?.add(x.member_slug));
    }

    await renderHead();
    renderFilters();
    renderLyrics();
  }

  async function renderHead() {
    document.title = `${song.title} — REALYZE Lines`;
    $('#viewSongTitle').textContent = song.title;
    $('#editSongBtn').onclick = () => location.href = `distribute.html?id=${songId}`;
    $('#timingSongBtn').href = `timing.html?id=${songId}`;
    $('#viewMembers').innerHTML = members.map(m => `<span class="legend-chip"><i style="background:${m.displayColor}"></i>${escapeHtml(m.name)}</span>`).join('');

    const cover = await signedUrl('lyric-song-covers', song.cover_path, 7200);
    if (cover) {
      $('#songCoverLarge').style.backgroundImage = `url('${cover}')`;
      $('#songBackdrop').style.backgroundImage = `url('${cover}')`;
    }

    const audioUrl = await signedUrl('lyric-song-audio', song.audio_path, 7200);
    if (audioUrl) audio.src = audioUrl;
  }

  function renderFilters() {
    $('#partFilters').innerHTML = `<button class="part-filter active" data-filter="all">All lines</button>${members.map(m => `<button class="part-filter" data-filter="${m.slug}" style="--member-color:${m.displayColor}">${escapeHtml(m.name)}</button>`).join('')}`;
    $('#partFilters').onclick = e => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      filter = b.dataset.filter;
      document.querySelectorAll('.part-filter').forEach(x => x.classList.toggle('active', x === b));
      renderLyrics();
    };
  }

  function isVisibleForFilter(line) {
    return filter === 'all' || line.is_all || assignments.get(line.id)?.has(filter);
  }

  function getFilteredLines() {
    if (filter === 'all') return lines;

    const out = [];
    let pendingBlanks = [];
    let hasVisibleBefore = false;

    lines.forEach(line => {
      if (isBlank(line)) {
        if (hasVisibleBefore) pendingBlanks.push(line);
        return;
      }

      if (isVisibleForFilter(line)) {
        if (pendingBlanks.length) out.push(...pendingBlanks);
        pendingBlanks = [];
        out.push(line);
        hasVisibleBefore = true;
      } else {
        pendingBlanks = [];
      }
    });

    return out;
  }

  function partInfo(line) {
    if (line.is_all) {
      return { key: 'all', names: '<span class="all-name">All</span>' };
    }

    const selected = members.filter(m => assignments.get(line.id)?.has(m.slug));
    if (!selected.length) {
      return { key: 'unassigned', names: '<span class="unassigned">Unassigned</span>' };
    }

    return {
      key: `members:${selected.map(m => m.slug).join('|')}`,
      names: selected.map(m => `<span style="color:${m.displayColor}">${escapeHtml(m.name)}</span>`).join('<span class="name-dot">・</span>')
    };
  }

  function groupedLyricsHtml(sourceLines) {
    let html = '';
    let run = null;

    const lineHtml = (line, first) => `${first ? '' : '<span class="part-label-placeholder"></span>'}<span class="run-text timed-lyric-line" data-line-id="${line.id}">${escapeHtml(line.lyric_text)}</span>`;

    const flush = () => {
      if (!run) return;
      html += `<div class="lyric-run"><span class="part-label">「 ${run.names} 」</span>${lineHtml(run.lines[0], true)}${run.lines.slice(1).map(line => lineHtml(line, false)).join('')}</div>`;
      run = null;
    };

    sourceLines.forEach(line => {
      if (isBlank(line)) {
        flush();
        html += '<div class="lyric-blank-space" aria-hidden="true"></div>';
        return;
      }

      const part = partInfo(line);
      if (!run || run.key !== part.key) {
        flush();
        run = { key: part.key, names: part.names, lines: [line] };
      } else {
        run.lines.push(line);
      }
    });

    flush();
    return html;
  }

  function renderLyrics() {
    const visible = getFilteredLines();
    $('#finalLyrics').innerHTML = groupedLyricsHtml(visible) || '<div class="empty-inline">Member này chưa có line riêng.</div>';
    lastActiveId = null;
    syncTimedLyrics(false);
  }

  function effectiveEnd(line) {
    if (line.end_ms != null) return line.end_ms;
    const ordered = lines.filter(l => !isBlank(l) && l.start_ms != null).sort((a, b) => a.start_ms - b.start_ms);
    const idx = ordered.findIndex(l => l.id === line.id);
    if (idx >= 0 && ordered[idx + 1]) return ordered[idx + 1].start_ms;
    if (Number.isFinite(audio.duration)) return Math.round(audio.duration * 1000);
    return line.start_ms + 5000;
  }

  function activeLineAt(ms) {
    const eligible = lines.filter(l => !isBlank(l) && l.start_ms != null && l.start_ms <= ms).sort((a, b) => a.start_ms - b.start_ms);
    for (let i = eligible.length - 1; i >= 0; i--) {
      if (ms < effectiveEnd(eligible[i])) return eligible[i];
    }
    return null;
  }

  function syncTimedLyrics(shouldScroll = true) {
    const current = activeLineAt(Math.round((audio.currentTime || 0) * 1000));
    document.querySelectorAll('.timed-lyric-line.is-playing').forEach(el => el.classList.remove('is-playing'));
    if (!current) {
      lastActiveId = null;
      return;
    }
    const el = document.querySelector(`.timed-lyric-line[data-line-id="${current.id}"]`);
    if (!el) return;
    el.classList.add('is-playing');
    if (shouldScroll && !audio.paused && lastActiveId !== current.id) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    lastActiveId = current.id;
  }

  let playbackFrame = 0;
  function runPlaybackFrame() {
    syncTimedLyrics(true);
    if (!audio.paused && !audio.ended) playbackFrame = requestAnimationFrame(runPlaybackFrame);
  }
  audio.addEventListener('timeupdate', () => syncTimedLyrics(true));
  audio.addEventListener('seeked', () => syncTimedLyrics(false));
  audio.addEventListener('play', () => { cancelAnimationFrame(playbackFrame); runPlaybackFrame(); });
  audio.addEventListener('pause', () => cancelAnimationFrame(playbackFrame));
  audio.addEventListener('ended', () => cancelAnimationFrame(playbackFrame));
  audio.addEventListener('loadedmetadata', () => syncTimedLyrics(false));
})();
