(async () => {
  const {
    $, db, requireMember, getMembers, signedUrl,
    songIdFromUrl, escapeHtml, toast, safeFileName
  } = RLZ;

  const songId = songIdFromUrl();
  if (!songId) {
    location.replace('playlist.html');
    return;
  }

  let song = null;
  let members = [];
  let lines = [];
  let assignments = new Map();
  let adlibs = [];
  let selectedLineId = null;
  let dirtyIds = new Set();
  let audioUrl = '';
  let coverUrl = '';
  let coverImage = null;
  let exporting = false;
  let editorOpen = false;
  let followTiming = true;
  let lastFollowLineId = null;
  let currentBoardOrder = [];
  let currentChatBoardOrder = [];
  let finalVisible = false;
  let editingAdlibId = null;
  let exportBoardMotion = null;
  let coverRenderCache = null;
  let chatCoverRenderCache = null;
  let audioVersions = [];
  let currentAudioVersionId = null;
  let lastChatSignature = '';
  let lastChatNewestGroupId = '';
  const chatMemberEls = new Map();
  let allCounts = localStorage.getItem(`rlz-line-all-counts:${songId}`) === '1';
  const FINAL_HOLD_MS = 6000;
  const LYRIC_TICK_MS = 720;
  const EXPORT_FPS = 60;
  const CHAT_TYPING_LEAD_MS = 800;
  const CHAT_LEAVE_HOLD_MS = 2200;
  const CHAT_ADLIB_FADE_MS = 360;
  const memberEls = new Map();

  const audio = $('#timingAudio');
  const rowsHost = $('#timingRows');
  const seekBar = $('#seekBar');
  const playPauseBtn = $('#playPauseBtn');
  const editorPanel = $('#timingEditorPanel');
  const editorBackdrop = $('#timingEditorBackdrop');
  const saveTimingBtn = $('#saveTimingBtn');
  const countAllToggle = $('#countAllToggle');
  const followTimingToggle = $('#followTimingToggle');
  const editorPlayPauseBtn = $('#editorPlayPauseBtn');
  const editorSeekBar = $('#editorSeekBar');
  const editorDurationClock = $('#editorDurationClock');
  const finalResults = $('#finalResults');
  const finalDonut = $('#finalDonut');
  const finalRankingRows = $('#finalRankingRows');
  const finalBalance = $('#finalBalance');
  const videoImagesDialog = $('#videoImagesDialog');
  const videoImageRows = $('#videoImageRows');
  const adlibDialog = $('#adlibDialog');
  const adlibMemberChoices = $('#adlibMemberChoices');
  const adlibText = $('#adlibText');
  const adlibShowText = $('#adlibShowText');
  const audioVersionSelect = $('#audioVersionSelect');
  const changeAudioDialog = $('#changeAudioDialog');
  const videoStyleDialog = $('#videoStyleDialog');
  const chatStage = $('#chatDistributionStage');
  const chatMemberBoard = $('#chatMemberBoard');
  const chatBubbleStream = $('#chatBubbleStream');
  const chatAdlibStream = $('#chatAdlibStream');
  const chatTypingIndicator = $('#chatTypingIndicator');
  const chatLeaveStream = $('#chatLeaveStream');
  const chatFinalResults = $('#chatFinalResults');
  const chatFinalDonut = $('#chatFinalDonut');
  const chatFinalRows = $('#chatFinalRows');
  const chatFinalBalance = $('#chatFinalBalance');

  countAllToggle.checked = allCounts;
  if (followTimingToggle) followTimingToggle.checked = followTiming;

  const isBlank = line => !String(line?.lyric_text || '').trim();
  const lyricLines = () => lines.filter(line => !isBlank(line));
  const toMs = seconds => Math.max(0, Math.round((Number(seconds) || 0) * 1000));

  function formatMs(ms) {
    if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return '--:--.---';
    const n = Math.max(0, Math.round(Number(ms)));
    const min = Math.floor(n / 60000);
    const sec = Math.floor((n % 60000) / 1000);
    const milli = n % 1000;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
  }

  function formatSeconds(ms) {
    return `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(2)}s`;
  }

  function parseTime(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '--:--.---') return null;
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000);
    const m = raw.match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!m) return NaN;
    const min = Number(m[1] || 0);
    const sec = Number(m[2] || 0);
    const milli = Number((m[3] || '').padEnd(3, '0'));
    if (sec >= 60) return NaN;
    return min * 60000 + sec * 1000 + milli;
  }

  function durationMs() {
    if (Number.isFinite(audio.duration) && audio.duration > 0) return Math.round(audio.duration * 1000);
    const starts = lyricLines().map(line => Number(line.start_ms)).filter(Number.isFinite);
    return starts.length ? Math.max(...starts) + 5000 : 0;
  }

  function markDirty(lineId) {
    dirtyIds.add(lineId);
    $('#timingState').textContent = 'Unsaved';
    $('#timingState').classList.add('dirty');
  }

  function markSaved(lineId) {
    dirtyIds.delete(lineId);
    if (!dirtyIds.size) {
      $('#timingState').textContent = 'Saved';
      $('#timingState').classList.remove('dirty');
    }
  }

  function assignedMembers(line) {
    if (!line || line.is_all) return [];
    const selected = assignments.get(line.id) || new Set();
    return members.filter(member => selected.has(member.slug));
  }

  function partInfo(line) {
    if (!line) return { text: '', html: '', segments: [] };
    if (line.is_all) {
      return {
        text: 'All',
        html: '<span class="all-name">All</span>',
        segments: [{ text: 'All', color: '#ffffff' }]
      };
    }
    const selected = assignedMembers(line);
    if (!selected.length) {
      return {
        text: 'Unassigned',
        html: '<span class="unassigned">Unassigned</span>',
        segments: [{ text: 'Unassigned', color: '#9ea4b4' }]
      };
    }
    return {
      text: selected.map(member => member.name).join('・'),
      html: selected
        .map(member => `<span style="color:${member.displayColor}">${escapeHtml(member.name)}</span>`)
        .join('<span class="name-dot">・</span>'),
      segments: selected.map(member => ({ text: member.name, color: member.displayColor }))
    };
  }

  function orderedTimedLines() {
    return lyricLines()
      .filter(line => line.start_ms !== null && line.start_ms !== undefined && Number.isFinite(Number(line.start_ms)))
      .sort((a, b) => Number(a.start_ms) - Number(b.start_ms) || Number(a.line_number) - Number(b.line_number));
  }

  function orderedTimedAdlibs() {
    return adlibs
      .filter(item => item.start_ms !== null && item.start_ms !== undefined && Number.isFinite(Number(item.start_ms)))
      .sort((a, b) => Number(a.start_ms) - Number(b.start_ms));
  }

  function orderedTimedItems() {
    return [...orderedTimedLines(), ...orderedTimedAdlibs()].sort((a, b) => {
      const timeDelta = Number(a.start_ms) - Number(b.start_ms);
      if (timeDelta) return timeDelta;
      if (a.kind !== b.kind) return a.kind === 'lyric' ? -1 : 1;
      if (a.kind === 'lyric') return Number(a.line_number || 0) - Number(b.line_number || 0);
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function effectiveEnd(item) {
    if (!item) return 0;
    if (item.end_ms !== null && item.end_ms !== undefined && Number.isFinite(Number(item.end_ms))) {
      return Math.max(Number(item.start_ms || 0), Number(item.end_ms));
    }
    if (item.kind === 'adlib') return Number(item.start_ms || 0) + 1000;
    const ordered = orderedTimedLines();
    const index = ordered.findIndex(row => row.id === item.id);
    if (index >= 0 && ordered[index + 1]) return Number(ordered[index + 1].start_ms);
    return durationMs() || Number(item.start_ms || 0) + 5000;
  }

  function activeLinesAt(ms) {
    return orderedTimedLines().filter(line => {
      const start = Number(line.start_ms);
      const end = effectiveEnd(line);
      return Number.isFinite(start) && Number.isFinite(end) && start <= ms && ms < end;
    });
  }

  function activeAdlibsAt(ms) {
    return orderedTimedAdlibs().filter(item => {
      const start = Number(item.start_ms);
      const end = effectiveEnd(item);
      return Number.isFinite(start) && Number.isFinite(end) && start <= ms && ms < end;
    });
  }

  function activeItemsAt(ms) {
    return orderedTimedItems().filter(item => {
      const start = Number(item.start_ms);
      const end = effectiveEnd(item);
      return Number.isFinite(start) && Number.isFinite(end) && start <= ms && ms < end;
    });
  }

  function activeLineAt(ms) {
    const active = activeLinesAt(ms);
    return active.at(-1) || null;
  }

  function visualLineStateAt(ms) {
    const ordered = orderedTimedLines();
    if (!ordered.length) return { prev: null, current: null, next: null, progress: 1 };
    let index = -1;
    for (let i = 0; i < ordered.length; i += 1) {
      if (Number(ordered[i].start_ms) <= ms) index = i;
      else break;
    }
    if (index < 0) return { prev: null, current: null, next: ordered[0], progress: 1 };
    const current = ordered[index];
    const prev = ordered[index - 1] || null;
    const next = ordered[index + 1] || null;
    const progress = Math.max(0, Math.min(1, (ms - Number(current.start_ms)) / LYRIC_TICK_MS));
    return { prev, current, next, progress };
  }

  function nextLineAt(ms) {
    return orderedTimedLines().find(line => Number(line.start_ms) > ms) || null;
  }

  function nextLineAfter(line) {
    const ordered = orderedTimedLines();
    if (!line) return ordered[0] || null;
    const index = ordered.findIndex(item => item.id === line.id);
    return index >= 0 ? ordered[index + 1] || null : null;
  }

  function soloMemberSlug(line) {
    if (!line || line.is_all) return null;
    const selected = assignedMembers(line);
    return selected.length === 1 ? selected[0].slug : null;
  }

  function chatGroupKey(line) {
    if (!line) return 'none';
    if (line.is_all) return 'all';
    const selected = assignedMembers(line).map(member => member.slug).sort();
    return selected.length ? `members:${selected.join('|')}` : 'unassigned';
  }

  function chatLyricGroups() {
    const groups = [];
    orderedTimedLines().forEach(line => {
      const key = chatGroupKey(line);
      const previous = groups.at(-1);
      if (previous?.key === key) {
        previous.lines.push(line);
        previous.end_ms = effectiveEnd(line);
      } else {
        groups.push({
          id: `chat-group-${line.id}`,
          key,
          lines: [line],
          start_ms: Number(line.start_ms),
          end_ms: effectiveEnd(line)
        });
      }
    });
    return groups;
  }

  function chatGroupMembers(group) {
    const first = group?.lines?.[0] || null;
    if (!first) return [];
    if (first.is_all) return members;
    return assignedMembers(first);
  }

  function chatCurrentLineInGroup(group, ms) {
    if (!group?.lines?.length) return null;
    let current = group.lines[0];
    for (const line of group.lines) {
      if (Number(line.start_ms) <= ms) current = line;
      else break;
    }
    return current;
  }

  function chatVisibleGroupsAt(ms) {
    const groups = chatLyricGroups();
    let currentIndex = -1;
    for (let i = 0; i < groups.length; i += 1) {
      if (Number(groups[i].start_ms) <= ms) currentIndex = i;
      else break;
    }
    if (currentIndex < 0) return [];
    return groups.slice(Math.max(0, currentIndex - 8), currentIndex + 1).map((group, offset, arr) => ({
      ...group,
      current: offset === arr.length - 1,
      currentLine: chatCurrentLineInGroup(group, ms)
    }));
  }

  function chatTypingAt(ms) {
    const groups = chatLyricGroups();
    const next = groups.find(group => Number(group.start_ms) > ms);
    if (!next) return null;
    const wait = Number(next.start_ms) - ms;
    if (wait <= 0 || wait > CHAT_TYPING_LEAD_MS) return null;
    const first = next.lines[0];
    const part = partInfo(first);
    if (!part.text || part.text === 'Unassigned') return null;
    return { group: next, line: first, text: `${part.text} đang nhập...`, wait };
  }

  function lastPersonalActivityByMember() {
    const result = new Map();
    orderedTimedLines().forEach(line => {
      if (line.is_all) return;
      const end = effectiveEnd(line);
      assignedMembers(line).forEach(member => {
        if (!Number.isFinite(end)) return;
        const old = result.get(member.slug);
        if (!old || end > old.end) result.set(member.slug, { member, end });
      });
    });
    orderedTimedAdlibs().forEach(item => {
      const end = effectiveEnd(item);
      (item.member_slugs || []).forEach(slug => {
        const member = members.find(row => row.slug === slug);
        if (!member || !Number.isFinite(end)) return;
        const old = result.get(slug);
        if (!old || end > old.end) result.set(slug, { member, end });
      });
    });
    return result;
  }

  function chatLeaveEventsAt(ms) {
    return [...lastPersonalActivityByMember().values()].filter(event => ms >= event.end && ms < event.end + CHAT_LEAVE_HOLD_MS);
  }

  function chatAdlibVisualsAt(ms) {
    return orderedTimedAdlibs().filter(item => item.show_text && String(item.label || '').trim()).map(item => {
      const start = Number(item.start_ms);
      const end = effectiveEnd(item);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      const lifeEnd = end + CHAT_ADLIB_FADE_MS;
      if (ms < start || ms >= lifeEnd) return null;
      const drift = Math.max(0, Math.min(1, (ms - start) / Math.max(1, lifeEnd - start)));
      const fade = ms < end ? 1 : Math.max(0, 1 - (ms - end) / CHAT_ADLIB_FADE_MS);
      const enter = Math.max(0, Math.min(1, (ms - start) / 180));
      return { item, start, end, drift, opacity: Math.min(enter, fade) };
    }).filter(Boolean);
  }

  function visualActiveSlugs(item) {
    if (!item) return new Set();
    if (item.kind === 'adlib') return new Set((item.member_slugs || []).filter(Boolean));
    if (item.is_all) return new Set(members.map(member => member.slug));
    return new Set(assignedMembers(item).map(member => member.slug));
  }

  function visualActiveSlugsAt(ms) {
    const active = new Set();
    activeItemsAt(ms).forEach(item => {
      visualActiveSlugs(item).forEach(slug => active.add(slug));
    });
    return active;
  }

  function countSlugs(item) {
    if (!item) return [];
    if (item.kind === 'adlib') return (item.member_slugs || []).filter(Boolean);
    if (item.is_all) return allCounts ? members.map(member => member.slug) : [];
    return assignedMembers(item).map(member => member.slug);
  }

  function totalsAt(ms) {
    const totals = new Map(members.map(member => [member.slug, 0]));
    const until = Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;

    orderedTimedItems().forEach(item => {
      const start = Number(item.start_ms);
      const end = effectiveEnd(item);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || until <= start) return;
      const elapsed = Math.max(0, Math.min(until, end) - start);
      if (!elapsed) return;
      countSlugs(item).forEach(slug => totals.set(slug, (totals.get(slug) || 0) + elapsed));
    });

    return totals;
  }

  function finalTotals() {
    return totalsAt(Number.MAX_SAFE_INTEGER);
  }

  function rankedMembers(totals) {
    const rosterIndex = new Map(members.map((member, index) => [member.slug, index]));
    return [...members].sort((a, b) => {
      const delta = (totals.get(b.slug) || 0) - (totals.get(a.slug) || 0);
      if (Math.abs(delta) > 0.5) return delta;
      return (rosterIndex.get(a.slug) || 0) - (rosterIndex.get(b.slug) || 0);
    });
  }

  function distributionStats(totals = finalTotals()) {
    const ranked = rankedMembers(totals);
    const totalMs = ranked.reduce((sum, member) => sum + Math.max(0, totals.get(member.slug) || 0), 0);
    const rows = ranked.map(member => ({
      member,
      ms: Math.max(0, totals.get(member.slug) || 0),
      rawPercent: totalMs > 0 ? Math.max(0, totals.get(member.slug) || 0) / totalMs * 100 : 0,
      percent: 0
    }));

    if (totalMs > 0 && rows.length) {
      const tenths = rows.map(row => {
        const exact = row.rawPercent * 10;
        const base = Math.floor(exact);
        return { row, base, remainder: exact - base };
      });
      let remaining = 1000 - tenths.reduce((sum, item) => sum + item.base, 0);
      [...tenths]
        .sort((a, b) => b.remainder - a.remainder || b.row.ms - a.row.ms)
        .forEach(item => {
          if (remaining > 0) {
            item.base += 1;
            remaining -= 1;
          }
        });
      tenths.forEach(item => { item.row.percent = item.base / 10; });
    }

    let balance = null;
    if (totalMs > 0 && rows.length > 1) {
      const ideal = 100 / rows.length;
      const deviation = rows.reduce((sum, row) => sum + Math.abs(row.rawPercent - ideal), 0);
      const maxDeviation = 2 * (100 - ideal);
      balance = Math.max(0, Math.min(100, (1 - deviation / maxDeviation) * 100));
    } else if (totalMs > 0 && rows.length === 1) {
      balance = 100;
    }

    return { ranked, rows, totalMs, balance };
  }

  function donutGradient(rows) {
    if (!rows.length || !rows.some(row => row.percent > 0)) return 'conic-gradient(#ffffff18 0 100%)';
    let cursor = 0;
    const stops = [];
    rows.forEach(row => {
      if (row.percent <= 0) return;
      const start = cursor;
      const end = Math.min(100, cursor + row.percent);
      stops.push(`${row.member.displayColor} ${start.toFixed(1)}% ${end.toFixed(1)}%`);
      cursor = end;
    });
    if (cursor < 100) stops.push(`#ffffff18 ${cursor.toFixed(1)}% 100%`);
    return `conic-gradient(${stops.join(',')})`;
  }

  function renderFinalResults() {
    if (!finalResults || !finalDonut || !finalRankingRows || !finalBalance) return;
    const stats = distributionStats();
    finalDonut.style.background = donutGradient(stats.rows);
    finalRankingRows.innerHTML = stats.rows.map((row, index) => `
      <div class="distribution-final-row">
        <span class="distribution-final-rank">#${index + 1}</span>
        <span class="distribution-final-member"><i style="--member-color:${row.member.displayColor}"></i><b style="color:${row.member.displayColor}">${escapeHtml(row.member.name)}</b></span>
        <span>${formatSeconds(row.ms)}</span>
        <strong>${row.percent.toFixed(1)}%</strong>
      </div>
    `).join('');
    finalBalance.textContent = stats.balance == null ? '—' : `${Math.round(stats.balance)}%`;
    if (chatFinalDonut) chatFinalDonut.style.background = donutGradient(stats.rows);
    if (chatFinalRows) chatFinalRows.innerHTML = stats.rows.map((row, index) => `
      <div class="chat-final-row"><span>#${index + 1}</span><span><i style="--member-color:${row.member.displayColor}"></i><b style="color:${row.member.displayColor}">${escapeHtml(row.member.name)}</b></span><span>${formatSeconds(row.ms)}</span><strong>${row.percent.toFixed(1)}%</strong></div>
    `).join('');
    if (chatFinalBalance) chatFinalBalance.textContent = stats.balance == null ? '—' : `${Math.round(stats.balance)}%`;
  }

  function applyLiveRanking(totals) {
    const ranked = rankedMembers(totals);
    const nextOrder = ranked.map(member => member.slug);
    const changed = nextOrder.some((slug, index) => currentBoardOrder[index] !== slug);
    const before = new Map();

    if (changed && currentBoardOrder.length) {
      members.forEach(member => {
        const card = memberEls.get(member.slug)?.card;
        if (card) before.set(member.slug, card.getBoundingClientRect());
      });
    }

    ranked.forEach((member, index) => {
      const refs = memberEls.get(member.slug);
      if (!refs) return;
      refs.card.style.order = String(index);
      if (refs.rank) refs.rank.textContent = `#${index + 1}`;
    });

    if (changed && before.size) {
      requestAnimationFrame(() => {
        ranked.forEach(member => {
          const card = memberEls.get(member.slug)?.card;
          const from = before.get(member.slug);
          if (!card || !from || !card.animate) return;
          const to = card.getBoundingClientRect();
          const dx = from.left - to.left;
          const dy = from.top - to.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          card.animate([
            { translate: `${dx}px ${dy}px` },
            { translate: '0 0' }
          ], { duration: 900, easing: 'cubic-bezier(.18,.72,.2,1)' });
        });
      });
    }

    currentBoardOrder = nextOrder;
    return ranked;
  }

  try {
    await requireMember();
    await load();
  } catch (error) {
    console.error(error);
    toast(error.message || 'Không thể tải Line Distribution.', 'error');
  }

  async function load() {
    const songRes = await db.from('lyric_songs').select('*').eq('id', songId).single();
    if (songRes.error) throw songRes.error;
    song = songRes.data;

    const audioVersionRes = await db.from('lyric_audio_versions')
      .select('id,song_id,label,audio_path,duration_seconds,timing_snapshot,adlib_snapshot,created_at')
      .eq('song_id', songId)
      .order('created_at', { ascending: true });
    if (audioVersionRes.error) throw audioVersionRes.error;
    audioVersions = audioVersionRes.data || [];
    currentAudioVersionId = song.current_audio_version_id || audioVersions.at(-1)?.id || null;

    const memberRes = await db.from('lyric_song_members').select('member_slug,video_image_path').eq('song_id', songId);
    if (memberRes.error) throw memberRes.error;

    const roster = await getMembers();
    const memberConfig = new Map((memberRes.data || []).map(item => [item.member_slug, item]));
    const selectedSlugs = new Set(memberConfig.keys());
    members = roster.filter(member => selectedSlugs.has(member.slug));

    await Promise.all(members.map(async member => {
      member.videoImagePath = memberConfig.get(member.slug)?.video_image_path || null;
      member.videoImageUrl = member.videoImagePath
        ? await signedUrl('lyric-video-member-images', member.videoImagePath, 14400)
        : '';
      member.videoImage = member.videoImageUrl ? await loadImageAsBlob(member.videoImageUrl).catch(() => null) : null;
      member.chatAvatarUrl = member.videoImageUrl || (member.avatar_path ? await signedUrl('member-avatars', member.avatar_path, 14400) : '');
      member.chatAvatarImage = member.videoImage || (member.chatAvatarUrl ? await loadImageAsBlob(member.chatAvatarUrl).catch(() => null) : null);
    }));

    const lineRes = await db.from('lyric_song_lines')
      .select('id,line_number,lyric_text,is_all,start_ms,end_ms')
      .eq('song_id', songId)
      .order('line_number');
    if (lineRes.error) throw lineRes.error;

    lines = (lineRes.data || []).map(line => ({
      ...line,
      kind: 'lyric',
      start_ms: line.start_ms == null ? null : Number(line.start_ms),
      end_ms: line.end_ms == null ? null : Number(line.end_ms)
    }));
    lines.forEach(line => assignments.set(line.id, new Set()));

    const lineIds = lines.map(line => line.id);
    if (lineIds.length) {
      const assignmentRes = await db.from('lyric_line_members')
        .select('line_id,member_slug')
        .in('line_id', lineIds);
      if (assignmentRes.error) throw assignmentRes.error;
      (assignmentRes.data || []).forEach(item => assignments.get(item.line_id)?.add(item.member_slug));
    }

    const adlibRes = await db.from('lyric_adlibs')
      .select('id,song_id,label,show_text,member_slugs,start_ms,end_ms,updated_at')
      .eq('song_id', songId)
      .order('start_ms', { ascending: true });
    if (adlibRes.error) throw adlibRes.error;
    adlibs = (adlibRes.data || []).map(item => ({
      ...item,
      kind: 'adlib',
      member_slugs: Array.isArray(item.member_slugs) ? item.member_slugs : [],
      start_ms: item.start_ms == null ? null : Number(item.start_ms),
      end_ms: item.end_ms == null ? null : Number(item.end_ms)
    }));

    $('#timingSongTitle').textContent = song.title;
    $('#distributionSongName').textContent = song.title;
    if ($('#finalSongTitle')) $('#finalSongTitle').textContent = song.title;
    $('#backToSongBtn').href = `song.html?id=${songId}`;
    document.title = `${song.title} — Line Distribution`;

    const currentVersion = audioVersions.find(item => item.id === currentAudioVersionId) || null;
    const activeAudioPath = currentVersion?.audio_path || song.audio_path;
    audioUrl = await signedUrl('lyric-song-audio', activeAudioPath, 14400);
    coverUrl = await signedUrl('lyric-song-covers', song.cover_path, 14400);
    if (audioUrl) audio.src = audioUrl;
    if (coverUrl) {
      $('#distributionStageBg').style.backgroundImage = `url('${coverUrl}')`;
      $('#chatDistributionBg').style.backgroundImage = `url('${coverUrl}')`;
      $('#chatCoverArt').style.backgroundImage = `url('${coverUrl}')`;
      coverImage = await loadImageAsBlob(coverUrl).catch(() => null);
    }

    $('#chatSongTitle').textContent = song.title;
    renderAudioVersionSelect();
    renderMemberBoard();
    renderChatMemberBoard();
    renderRows();
    renderVideoImageRows();
    renderAdlibMemberChoices();
    renderFinalResults();
    applyDistributionStyle();
    syncStage();
    if (!song.distribution_style_chosen) setTimeout(() => videoStyleDialog?.showModal(), 120);
  }

  async function loadImageAsBlob(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Image fetch failed');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = reject;
      image.src = objectUrl;
    });
  }

  function renderAudioVersionSelect() {
    if (!audioVersionSelect) return;
    audioVersionSelect.innerHTML = audioVersions.map((version, index) => `
      <option value="${escapeHtml(version.id)}" ${version.id === currentAudioVersionId ? 'selected' : ''}>${escapeHtml(version.label || `Audio ${index + 1}`)}</option>
    `).join('');
    audioVersionSelect.classList.toggle('hidden', audioVersions.length < 2);
  }

  function applyDistributionStyle() {
    const style = song?.distribution_style === 'chat' ? 'chat' : 'classic';
    $('#distributionStage')?.classList.toggle('hidden', style === 'chat');
    chatStage?.classList.toggle('hidden', style !== 'chat');
    chatStage?.setAttribute('aria-hidden', style === 'chat' ? 'false' : 'true');
    $('#videoImagesBtn')?.classList.toggle('hidden', style === 'chat');
    document.body.dataset.distributionStyle = style;
  }

  function renderChatMemberBoard() {
    if (!chatMemberBoard) return;
    chatMemberEls.clear();
    chatMemberBoard.innerHTML = members.map((member, index) => `
      <article class="chat-member-card" data-chat-member="${escapeHtml(member.slug)}" style="--member-color:${member.displayColor}">
        <div class="chat-member-avatar">${member.videoImageUrl ? `<img src="${escapeHtml(member.videoImageUrl)}" alt="">` : `<span>${escapeHtml(initials(member.name))}</span>`}</div>
        <div class="chat-member-info"><b>${escapeHtml(member.name)}</b><span data-chat-time>0.00s</span></div>
        <div class="chat-member-track"><i data-chat-bar></i></div>
        <span class="chat-member-rank" data-chat-rank>#${index + 1}</span>
      </article>
    `).join('');
    members.forEach(member => {
      const card = chatMemberBoard.querySelector(`[data-chat-member="${CSS.escape(member.slug)}"]`);
      if (!card) return;
      chatMemberEls.set(member.slug, {
        card,
        time: card.querySelector('[data-chat-time]'),
        bar: card.querySelector('[data-chat-bar]'),
        rank: card.querySelector('[data-chat-rank]')
      });
    });
  }

  function applyChatLiveRanking(totals) {
    const ranked = rankedMembers(totals);
    const nextOrder = ranked.map(member => member.slug);
    const changed = nextOrder.some((slug, index) => currentChatBoardOrder[index] !== slug);
    const before = new Map();
    if (changed && currentChatBoardOrder.length) {
      members.forEach(member => {
        const card = chatMemberEls.get(member.slug)?.card;
        if (card) before.set(member.slug, card.getBoundingClientRect());
      });
    }
    ranked.forEach((member, index) => {
      const refs = chatMemberEls.get(member.slug);
      if (!refs) return;
      refs.card.style.order = String(index);
      refs.rank.textContent = `#${index + 1}`;
    });
    if (changed && before.size) {
      requestAnimationFrame(() => {
        ranked.forEach(member => {
          const card = chatMemberEls.get(member.slug)?.card;
          const from = before.get(member.slug);
          if (!card || !from || !card.animate) return;
          const to = card.getBoundingClientRect();
          const dx = from.left - to.left;
          const dy = from.top - to.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          card.animate([
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: 'translate(0, 0)' }
          ], { duration: 1250, easing: 'cubic-bezier(.18,.72,.2,1)' });
        });
      });
    }
    currentChatBoardOrder = nextOrder;
    return ranked;
  }

  function chatAvatarStackHtml(group) {
    const groupMembers = chatGroupMembers(group);
    if (!groupMembers.length) return '<div class="chat-msg-avatar fallback">?</div>';
    const shown = groupMembers.slice(0, 3);
    const avatars = shown.map((member, index) => {
      const image = member.chatAvatarUrl ? `<img src="${escapeHtml(member.chatAvatarUrl)}" alt="">` : `<span>${escapeHtml(initials(member.name))}</span>`;
      return `<div class="chat-msg-avatar" style="--member-color:${member.displayColor};--avatar-index:${index}">${image}</div>`;
    }).join('');
    const extra = groupMembers.length > shown.length ? `<div class="chat-msg-avatar extra">+${groupMembers.length - shown.length}</div>` : '';
    return avatars + extra;
  }

  function syncChatStage(now, finalMoment, totals, activeSlugs) {
    if (!chatStage || song?.distribution_style !== 'chat') return;
    const maxCurrent = Math.max(1, ...members.map(member => totals.get(member.slug) || 0));
    applyChatLiveRanking(totals).forEach((member, index) => {
      const refs = chatMemberEls.get(member.slug);
      if (!refs) return;
      const total = totals.get(member.slug) || 0;
      refs.rank.textContent = `#${index + 1}`;
      refs.time.textContent = formatSeconds(total);
      refs.bar.style.width = `${Math.max(0, Math.min(100, total / maxCurrent * 100))}%`;
      refs.card.classList.toggle('active', activeSlugs.has(member.slug));
    });

    chatFinalResults?.classList.toggle('hidden', !finalMoment);
    chatFinalResults?.setAttribute('aria-hidden', finalMoment ? 'false' : 'true');
    if (finalMoment) return;

    const visual = visualLineStateAt(now);
    const visibleGroups = chatVisibleGroupsAt(now);
    const typing = chatTypingAt(now);
    const leaving = chatLeaveEventsAt(now);
    const adlibVisuals = chatAdlibVisualsAt(now);
    const newestGroupId = visibleGroups.at(-1)?.id || '';
    const newGroupArrived = Boolean(newestGroupId && newestGroupId !== lastChatNewestGroupId);
    const signature = [
      visibleGroups.map(group => group.id).join('|'),
      typing?.group?.id || 'no-typing',
      leaving.map(item => item.member.slug).sort().join(','),
      adlibVisuals.map(state => state.item.id).join(',')
    ].join('::');

    $('#chatNowLabel').textContent = visual.current ? partInfo(visual.current).text : song.title;

    if (signature !== lastChatSignature) {
      lastChatSignature = signature;
      if (chatBubbleStream) {
        chatBubbleStream.innerHTML = visibleGroups.map(group => {
          const firstLine = group.lines[0];
          const part = partInfo(firstLine);
          const groupClass = group.current && newGroupArrived ? 'chat-group-enter' : (!group.current && newGroupArrived ? 'chat-group-push' : '');
          const linesHtml = group.lines.map(line => `<div class="chat-lyric-text" data-chat-line="${escapeHtml(line.id)}">${escapeHtml(line.lyric_text)}</div>`).join('');
          return `<article class="chat-message-group ${group.current ? 'active' : 'history'} ${groupClass}" data-chat-group="${escapeHtml(group.id)}">
            <div class="chat-msg-avatar-stack">${chatAvatarStackHtml(group)}</div>
            <div class="chat-lyric-bubble">
              <div class="chat-lyric-name">${part.html}</div>
              <div class="chat-lyric-lines">${linesHtml}</div>
            </div>
          </article>`;
        }).join('');
      }
      if (chatTypingIndicator) {
        chatTypingIndicator.textContent = typing?.text || '';
        chatTypingIndicator.classList.toggle('hidden', !typing);
      }
      if (chatLeaveStream) {
        chatLeaveStream.innerHTML = leaving.map(item => `<div class="chat-leave-message"><b style="color:${item.member.displayColor}">${escapeHtml(item.member.name)}</b> đã rời khỏi kênh chat</div>`).join('');
      }
      if (chatAdlibStream) {
        chatAdlibStream.innerHTML = adlibVisuals.map(state => {
          const item = state.item;
          const names = (item.member_slugs || []).map(slug => members.find(member => member.slug === slug)).filter(Boolean);
          return `<div class="chat-adlib-bubble" data-chat-adlib="${escapeHtml(item.id)}"><b>${names.map(member => escapeHtml(member.name)).join(' · ')}</b><span>${escapeHtml(item.label)}</span></div>`;
        }).join('');
      }
      if (newestGroupId) lastChatNewestGroupId = newestGroupId;
    }

    if (chatBubbleStream) {
      const currentGroup = visibleGroups.at(-1) || null;
      const currentLine = currentGroup ? chatCurrentLineInGroup(currentGroup, now) : null;
      chatBubbleStream.querySelectorAll('[data-chat-line]').forEach(el => {
        el.classList.toggle('current', el.dataset.chatLine === currentLine?.id);
      });
    }

    if (chatAdlibStream) {
      const stateById = new Map(adlibVisuals.map(state => [String(state.item.id), state]));
      chatAdlibStream.querySelectorAll('[data-chat-adlib]').forEach(el => {
        const state = stateById.get(String(el.dataset.chatAdlib));
        if (!state) return;
        el.style.transform = `translateY(${-62 * state.drift}px)`;
        el.style.opacity = String(state.opacity);
      });
    }
  }

  function timingSnapshotFromState() {
    const snapshot = {};
    lines.forEach(line => { snapshot[line.id] = { start_ms: line.start_ms ?? null, end_ms: line.end_ms ?? null }; });
    return snapshot;
  }

  function adlibSnapshotFromState() {
    return adlibs.map(item => ({
      label: item.label || '',
      show_text: Boolean(item.show_text),
      member_slugs: Array.isArray(item.member_slugs) ? item.member_slugs : [],
      start_ms: item.start_ms ?? null,
      end_ms: item.end_ms ?? null
    }));
  }

  async function saveCurrentAudioSnapshot() {
    if (!currentAudioVersionId) return;
    const result = await db.from('lyric_audio_versions').update({
      timing_snapshot: timingSnapshotFromState(),
      adlib_snapshot: adlibSnapshotFromState(),
      updated_at: new Date().toISOString()
    }).eq('id', currentAudioVersionId);
    if (result.error) throw result.error;
    const version = audioVersions.find(item => item.id === currentAudioVersionId);
    if (version) {
      version.timing_snapshot = timingSnapshotFromState();
      version.adlib_snapshot = adlibSnapshotFromState();
    }
  }

  async function applyAudioVersion(version) {
    if (!version) return;
    const timing = version.timing_snapshot && typeof version.timing_snapshot === 'object' ? version.timing_snapshot : {};
    lines.forEach(line => {
      const row = timing[line.id] || {};
      line.start_ms = row.start_ms == null ? null : Number(row.start_ms);
      line.end_ms = row.end_ms == null ? null : Number(row.end_ms);
    });
    for (const line of lines) {
      const result = await db.from('lyric_song_lines').update({
        start_ms: line.start_ms,
        end_ms: line.end_ms,
        timing_updated_at: new Date().toISOString()
      }).eq('id', line.id);
      if (result.error) throw result.error;
    }

    const del = await db.from('lyric_adlibs').delete().eq('song_id', songId);
    if (del.error) throw del.error;
    const snapshot = Array.isArray(version.adlib_snapshot) ? version.adlib_snapshot : [];
    adlibs = [];
    if (snapshot.length) {
      const insert = await db.from('lyric_adlibs').insert(snapshot.map(item => ({
        song_id: songId,
        label: item.label || '',
        show_text: Boolean(item.show_text),
        member_slugs: Array.isArray(item.member_slugs) ? item.member_slugs : [],
        start_ms: item.start_ms == null ? null : Number(item.start_ms),
        end_ms: item.end_ms == null ? null : Number(item.end_ms)
      }))).select();
      if (insert.error) throw insert.error;
      adlibs = (insert.data || []).map(item => ({ ...item, kind: 'adlib', member_slugs: item.member_slugs || [] }));
    }

    currentAudioVersionId = version.id;
    song.current_audio_version_id = version.id;
    song.audio_path = version.audio_path;
    const updateSong = await db.from('lyric_songs').update({
      current_audio_version_id: version.id,
      audio_path: version.audio_path,
      updated_at: new Date().toISOString()
    }).eq('id', songId);
    if (updateSong.error) throw updateSong.error;

    audio.pause();
    audio.currentTime = 0;
    audioUrl = await signedUrl('lyric-song-audio', version.audio_path, 14400);
    if (audioUrl) { audio.src = audioUrl; audio.load(); }
    dirtyIds.clear();
    renderRows();
    renderFinalResults();
    renderAudioVersionSelect();
    syncStage();
  }

  function scaleSnapshot(snapshot, ratio, reset = false) {
    const out = {};
    Object.entries(snapshot || {}).forEach(([id, row]) => {
      out[id] = {
        start_ms: reset || row?.start_ms == null ? null : Math.round(Number(row.start_ms) * ratio),
        end_ms: reset || row?.end_ms == null ? null : Math.round(Number(row.end_ms) * ratio)
      };
    });
    return out;
  }

  function scaleAdlibSnapshot(snapshot, ratio, reset = false) {
    return (snapshot || []).map(item => ({
      ...item,
      start_ms: reset || item.start_ms == null ? null : Math.round(Number(item.start_ms) * ratio),
      end_ms: reset || item.end_ms == null ? null : Math.round(Number(item.end_ms) * ratio)
    }));
  }

  async function readAudioDuration(file) {
    return new Promise(resolve => {
      const element = document.createElement('audio');
      element.preload = 'metadata';
      element.onloadedmetadata = () => {
        const duration = Number.isFinite(element.duration) ? element.duration : null;
        URL.revokeObjectURL(element.src);
        resolve(duration);
      };
      element.onerror = () => resolve(null);
      element.src = URL.createObjectURL(file);
    });
  }

  function initials(name) {
    const text = String(name || '?').trim();
    const parts = text.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : text.slice(0, 2)).toUpperCase();
  }

  function renderMemberBoard() {
    const board = $('#memberBoard');
    memberEls.clear();
    board.innerHTML = members.map(member => `
      <article class="distribution-member-card" data-member="${escapeHtml(member.slug)}" style="--member-color:${member.displayColor}">
        <span class="distribution-rank" data-member-rank>#${members.indexOf(member) + 1}</span>
        <div class="distribution-avatar-wrap">
          ${member.videoImageUrl
            ? `<img class="distribution-avatar" src="${escapeHtml(member.videoImageUrl)}" alt="">`
            : `<div class="distribution-avatar distribution-avatar-fallback">${escapeHtml(initials(member.name))}</div>`}
        </div>
        <div class="distribution-member-copy">
          <strong>${escapeHtml(member.name)}</strong>
          <span data-member-time>0.00s</span>
        </div>
        <div class="distribution-member-track"><i data-member-bar></i></div>
      </article>
    `).join('');

    members.forEach(member => {
      const card = board.querySelector(`[data-member="${CSS.escape(member.slug)}"]`);
      if (!card) return;
      memberEls.set(member.slug, {
        card,
        time: card.querySelector('[data-member-time]'),
        bar: card.querySelector('[data-member-bar]'),
        rank: card.querySelector('[data-member-rank]')
      });
    });
  }

  function renderVideoImageRows() {
    if (!videoImageRows) return;
    videoImageRows.innerHTML = members.map(member => `
      <div class="video-image-row" data-video-member="${escapeHtml(member.slug)}" style="--member-color:${member.displayColor}">
        <div class="video-image-preview">
          ${member.videoImageUrl ? `<img src="${escapeHtml(member.videoImageUrl)}" alt="">` : `<span>${escapeHtml(initials(member.name))}</span>`}
        </div>
        <div class="video-image-copy"><b>${escapeHtml(member.name)}</b><span>${member.videoImagePath ? 'IMAGE' : 'TEXT'}</span></div>
        <div class="video-image-actions">
          <label class="ghost-btn small">Choose<input class="video-image-file" data-image-file type="file" accept="image/png,image/jpeg,image/webp"></label>
          <button class="ghost-btn small ${member.videoImagePath ? '' : 'hidden'}" data-clear-image type="button">Clear</button>
        </div>
      </div>
    `).join('');
  }

  function renderAdlibMemberChoices(selected = []) {
    if (!adlibMemberChoices) return;
    const chosen = new Set(selected);
    adlibMemberChoices.innerHTML = members.map(member => `
      <label class="adlib-member-choice" style="--member-color:${member.displayColor}">
        <input type="checkbox" value="${escapeHtml(member.slug)}" ${chosen.has(member.slug) ? 'checked' : ''}>
        <span style="color:${member.displayColor}">${escapeHtml(member.name)}</span>
      </label>
    `).join('');
  }

  function renderRows() {
    const visible = lyricLines();
    const lyricHtml = visible.map(line => {
      const part = partInfo(line);
      const dirty = dirtyIds.has(line.id);
      const selected = line.id === selectedLineId;
      return `<article class="timing-row ${dirty ? 'dirty' : ''} ${selected ? 'selected' : ''}" data-line-id="${line.id}" data-kind="lyric">
        <button class="timing-row-main" data-select-line>
          <span class="timing-line-no">${String(line.line_number).padStart(2, '0')}</span>
          <span class="timing-line-copy">
            <span class="timing-part">「 ${part.html} 」</span>
            <b>${escapeHtml(line.lyric_text)}</b>
          </span>
        </button>
        <div class="timing-fields">
          <label><span>IN</span><input data-time="start" value="${formatMs(line.start_ms)}" spellcheck="false"></label>
          <button class="timing-capture" data-capture="start">IN</button>
          <label><span>OUT</span><input data-time="end" value="${formatMs(line.end_ms)}" spellcheck="false"></label>
          <button class="timing-capture" data-capture="end">OUT</button>
        </div>
        <div class="timing-row-actions">
          <button class="ghost-btn small" data-preview-line>▶</button>
          <button class="ghost-btn small" data-save-line>${dirty ? 'Save*' : 'Save'}</button>
        </div>
      </article>`;
    }).join('');

    const adlibHtml = [...adlibs].sort((a, b) => Number(a.start_ms || 0) - Number(b.start_ms || 0)).map(item => {
      const dirty = dirtyIds.has(item.id);
      const selected = item.id === selectedLineId;
      const memberHtml = (item.member_slugs || []).map(slug => {
        const member = members.find(row => row.slug === slug);
        return member ? `<span style="color:${member.displayColor}">${escapeHtml(member.name)}</span>` : '';
      }).join('');
      return `<article class="timing-row adlib-row ${dirty ? 'dirty' : ''} ${selected ? 'selected' : ''}" data-line-id="${item.id}" data-kind="adlib">
        <button class="timing-row-main" data-select-line>
          <span class="timing-line-no">ADLIB</span>
          <span class="timing-line-copy">
            <span class="timing-part">${item.show_text ? 'VISIBLE' : 'HIDDEN TEXT'}</span>
            <b>${escapeHtml(item.label || 'Adlib')}</b>
            <span class="timing-adlib-members">${memberHtml}</span>
          </span>
        </button>
        <div class="timing-fields">
          <label><span>IN</span><input data-time="start" value="${formatMs(item.start_ms)}" spellcheck="false"></label>
          <button class="timing-capture" data-capture="start">IN</button>
          <label><span>OUT</span><input data-time="end" value="${formatMs(item.end_ms)}" spellcheck="false"></label>
          <button class="timing-capture" data-capture="end">OUT</button>
        </div>
        <div class="timing-row-actions">
          <button class="ghost-btn small" data-edit-adlib>Edit</button>
          <button class="ghost-btn small" data-preview-line>▶</button>
          <button class="ghost-btn small" data-save-line>${dirty ? 'Save*' : 'Save'}</button>
        </div>
      </article>`;
    }).join('');

    rowsHost.innerHTML = `${lyricHtml || '<div class="empty-inline">No lyric lines.</div>'}${adlibHtml ? `<div class="timing-subhead">ADLIBS</div>${adlibHtml}` : ''}`;
  }

  function easeOutCubic(value) {
    const p = Math.max(0, Math.min(1, Number(value) || 0));
    return 1 - Math.pow(1 - p, 3);
  }

  function restartFinalAnimation() {
    if (!finalResults) return;
    finalResults.classList.remove('final-animate');
    void finalResults.offsetWidth;
    finalResults.classList.add('final-animate');
  }

  function syncLyricTicker(now, finalMoment) {
    const singer = $('#stageSinger');
    const prevEl = $('#stagePrev');
    const currentEl = $('#stageLyric');
    const nextEl = $('#stageNext');
    const adlibEl = $('#stageAdlib');
    const state = visualLineStateAt(now);
    const first = orderedTimedLines()[0] || null;
    const beforeFirst = first && now < Number(first.start_ms);

    if (finalMoment) {
      singer.textContent = '';
      prevEl.textContent = '';
      currentEl.textContent = '';
      nextEl.textContent = '';
      adlibEl.textContent = '';
      return;
    }

    if (beforeFirst || !first) {
      singer.textContent = 'RƎ:ALYZE';
      prevEl.textContent = '';
      currentEl.textContent = song?.title || 'LINE DISTRIBUTION';
      nextEl.textContent = state.next?.lyric_text || '';
      currentEl.style.transform = 'translateY(0px)';
      currentEl.style.opacity = '1';
      nextEl.style.transform = 'translateY(0px)';
      nextEl.style.opacity = '.38';
      prevEl.style.opacity = '0';
      adlibEl.textContent = '';
      return;
    }

    const { prev, current, next, progress } = state;
    if (!current) return;
    const part = partInfo(current);
    singer.innerHTML = `「 ${part.html} 」`;

    const eased = easeOutCubic(progress);
    const distance = 38;
    prevEl.textContent = prev?.lyric_text || '';
    currentEl.textContent = current.lyric_text || '';
    nextEl.textContent = next?.lyric_text || '';

    prevEl.style.transform = `translateY(${-distance * eased}px)`;
    prevEl.style.opacity = String((1 - eased) * .95);
    currentEl.style.transform = `translateY(${distance * (1 - eased)}px)`;
    currentEl.style.opacity = String(.42 + .58 * eased);
    const nextReveal = Math.max(0, Math.min(1, (progress - .62) / .38));
    nextEl.style.transform = 'translateY(0px)';
    nextEl.style.opacity = String(.38 * nextReveal);

    const visibleAdlibs = activeAdlibsAt(now).filter(item => item.show_text && String(item.label || '').trim());
    adlibEl.textContent = visibleAdlibs.map(item => item.label).join('  ·  ');
  }

  function syncStage() {
    const now = toMs(audio.currentTime);
    const duration = durationMs();
    $('#currentClock').textContent = formatMs(now);
    $('#durationClock').textContent = `/ ${formatMs(duration)}`;
    seekBar.max = String(Math.max(duration, 1));
    if (!seekBar.matches(':active')) seekBar.value = String(Math.min(now, duration || now));
    if (editorSeekBar) {
      editorSeekBar.max = String(Math.max(duration, 1));
      if (!editorSeekBar.matches(':active')) editorSeekBar.value = String(Math.min(now, duration || now));
    }
    if (editorDurationClock) editorDurationClock.textContent = `/ ${formatMs(duration)}`;

    const activeLines = activeLinesAt(now);
    const activeItems = activeItemsAt(now);
    const current = activeLines.at(-1) || null;
    const visualState = visualLineStateAt(now);
    const mediaDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : 0;
    const finalMoment = mediaDuration ? now >= Math.max(0, mediaDuration - 40) : false;

    finalResults?.classList.toggle('hidden', !finalMoment);
    finalResults?.setAttribute('aria-hidden', finalMoment ? 'false' : 'true');
    $('#distributionStage')?.classList.toggle('show-final-results', finalMoment);
    if (finalMoment && !finalVisible) {
      renderFinalResults();
      restartFinalAnimation();
    }
    if (!finalMoment && finalVisible) finalResults?.classList.remove('final-animate');
    finalVisible = finalMoment;

    syncLyricTicker(now, finalMoment);

    const activeSlugs = visualActiveSlugsAt(now);
    const totals = totalsAt(now);
    syncChatStage(now, finalMoment, totals, activeSlugs);
    const maxCurrent = Math.max(1, ...members.map(member => totals.get(member.slug) || 0));
    applyLiveRanking(totals);

    members.forEach(member => {
      const refs = memberEls.get(member.slug);
      if (!refs) return;
      const total = totals.get(member.slug) || 0;
      const width = Math.max(0, Math.min(100, total / maxCurrent * 100));
      refs.time.textContent = formatSeconds(total);
      refs.bar.style.width = `${width}%`;
      refs.card.classList.toggle('active', activeSlugs.has(member.slug));
      refs.card.classList.toggle('inactive', activeItems.length > 0 && !activeSlugs.has(member.slug));
    });

    const activeItemIds = new Set(activeItems.map(item => item.id));
    document.querySelectorAll('.timing-row').forEach(row => {
      row.classList.toggle('playing', activeItemIds.has(row.dataset.lineId));
    });

    if ($('#editorClock')) $('#editorClock').textContent = formatMs(now);
    if (editorPlayPauseBtn) {
      editorPlayPauseBtn.textContent = audio.paused ? '▶' : 'Ⅱ';
      editorPlayPauseBtn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    }

    const followItem = activeItems.at(-1) || current || visualState.current;
    if (editorOpen && followTiming && followItem?.id && followItem.id !== lastFollowLineId) {
      lastFollowLineId = followItem.id;
      const row = rowsHost.querySelector(`[data-line-id="${CSS.escape(followItem.id)}"]`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    playPauseBtn.textContent = audio.paused ? '▶' : 'Ⅱ';
    playPauseBtn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  }

  let playbackFrame = 0;
  function runPlaybackFrame() {
    syncStage();
    if (!audio.paused && !audio.ended) playbackFrame = requestAnimationFrame(runPlaybackFrame);
  }

  audio.addEventListener('loadedmetadata', syncStage);
  audio.addEventListener('timeupdate', syncStage);
  audio.addEventListener('seeked', syncStage);
  audio.addEventListener('play', () => {
    cancelAnimationFrame(playbackFrame);
    runPlaybackFrame();
  });
  audio.addEventListener('pause', () => {
    cancelAnimationFrame(playbackFrame);
    syncStage();
  });
  audio.addEventListener('ended', () => {
    cancelAnimationFrame(playbackFrame);
    syncStage();
  });

  playPauseBtn.onclick = async () => {
    if (!audio.src) return;
    if (audio.ended) audio.currentTime = 0;
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  seekBar.addEventListener('input', () => {
    audio.currentTime = Number(seekBar.value || 0) / 1000;
    syncStage();
  });

  editorSeekBar?.addEventListener('input', () => {
    audio.currentTime = Number(editorSeekBar.value || 0) / 1000;
    lastFollowLineId = null;
    syncStage();
  });

  countAllToggle.addEventListener('change', () => {
    allCounts = countAllToggle.checked;
    localStorage.setItem(`rlz-line-all-counts:${songId}`, allCounts ? '1' : '0');
    renderFinalResults();
    syncStage();
  });

  function setEditorOpen(open) {
    editorOpen = Boolean(open);
    editorPanel.classList.toggle('hidden', !editorOpen);
    editorBackdrop?.classList.toggle('hidden', !editorOpen);
    editorPanel.setAttribute('aria-hidden', editorOpen ? 'false' : 'true');
    saveTimingBtn.classList.toggle('hidden', !editorOpen);
    $('#toggleEditorBtn').textContent = editorOpen ? 'Close Editor' : 'Edit Timing';
    document.body.classList.toggle('timing-editor-open', editorOpen);

    if (editorOpen) {
      const now = toMs(audio.currentTime);
      const target = activeItemsAt(now).at(-1) || orderedTimedItems().find(item => Number(item.start_ms) > now) || lyricLines()[0] || null;
      if (target) {
        selectedLineId = target.id;
        renderRows();
        requestAnimationFrame(() => {
          rowsHost.querySelector(`[data-line-id="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: 'center' });
        });
      }
    }
    syncStage();
  }

  $('#toggleEditorBtn').onclick = () => setEditorOpen(!editorOpen);
  $('#closeEditorBtn').onclick = () => setEditorOpen(false);
  editorBackdrop?.addEventListener('click', () => setEditorOpen(false));
  editorPlayPauseBtn?.addEventListener('click', async () => {
    if (!audio.src) return;
    if (audio.ended) audio.currentTime = 0;
    if (audio.paused) await audio.play();
    else audio.pause();
  });
  followTimingToggle?.addEventListener('change', () => {
    followTiming = followTimingToggle.checked;
    lastFollowLineId = null;
  });

  function findItem(id) {
    return lines.find(item => item.id === id) || adlibs.find(item => item.id === id) || null;
  }

  function editableItems() {
    return [...lyricLines(), ...adlibs];
  }

  function selectedItem() {
    return findItem(selectedLineId);
  }

  function captureSelected(kind) {
    const item = selectedItem();
    if (!item) return;
    const now = toMs(audio.currentTime);
    if (kind === 'start') {
      item.start_ms = now;
      if (item.end_ms != null && item.end_ms <= now) item.end_ms = null;
    } else {
      if (item.start_ms == null) {
        toast('Set IN first.', 'error');
        return;
      }
      item.end_ms = Math.max(Number(item.start_ms) + 10, now);
    }
    markDirty(item.id);
    renderRows();
    syncStage();
  }

  addEventListener('keydown', async event => {
    if (!editorOpen) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable || adlibDialog?.open || videoImagesDialog?.open) return;

    if (event.code === 'Space') {
      event.preventDefault();
      if (audio.paused) await audio.play();
      else audio.pause();
    } else if (event.key.toLowerCase() === 'i') {
      event.preventDefault();
      captureSelected('start');
    } else if (event.key.toLowerCase() === 'o') {
      event.preventDefault();
      captureSelected('end');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelectedLine(-1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelectedLine(1);
    } else if (event.key === 'Escape') {
      setEditorOpen(false);
    }
  });

  function moveSelectedLine(step) {
    const visible = editableItems();
    if (!visible.length) return;
    let index = visible.findIndex(item => item.id === selectedLineId);
    if (index < 0) index = 0;
    else index = Math.min(visible.length - 1, Math.max(0, index + step));
    const item = visible[index];
    selectedLineId = item.id;
    renderRows();
    requestAnimationFrame(() => rowsHost.querySelector(`[data-line-id="${CSS.escape(item.id)}"]`)?.scrollIntoView({ block: 'center' }));
    syncStage();
  }

  rowsHost.addEventListener('click', async event => {
    const row = event.target.closest('.timing-row');
    if (!row) return;
    const item = findItem(row.dataset.lineId);
    if (!item) return;

    if (event.target.closest('[data-select-line]')) {
      selectedLineId = item.id;
      renderRows();
      syncStage();
      return;
    }

    const capture = event.target.closest('[data-capture]');
    if (capture) {
      selectedLineId = item.id;
      captureSelected(capture.dataset.capture);
      return;
    }

    if (event.target.closest('[data-edit-adlib]') && item.kind === 'adlib') {
      openAdlibDialog(item);
      return;
    }

    if (event.target.closest('[data-preview-line]')) {
      if (item.start_ms == null) {
        toast('This line has no IN.', 'error');
        return;
      }
      selectedLineId = item.id;
      audio.currentTime = item.start_ms / 1000;
      await audio.play();
      return;
    }

    if (event.target.closest('[data-save-line]')) {
      await saveItem(item);
    }
  });

  rowsHost.addEventListener('change', event => {
    const input = event.target.closest('[data-time]');
    if (!input) return;
    const row = input.closest('.timing-row');
    const item = findItem(row?.dataset.lineId);
    if (!item) return;

    const value = parseTime(input.value);
    if (Number.isNaN(value)) {
      toast('Time format: 01:23.456', 'error');
      input.value = formatMs(input.dataset.time === 'start' ? item.start_ms : item.end_ms);
      return;
    }

    if (input.dataset.time === 'start') item.start_ms = value;
    else item.end_ms = value;

    if (item.start_ms != null && item.end_ms != null && item.end_ms <= item.start_ms) {
      toast('OUT must be after IN.', 'error');
      item.end_ms = null;
    }

    markDirty(item.id);
    renderRows();
    syncStage();
  });

  async function saveItem(item) {
    let result;
    if (item.kind === 'adlib') {
      result = await db.from('lyric_adlibs').update({
        start_ms: item.start_ms,
        end_ms: item.end_ms,
        updated_at: new Date().toISOString()
      }).eq('id', item.id);
    } else {
      result = await db.from('lyric_song_lines').update({
        start_ms: item.start_ms,
        end_ms: item.end_ms,
        timing_updated_at: new Date().toISOString()
      }).eq('id', item.id);
    }

    if (result.error) {
      toast(result.error.message || 'Could not save timing.', 'error');
      throw result.error;
    }

    markSaved(item.id);
    renderRows();
  }

  async function saveAll() {
    const ids = [...dirtyIds];
    if (!ids.length) {
      toast('Timing is saved.', 'success');
      return;
    }

    saveTimingBtn.disabled = true;
    try {
      for (const id of ids) {
        const item = findItem(id);
        if (item) await saveItem(item);
      }
      await db.from('lyric_songs').update({ updated_at: new Date().toISOString() }).eq('id', songId);
      toast('Timing saved.', 'success');
    } finally {
      saveTimingBtn.disabled = false;
    }
  }

  saveTimingBtn.onclick = saveAll;

  $('#jumpPrevBtn').onclick = () => jumpLine(-1);
  $('#jumpNextBtn').onclick = () => jumpLine(1);

  function jumpLine(step) {
    const ordered = orderedTimedItems();
    if (!ordered.length) return;
    const active = activeItemsAt(toMs(audio.currentTime));
    const current = active.at(-1) || null;
    let index = current ? ordered.findIndex(item => item.id === current.id) : 0;
    index = Math.min(ordered.length - 1, Math.max(0, index + step));
    selectedLineId = ordered[index].id;
    audio.currentTime = ordered[index].start_ms / 1000;
    renderRows();
    syncStage();
  }

  $('#clearTimingBtn').onclick = () => {
    if (!confirm('Clear all timing for this song?')) return;
    editableItems().forEach(item => {
      item.start_ms = null;
      item.end_ms = null;
      markDirty(item.id);
    });
    renderRows();
    syncStage();
  };

  function openAdlibDialog(item = null) {
    editingAdlibId = item?.id || null;
    $('#adlibDialogTitle').textContent = item ? 'Edit adlib' : 'Add adlib';
    adlibText.value = item?.label || '';
    adlibShowText.checked = Boolean(item?.show_text);
    renderAdlibMemberChoices(item?.member_slugs || []);
    $('#deleteAdlibBtn').classList.toggle('hidden', !item);
    if (!adlibDialog.open) adlibDialog.showModal();
  }

  $('#addAdlibBtn')?.addEventListener('click', () => openAdlibDialog());
  $('#closeAdlibBtn')?.addEventListener('click', () => adlibDialog.close());
  $('#saveAdlibBtn')?.addEventListener('click', async () => {
    const member_slugs = [...adlibMemberChoices.querySelectorAll('input:checked')].map(input => input.value);
    if (!member_slugs.length) {
      toast('Choose at least one member.', 'error');
      return;
    }
    const label = adlibText.value.trim();
    const show_text = adlibShowText.checked;
    if (editingAdlibId) {
      const result = await db.from('lyric_adlibs').update({ label, show_text, member_slugs, updated_at: new Date().toISOString() }).eq('id', editingAdlibId).select().single();
      if (result.error) return toast(result.error.message, 'error');
      const index = adlibs.findIndex(item => item.id === editingAdlibId);
      if (index >= 0) adlibs[index] = { ...adlibs[index], ...result.data, kind: 'adlib', member_slugs };
    } else {
      const start_ms = toMs(audio.currentTime);
      const end_ms = start_ms + 1000;
      const result = await db.from('lyric_adlibs').insert({ song_id: songId, label, show_text, member_slugs, start_ms, end_ms }).select().single();
      if (result.error) return toast(result.error.message, 'error');
      adlibs.push({ ...result.data, kind: 'adlib', member_slugs, start_ms: Number(result.data.start_ms), end_ms: Number(result.data.end_ms) });
      selectedLineId = result.data.id;
    }
    editingAdlibId = null;
    adlibDialog.close();
    renderRows();
    renderFinalResults();
    syncStage();
  });
  $('#deleteAdlibBtn')?.addEventListener('click', async () => {
    if (!editingAdlibId) return;
    const result = await db.from('lyric_adlibs').delete().eq('id', editingAdlibId);
    if (result.error) return toast(result.error.message, 'error');
    adlibs = adlibs.filter(item => item.id !== editingAdlibId);
    dirtyIds.delete(editingAdlibId);
    if (selectedLineId === editingAdlibId) selectedLineId = null;
    editingAdlibId = null;
    adlibDialog.close();
    renderRows();
    renderFinalResults();
    syncStage();
  });

  $('#videoImagesBtn')?.addEventListener('click', () => {
    renderVideoImageRows();
    if (!videoImagesDialog.open) videoImagesDialog.showModal();
  });
  $('#closeVideoImagesBtn')?.addEventListener('click', () => videoImagesDialog.close());
  videoImageRows?.addEventListener('change', async event => {
    const input = event.target.closest('[data-image-file]');
    if (!input?.files?.[0]) return;
    const row = input.closest('[data-video-member]');
    const member = members.find(item => item.slug === row?.dataset.videoMember);
    if (!member) return;
    input.disabled = true;
    try {
      await setVideoImage(member, input.files[0]);
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not upload image.', 'error');
    } finally {
      input.disabled = false;
      input.value = '';
    }
  });
  videoImageRows?.addEventListener('click', async event => {
    const clear = event.target.closest('[data-clear-image]');
    if (!clear) return;
    const row = clear.closest('[data-video-member]');
    const member = members.find(item => item.slug === row?.dataset.videoMember);
    if (!member) return;
    clear.disabled = true;
    try {
      await clearVideoImage(member);
    } finally {
      clear.disabled = false;
    }
  });

  async function setVideoImage(member, file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use PNG, JPG or WEBP.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Image is too large.');
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${songId}/${member.slug}.${ext}`;
    const upload = await db.storage.from('lyric-video-member-images').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
    if (upload.error) throw upload.error;
    const update = await db.from('lyric_song_members').update({ video_image_path: path }).eq('song_id', songId).eq('member_slug', member.slug);
    if (update.error) throw update.error;
    const previousPath = member.videoImagePath;
    member.videoImagePath = path;
    const signed = await signedUrl('lyric-video-member-images', path, 14400);
    member.videoImageUrl = signed ? `${signed}${signed.includes('?') ? '&' : '?'}v=${Date.now()}` : '';
    member.videoImage = member.videoImageUrl ? await loadImageAsBlob(member.videoImageUrl).catch(() => null) : null;
    if (previousPath && previousPath !== path) await db.storage.from('lyric-video-member-images').remove([previousPath]);
    renderMemberBoard();
    renderChatMemberBoard();
    renderVideoImageRows();
    syncStage();
  }

  async function clearVideoImage(member) {
    if (member.videoImagePath) await db.storage.from('lyric-video-member-images').remove([member.videoImagePath]);
    const update = await db.from('lyric_song_members').update({ video_image_path: null }).eq('song_id', songId).eq('member_slug', member.slug);
    if (update.error) return toast(update.error.message, 'error');
    member.videoImagePath = null;
    member.videoImageUrl = '';
    member.videoImage = null;
    renderMemberBoard();
    renderChatMemberBoard();
    renderVideoImageRows();
    syncStage();
  }

  $('#videoStyleBtn')?.addEventListener('click', () => {
    if (!videoStyleDialog?.open) videoStyleDialog.showModal();
  });
  $('#closeVideoStyleBtn')?.addEventListener('click', () => { if (!song?.distribution_style_chosen) return toast('Choose a style first.', 'error'); videoStyleDialog.close(); });
  videoStyleDialog?.addEventListener('click', async event => {
    const option = event.target.closest('[data-video-style]');
    if (!option) return;
    const style = option.dataset.videoStyle === 'chat' ? 'chat' : 'classic';
    const result = await db.from('lyric_songs').update({
      distribution_style: style,
      distribution_style_chosen: true,
      updated_at: new Date().toISOString()
    }).eq('id', songId);
    if (result.error) return toast(result.error.message, 'error');
    song.distribution_style = style;
    song.distribution_style_chosen = true;
    lastChatSignature = '';
    applyDistributionStyle();
    syncStage();
    videoStyleDialog.close();
  });

  $('#changeAudioBtn')?.addEventListener('click', () => {
    $('#replacementAudioFile').value = '';
    $('#replacementAudioLabel').value = '';
    $('#changeAudioError').classList.add('hidden');
    if (!changeAudioDialog?.open) changeAudioDialog.showModal();
  });
  $('#closeChangeAudioBtn')?.addEventListener('click', () => changeAudioDialog.close());

  audioVersionSelect?.addEventListener('change', async () => {
    const target = audioVersions.find(item => item.id === audioVersionSelect.value);
    if (!target || target.id === currentAudioVersionId) return;
    audioVersionSelect.disabled = true;
    try {
      if (dirtyIds.size) await saveAll();
      await saveCurrentAudioSnapshot();
      await applyAudioVersion(target);
      toast(`Audio: ${target.label || 'version'}`, 'success');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not switch audio.', 'error');
      renderAudioVersionSelect();
    } finally {
      audioVersionSelect.disabled = false;
    }
  });

  $('#saveReplacementAudioBtn')?.addEventListener('click', async () => {
    const file = $('#replacementAudioFile').files?.[0];
    const errorBox = $('#changeAudioError');
    errorBox.classList.add('hidden');
    if (!file) {
      errorBox.textContent = 'Choose an audio file.';
      errorBox.classList.remove('hidden');
      return;
    }
    const button = $('#saveReplacementAudioBtn');
    button.disabled = true;
    button.textContent = 'Uploading...';
    try {
      if (dirtyIds.size) await saveAll();
      await saveCurrentAudioSnapshot();
      const durationSeconds = await readAudioDuration(file);
      const currentVersion = audioVersions.find(item => item.id === currentAudioVersionId) || null;
      const oldDuration = Number(currentVersion?.duration_seconds) || (Number.isFinite(audio.duration) ? audio.duration : 0);
      const ratio = oldDuration > 0 && durationSeconds > 0 ? durationSeconds / oldDuration : 1;
      const mode = document.querySelector('input[name="retimeMode"]:checked')?.value || 'copy';
      const reset = mode === 'reset';
      const scale = mode === 'scale' ? ratio : 1;
      const timingSnapshot = scaleSnapshot(timingSnapshotFromState(), scale, reset);
      const adlibSnapshot = scaleAdlibSnapshot(adlibSnapshotFromState(), scale, reset);
      const path = `${songId}/${Date.now()}-${safeFileName(file.name)}`;
      const upload = await db.storage.from('lyric-song-audio').upload(path, file, {
        upsert: false,
        contentType: file.type || undefined
      });
      if (upload.error) throw upload.error;
      const label = $('#replacementAudioLabel').value.trim() || `Audio ${audioVersions.length + 1}`;
      const created = await db.from('lyric_audio_versions').insert({
        song_id: songId,
        label,
        audio_path: path,
        duration_seconds: durationSeconds,
        timing_snapshot: timingSnapshot,
        adlib_snapshot: adlibSnapshot,
        created_by: song.created_by || null
      }).select().single();
      if (created.error) throw created.error;
      audioVersions.push(created.data);
      await applyAudioVersion(created.data);
      changeAudioDialog.close();
      toast('New audio version is ready. Retime only what changed.', 'success');
    } catch (error) {
      console.error(error);
      errorBox.textContent = error.message || 'Could not replace audio.';
      errorBox.classList.remove('hidden');
    } finally {
      button.disabled = false;
      button.textContent = 'Use new audio';
    }
  });

  $('#exportVideoBtn').onclick = exportVideo;

  async function exportVideo() {
    if (exporting) return;
    const ready = orderedTimedItems();
    if (!ready.length) {
      toast('No timing to export.', 'error');
      return;
    }
    if (!audioUrl) {
      toast('Audio is unavailable.', 'error');
      return;
    }

    exporting = true;
    const button = $('#exportVideoBtn');
    button.disabled = true;
    audio.pause();
    $('#exportState').textContent = 'Preparing offline render...';

    try {
      await document.fonts?.ready;

      // Primary renderer: fixed-timestep, offline WebCodecs encoding.
      // Frames are generated at exact 1/60 s timestamps, so slow rendering
      // only makes export take longer; it cannot create dropped frames in the file.
      if ('VideoEncoder' in window && 'AudioEncoder' in window) {
        await exportVideoOffline60();
      } else {
        // Older browsers get a deliberately lighter realtime fallback.
        // 30 fps is far more stable than attempting realtime 1080p60.
        await exportVideoRealtimeFallback();
      }
    } catch (error) {
      console.error(error);
      $('#exportState').textContent = '';
      toast(error.message || 'Could not export video.', 'error');
    } finally {
      exporting = false;
      button.disabled = false;
      exportBoardMotion = null;
    }
  }

  async function exportVideoOffline60() {
    const {
      Output,
      WebMOutputFormat,
      BufferTarget,
      CanvasSource,
      AudioBufferSource: BunnyAudioBufferSource,
      Quality
    } = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.59.1/+esm');

    const canvas = $('#exportCanvas');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    $('#exportState').textContent = 'Decoding audio...';
    const audioResponse = await fetch(audioUrl, { mode: 'cors', credentials: 'omit' });
    if (!audioResponse.ok) throw new Error(`Audio download failed (${audioResponse.status}).`);
    const encodedAudio = await audioResponse.arrayBuffer();
    const decodeContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    const decodedAudio = await decodeContext.decodeAudioData(encodedAudio.slice(0));

    const target = new BufferTarget();
    const output = new Output({
      format: new WebMOutputFormat(),
      target
    });

    // The content is mostly typography/cards over a static background, so VP9
    // at ~8.5 Mbps keeps 1080p sharp without creating enormous in-memory files.
    const videoSource = new CanvasSource(canvas, {
      codec: 'vp9',
      quality: new Quality({ bitrate: 8_500_000 })
    });
    const audioSource = new BunnyAudioBufferSource({
      codec: 'opus',
      quality: new Quality({ bitrate: 192_000 })
    });

    output.addVideoTrack(videoSource, { frameRate: EXPORT_FPS });
    output.addAudioTrack(audioSource);
    output.setMetadataTags?.({
      title: `${song.title} — Line Distribution`,
      artist: 'RƎ:ALYZE'
    });

    await output.start();

    // Let audio encoding run alongside video encoding. It is independent from
    // wall-clock playback and therefore cannot drift when the page is busy.
    const audioPromise = audioSource.add(decodedAudio).then(() => audioSource.close());

    const audioDurationMs = Math.round(decodedAudio.duration * 1000);
    const totalDurationMs = audioDurationMs + FINAL_HOLD_MS;
    const frameDuration = 1 / EXPORT_FPS;
    const totalFrames = Math.max(1, Math.ceil(totalDurationMs / 1000 * EXPORT_FPS));
    exportBoardMotion = { lastMs: 0, positions: new Map() };

    let lastPercent = -1;
    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (!exporting) throw new Error('Export cancelled.');

      const seconds = frame / EXPORT_FPS;
      const frameMs = seconds * 1000;
      if (frameMs < audioDurationMs) {
        drawVideoFrame(ctx, canvas, frameMs, audioDurationMs);
      } else {
        drawVideoFrame(ctx, canvas, audioDurationMs, audioDurationMs, {
          finalElapsed: frameMs - audioDurationMs
        });
      }

      // Keyframe every two seconds makes seeking reliable without bloating output.
      await videoSource.add(seconds, frameDuration, {
        keyFrame: frame % (EXPORT_FPS * 2) === 0
      });

      const percent = Math.min(100, Math.floor((frame + 1) / totalFrames * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        $('#exportState').textContent = `${percent}% · OFFLINE 1080p60`;
      }

      // Give the page a chance to repaint the progress label. This does not affect
      // video timing because frame timestamps above are fixed, not realtime.
      if (frame % 12 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }

    videoSource.close();
    await audioPromise;
    await output.finalize();
    await decodeContext.close().catch(() => {});

    if (!target.buffer) throw new Error('Encoder did not produce a video file.');
    const blob = new Blob([target.buffer], { type: 'video/webm' });
    downloadExportBlob(blob, `${safeVideoName(song.title)}-line-distribution-1080p60.webm`);
    $('#exportState').textContent = 'Ready · 1080p60';
    toast('Video exported without realtime frame drops.', 'success');
  }

  async function exportVideoRealtimeFallback() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error('This browser does not support video export.');
    }

    const FALLBACK_FPS = 30;
    const canvas = $('#exportCanvas');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    let context = null;
    let recorder = null;
    let frameId = 0;
    let exportAudio = null;

    try {
      exportAudio = new Audio();
      exportAudio.crossOrigin = 'anonymous';
      exportAudio.preload = 'auto';
      exportAudio.src = audioUrl;
      await waitForMedia(exportAudio);

      context = new (window.AudioContext || window.webkitAudioContext)();
      const source = context.createMediaElementSource(exportAudio);
      const destination = context.createMediaStreamDestination();
      source.connect(destination);

      exportBoardMotion = { lastMs: 0, positions: new Map() };
      const canvasStream = canvas.captureStream(FALLBACK_FPS);
      const stream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
      ]);

      const mimeType = pickVideoMime();
      recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: 10_000_000,
        audioBitsPerSecond: 192_000
      });

      const chunks = [];
      recorder.ondataavailable = event => {
        if (event.data?.size) chunks.push(event.data);
      };

      const stopped = new Promise((resolve, reject) => {
        recorder.onerror = event => reject(event.error || new Error('Recorder error'));
        recorder.onstop = resolve;
      });

      let lastPaint = -Infinity;
      const frameStep = 1000 / FALLBACK_FPS;
      const draw = now => {
        if (now - lastPaint >= frameStep - 1) {
          lastPaint = now;
          drawVideoFrame(ctx, canvas, exportAudio.currentTime * 1000, exportAudio.duration * 1000);
          const percent = exportAudio.duration ? Math.min(100, exportAudio.currentTime / exportAudio.duration * 100) : 0;
          $('#exportState').textContent = `${percent.toFixed(0)}% · fallback 1080p30`;
        }
        if (!exportAudio.ended && exporting) frameId = requestAnimationFrame(draw);
      };

      recorder.start(1000);
      await context.resume();
      exportAudio.currentTime = 0;
      draw(performance.now());
      await exportAudio.play();
      await new Promise(resolve => exportAudio.addEventListener('ended', resolve, { once: true }));

      $('#exportState').textContent = 'Final...';
      await new Promise(resolve => {
        const started = performance.now();
        let lastFinalPaint = -Infinity;
        const drawFinal = now => {
          const elapsed = now - started;
          if (now - lastFinalPaint >= (1000 / FALLBACK_FPS) - 1) {
            lastFinalPaint = now;
            drawVideoFrame(ctx, canvas, exportAudio.duration * 1000, exportAudio.duration * 1000, { finalElapsed: elapsed });
          }
          if (elapsed < FINAL_HOLD_MS) requestAnimationFrame(drawFinal);
          else resolve();
        };
        requestAnimationFrame(drawFinal);
      });

      recorder.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      downloadExportBlob(blob, `${safeVideoName(song.title)}-line-distribution.webm`);
      $('#exportState').textContent = 'Ready · fallback 30fps';
      toast('Video exported in compatibility mode.', 'success');
    } finally {
      if (frameId) cancelAnimationFrame(frameId);
      if (exportAudio) exportAudio.pause();
      if (context) context.close().catch(() => {});
    }
  }

  function downloadExportBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function waitForMedia(media) {
    if (media.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      media.addEventListener('loadedmetadata', resolve, { once: true });
      media.addEventListener('error', () => reject(new Error('Audio could not be loaded.')), { once: true });
    });
  }

  function pickVideoMime() {
    return [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm'
    ].find(type => MediaRecorder.isTypeSupported(type)) || '';
  }

  function safeVideoName(value) {
    return String(value || 'realyze')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'realyze';
  }

  function drawCoverFill(ctx, image, width, height) {
    if (!image) {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#281c31');
      gradient.addColorStop(1, '#10131d');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      return;
    }

    if (!coverRenderCache || coverRenderCache.width !== width || coverRenderCache.height !== height) {
      coverRenderCache = document.createElement('canvas');
      coverRenderCache.width = width;
      coverRenderCache.height = height;
      const bg = coverRenderCache.getContext('2d', { alpha: false });
      const scale = Math.max(width / image.width, height / image.height);
      const dw = image.width * scale;
      const dh = image.height * scale;
      bg.save();
      bg.filter = 'blur(26px) saturate(.75) brightness(.72)';
      bg.drawImage(image, (width - dw) / 2 - 30, (height - dh) / 2 - 30, dw + 60, dh + 60);
      bg.restore();
    }
    ctx.drawImage(coverRenderCache, 0, 0, width, height);
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function drawVideoFrame(ctx, canvas, ms, mediaDuration, options = {}) {
    if (song?.distribution_style === 'chat' && options.finalElapsed === undefined) {
      drawChatVideoFrame(ctx, canvas, ms, mediaDuration);
      return;
    }
    const logicalWidth = 1280;
    const logicalHeight = 720;
    const scale = Math.min(canvas.width / logicalWidth, canvas.height / logicalHeight);
    const offsetX = (canvas.width - logicalWidth * scale) / 2;
    const offsetY = (canvas.height - logicalHeight * scale) / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const width = logicalWidth;
    const height = logicalHeight;
    drawCoverFill(ctx, coverImage, width, height);

    const shade = ctx.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, 'rgba(7,9,14,.60)');
    shade.addColorStop(.5, 'rgba(7,9,14,.76)');
    shade.addColorStop(1, 'rgba(7,9,14,.90)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '800 16px Space Grotesk, sans-serif';
    ctx.fillText('RƎ:ALYZE', 58, 52);
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.font = '700 10px Space Grotesk, sans-serif';
    ctx.fillText('LINE DISTRIBUTION', 58, 70);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 20px Space Grotesk, sans-serif';
    ctx.fillText(song.title, width - 58, 60);

    if (options.finalElapsed !== undefined) {
      drawFinalDistributionResult(ctx, width, height, options.finalElapsed);
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fillRect(58, height - 30, width - 116, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(58, height - 30, width - 116, 2);
      ctx.restore();
      return;
    }

    const visual = visualLineStateAt(ms);
    const first = orderedTimedLines()[0] || null;
    const beforeFirst = first && ms < Number(first.start_ms);

    if (visual.current) {
      drawSingerSegments(ctx, partInfo(visual.current).segments, width / 2, 142);
      const eased = easeOutCubic(visual.progress);
      const distance = 38;

      if (visual.prev) {
        ctx.save();
        ctx.globalAlpha = (1 - eased) * .95;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 28px Nunito, sans-serif';
        wrapCentered(ctx, visual.prev.lyric_text, width / 2, 198 - distance * eased, width - 300, 34);
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = .42 + .58 * eased;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 28px Nunito, sans-serif';
      wrapCentered(ctx, visual.current.lyric_text, width / 2, 198 + distance * (1 - eased), width - 300, 34);
      ctx.restore();

      if (visual.next) {
        const reveal = clamp01((visual.progress - .62) / .38);
        ctx.save();
        ctx.globalAlpha = .38 * reveal;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 14px Nunito, sans-serif';
        wrapCentered(ctx, visual.next.lyric_text, width / 2, 244, width - 360, 20);
        ctx.restore();
      }

      const visibleAdlibs = activeAdlibsAt(ms).filter(item => item.show_text && String(item.label || '').trim());
      if (visibleAdlibs.length) {
        ctx.save();
        ctx.globalAlpha = .6;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 11px Nunito, sans-serif';
        ctx.fillText(visibleAdlibs.map(item => item.label).join('  ·  '), width / 2, 272);
        ctx.restore();
      }
    } else if (beforeFirst || !first) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.font = '900 16px Space Grotesk, sans-serif';
      ctx.fillText('RƎ:ALYZE', width / 2, 145);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 29px Space Grotesk, sans-serif';
      wrapCentered(ctx, song.title, width / 2, 205, width - 340, 34);
      if (visual.next) {
        ctx.fillStyle = 'rgba(255,255,255,.32)';
        ctx.font = '700 14px Nunito, sans-serif';
        wrapCentered(ctx, visual.next.lyric_text, width / 2, 246, width - 390, 20);
      }
    }

    drawDistributionBoard(ctx, ms, activeItemsAt(ms), 50, 305, width - 100, 350, exportBoardMotion);

    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(58, height - 30, width - 116, 2);
    const progress = mediaDuration > 0 ? clamp01(ms / mediaDuration) : 0;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(58, height - 30, (width - 116) * progress, 2);
    ctx.restore();
  }

  function drawChatVideoFrame(ctx, canvas, ms, mediaDuration) {
    const logicalWidth = 1280;
    const logicalHeight = 720;
    const scale = Math.min(canvas.width / logicalWidth, canvas.height / logicalHeight);
    const offsetX = (canvas.width - logicalWidth * scale) / 2;
    const offsetY = (canvas.height - logicalHeight * scale) / 2;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();
    ctx.translate(offsetX, offsetY); ctx.scale(scale, scale);
    const width = logicalWidth, height = logicalHeight;
    ctx.fillStyle = '#f2f0f4'; ctx.fillRect(0,0,width,height);

    const leftX = 18, leftY = 18, leftW = 420, leftH = height - 36;
    roundedRect(ctx,leftX,leftY,leftW,leftH,24); ctx.save(); ctx.clip();
    drawChatCoverCached(ctx, coverImage, leftX, leftY, leftW, leftH);
    const shade = ctx.createLinearGradient(0,leftY,0,leftY+leftH);
    shade.addColorStop(0,'rgba(8,9,14,.18)'); shade.addColorStop(.55,'rgba(8,9,14,.30)'); shade.addColorStop(1,'rgba(8,9,14,.90)');
    ctx.fillStyle=shade; ctx.fillRect(leftX,leftY,leftW,leftH); ctx.restore();
    ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,.82)'; ctx.font='800 13px Space Grotesk, sans-serif'; ctx.fillText('RƎ:ALYZE',leftX+24,leftY+34);
    ctx.fillStyle='#fff'; ctx.font='800 29px Space Grotesk, sans-serif'; wrapLeft(ctx,song.title,leftX+24,leftY+74,leftW-48,32,2);

    const totals=totalsAt(ms); const ranked=rankedMembers(totals); const active=visualActiveSlugsAt(ms); const maxCurrent=Math.max(1,...members.map(member=>totals.get(member.slug)||0));
    const rowH=54; const rowsY=leftY+leftH-26-ranked.length*rowH;
    ranked.forEach((member,index)=>{
      const y=rowsY+index*rowH; const isActive=active.has(member.slug);
      ctx.save(); if(isActive){ctx.shadowColor=member.displayColor;ctx.shadowBlur=13;} roundedRect(ctx,leftX+22,y,leftW-44,43,13); ctx.fillStyle=isActive?'rgba(255,255,255,.16)':'rgba(0,0,0,.26)';ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle=isActive?member.displayColor:'rgba(255,255,255,.10)';ctx.lineWidth=isActive?2:1;ctx.stroke();ctx.restore();
      const avatarSize=30,ax=leftX+34,ay=y+6; if(member.videoImage)drawCircleImage(ctx,member.videoImage,ax,ay,avatarSize);else drawAvatarFallback(ctx,member,ax,ay,avatarSize);
      ctx.textAlign='left';ctx.fillStyle=member.displayColor;ctx.font='800 14px Nunito, sans-serif';ctx.fillText(member.name,ax+avatarSize+10,y+18);ctx.fillStyle='#fff';ctx.font='800 12px Space Grotesk, sans-serif';ctx.fillText(formatSeconds(totals.get(member.slug)||0),ax+avatarSize+10,y+34);
      const bx=leftX+190,by=y+25,bw=leftW-230;roundedRect(ctx,bx,by,bw,9,4.5);ctx.fillStyle='rgba(255,255,255,.13)';ctx.fill();const ratio=Math.max(0,Math.min(1,(totals.get(member.slug)||0)/maxCurrent));if(ratio>0){roundedRect(ctx,bx,by,bw*ratio,9,4.5);ctx.fillStyle=member.displayColor;ctx.fill();}ctx.textAlign='right';ctx.fillStyle='rgba(255,255,255,.56)';ctx.font='800 11px Space Grotesk, sans-serif';ctx.fillText(`#${index+1}`,leftX+leftW-34,y+18);
    });

    const rightX=466,rightY=18,rightW=width-rightX-18,rightH=height-36;
    roundedRect(ctx,rightX,rightY,rightW,rightH,24);ctx.fillStyle='#fbfafc';ctx.fill();
    ctx.fillStyle='#8d8795';ctx.font='800 11px Space Grotesk, sans-serif';ctx.textAlign='left';ctx.fillText('LINE DISTRIBUTION',rightX+28,rightY+31);
    const visual=visualLineStateAt(ms);ctx.textAlign='right';ctx.fillStyle='#aaa3b0';ctx.font='700 12px Nunito, sans-serif';ctx.fillText(visual.current?partInfo(visual.current).text:song.title,rightX+rightW-28,rightY+31);

    const visibleGroups=chatVisibleGroupsAt(ms);
    const typing=chatTypingAt(ms);
    const currentGroup=visibleGroups.at(-1)||null;
    const currentLine=currentGroup?chatCurrentLineInGroup(currentGroup,ms):null;
    const bottomLimit=rightY+rightH-64;
    const typingSpace=typing?26:0;
    const groupMetrics=visibleGroups.map(group=>{
      const lineFont=15.5, lineHeight=21;
      const bubbleW=Math.min(rightW*.63,500);
      const lineHeights=group.lines.map(line=>Math.max(1,estimateLines(ctx,line.lyric_text,bubbleW-34,lineFont))*lineHeight);
      const bubbleH=38+lineHeights.reduce((a,b)=>a+b,0)+12;
      return {group,bubbleW,lineFont,lineHeight,lineHeights,bubbleH,totalH:bubbleH+12};
    });
    const newestStart=currentGroup?Number(currentGroup.start_ms):0;
    const enter=currentGroup?clamp01((ms-newestStart)/420):1;
    let cursorY=bottomLimit-typingSpace;
    for(let i=groupMetrics.length-1;i>=0;i-=1){
      const metric=groupMetrics[i];
      const isNewest=i===groupMetrics.length-1;
      const pushAmount=isNewest?(1-enter)*34:(currentGroup && ms-newestStart<420 ? (1-enter)*34 : 0);
      cursorY-=metric.totalH*(isNewest?enter:1);
      let gy=cursorY+pushAmount;
      const alphaTop=gy<rightY+98?Math.max(0,Math.min(1,(gy-(rightY+56))/42)):1;
      if(alphaTop<=0){cursorY-=8;continue;}
      const membersForGroup=chatGroupMembers(metric.group);
      const avatarX=rightX+30, avatarY=gy+8;
      ctx.save();ctx.globalAlpha=alphaTop;
      membersForGroup.slice(0,3).forEach((member,idx)=>{
        const size=30;const x=avatarX+idx*18,y=avatarY;
        if(member.chatAvatarImage) drawCircleImage(ctx,member.chatAvatarImage,x,y,size); else drawAvatarFallback(ctx,member,x,y,size);
      });
      if(membersForGroup.length>3){ctx.fillStyle='#807985';ctx.font='800 9px Space Grotesk, sans-serif';ctx.fillText(`+${membersForGroup.length-3}`,avatarX+58,avatarY+19);}
      const bx=rightX+76,bw=metric.bubbleW;
      roundedRect(ctx,bx,gy,bw,metric.bubbleH,15);ctx.fillStyle=metric.group.current?'#ffffff':'#f0edf2';ctx.fill();ctx.strokeStyle='rgba(60,54,65,.07)';ctx.lineWidth=1;ctx.stroke();
      ctx.textAlign='left';ctx.font='800 9px Space Grotesk, sans-serif';drawColoredSingerText(ctx,partInfo(metric.group.lines[0]).segments,bx+16,gy+18);
      let ly=gy+43;
      metric.group.lines.forEach((line,lineIndex)=>{
        const isCurrent=line.id===currentLine?.id && metric.group.current;
        ctx.fillStyle=isCurrent?'#2d2931':'#96909a';
        ctx.font=isCurrent?'800 17px Space Grotesk, sans-serif':'700 15.5px Space Grotesk, sans-serif';
        if(isCurrent){ctx.save();ctx.translate(bx+16,ly);ctx.scale(1.04,1.04);wrapLeft(ctx,line.lyric_text,0,0,bw-34,metric.lineHeight,3);ctx.restore();}
        else wrapLeft(ctx,line.lyric_text,bx+16,ly,bw-34,metric.lineHeight,3);
        ly+=metric.lineHeights[lineIndex];
      });
      ctx.restore();
      cursorY-=8;
    }
    const fade=ctx.createLinearGradient(0,rightY+50,0,rightY+112);fade.addColorStop(0,'rgba(251,250,252,1)');fade.addColorStop(1,'rgba(251,250,252,0)');ctx.fillStyle=fade;ctx.fillRect(rightX+1,rightY+48,rightW-2,70);

    if(typing){ctx.textAlign='left';ctx.fillStyle='#aaa3ae';ctx.font='700 11px Nunito, sans-serif';ctx.fillText(typing.text,rightX+78,rightY+rightH-31);}
    const leaving=chatLeaveEventsAt(ms); leaving.slice(0,2).forEach((event,index)=>{const elapsed=ms-event.end;const alpha=Math.min(1,elapsed/180)*Math.min(1,(CHAT_LEAVE_HOLD_MS-elapsed)/300);ctx.save();ctx.globalAlpha=Math.max(0,alpha)*.72;ctx.textAlign='left';ctx.fillStyle=event.member.displayColor;ctx.font='800 10px Nunito, sans-serif';ctx.fillText(`${event.member.name} đã rời khỏi kênh chat`,rightX+78,rightY+rightH-52-index*18);ctx.restore();});

    const adlibVisuals=chatAdlibVisualsAt(ms).slice(0,3);
    adlibVisuals.forEach((state,index)=>{
      const item=state.item;const bx=rightX+rightW-220,baseY=rightY+rightH-86-index*52;const by=baseY-62*state.drift;
      ctx.save();ctx.globalAlpha=state.opacity;roundedRect(ctx,bx,by,190,40,13);ctx.fillStyle='rgba(255,255,255,.96)';ctx.fill();ctx.strokeStyle='rgba(0,0,0,.06)';ctx.stroke();const names=(item.member_slugs||[]).map(slug=>members.find(m=>m.slug===slug)?.name).filter(Boolean).join(' · ');ctx.textAlign='left';ctx.fillStyle='#8a8391';ctx.font='800 9px Nunito, sans-serif';ctx.fillText(names,bx+12,by+14);ctx.fillStyle='#34303a';ctx.font='700 14px Space Grotesk, sans-serif';ctx.fillText(item.label,bx+12,by+30);ctx.restore();
    });

    ctx.fillStyle='rgba(44,39,49,.12)';ctx.fillRect(rightX+28,height-38,rightW-56,2);const progress=mediaDuration>0?clamp01(ms/mediaDuration):0;ctx.fillStyle='#2d2832';ctx.fillRect(rightX+28,height-38,(rightW-56)*progress,2);ctx.restore();
  }

  function drawChatCoverCached(ctx, image, x, y, width, height) {
    if (!image) { ctx.fillStyle='#17141d'; ctx.fillRect(x,y,width,height); return; }
    if (!chatCoverRenderCache || chatCoverRenderCache.width!==width || chatCoverRenderCache.height!==height) {
      chatCoverRenderCache=document.createElement('canvas'); chatCoverRenderCache.width=width; chatCoverRenderCache.height=height;
      const bg=chatCoverRenderCache.getContext('2d',{alpha:false});
      const scale=Math.max(width/image.width,height/image.height); const dw=image.width*scale, dh=image.height*scale;
      bg.save(); bg.filter='blur(16px) saturate(1.05) brightness(.82)'; bg.drawImage(image,(width-dw)/2-20,(height-dh)/2-20,dw+40,dh+40); bg.restore();
    }
    ctx.drawImage(chatCoverRenderCache,x,y,width,height);
  }

  function wrapLeft(ctx,text,x,y,maxWidth,lineHeight,maxLines=99){
    const words=String(text||'').split(/\s+/); let line=''; let lineNo=0;
    for(let i=0;i<words.length;i+=1){ const test=line?`${line} ${words[i]}`:words[i]; if(ctx.measureText(test).width>maxWidth && line){ ctx.fillText(line,x,y+lineNo*lineHeight); line=words[i]; lineNo+=1; if(lineNo>=maxLines)return lineNo; } else line=test; }
    if(line && lineNo<maxLines){ ctx.fillText(line,x,y+lineNo*lineHeight); lineNo+=1; } return lineNo;
  }

  function estimateLines(ctx,text,maxWidth,fontSize){
    ctx.save(); ctx.font=`700 ${fontSize}px Nunito, sans-serif`; const words=String(text||'').split(/\s+/); let line='', linesCount=1; words.forEach(word=>{ const test=line?`${line} ${word}`:word; if(ctx.measureText(test).width>maxWidth && line){ linesCount+=1; line=word; } else line=test; }); ctx.restore(); return linesCount;
  }

  function drawColoredSingerText(ctx, segments, x, y){
    let cursor=x; ctx.textAlign='left';
    (segments||[]).forEach((segment,index)=>{ const text=`${index?' · ':''}${segment.text || ''}`; ctx.fillStyle=segment.color||'#3b3640'; ctx.fillText(text,cursor,y); cursor+=ctx.measureText(text).width; });
  }

  function drawFinalDistributionResult(ctx, width, height, elapsed = 99999) {
    const stats = distributionStats();
    const rows = stats.rows;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 31px Space Grotesk, sans-serif';
    ctx.fillText('FINAL DISTRIBUTION', 74, 126);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '700 13px Nunito, sans-serif';
    ctx.fillText(song.title, 74, 151);

    const donutX = 330;
    const donutY = 374;
    const radius = 157;
    const ring = 58;
    const donutReveal = easeOutCubic(clamp01(elapsed / 1650));
    drawDistributionDonut(ctx, rows, donutX, donutY, radius, ring, donutReveal);

    const centerAlpha = easeOutCubic(clamp01((elapsed - 1600) / 460));
    if (centerAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = centerAlpha;
      const scale = .9 + .1 * centerAlpha;
      ctx.translate(donutX, donutY);
      ctx.scale(scale, scale);
      ctx.translate(-donutX, -donutY);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 38px Space Grotesk, sans-serif';
      ctx.fillText(stats.totalMs > 0 ? '100%' : '—', donutX, donutY + 4);
      ctx.fillStyle = 'rgba(255,255,255,.43)';
      ctx.font = '800 11px Space Grotesk, sans-serif';
      ctx.fillText('LINE SHARE', donutX, donutY + 28);
      ctx.restore();
    }

    const tableX = 602;
    const tableY = 160;
    const tableW = width - tableX - 74;
    const rankX = tableX + 8;
    const memberX = tableX + 64;
    const timeX = tableX + tableW - 150;
    const pctX = tableX + tableW - 8;
    const headAlpha = clamp01((elapsed - 580) / 360);

    ctx.save();
    ctx.globalAlpha = headAlpha;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.38)';
    ctx.font = '800 10px Space Grotesk, sans-serif';
    ctx.fillText('#', rankX, tableY);
    ctx.fillText('MEMBER', memberX, tableY);
    ctx.textAlign = 'right';
    ctx.fillText('TIME', timeX, tableY);
    ctx.fillText('%', pctX, tableY);
    ctx.restore();

    const rowStart = tableY + 23;
    const maxRowsHeight = 365;
    const rowH = Math.min(39, maxRowsHeight / Math.max(1, rows.length));
    rows.forEach((row, index) => {
      const alpha = easeOutCubic(clamp01((elapsed - (700 + index * 85)) / 420));
      if (alpha <= 0) return;
      const y = rowStart + index * rowH;
      const centerY = y + rowH / 2;
      const lift = (1 - alpha) * 10;
      ctx.save();
      ctx.globalAlpha = alpha;

      roundedRect(ctx, tableX, y + lift, tableW, Math.max(29, rowH - 4), 11);
      ctx.fillStyle = index === 0 ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.035)';
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.fillStyle = index < 3 ? '#ffffff' : 'rgba(255,255,255,.56)';
      ctx.font = '800 13px Space Grotesk, sans-serif';
      ctx.fillText(`#${index + 1}`, rankX, centerY + 5 + lift);

      ctx.beginPath();
      ctx.arc(memberX + 6, centerY + lift, 5, 0, Math.PI * 2);
      ctx.fillStyle = row.member.displayColor;
      ctx.fill();

      ctx.fillStyle = row.member.displayColor;
      ctx.font = '800 15px Nunito, sans-serif';
      ctx.fillText(row.member.name, memberX + 20, centerY + 5 + lift);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 14px Space Grotesk, sans-serif';
      ctx.fillText(formatSeconds(row.ms), timeX, centerY + 5 + lift);
      ctx.fillStyle = row.member.displayColor;
      ctx.fillText(`${row.percent.toFixed(1)}%`, pctX, centerY + 5 + lift);
      ctx.restore();
    });

    const balanceAlpha = easeOutCubic(clamp01((elapsed - 1780) / 450));
    if (balanceAlpha > 0) {
      const balanceW = 250;
      const balanceH = 62;
      const balanceX = width - 74 - balanceW;
      const balanceY = height - 112 + (1 - balanceAlpha) * 8;
      ctx.save();
      ctx.globalAlpha = balanceAlpha;
      roundedRect(ctx, balanceX, balanceY, balanceW, balanceH, 15);
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.10)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,.42)';
      ctx.font = '800 10px Space Grotesk, sans-serif';
      ctx.fillText('LINE BALANCE', balanceX + 17, balanceY + 25);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 27px Space Grotesk, sans-serif';
      ctx.fillText(stats.balance == null ? '—' : `${Math.round(stats.balance)}%`, balanceX + balanceW - 17, balanceY + 39);
      ctx.restore();
    }
  }

  function drawDistributionDonut(ctx, rows, centerX, centerY, radius, ringWidth, reveal = 1) {
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineWidth = ringWidth;
    const availableSweep = Math.PI * 2 * clamp01(reveal);
    let consumed = 0;
    let angle = -Math.PI / 2;
    rows.forEach(row => {
      if (row.percent <= 0 || consumed >= availableSweep) return;
      const fullSweep = Math.PI * 2 * (row.percent / 100);
      const sweep = Math.min(fullSweep, availableSweep - consumed);
      if (sweep <= 0) return;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius - ringWidth / 2, angle, angle + sweep);
      ctx.strokeStyle = row.member.displayColor;
      ctx.stroke();
      angle += fullSweep;
      consumed += sweep;
    });
    ctx.restore();
  }

  function drawDistributionBoard(ctx, ms, activeItems, x, y, width, height, motionState = null) {
    if (!members.length) return;

    const totals = totalsAt(ms);
    const ranked = rankedMembers(totals);
    const maxCurrent = Math.max(1, ...members.map(member => totals.get(member.slug) || 0));
    const active = new Set();
    (activeItems || []).forEach(item => visualActiveSlugs(item).forEach(slug => active.add(slug)));
    const columns = ranked.length <= 4 ? ranked.length : Math.min(4, Math.ceil(ranked.length / 2));
    const rows = Math.ceil(ranked.length / columns);
    const gapX = 14;
    const gapY = 14;
    const cardWidth = (width - gapX * (columns - 1)) / columns;
    const cardHeight = Math.min(148, (height - gapY * (rows - 1)) / rows);

    const targetBySlug = new Map();
    ranked.forEach((member, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      targetBySlug.set(member.slug, {
        x: x + col * (cardWidth + gapX),
        y: y + row * (cardHeight + gapY),
        rank: index
      });
    });

    let dt = 0;
    if (motionState) {
      if (ms < motionState.lastMs) motionState.positions.clear();
      dt = Math.max(0, Math.min(100, ms - motionState.lastMs));
      motionState.lastMs = ms;
    }
    const moveAlpha = motionState ? (1 - Math.exp(-dt / 420)) : 1;

    ranked.forEach(member => {
      const target = targetBySlug.get(member.slug);
      let cx = target.x;
      let cy = target.y;
      if (motionState) {
        let pos = motionState.positions.get(member.slug);
        if (!pos) {
          pos = { x: target.x, y: target.y };
          motionState.positions.set(member.slug, pos);
        } else {
          pos.x += (target.x - pos.x) * moveAlpha;
          pos.y += (target.y - pos.y) * moveAlpha;
        }
        cx = pos.x;
        cy = pos.y;
      }

      const isActive = active.has(member.slug);
      const total = totals.get(member.slug) || 0;
      const barRatio = Math.max(0, Math.min(1, total / maxCurrent));

      ctx.save();
      if (isActive) {
        ctx.shadowColor = member.displayColor;
        ctx.shadowBlur = 16;
      }
      roundedRect(ctx, cx, cy, cardWidth, cardHeight, 18);
      ctx.fillStyle = isActive ? 'rgba(255,255,255,.13)' : 'rgba(15,17,24,.58)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = isActive ? 2.4 : 1;
      ctx.strokeStyle = isActive ? member.displayColor : 'rgba(255,255,255,.10)';
      ctx.stroke();
      ctx.restore();

      ctx.textAlign = 'right';
      ctx.fillStyle = isActive ? member.displayColor : 'rgba(255,255,255,.40)';
      ctx.font = '800 14px Space Grotesk, sans-serif';
      ctx.fillText(`#${target.rank + 1}`, cx + cardWidth - 16, cy + 25);

      const avatarSize = Math.min(66, cardHeight - 50);
      const avatarX = cx + 18;
      const avatarY = cy + 16;
      if (member.videoImage) drawCircleImage(ctx, member.videoImage, avatarX, avatarY, avatarSize);
      else drawAvatarFallback(ctx, member, avatarX, avatarY, avatarSize);

      ctx.textAlign = 'left';
      ctx.fillStyle = member.displayColor;
      ctx.font = '800 17px Nunito, sans-serif';
      ctx.fillText(member.name, avatarX + avatarSize + 14, cy + 39);

      ctx.fillStyle = '#ffffff';
      ctx.font = '800 21px Space Grotesk, sans-serif';
      ctx.fillText(formatSeconds(total), avatarX + avatarSize + 14, cy + 67);

      const trackX = cx + 18;
      const trackY = cy + cardHeight - 27;
      const trackW = cardWidth - 36;
      roundedRect(ctx, trackX, trackY, trackW, 13, 6.5);
      ctx.fillStyle = 'rgba(255,255,255,.11)';
      ctx.fill();
      if (barRatio > 0) {
        ctx.save();
        if (isActive) {
          ctx.shadowColor = member.displayColor;
          ctx.shadowBlur = 10;
        }
        roundedRect(ctx, trackX, trackY, trackW * barRatio, 13, 6.5);
        ctx.fillStyle = member.displayColor;
        ctx.fill();
        ctx.restore();
      }
    });
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawCircleImage(ctx, image, x, y, size) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max(size / image.width, size / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.drawImage(image, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
    ctx.restore();
  }

  function drawAvatarFallback(ctx, member, x, y, size) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = `${member.displayColor}33`;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = member.displayColor;
    ctx.font = '800 18px Nunito, sans-serif';
    ctx.fillText(initials(member.name), x + size / 2, y + size / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  function drawSingerSegments(ctx, segments, centerX, y) {
    ctx.font = '800 22px Nunito, sans-serif';
    const parts = [{ text: '「 ', color: '#ffffff' }];
    segments.forEach((segment, index) => {
      if (index) parts.push({ text: '・', color: 'rgba(255,255,255,.50)' });
      parts.push(segment);
    });
    parts.push({ text: ' 」', color: '#ffffff' });

    const totalWidth = parts.reduce((sum, part) => sum + ctx.measureText(part.text).width, 0);
    let x = centerX - totalWidth / 2;
    ctx.textAlign = 'left';
    parts.forEach(part => {
      ctx.fillStyle = part.color;
      ctx.fillText(part.text, x, y);
      x += ctx.measureText(part.text).width;
    });
  }

  function wrapCentered(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const rows = [];
    let row = '';
    words.forEach(word => {
      const test = row ? `${row} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && row) {
        rows.push(row);
        row = word;
      } else {
        row = test;
      }
    });
    if (row) rows.push(row);
    const offset = (rows.length - 1) * lineHeight / 2;
    rows.forEach((value, index) => ctx.fillText(value, x, y - offset + index * lineHeight));
  }

  addEventListener('beforeunload', event => {
    if (dirtyIds.size || exporting) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
})();
