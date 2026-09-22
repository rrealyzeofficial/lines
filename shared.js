(() => {
  const url = window.REALYZE_SUPABASE_URL || '';
  const key = window.REALYZE_SUPABASE_PUBLISHABLE_KEY || '';
  const configured = url && key && !url.includes('PASTE_') && !key.includes('PASTE_');
  const db = configured ? window.supabase.createClient(url, key) : null;

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function toast(message, type = 'info') {
    let host = $('#toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  function ensureConfigured() {
    if (configured) return true;
    const target = $('#configWarning') || document.body;
    if (!$('#configWarning')) {
      const box = document.createElement('div');
      box.id = 'configWarning';
      box.className = 'config-warning';
      box.innerHTML = '<b>Chưa cấu hình Supabase.</b><br>Hãy mở <code>supabase-config.js</code> và chép URL + Publishable Key từ Team Space cũ.';
      target.prepend(box);
    }
    return false;
  }

  async function requireMember() {
    if (!ensureConfigured()) throw new Error('Supabase chưa được cấu hình');
    const { data: sessionData, error: sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData.session?.user;
    if (!user) {
      location.replace('login.html');
      throw new Error('Chưa đăng nhập');
    }

    const { data: member, error } = await db
      .from('team_members')
      .select('slug,display_name,color,auth_user_id,is_owner,is_active')
      .eq('auth_user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!member) {
      await db.auth.signOut();
      location.replace('login.html?reason=not-member');
      throw new Error('Tài khoản chưa được nối với member REALYZE');
    }

    const { data: profile } = await db
      .from('team_member_profiles')
      .select('member_slug,stage_name,profile_color,avatar_path')
      .eq('member_slug', member.slug)
      .maybeSingle();

    return { user, member: { ...member, profile: profile || null } };
  }

  async function getMembers({ onlyActive = true } = {}) {
    let query = db.from('team_members')
      .select('slug,display_name,color,is_owner,is_active,created_at')
      .order('created_at', { ascending: true });
    if (onlyActive) query = query.eq('is_active', true);
    const { data: roster, error } = await query;
    if (error) throw error;

    const slugs = (roster || []).map(m => m.slug);
    let profiles = [];
    if (slugs.length) {
      const res = await db.from('team_member_profiles')
        .select('member_slug,stage_name,profile_color,avatar_path')
        .in('member_slug', slugs);
      if (res.error) throw res.error;
      profiles = res.data || [];
    }
    const pmap = new Map(profiles.map(p => [p.member_slug, p]));
    return (roster || []).map(m => {
      const p = pmap.get(m.slug) || {};
      return {
        ...m,
        name: p.stage_name || m.display_name,
        displayColor: p.profile_color || m.color || '#ffffff',
        avatar_path: p.avatar_path || null,
      };
    });
  }

  async function signedUrl(bucket, path, expires = 3600) {
    if (!path) return '';
    const { data, error } = await db.storage.from(bucket).createSignedUrl(path, expires);
    if (error) return '';
    return data?.signedUrl || '';
  }

  async function memberAvatar(member, expires = 3600) {
    if (!member?.avatar_path) return '';
    return signedUrl('member-avatars', member.avatar_path, expires);
  }

  async function mountTopbar(session) {
    const name = $('#currentMemberName');
    const dot = $('#currentMemberDot');
    const avatar = $('#currentMemberAvatar');
    if (name) name.textContent = session.member.profile?.stage_name || session.member.display_name;
    const color = session.member.profile?.profile_color || session.member.color || '#fff';
    if (dot) dot.style.background = color;
    if (avatar) {
      const src = await memberAvatar({ avatar_path: session.member.profile?.avatar_path });
      if (src) {
        avatar.src = src;
        avatar.classList.remove('hidden');
      }
    }
    const logout = $('#logoutBtn');
    if (logout) logout.onclick = async () => {
      await db.auth.signOut();
      location.replace('login.html');
    };
  }

  function songIdFromUrl() {
    return new URLSearchParams(location.search).get('id');
  }

  function safeFileName(name = 'file') {
    return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'file';
  }

  window.RLZ = {
    db, configured, $, $$, escapeHtml, toast, ensureConfigured, requireMember,
    getMembers, signedUrl, memberAvatar, mountTopbar, songIdFromUrl, safeFileName,
  };
})();
