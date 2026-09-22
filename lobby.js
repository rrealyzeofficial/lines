(async () => {
  const { $, db, requireMember, mountTopbar, signedUrl, escapeHtml } = RLZ;
  try {
    const session = await requireMember(); await mountTopbar(session);
    const { data: songs, error } = await db.from('lyric_songs').select('id,title,cover_path,status,created_at').order('created_at', { ascending:false }).limit(3);
    if (error) throw error;
    const host = $('#recentSongs');
    if (!songs?.length) { host.innerHTML = '<div class="empty-inline">No projects yet.</div>'; return; }
    const cards = await Promise.all(songs.map(async song => ({ ...song, coverUrl: await signedUrl('lyric-song-covers', song.cover_path) })));
    host.innerHTML = cards.map(song => `<a class="song-card" href="${song.status === 'completed' ? 'song' : 'distribute'}.html?id=${song.id}"><div class="song-card-cover" style="${song.coverUrl ? `background-image:url('${song.coverUrl}')` : ''}"><span class="status-pill ${song.status === 'completed' ? 'done' : 'draft'}">${song.status === 'completed' ? 'Đã chia xong' : 'Đang chia'}</span></div><div class="song-card-body"><h3>${escapeHtml(song.title)}</h3><span>Open →</span></div></a>`).join('');
  } catch (err) { console.error(err); }
})();
