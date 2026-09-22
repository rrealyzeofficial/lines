(async () => {
  const { $, db, ensureConfigured } = RLZ;
  ensureConfigured();
  if (db) {
    const { data } = await db.auth.getSession();
    if (data.session) location.replace('index.html');
  }
  const reason = new URLSearchParams(location.search).get('reason');
  if (reason === 'not-member') {
    $('#loginError').textContent = 'Tài khoản này chưa được liên kết với member REALYZE.';
    $('#loginError').classList.remove('hidden');
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ensureConfigured()) return;
    const btn = $('#loginBtn'); const errorBox = $('#loginError');
    errorBox.classList.add('hidden'); btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
    try {
      const { data, error } = await db.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
      if (error) throw error;
      const { data: member, error: memberError } = await db.from('team_members').select('slug').eq('auth_user_id', data.user.id).eq('is_active', true).maybeSingle();
      if (memberError) throw memberError;
      if (!member) { await db.auth.signOut(); throw new Error('Tài khoản hợp lệ nhưng chưa được liên kết với member REALYZE.'); }
      location.replace('index.html');
    } catch (err) {
      errorBox.textContent = err.message || 'Không thể đăng nhập.'; errorBox.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.innerHTML = 'Đăng nhập <span>→</span>';
    }
  });
})();
