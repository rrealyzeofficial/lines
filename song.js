(async () => {
  const { $, db, requireMember, getMembers, signedUrl, songIdFromUrl, escapeHtml, toast } = RLZ;
  const songId = songIdFromUrl();
  if (!songId) { location.replace('playlist.html'); return; }

  let song;
  let members = [];
  let lines = [];
  let assignments = new Map();
  let filter = 'all';

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
      .select('id,line_number,lyric_text,is_all')
      .eq('song_id', songId)
      .order('line_number');
    if (lr.error) throw lr.error;
    lines = lr.data || [];
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
    $('#viewMembers').innerHTML = members.map(m => `<span class="legend-chip"><i style="background:${m.displayColor}"></i>${escapeHtml(m.name)}</span>`).join('');

    const cover = await signedUrl('lyric-song-covers', song.cover_path, 7200);
    if (cover) {
      $('#songCoverLarge').style.backgroundImage = `url('${cover}')`;
      $('#songBackdrop').style.backgroundImage = `url('${cover}')`;
    }

    const audio = await signedUrl('lyric-song-audio', song.audio_path, 7200);
    if (audio) $('#viewAudio').src = audio;
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

    const flush = () => {
      if (!run) return;
      html += `<div class="lyric-run"><span class="part-label">「 ${run.names} 」</span><span class="run-text">${escapeHtml(run.texts[0])}</span>${run.texts.slice(1).map(text => `<span class="part-label-placeholder"></span><span class="run-text">${escapeHtml(text)}</span>`).join('')}</div>`;
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
        run = { key: part.key, names: part.names, texts: [line.lyric_text] };
      } else {
        run.texts.push(line.lyric_text);
      }
    });

    flush();
    return html;
  }

  function renderLyrics() {
    const visible = getFilteredLines();
    $('#finalLyrics').innerHTML = groupedLyricsHtml(visible) || '<div class="empty-inline">Member này chưa có line riêng.</div>';
  }
})();
