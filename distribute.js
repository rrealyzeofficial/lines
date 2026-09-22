(async () => {
  const { $, db, requireMember, getMembers, signedUrl, songIdFromUrl, escapeHtml, toast } = RLZ;
  const songId = songIdFromUrl();
  if (!songId) { location.replace('playlist.html'); return; }

  let song;
  let members = [];
  let lines = [];
  let assignments = new Map();
  let dirty = false;
  let savedSnapshot = null;

  const isBlank = line => !String(line?.lyric_text || '').trim();

  function parseLyrics(value) {
    const rows = String(value || '').replace(/\r\n?/g, '\n').split('\n').map(x => x.trim());
    while (rows.length && rows[0] === '') rows.shift();
    while (rows.length && rows[rows.length - 1] === '') rows.pop();
    return rows;
  }

  function cloneAssignments(source = assignments) {
    const copy = new Map();
    source.forEach((set, id) => copy.set(id, new Set(set || [])));
    return copy;
  }

  function makeSnapshot() {
    return {
      lines: lines.map(l => ({ ...l })),
      assignments: cloneAssignments()
    };
  }

  try {
    await requireMember();
    await load();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Không thể tải project.', 'error');
  }

  async function load() {
    const songRes = await db.from('lyric_songs').select('*').eq('id', songId).single();
    if (songRes.error) throw songRes.error;
    song = songRes.data;

    const smRes = await db.from('lyric_song_members').select('member_slug').eq('song_id', songId);
    if (smRes.error) throw smRes.error;

    const all = await getMembers();
    const selected = new Set((smRes.data || []).map(x => x.member_slug));
    members = all.filter(m => selected.has(m.slug));

    const linesRes = await db.from('lyric_song_lines')
      .select('id,song_id,line_number,lyric_text,is_all')
      .eq('song_id', songId)
      .order('line_number');
    if (linesRes.error) throw linesRes.error;
    lines = linesRes.data || [];

    const ids = lines.map(l => l.id);
    let links = [];
    if (ids.length) {
      const lr = await db.from('lyric_line_members').select('line_id,member_slug').in('line_id', ids);
      if (lr.error) throw lr.error;
      links = lr.data || [];
    }

    lines.forEach(l => assignments.set(l.id, new Set()));
    links.forEach(x => assignments.get(x.line_id)?.add(x.member_slug));
    lines.forEach(l => {
      if (isBlank(l)) {
        l.is_all = false;
        assignments.get(l.id)?.clear();
      }
    });

    savedSnapshot = makeSnapshot();
    await renderSong();
    syncLyricsEditor();
    renderTable();
    renderStats();
    setDirty(false);
  }

  async function renderSong() {
    $('#songTitle').textContent = song.title;
    $('#songTitleHead').textContent = song.title;
    $('#previewTitle').textContent = song.title;

    const status = $('#songStatusPill');
    status.textContent = song.status === 'completed' ? 'Đã hoàn tất' : 'Đang chia';
    status.className = `status-pill ${song.status === 'completed' ? 'done' : 'draft'}`;

    $('#memberLegend').innerHTML = members.map(m => `<span class="legend-chip"><i style="background:${m.displayColor}"></i>${escapeHtml(m.name)}</span>`).join('');

    const cover = await signedUrl('lyric-song-covers', song.cover_path);
    if (cover) $('#coverThumb').style.backgroundImage = `url('${cover}')`;

    const audio = await signedUrl('lyric-song-audio', song.audio_path, 7200);
    if (audio) $('#songAudioPlayer').src = audio;
  }

  function syncLyricsEditor() {
    const editor = $('#lyricsEditor');
    if (!editor) return;
    editor.value = lines.map(l => l.lyric_text || '').join('\n');
    updateLyricsEditorCount();
  }

  function updateLyricsEditorCount() {
    const editor = $('#lyricsEditor');
    const count = $('#lyricsEditorCount');
    if (!editor || !count) return;
    const rows = parseLyrics(editor.value);
    const lyricCount = rows.filter(Boolean).length;
    const blankCount = rows.length - lyricCount;
    count.textContent = blankCount ? `${lyricCount} câu · ${blankCount} cách dòng` : `${lyricCount} câu`;
  }

  function renderTable() {
    $('#lineTableHead').innerHTML = `<tr><th class="col-no">#</th><th class="col-lyrics">Lyrics</th>${members.map(m => `<th class="member-col"><span class="header-dot" style="background:${m.displayColor}"></span>${escapeHtml(m.name)}</th>`).join('')}<th class="member-col all-col">All</th></tr>`;

    $('#lineTableBody').innerHTML = lines.map(l => {
      if (isBlank(l)) {
        return `<tr class="blank-line-row" data-line-id="${l.id}"><td class="line-no">··</td><td class="line-text"><span class="blank-line-label">↳ Cách dòng</span></td><td class="blank-line-fill" colspan="${members.length + 1}"></td></tr>`;
      }

      return `<tr data-line-id="${l.id}">
        <td class="line-no">${String(l.line_number).padStart(2, '0')}</td>
        <td class="line-text"><input class="line-text-input" data-line-text value="${escapeHtml(l.lyric_text)}" aria-label="Sửa lời dòng ${l.line_number}"></td>
        ${members.map(m => `<td class="check-cell"><button class="assign-box ${assignments.get(l.id)?.has(m.slug) ? 'checked' : ''}" data-member="${m.slug}" style="--member-color:${m.displayColor}" aria-label="${escapeHtml(m.name)}"></button></td>`).join('')}
        <td class="check-cell"><button class="assign-box all-box ${l.is_all ? 'checked' : ''}" data-all aria-label="All"></button></td>
      </tr>`;
    }).join('');
  }

  $('#lineTableBody').addEventListener('click', e => {
    const btn = e.target.closest('.assign-box');
    if (!btn) return;

    const row = btn.closest('tr');
    const line = lines.find(x => x.id === row?.dataset.lineId);
    if (!line || isBlank(line)) return;

    const set = assignments.get(line.id);
    if (btn.hasAttribute('data-all')) {
      line.is_all = !line.is_all;
      if (line.is_all) set.clear();
    } else {
      const slug = btn.dataset.member;
      if (line.is_all) line.is_all = false;
      set.has(slug) ? set.delete(slug) : set.add(slug);
    }

    setDirty(true);
    renderTable();
    renderStats();
  });

  $('#lineTableBody').addEventListener('input', e => {
    const input = e.target.closest('[data-line-text]');
    if (!input) return;
    const row = input.closest('tr');
    const line = lines.find(x => x.id === row?.dataset.lineId);
    if (!line) return;
    line.lyric_text = input.value;
    setDirty(true);
    syncLyricsEditor();
  });

  function renderStats() {
    const counts = new Map(members.map(m => [m.slug, 0]));
    let allCount = 0;

    lines.forEach(l => {
      if (isBlank(l)) return;
      if (l.is_all) {
        allCount++;
        members.forEach(m => counts.set(m.slug, (counts.get(m.slug) || 0) + 1));
      } else {
        assignments.get(l.id)?.forEach(s => counts.set(s, (counts.get(s) || 0) + 1));
      }
    });

    const max = Math.max(1, ...counts.values(), allCount);
    $('#lineStats').innerHTML = members.map(m => {
      const c = counts.get(m.slug) || 0;
      return `<div class="stat-item"><div class="stat-top"><b style="color:${m.displayColor}">${escapeHtml(m.name)}</b><span>${c} lines</span></div><div class="stat-bar"><i style="width:${(c / max) * 100}%;background:${m.displayColor}"></i></div></div>`;
    }).join('') + `<div class="stat-item"><div class="stat-top"><b>All</b><span>${allCount} lines</span></div><div class="stat-bar"><i style="width:${(allCount / max) * 100}%"></i></div></div>`;
  }

  function setDirty(value) {
    dirty = value;
    const el = $('#saveState');
    el.textContent = value ? 'Chưa lưu' : 'Đã lưu';
    el.classList.toggle('dirty', value);
  }

  function copyLineState(oldLine, text, index) {
    const blank = !text.trim();
    const id = oldLine?.id || crypto.randomUUID();
    const next = {
      id,
      song_id: songId,
      line_number: index + 1,
      lyric_text: text,
      is_all: blank ? false : !!oldLine?.is_all
    };
    const set = blank ? new Set() : new Set(assignments.get(oldLine?.id) || []);
    return { line: next, set };
  }

  function reconcileLyrics(newTexts) {
    const oldLines = lines;
    const n = oldLines.length;
    const m = newTexts.length;

    // LCS giúp giữ đúng assignment khi chèn/xóa line ở giữa bài.
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = oldLines[i].lyric_text === newTexts[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }

    const mappedOldByNew = new Map();
    const usedOld = new Set();
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (oldLines[i].lyric_text === newTexts[j]) {
        mappedOldByNew.set(j, i);
        usedOld.add(i);
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }

    // Nếu chỉ sửa chữ của một câu ở đúng vị trí, vẫn giữ assignment của câu đó.
    for (let newIndex = 0; newIndex < m; newIndex++) {
      if (mappedOldByNew.has(newIndex)) continue;
      const candidate = oldLines[newIndex];
      if (!candidate || usedOld.has(newIndex)) continue;
      const sameKind = isBlank(candidate) === !newTexts[newIndex].trim();
      if (!sameKind) continue;
      mappedOldByNew.set(newIndex, newIndex);
      usedOld.add(newIndex);
    }

    const nextLines = [];
    const nextAssignments = new Map();

    newTexts.forEach((text, index) => {
      const oldIndex = mappedOldByNew.get(index);
      const oldLine = oldIndex === undefined ? null : oldLines[oldIndex];
      const copied = copyLineState(oldLine, text, index);
      nextLines.push(copied.line);
      nextAssignments.set(copied.line.id, copied.set);
    });

    lines = nextLines;
    assignments = nextAssignments;
  }

  async function restoreSnapshot(snapshot) {
    if (!snapshot) return;
    const rows = snapshot.lines.map((l, i) => ({
      id: l.id,
      song_id: songId,
      line_number: i + 1,
      lyric_text: l.lyric_text,
      is_all: !!l.is_all
    }));

    await db.from('lyric_song_lines').delete().eq('song_id', songId);
    if (rows.length) await db.from('lyric_song_lines').insert(rows);

    const links = [];
    snapshot.lines.forEach(l => {
      if (l.is_all || isBlank(l)) return;
      snapshot.assignments.get(l.id)?.forEach(member_slug => links.push({ line_id: l.id, member_slug }));
    });
    if (links.length) await db.from('lyric_line_members').insert(links);
  }

  async function save() {
    $('#saveBtn').disabled = true;
    $('#saveState').textContent = 'Đang lưu...';

    const beforeSave = savedSnapshot;
    try {
      lines.forEach((l, i) => {
        l.song_id = songId;
        l.line_number = i + 1;
        l.lyric_text = String(l.lyric_text || '').trim();
        if (isBlank(l)) {
          l.is_all = false;
          assignments.get(l.id)?.clear();
        }
      });

      // Thay toàn bộ danh sách line để việc chèn/xóa/cách dòng ở giữa không vướng unique line_number.
      const del = await db.from('lyric_song_lines').delete().eq('song_id', songId);
      if (del.error) throw del.error;

      if (lines.length) {
        const insLines = await db.from('lyric_song_lines').insert(lines.map(l => ({
          id: l.id,
          song_id: songId,
          line_number: l.line_number,
          lyric_text: l.lyric_text,
          is_all: l.is_all
        })));
        if (insLines.error) throw insLines.error;
      }

      const inserts = [];
      lines.forEach(l => {
        if (l.is_all || isBlank(l)) return;
        assignments.get(l.id)?.forEach(member_slug => inserts.push({ line_id: l.id, member_slug }));
      });
      if (inserts.length) {
        const ins = await db.from('lyric_line_members').insert(inserts);
        if (ins.error) throw ins.error;
      }

      const touch = await db.from('lyric_songs').update({ updated_at: new Date().toISOString() }).eq('id', songId);
      if (touch.error) throw touch.error;

      savedSnapshot = makeSnapshot();
      setDirty(false);
      renderTable();
      syncLyricsEditor();
      toast('Đã lưu chia lời.', 'success');
    } catch (err) {
      console.error(err);
      $('#saveState').textContent = 'Lưu lỗi';
      try { await restoreSnapshot(beforeSave); } catch (restoreErr) { console.error('Restore failed', restoreErr); }
      toast(err.message || 'Không thể lưu.', 'error');
      throw err;
    } finally {
      $('#saveBtn').disabled = false;
    }
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

  function previewHtml() {
    return groupedLyricsHtml(lines) || '<div class="empty-inline">Chưa có lời bài hát.</div>';
  }

  function openPreview() {
    $('#previewLyrics').innerHTML = previewHtml();
    $('#previewModal').classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closePreview() {
    $('#previewModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  $('#toggleLyricsEditor').onclick = () => {
    syncLyricsEditor();
    $('#lyricsEditorPanel').classList.toggle('hidden');
    if (!$('#lyricsEditorPanel').classList.contains('hidden')) $('#lyricsEditor').focus();
  };

  $('#lyricsEditor').addEventListener('input', updateLyricsEditorCount);

  $('#cancelLyricsEdit').onclick = () => {
    syncLyricsEditor();
    $('#lyricsEditorPanel').classList.add('hidden');
  };

  $('#applyLyricsEdit').onclick = () => {
    const newTexts = parseLyrics($('#lyricsEditor').value);
    if (!newTexts.some(Boolean)) {
      toast('Lyrics cần có ít nhất một câu.', 'error');
      return;
    }

    reconcileLyrics(newTexts);
    renderTable();
    renderStats();
    syncLyricsEditor();
    setDirty(true);
    $('#lyricsEditorPanel').classList.add('hidden');
    toast('Đã cập nhật lời. Bấm Lưu để ghi lên Supabase.', 'success');
  };

  $('#saveBtn').onclick = save;
  $('#previewBtn').onclick = openPreview;
  document.addEventListener('click', e => { if (e.target.matches('[data-close-preview]')) closePreview(); });

  $('#finishBtn').onclick = async () => {
    try {
      if (dirty) await save();
      const res = await db.from('lyric_songs').update({ status: 'completed' }).eq('id', songId);
      if (res.error) throw res.error;
      location.href = `song.html?id=${songId}`;
    } catch (err) {
      console.error(err);
    }
  };

  addEventListener('beforeunload', e => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();
