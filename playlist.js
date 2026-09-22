(async () => {
  const { $, $$, db, requireMember, mountTopbar, getMembers, signedUrl, escapeHtml, toast, safeFileName } = RLZ;
  let session = null;
  let members = [];

  const modal = $('#createModal');
  const createForm = $('#createSongForm');
  const errBox = $('#createError');

  function parseLyrics(value) {
    const rows = String(value || '').replace(/\r\n?/g, '\n').split('\n').map(x => x.trim());
    while (rows.length && rows[0] === '') rows.shift();
    while (rows.length && rows[rows.length - 1] === '') rows.pop();
    return rows;
  }

  function openModal() {
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  // Gắn event UI ngay lập tức, không chờ Supabase tải xong.
  $('#openCreateBtn')?.addEventListener('click', openModal);

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-create]')) {
      e.preventDefault();
      openModal();
      return;
    }

    if (e.target.closest('[data-close-modal]')) {
      e.preventDefault();
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal?.classList.contains('hidden')) closeModal();
  });

  $('#songLyrics')?.addEventListener('input', updateLineCount);
  updateLineCount();

  // Sau khi UI đã dùng được mới tải session + dữ liệu Supabase.
  try {
    session = await requireMember();
    await mountTopbar(session);
  } catch (err) {
    console.error(err);
    showCreateError(err.message || 'Không thể xác thực tài khoản REALYZE.');
    return;
  }

  try {
    members = await getMembers();
    renderMemberPicker();
  } catch (err) {
    console.error(err);
    const picker = $('#memberPicker');
    if (picker) picker.innerHTML = '<span class="form-error">Không tải được danh sách member.</span>';
    showCreateError(err.message || 'Không tải được danh sách member.');
  }

  try {
    await loadPlaylist();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Không tải được playlist.', 'error');
  }

  function showCreateError(message) {
    if (!errBox) return;
    errBox.textContent = message;
    errBox.classList.remove('hidden');
  }

  function clearCreateError() {
    if (!errBox) return;
    errBox.textContent = '';
    errBox.classList.add('hidden');
  }

  function renderMemberPicker() {
    const picker = $('#memberPicker');
    if (!picker) return;

    if (!members.length) {
      picker.innerHTML = '<span>Chưa có member khả dụng.</span>';
      return;
    }

    picker.innerHTML = members.map(m => `
      <label class="member-choice" style="--member-color:${m.displayColor}">
        <input type="checkbox" name="member" value="${escapeHtml(m.slug)}">
        <span class="choice-box"></span>
        <span>${escapeHtml(m.name)}</span>
      </label>
    `).join('');
  }

  function updateLineCount() {
    const lyricsBox = $('#songLyrics');
    const counter = $('#lineCounter');
    if (!lyricsBox || !counter) return;

    const rows = parseLyrics(lyricsBox.value);
    const lyricCount = rows.filter(Boolean).length;
    const blankCount = rows.length - lyricCount;
    counter.textContent = blankCount
      ? `${lyricCount} câu · ${blankCount} cách dòng`
      : `${lyricCount} câu`;
  }

  async function loadPlaylist() {
    if (!db) return;

    const { data: songs, error } = await db
      .from('lyric_songs')
      .select('id,title,cover_path,status,created_at,updated_at')
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const grid = $('#playlistGrid');
    if (!grid) return;

    if (!songs?.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">♫</div>
          <h3>No projects yet</h3>
          <button type="button" class="round-plus" data-open-create>＋</button>
        </div>`;
      return;
    }

    const songIds = songs.map(s => s.id);
    const { data: sm, error: memberError } = await db
      .from('lyric_song_members')
      .select('song_id,member_slug')
      .in('song_id', songIds);

    if (memberError) throw memberError;

    const counts = new Map();
    (sm || []).forEach(x => counts.set(x.song_id, (counts.get(x.song_id) || 0) + 1));

    const ready = await Promise.all(songs.map(async s => ({
      ...s,
      coverUrl: await signedUrl('lyric-song-covers', s.cover_path)
    })));

    grid.innerHTML = ready.map(song => `
      <a class="song-card" href="${song.status === 'completed' ? 'song' : 'distribute'}.html?id=${song.id}">
        <div class="song-card-cover" style="${song.coverUrl ? `background-image:url('${song.coverUrl}')` : ''}">
          <span class="status-pill ${song.status === 'completed' ? 'done' : 'draft'}">
            ${song.status === 'completed' ? 'Đã chia xong' : 'Đang chia'}
          </span>
        </div>
        <div class="song-card-body">
          <h3>${escapeHtml(song.title)}</h3>
          <div class="song-card-meta">
            <span>${counts.get(song.id) || 0} members</span>
            <span>${new Date(song.updated_at).toLocaleDateString('vi-VN')}</span>
          </div>
        </div>
      </a>
    `).join('') + `
      <button type="button" class="add-song-card" data-open-create>
        <span>＋</span>
        <b>Tạo bài mới</b>
      </button>`;
  }

  createForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearCreateError();

    if (!session || !db) {
      showCreateError('Chưa kết nối được tài khoản Supabase. Hãy tải lại trang và đăng nhập lại.');
      return;
    }

    const title = $('#songTitle').value.trim();
    // Giữ nguyên các dòng trống ở GIỮA lyrics để dùng làm khoảng cách/stanza.
    const lyrics = parseLyrics($('#songLyrics').value);

    const selected = $$('input[name="member"]:checked').map(x => x.value);
    const audio = $('#songAudio').files[0];
    const cover = $('#songCover').files[0];

    if (!title || !audio || !cover || !lyrics.some(Boolean) || !selected.length) {
      showCreateError('Hãy nhập đủ tên bài, nhạc, ảnh nền, member và lời bài hát.');
      return;
    }

    const btn = $('#createSongBtn');
    btn.disabled = true;
    btn.textContent = 'Đang tạo project...';

    const songId = crypto.randomUUID();
    let audioPath = '';
    let coverPath = '';

    try {
      const insert = await db.from('lyric_songs').insert({
        id: songId,
        title,
        created_by: session.member.slug,
        status: 'draft'
      });
      if (insert.error) throw insert.error;

      audioPath = `${songId}/${Date.now()}-${safeFileName(audio.name)}`;
      coverPath = `${songId}/${Date.now()}-${safeFileName(cover.name)}`;

      const upAudio = await db.storage
        .from('lyric-song-audio')
        .upload(audioPath, audio, { upsert: false, contentType: audio.type || undefined });
      if (upAudio.error) throw upAudio.error;

      const upCover = await db.storage
        .from('lyric-song-covers')
        .upload(coverPath, cover, { upsert: false, contentType: cover.type || undefined });
      if (upCover.error) throw upCover.error;

      const update = await db
        .from('lyric_songs')
        .update({ audio_path: audioPath, cover_path: coverPath })
        .eq('id', songId);
      if (update.error) throw update.error;

      const memberInsert = await db
        .from('lyric_song_members')
        .insert(selected.map(member_slug => ({ song_id: songId, member_slug })));
      if (memberInsert.error) throw memberInsert.error;

      const lineInsert = await db
        .from('lyric_song_lines')
        .insert(lyrics.map((lyric_text, i) => ({
          song_id: songId,
          line_number: i + 1,
          lyric_text,
          is_all: false
        })));
      if (lineInsert.error) throw lineInsert.error;

      toast('Đã tạo project.', 'success');
      location.href = `distribute.html?id=${songId}`;
    } catch (err) {
      console.error(err);

      if (audioPath) await db.storage.from('lyric-song-audio').remove([audioPath]);
      if (coverPath) await db.storage.from('lyric-song-covers').remove([coverPath]);
      await db.from('lyric_songs').delete().eq('id', songId);

      showCreateError(err.message || 'Không thể tạo project.');
      btn.disabled = false;
      btn.textContent = 'Tạo & chia lời →';
    }
  });
})();
