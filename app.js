(() => {
  'use strict';

  const config = window.SAMAK_CONFIG || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    supabase: null,
    session: null,
    profile: null,
    settings: null,
    currentTab: 'dashboard',
    memberEditId: null,
    bookEditId: null,
    activeReport: null,
    clockTimer: null,
    cachedMembers: [],
    cachedBooks: []
  };

  const els = {
    appShell: $('#appShell'),
    loginModal: $('#loginModal'),
    loginForm: $('#loginForm'),
    loginUsername: $('#loginUsername'),
    loginPassword: $('#loginPassword'),
    loginError: $('#loginError'),
    loginSubmit: $('#loginSubmit'),
    logoutBtn: $('#logoutBtn'),
    tabs: $('#tabs'),
    panelContent: $('#panelContent'),
    main: $('#main'),
    libName: $('#libName'),
    logoEl: $('#logoEl'),
    nowShamsi: $('#nowShamsi'),
    currentUserLabel: $('#currentUserLabel'),
    themeToggle: $('#themeToggle'),
    toastWrap: $('#toastWrap'),
    printArea: $('#printArea')
  };

  const formatterDateTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const formatterDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  });

  function assertConfig() {
    const invalid = !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY ||
      config.SUPABASE_URL.includes('YOUR_PROJECT_ID') ||
      config.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');
    if (invalid) {
      throw new Error('ابتدا مقادیر SUPABASE_URL و SUPABASE_ANON_KEY را در config.js تنظیم کنید.');
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
  }

  function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function normalizeDigits(value) {
    const fa = '۰۱۲۳۴۵۶۷۸۹';
    const ar = '٠١٢٣٤٥٦٧٨٩';
    return String(value ?? '')
      .replace(/[۰-۹]/g, d => String(fa.indexOf(d)))
      .replace(/[٠-٩]/g, d => String(ar.indexOf(d)));
  }

  function normalizeUsername(value) {
    return normalizeDigits(value)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9._-]/g, '');
  }

  function usernameToEmail(username) {
    const clean = normalizeUsername(username);
    if (!clean) return '';
    return `${clean}@${config.USERNAME_DOMAIN || 'library.local'}`;
  }

  function toShamsi(value, includeTime = false) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return includeTime ? formatterDateTime.format(date) : formatterDate.format(date);
  }

  function remainingDays(loan) {
    if (!loan || loan.returned_at) return null;
    const due = new Date(loan.due_at);
    if (Number.isNaN(due.getTime())) return null;
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / 86400000);
  }

  function remainingLabel(loan) {
    const days = remainingDays(loan);
    if (days === null) return '—';
    if (days < 0) return `دیرکرد ${Math.abs(days)} روز`;
    if (days === 0) return 'سررسید امروز';
    return `${days} روز`;
  }

  function showToast(message, type = 'success', timeout = 3200) {
    const node = document.createElement('div');
    node.className = `toast${type === 'error' ? ' error' : ''}`;
    node.textContent = message;
    els.toastWrap.appendChild(node);
    window.setTimeout(() => node.remove(), timeout);
  }

  function friendlyError(error) {
    const message = error?.message || String(error || 'خطای نامشخص');
    if (/duplicate key|unique constraint/i.test(message)) return 'مقدار تکراری است و قبلاً ثبت شده است.';
    if (/foreign key|violates foreign key/i.test(message)) return 'این رکورد سابقه مرتبط دارد و قابل حذف نیست.';
    if (/permission denied|row-level security|not authorized/i.test(message)) return 'اجازه انجام این عملیات را ندارید.';
    if (/Failed to fetch|NetworkError/i.test(message)) return 'ارتباط با پایگاه‌داده برقرار نشد. اینترنت و تنظیمات پروژه را بررسی کنید.';
    return message;
  }

  function handleError(error, prefix = 'خطا') {
    console.error(error);
    showToast(`${prefix}: ${friendlyError(error)}`, 'error', 5000);
  }

  function setBusy(button, busy, label = 'در حال انجام…') {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  function downloadFile(content, filename, mime = 'application/json;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadCsv(rows, filename) {
    downloadFile(`\uFEFF${rows.join('\n')}`, filename, 'text/csv;charset=utf-8');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text ?? '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '"') {
        if (quoted && source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (ch === ',' && !quoted) {
        row.push(cell.trim());
        cell = '';
      } else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && source[i + 1] === '\n') i += 1;
        row.push(cell.trim());
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell.trim());
    if (row.some(value => value !== '')) rows.push(row);
    return rows;
  }

  async function resizeImage(file, maxWidth = 600, maxHeight = 600, quality = 0.78) {
    if (!file) return '';
    if (!file.type.startsWith('image/')) throw new Error('فایل انتخاب‌شده تصویر نیست.');
    if (file.size > 8 * 1024 * 1024) throw new Error('حجم تصویر بیشتر از ۸ مگابایت است.');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('خطا در خواندن تصویر'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('تصویر قابل پردازش نیست.'));
      img.src = dataUrl;
    });
    const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const width = Math.max(1, Math.round(image.width * ratio));
    const height = Math.max(1, Math.round(image.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function query(builder) {
    const result = await builder;
    if (result.error) throw result.error;
    return result.data;
  }

  function isAdmin() {
    return state.profile?.role === 'admin';
  }

  function requireAdmin() {
    if (!isAdmin()) {
      showToast('این بخش فقط برای مدیر سامانه قابل دسترسی است.', 'error');
      return false;
    }
    return true;
  }

  async function loadProfile() {
    const userId = state.session?.user?.id;
    if (!userId) throw new Error('نشست کاربری معتبر نیست.');
    state.profile = await query(
      state.supabase.from('profiles').select('*').eq('id', userId).single()
    );
    if (!state.profile.active) {
      await state.supabase.auth.signOut();
      throw new Error('حساب کاربری شما غیرفعال شده است.');
    }
    const loginMark = await state.supabase.rpc('mark_login');
    if (loginMark.error) console.warn('mark_login failed', loginMark.error);
    state.profile.last_login_at = new Date().toISOString();
  }

  async function loadSettings() {
    const settings = await query(
      state.supabase.from('library_settings').select('*').eq('id', 1).single()
    );
    state.settings = settings;
    els.libName.textContent = settings.library_name || 'سامانه مدیریت کتابخانه';
    if (settings.logo_data) {
      els.logoEl.innerHTML = `<img src="${escapeHtml(settings.logo_data)}" alt="نشان کتابخانه">`;
    } else {
      els.logoEl.textContent = '📚';
    }
    applyTheme(localStorage.getItem('samak-theme') || settings.default_theme || 'light');
  }

  function applyTheme(theme) {
    const safeTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = safeTheme;
    localStorage.setItem('samak-theme', safeTheme);
    els.themeToggle.textContent = safeTheme === 'dark' ? '☀' : '◐';
  }

  function startClock() {
    if (state.clockTimer) window.clearInterval(state.clockTimer);
    const update = () => { els.nowShamsi.textContent = toShamsi(new Date(), true); };
    update();
    state.clockTimer = window.setInterval(update, 1000);
  }

  async function enterApp(session) {
    state.session = session;
    await loadProfile();
    await loadSettings();
    els.currentUserLabel.textContent = `${state.profile.full_name} — ${state.profile.role === 'admin' ? 'مدیر سامانه' : 'کتابدار'}`;
    $$('.admin-only').forEach(el => el.classList.toggle('is-hidden', !isAdmin()));
    els.loginModal.classList.add('is-hidden');
    els.appShell.classList.remove('is-hidden');
    els.appShell.setAttribute('aria-hidden', 'false');
    startClock();
    await showTab('dashboard');
  }

  function leaveApp() {
    state.session = null;
    state.profile = null;
    state.settings = null;
    if (state.clockTimer) window.clearInterval(state.clockTimer);
    els.appShell.classList.add('is-hidden');
    els.appShell.setAttribute('aria-hidden', 'true');
    els.loginModal.classList.remove('is-hidden');
    els.loginPassword.value = '';
    els.loginError.textContent = '';
    window.setTimeout(() => els.loginUsername.focus(), 100);
  }

  async function login(event) {
    event.preventDefault();
    els.loginError.textContent = '';
    const username = normalizeUsername(els.loginUsername.value);
    const password = els.loginPassword.value;
    if (!username || password.length < 8) {
      els.loginError.textContent = 'نام کاربری معتبر و رمز عبور حداقل ۸ کاراکتری وارد کنید.';
      return;
    }
    setBusy(els.loginSubmit, true, 'در حال بررسی…');
    try {
      const { data, error } = await state.supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password
      });
      if (error) throw error;
      await enterApp(data.session);
      showToast('ورود با موفقیت انجام شد.');
    } catch (error) {
      console.error(error);
      els.loginError.textContent = /Invalid login credentials/i.test(error.message)
        ? 'نام کاربری یا رمز عبور نادرست است.'
        : friendlyError(error);
      await state.supabase.auth.signOut().catch(() => {});
    } finally {
      setBusy(els.loginSubmit, false);
    }
  }

  async function logout() {
    try {
      await state.supabase.auth.signOut();
    } catch (error) {
      handleError(error, 'خطا در خروج');
    } finally {
      leaveApp();
    }
  }

  function setActiveTab(tab) {
    $$('.nav-btn', els.tabs).forEach(button => {
      button.classList.toggle('is-active', button.dataset.tab === tab);
    });
  }

  async function showTab(tab) {
    if (tab === 'settings' && !requireAdmin()) return;
    state.currentTab = tab;
    setActiveTab(tab);
    els.panelContent.innerHTML = '<div class="empty-state">در حال آماده‌سازی…</div>';
    els.main.innerHTML = '<div class="empty-state">در حال دریافت اطلاعات…</div>';
    try {
      const renderers = {
        dashboard: renderDashboard,
        members: renderMembers,
        books: renderBooks,
        loans: renderLoans,
        reports: renderReports,
        cards: renderCards,
        settings: renderSettings
      };
      await (renderers[tab] || renderDashboard)();
    } catch (error) {
      handleError(error, 'خطا در نمایش بخش');
      els.main.innerHTML = `<div class="empty-state">${escapeHtml(friendlyError(error))}</div>`;
    }
  }

  async function renderDashboard() {
    const [membersCount, booksCount, activeLoansCount, overdueLoans, recentMembers, recentLoans] = await Promise.all([
      state.supabase.from('members').select('*', { count: 'exact', head: true }),
      state.supabase.from('books').select('*', { count: 'exact', head: true }),
      state.supabase.from('loans').select('*', { count: 'exact', head: true }).is('returned_at', null),
      query(state.supabase.from('loans').select('id,due_at').is('returned_at', null).lt('due_at', new Date().toISOString())),
      query(state.supabase.from('members').select('id,membership_code,first_name,last_name,registered_at').order('registered_at', { ascending: false }).limit(8)),
      query(state.supabase.from('loans').select('id,issue_at,due_at,returned_at,members(first_name,last_name),books(title)').order('issue_at', { ascending: false }).limit(8))
    ]);
    for (const result of [membersCount, booksCount, activeLoansCount]) if (result.error) throw result.error;

    els.panelContent.innerHTML = `
      <h2 class="section-title">نمای کلی سامانه</h2>
      <p class="section-note">آمار لحظه‌ای کتابخانه بر اساس اطلاعات پایگاه‌داده مرکزی نمایش داده می‌شود.</p>
      <div class="form-actions">
        <button class="btn btn-primary" data-go="members">ثبت عضو</button>
        <button class="btn btn-soft" data-go="books">ثبت کتاب</button>
        <button class="btn btn-accent" data-go="loans">ثبت امانت</button>
      </div>`;
    $$('[data-go]', els.panelContent).forEach(button => button.addEventListener('click', () => showTab(button.dataset.go)));

    els.main.innerHTML = `
      <div class="stats-grid">
        <article class="stat-card"><span>تعداد اعضا</span><strong>${membersCount.count || 0}</strong></article>
        <article class="stat-card"><span>عنوان‌های کتاب</span><strong>${booksCount.count || 0}</strong></article>
        <article class="stat-card"><span>امانات جاری</span><strong>${activeLoansCount.count || 0}</strong></article>
        <article class="stat-card warn"><span>امانات دارای دیرکرد</span><strong>${overdueLoans.length}</strong></article>
      </div>
      <div class="info-grid">
        <article class="info-card">
          <h3>آخرین اعضای ثبت‌شده</h3>
          <div class="list-plain">${recentMembers.length ? recentMembers.map(member => `
            <div class="list-item"><span>${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)}</span><strong>${escapeHtml(member.membership_code)}</strong></div>`).join('') : '<div class="empty-state">عضوی ثبت نشده است.</div>'}</div>
        </article>
        <article class="info-card">
          <h3>آخرین گردش امانت</h3>
          <div class="list-plain">${recentLoans.length ? recentLoans.map(loan => `
            <div class="list-item"><span>${escapeHtml(loan.members?.first_name)} ${escapeHtml(loan.members?.last_name)} — ${escapeHtml(loan.books?.title)}</span><strong>${loan.returned_at ? 'بازگشت' : toShamsi(loan.due_at)}</strong></div>`).join('') : '<div class="empty-state">امانتی ثبت نشده است.</div>'}</div>
        </article>
      </div>`;
  }

  function memberFormHtml(member = {}) {
    const grades = state.settings?.grades || [];
    const fields = state.settings?.fields || [];
    return `
      <h2 class="section-title">${member.id ? 'ویرایش عضو' : 'ثبت عضو جدید'}</h2>
      <form id="memberForm" class="form-grid" novalidate>
        <div class="form-row"><label for="mCode">کد عضویت</label><input id="mCode" required maxlength="30" value="${escapeHtml(member.membership_code || '')}"></div>
        <div class="form-row"><label for="mFirst">نام</label><input id="mFirst" required maxlength="80" value="${escapeHtml(member.first_name || '')}"></div>
        <div class="form-row"><label for="mLast">نام خانوادگی</label><input id="mLast" required maxlength="100" value="${escapeHtml(member.last_name || '')}"></div>
        <div class="form-row"><label for="mPhone">شماره تماس</label><input id="mPhone" required inputmode="tel" maxlength="20" value="${escapeHtml(member.phone || '')}"></div>
        <div class="form-row"><label for="mNational">کد ملی</label><input id="mNational" inputmode="numeric" maxlength="20" value="${escapeHtml(member.national_code || '')}"></div>
        <div class="form-row"><label for="mGrade">پایه</label><select id="mGrade">${grades.map(item => `<option${item === member.grade ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div>
        <div class="form-row"><label for="mField">رشته</label><select id="mField">${fields.map(item => `<option${item === member.field ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div>
        <div class="form-row"><label>تعهدنامه</label><div class="radio-group">
          <label><input type="radio" name="commitment" value="true"${member.commitment !== false ? ' checked' : ''}> دارد</label>
          <label><input type="radio" name="commitment" value="false"${member.commitment === false ? ' checked' : ''}> ندارد</label>
        </div></div>
        <div class="form-row"><label for="mPhoto">عکس</label><input id="mPhoto" type="file" accept="image/jpeg,image/png,image/webp"></div>
        <div class="form-row"><label>پیش‌نمایش</label><img id="mPhotoPreview" class="photo-preview" src="${escapeHtml(member.photo_data || '')}" alt="پیش‌نمایش عکس عضو"></div>
        <div class="form-actions">
          <button id="memberSave" class="btn btn-primary" type="submit">${member.id ? 'ذخیره تغییرات' : 'ثبت عضو'}</button>
          ${member.id ? '<button id="memberCancel" class="btn btn-soft" type="button">انصراف</button>' : ''}
          <button id="memberImport" class="btn btn-soft" type="button">ورود CSV</button>
          <button id="memberSample" class="btn btn-outline" type="button">نمونه CSV</button>
          <button id="memberExport" class="btn btn-outline" type="button">خروجی CSV</button>
        </div>
      </form>`;
  }

  async function nextMemberCode() {
    const latest = await query(state.supabase.from('members').select('membership_code').order('id', { ascending: false }).limit(1));
    if (!latest.length) return '1000';
    const numeric = Number(normalizeDigits(latest[0].membership_code));
    return Number.isFinite(numeric) ? String(numeric + 1) : '';
  }

  async function renderMembers(editMember = null) {
    state.memberEditId = editMember?.id || null;
    const initial = editMember || { membership_code: await nextMemberCode(), commitment: true };
    els.panelContent.innerHTML = memberFormHtml(initial);
    await renderMembersList();

    $('#mPhoto').addEventListener('change', async event => {
      try {
        $('#mPhotoPreview').src = await resizeImage(event.target.files[0]);
      } catch (error) { handleError(error, 'خطا در تصویر'); }
    });
    $('#memberForm').addEventListener('submit', saveMember);
    $('#memberCancel')?.addEventListener('click', () => renderMembers());
    $('#memberSample').addEventListener('click', downloadMemberSample);
    $('#memberExport').addEventListener('click', exportMembersCsv);
    $('#memberImport').addEventListener('click', importMembersCsv);
  }

  async function saveMember(event) {
    event.preventDefault();
    const button = $('#memberSave');
    const payload = {
      membership_code: normalizeDigits($('#mCode').value.trim()),
      first_name: $('#mFirst').value.trim(),
      last_name: $('#mLast').value.trim(),
      phone: normalizeDigits($('#mPhone').value.trim()),
      national_code: normalizeDigits($('#mNational').value.trim()),
      grade: $('#mGrade').value,
      field: $('#mField').value,
      commitment: $('input[name="commitment"]:checked').value === 'true',
      photo_data: $('#mPhotoPreview').src.startsWith('data:image/') ? $('#mPhotoPreview').src : null
    };
    if (!payload.membership_code || !payload.first_name || !payload.last_name || !payload.phone) {
      showToast('کد عضویت، نام، نام خانوادگی و تلفن الزامی است.', 'error');
      return;
    }
    setBusy(button, true);
    try {
      if (state.memberEditId) {
        await query(state.supabase.from('members').update(payload).eq('id', state.memberEditId));
        showToast('اطلاعات عضو ویرایش شد.');
      } else {
        await query(state.supabase.from('members').insert({ ...payload, created_by: state.profile.id }));
        showToast('عضو جدید ثبت شد.');
      }
      await showTab('members');
    } catch (error) { handleError(error, 'ثبت عضو ناموفق بود'); }
    finally { setBusy(button, false); }
  }

  async function renderMembersList({ queryText = '', page = 1, pageSize = 25 } = {}) {
    let builder = state.supabase.from('members').select('*', { count: 'exact' }).order('registered_at', { ascending: false });
    if (queryText) {
      const q = queryText.replace(/[%(),]/g, ' ').trim();
      builder = builder.or(`membership_code.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%,national_code.ilike.%${q}%`);
    }
    const from = (page - 1) * pageSize;
    const result = await builder.range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const members = result.data || [];
    const total = result.count || 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));

    els.main.innerHTML = `
      <div class="toolbar">
        <input id="memberSearch" class="search-input" placeholder="جست‌وجو بر اساس نام، کد عضویت، تلفن یا کد ملی" value="${escapeHtml(queryText)}">
        <select id="memberPageSize"><option${pageSize === 10 ? ' selected' : ''}>10</option><option${pageSize === 25 ? ' selected' : ''}>25</option><option${pageSize === 50 ? ' selected' : ''}>50</option></select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>کد عضویت</th><th>نام و نام خانوادگی</th><th>تلفن</th><th>پایه</th><th>رشته</th><th>تعهد</th><th>عملیات</th></tr></thead>
        <tbody>${members.length ? members.map(member => `<tr>
          <td>${escapeHtml(member.membership_code)}</td>
          <td>${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)}</td>
          <td>${escapeHtml(member.phone)}</td><td>${escapeHtml(member.grade)}</td><td>${escapeHtml(member.field)}</td>
          <td><span class="status ${member.commitment ? 'status-success' : 'status-danger'}">${member.commitment ? 'دارد' : 'ندارد'}</span></td>
          <td><div class="row-actions"><button class="row-btn" data-edit-member="${member.id}">ویرایش</button><button class="row-btn" data-card-member="${member.id}">کارت</button>${isAdmin() ? `<button class="row-btn danger" data-delete-member="${member.id}">حذف</button>` : ''}</div></td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty-state">عضوی یافت نشد.</td></tr>'}</tbody>
      </table></div>
      <div class="pagination"><span>تعداد کل: ${total} — صفحه ${page} از ${pages}</span><button id="memberPrev" class="btn btn-soft"${page <= 1 ? ' disabled' : ''}>قبلی</button><button id="memberNext" class="btn btn-soft"${page >= pages ? ' disabled' : ''}>بعدی</button></div>`;

    let searchTimer;
    $('#memberSearch').addEventListener('input', event => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => renderMembersList({ queryText: event.target.value, page: 1, pageSize }), 260);
    });
    $('#memberPageSize').addEventListener('change', event => renderMembersList({ queryText, page: 1, pageSize: Number(event.target.value) }));
    $('#memberPrev').addEventListener('click', () => renderMembersList({ queryText, page: page - 1, pageSize }));
    $('#memberNext').addEventListener('click', () => renderMembersList({ queryText, page: page + 1, pageSize }));
    $$('[data-edit-member]').forEach(button => button.addEventListener('click', async () => {
      const member = await query(state.supabase.from('members').select('*').eq('id', Number(button.dataset.editMember)).single());
      await renderMembers(member);
    }));
    $$('[data-card-member]').forEach(button => button.addEventListener('click', async () => {
      const member = await query(state.supabase.from('members').select('*').eq('id', Number(button.dataset.cardMember)).single());
      printMemberCards([member]);
    }));
    $$('[data-delete-member]').forEach(button => button.addEventListener('click', () => deleteMember(Number(button.dataset.deleteMember))));
  }

  async function deleteMember(id) {
    if (!window.confirm('عضو حذف شود؟ اعضایی که سابقه امانت دارند قابل حذف نیستند.')) return;
    try {
      await query(state.supabase.from('members').delete().eq('id', id));
      showToast('عضو حذف شد.');
      await renderMembersList();
    } catch (error) { handleError(error, 'حذف عضو ناموفق بود'); }
  }

  function downloadMemberSample() {
    downloadCsv([
      'membershipCode,firstName,lastName,phone,nationalCode,grade,field,commitment',
      '1001,علی,رضایی,09120000000,0011223344,دهم,تجربی,دارد'
    ], 'members_sample.csv');
  }

  async function exportMembersCsv() {
    try {
      const members = await query(state.supabase.from('members').select('*').order('id'));
      const rows = ['membershipCode,firstName,lastName,phone,nationalCode,grade,field,commitment'];
      members.forEach(member => rows.push([
        member.membership_code, member.first_name, member.last_name, member.phone,
        member.national_code, member.grade, member.field, member.commitment ? 'دارد' : 'ندارد'
      ].map(csvEscape).join(',')));
      downloadCsv(rows, 'members_export.csv');
    } catch (error) { handleError(error, 'خروجی اعضا ناموفق بود'); }
  }

  function commitmentFromText(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (['ندارد', 'ندارم', 'no', 'false', '0', 'x', '×'].includes(text)) return false;
    if (text.includes('ندار')) return false;
    return ['دارد', 'دارم', 'yes', 'true', '1', 'ok', '✓', '✔'].includes(text) || text.includes('دارد');
  }

  async function importMembersCsv() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.csv,text/csv';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const rows = parseCsv(await file.text());
        if (rows.length < 2) throw new Error('فایل CSV فاقد داده است.');
        const aliases = {
          membershipcode: 'membership_code', 'کدعضویت': 'membership_code',
          firstname: 'first_name', 'نام': 'first_name',
          lastname: 'last_name', 'نامخانوادگی': 'last_name',
          phone: 'phone', 'شمارهتماس': 'phone', 'تلفن': 'phone',
          nationalcode: 'national_code', 'کدملی': 'national_code',
          grade: 'grade', 'پایه': 'grade', field: 'field', 'رشته': 'field',
          commitment: 'commitment', 'تعهدنامه': 'commitment', 'تعهد': 'commitment'
        };
        const normalizeHeader = value => String(value).toLowerCase().replace(/[\s_-]/g, '');
        const headers = rows[0].map(value => aliases[normalizeHeader(value)] || null);
        if (!headers.includes('first_name') || !headers.includes('last_name') || !headers.includes('phone')) {
          throw new Error('سرستون‌های firstName، lastName و phone یا معادل فارسی آن‌ها ضروری است.');
        }
        let next = Number(await nextMemberCode()) || 1000;
        const payload = rows.slice(1).map(row => {
          const item = {};
          headers.forEach((key, index) => { if (key) item[key] = row[index] ?? ''; });
          const code = normalizeDigits(item.membership_code || String(next++));
          return {
            membership_code: code, first_name: String(item.first_name || '').trim(),
            last_name: String(item.last_name || '').trim(), phone: normalizeDigits(item.phone || ''),
            national_code: normalizeDigits(item.national_code || ''), grade: item.grade || '', field: item.field || '',
            commitment: commitmentFromText(item.commitment), created_by: state.profile.id
          };
        }).filter(item => item.membership_code && item.first_name && item.last_name && item.phone);
        if (!payload.length) throw new Error('هیچ ردیف معتبری در فایل پیدا نشد.');
        await query(state.supabase.from('members').upsert(payload, { onConflict: 'membership_code', ignoreDuplicates: true }));
        showToast(`${payload.length} ردیف معتبر پردازش شد.`);
        await showTab('members');
      } catch (error) { handleError(error, 'ورود CSV اعضا ناموفق بود'); }
    });
    input.click();
  }

  function bookFormHtml(book = {}) {
    const grades = state.settings?.grades || [];
    const fields = state.settings?.fields || [];
    return `
      <h2 class="section-title">${book.id ? 'ویرایش کتاب' : 'ثبت کتاب جدید'}</h2>
      <form id="bookForm" class="form-grid">
        <div class="form-row"><label for="bReg">شماره ثبت</label><input id="bReg" required maxlength="30" value="${escapeHtml(book.reg_number || '')}"></div>
        <div class="form-row"><label for="bTitle">عنوان کتاب</label><input id="bTitle" required maxlength="250" value="${escapeHtml(book.title || '')}"></div>
        <div class="form-row"><label for="bAbbr">اختصار</label><input id="bAbbr" maxlength="80" value="${escapeHtml(book.abbr || '')}"></div>
        <div class="form-row"><label for="bGrade">پایه</label><select id="bGrade">${grades.map(item => `<option${item === book.grade ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div>
        <div class="form-row"><label for="bField">رشته</label><select id="bField">${fields.map(item => `<option${item === book.field ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div>
        <div class="form-row"><label for="bTotal">تعداد کل</label><input id="bTotal" type="number" min="1" max="100000" required value="${escapeHtml(book.total || 1)}"></div>
        <div class="form-actions">
          <button id="bookSave" class="btn btn-primary" type="submit">${book.id ? 'ذخیره تغییرات' : 'ثبت کتاب'}</button>
          ${book.id ? '<button id="bookCancel" class="btn btn-soft" type="button">انصراف</button>' : ''}
          <button id="bookImport" class="btn btn-soft" type="button">ورود CSV</button>
          <button id="bookSample" class="btn btn-outline" type="button">نمونه CSV</button>
          <button id="bookExport" class="btn btn-outline" type="button">خروجی CSV</button>
        </div>
      </form>`;
  }

  async function nextBookReg() {
    const latest = await query(state.supabase.from('books').select('reg_number').order('id', { ascending: false }).limit(1));
    if (!latest.length) return '1000';
    const numeric = Number(normalizeDigits(latest[0].reg_number));
    return Number.isFinite(numeric) ? String(numeric + 1) : '';
  }

  async function renderBooks(editBook = null) {
    state.bookEditId = editBook?.id || null;
    els.panelContent.innerHTML = bookFormHtml(editBook || { reg_number: await nextBookReg(), total: 1 });
    await renderBooksList();
    $('#bookForm').addEventListener('submit', saveBook);
    $('#bookCancel')?.addEventListener('click', () => renderBooks());
    $('#bookSample').addEventListener('click', () => downloadCsv([
      'regNumber,title,abbr,grade,field,total',
      '2001,ریاضی پایه,ریاضی,دهم,تجربی,3'
    ], 'books_sample.csv'));
    $('#bookExport').addEventListener('click', exportBooksCsv);
    $('#bookImport').addEventListener('click', importBooksCsv);
  }

  async function saveBook(event) {
    event.preventDefault();
    const button = $('#bookSave');
    const total = Math.floor(Number(normalizeDigits($('#bTotal').value)));
    const payload = {
      reg_number: normalizeDigits($('#bReg').value.trim()),
      title: $('#bTitle').value.trim(), abbr: $('#bAbbr').value.trim(),
      grade: $('#bGrade').value, field: $('#bField').value, total
    };
    if (!payload.reg_number || !payload.title || !Number.isInteger(total) || total < 1) {
      showToast('شماره ثبت، عنوان و تعداد کل معتبر الزامی است.', 'error'); return;
    }
    setBusy(button, true);
    try {
      if (state.bookEditId) {
        await query(state.supabase.rpc('update_book_inventory', { p_book_id: state.bookEditId, p_payload: payload }));
        showToast('اطلاعات کتاب و موجودی آن اصلاح شد.');
      } else {
        await query(state.supabase.from('books').insert({ ...payload, available: total, created_by: state.profile.id }));
        showToast('کتاب ثبت شد.');
      }
      await showTab('books');
    } catch (error) { handleError(error, 'ثبت کتاب ناموفق بود'); }
    finally { setBusy(button, false); }
  }

  async function renderBooksList({ queryText = '', page = 1, pageSize = 25 } = {}) {
    let builder = state.supabase.from('books').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (queryText) {
      const q = queryText.replace(/[%(),]/g, ' ').trim();
      builder = builder.or(`reg_number.ilike.%${q}%,title.ilike.%${q}%,abbr.ilike.%${q}%`);
    }
    const from = (page - 1) * pageSize;
    const result = await builder.range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const books = result.data || [];
    const total = result.count || 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    els.main.innerHTML = `
      <div class="toolbar"><input id="bookSearch" class="search-input" placeholder="جست‌وجوی عنوان، شماره ثبت یا اختصار" value="${escapeHtml(queryText)}"><select id="bookPageSize"><option${pageSize === 10 ? ' selected' : ''}>10</option><option${pageSize === 25 ? ' selected' : ''}>25</option><option${pageSize === 50 ? ' selected' : ''}>50</option></select></div>
      <div class="table-wrap"><table><thead><tr><th>شماره ثبت</th><th>عنوان</th><th>اختصار</th><th>پایه</th><th>رشته</th><th>موجودی</th><th>عملیات</th></tr></thead><tbody>
      ${books.length ? books.map(book => `<tr><td>${escapeHtml(book.reg_number)}</td><td>${escapeHtml(book.title)}</td><td>${escapeHtml(book.abbr)}</td><td>${escapeHtml(book.grade)}</td><td>${escapeHtml(book.field)}</td><td><span class="status ${book.available > 0 ? 'status-success' : 'status-danger'}">${book.available} از ${book.total}</span></td><td><div class="row-actions"><button class="row-btn" data-edit-book="${book.id}">ویرایش</button>${isAdmin() ? `<button class="row-btn danger" data-delete-book="${book.id}">حذف</button>` : ''}</div></td></tr>`).join('') : '<tr><td colspan="7" class="empty-state">کتابی یافت نشد.</td></tr>'}
      </tbody></table></div><div class="pagination"><span>تعداد کل: ${total} — صفحه ${page} از ${pages}</span><button id="bookPrev" class="btn btn-soft"${page <= 1 ? ' disabled' : ''}>قبلی</button><button id="bookNext" class="btn btn-soft"${page >= pages ? ' disabled' : ''}>بعدی</button></div>`;
    let timer;
    $('#bookSearch').addEventListener('input', event => { window.clearTimeout(timer); timer = window.setTimeout(() => renderBooksList({ queryText: event.target.value, page: 1, pageSize }), 260); });
    $('#bookPageSize').addEventListener('change', event => renderBooksList({ queryText, page: 1, pageSize: Number(event.target.value) }));
    $('#bookPrev').addEventListener('click', () => renderBooksList({ queryText, page: page - 1, pageSize }));
    $('#bookNext').addEventListener('click', () => renderBooksList({ queryText, page: page + 1, pageSize }));
    $$('[data-edit-book]').forEach(button => button.addEventListener('click', async () => {
      const book = await query(state.supabase.from('books').select('*').eq('id', Number(button.dataset.editBook)).single());
      await renderBooks(book);
    }));
    $$('[data-delete-book]').forEach(button => button.addEventListener('click', () => deleteBook(Number(button.dataset.deleteBook))));
  }

  async function deleteBook(id) {
    if (!window.confirm('کتاب حذف شود؟ کتاب دارای سابقه امانت قابل حذف نیست.')) return;
    try {
      await query(state.supabase.from('books').delete().eq('id', id));
      showToast('کتاب حذف شد.');
      await renderBooksList();
    } catch (error) { handleError(error, 'حذف کتاب ناموفق بود'); }
  }

  async function exportBooksCsv() {
    try {
      const books = await query(state.supabase.from('books').select('*').order('id'));
      const rows = ['regNumber,title,abbr,grade,field,total,available'];
      books.forEach(book => rows.push([book.reg_number, book.title, book.abbr, book.grade, book.field, book.total, book.available].map(csvEscape).join(',')));
      downloadCsv(rows, 'books_export.csv');
    } catch (error) { handleError(error, 'خروجی کتاب‌ها ناموفق بود'); }
  }

  async function importBooksCsv() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv';
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file) return;
      try {
        const rows = parseCsv(await file.text());
        if (rows.length < 2) throw new Error('فایل CSV فاقد داده است.');
        const aliases = { regnumber: 'reg_number', 'شمارهثبت': 'reg_number', title: 'title', 'عنوان': 'title', 'نامکتاب': 'title', abbr: 'abbr', 'اختصار': 'abbr', grade: 'grade', 'پایه': 'grade', field: 'field', 'رشته': 'field', total: 'total', 'تعداد': 'total', 'تعدادکل': 'total' };
        const norm = value => String(value).toLowerCase().replace(/[\s_-]/g, '');
        const headers = rows[0].map(value => aliases[norm(value)] || null);
        if (!headers.includes('reg_number') || !headers.includes('title')) throw new Error('سرستون‌های regNumber و title یا معادل فارسی آن‌ها ضروری است.');
        const payload = rows.slice(1).map(row => {
          const item = {}; headers.forEach((key, index) => { if (key) item[key] = row[index] ?? ''; });
          const total = Math.max(1, Math.floor(Number(normalizeDigits(item.total || 1))) || 1);
          return { reg_number: normalizeDigits(item.reg_number || ''), title: String(item.title || '').trim(), abbr: item.abbr || '', grade: item.grade || '', field: item.field || '', total, available: total, created_by: state.profile.id };
        }).filter(item => item.reg_number && item.title);
        if (!payload.length) throw new Error('هیچ ردیف معتبری پیدا نشد.');
        await query(state.supabase.from('books').upsert(payload, { onConflict: 'reg_number', ignoreDuplicates: true }));
        showToast(`${payload.length} ردیف معتبر پردازش شد.`);
        await showTab('books');
      } catch (error) { handleError(error, 'ورود CSV کتاب‌ها ناموفق بود'); }
    });
    input.click();
  }

  async function loadLoanOptions() {
    const [members, books] = await Promise.all([
      query(state.supabase.from('members').select('id,membership_code,first_name,last_name,phone').order('last_name')),
      query(state.supabase.from('books').select('id,reg_number,title,available,total').gt('available', 0).order('title'))
    ]);
    state.cachedMembers = members;
    state.cachedBooks = books;
    return { members, books };
  }

  function populateSelect(select, rows, renderer) {
    select.innerHTML = rows.length ? rows.map(renderer).join('') : '<option value="">نتیجه‌ای یافت نشد</option>';
  }

  async function renderLoans() {
    const { members, books } = await loadLoanOptions();
    els.panelContent.innerHTML = `
      <h2 class="section-title">ثبت امانت</h2>
      <form id="loanForm" class="form-grid">
        <div class="form-row"><label for="loanMemberSearch">جست‌وجوی عضو</label><input id="loanMemberSearch" placeholder="نام، کد یا تلفن"></div>
        <div class="form-row"><label for="loanMember">عضو</label><select id="loanMember"></select></div>
        <div class="form-row"><label for="loanBookSearch">جست‌وجوی کتاب</label><input id="loanBookSearch" placeholder="عنوان یا شماره ثبت"></div>
        <div class="form-row"><label for="loanBook">کتاب</label><select id="loanBook"></select></div>
        <div class="form-actions"><button id="loanIssue" class="btn btn-primary" type="submit">ثبت امانت</button></div>
      </form>`;
    const memberSelect = $('#loanMember'); const bookSelect = $('#loanBook');
    const renderMember = member => `<option value="${member.id}">${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)} — ${escapeHtml(member.membership_code)}</option>`;
    const renderBook = book => `<option value="${book.id}">${escapeHtml(book.title)} [${escapeHtml(book.reg_number)}] — ${book.available}/${book.total}</option>`;
    populateSelect(memberSelect, members, renderMember); populateSelect(bookSelect, books, renderBook);
    $('#loanMemberSearch').addEventListener('input', event => {
      const q = event.target.value.trim().toLowerCase();
      populateSelect(memberSelect, members.filter(m => `${m.membership_code} ${m.first_name} ${m.last_name} ${m.phone}`.toLowerCase().includes(q)), renderMember);
    });
    $('#loanBookSearch').addEventListener('input', event => {
      const q = event.target.value.trim().toLowerCase();
      populateSelect(bookSelect, books.filter(b => `${b.reg_number} ${b.title}`.toLowerCase().includes(q)), renderBook);
    });
    $('#loanForm').addEventListener('submit', issueLoan);
    await renderLoansList();
  }

  async function issueLoan(event) {
    event.preventDefault();
    const button = $('#loanIssue');
    const memberId = Number($('#loanMember').value); const bookId = Number($('#loanBook').value);
    if (!memberId || !bookId) { showToast('عضو و کتاب را انتخاب کنید.', 'error'); return; }
    setBusy(button, true);
    try {
      await query(state.supabase.rpc('issue_loan', { p_member_id: memberId, p_book_id: bookId }));
      showToast('امانت با موفقیت ثبت شد.');
      await renderLoans();
    } catch (error) { handleError(error, 'ثبت امانت ناموفق بود'); }
    finally { setBusy(button, false); }
  }

  async function renderLoansList({ queryText = '', status = 'all', sort = 'due_asc', page = 1, pageSize = 25 } = {}) {
    let builder = state.supabase.from('loans').select('id,member_id,book_id,issue_at,due_at,returned_at,renew_count,members(membership_code,first_name,last_name),books(reg_number,title)');
    if (status === 'active') builder = builder.is('returned_at', null);
    if (status === 'returned') builder = builder.not('returned_at', 'is', null);
    if (status === 'overdue') builder = builder.is('returned_at', null).lt('due_at', new Date().toISOString());
    let loans = await query(builder);
    const q = queryText.trim().toLowerCase();
    if (q) loans = loans.filter(loan => `${loan.members?.membership_code} ${loan.members?.first_name} ${loan.members?.last_name} ${loan.books?.reg_number} ${loan.books?.title}`.toLowerCase().includes(q));
    if (sort === 'due_asc') loans.sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    if (sort === 'due_desc') loans.sort((a, b) => new Date(b.due_at) - new Date(a.due_at));
    if (sort === 'issue_desc') loans.sort((a, b) => new Date(b.issue_at) - new Date(a.issue_at));
    const total = loans.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(Math.max(1, page), pages);
    loans = loans.slice((page - 1) * pageSize, page * pageSize);

    els.main.innerHTML = `
      <div class="toolbar"><input id="loanSearch" class="search-input" placeholder="جست‌وجوی عضو یا کتاب" value="${escapeHtml(queryText)}"><select id="loanStatus"><option value="all"${status === 'all' ? ' selected' : ''}>همه امانات</option><option value="active"${status === 'active' ? ' selected' : ''}>جاری</option><option value="overdue"${status === 'overdue' ? ' selected' : ''}>دیرکرد</option><option value="returned"${status === 'returned' ? ' selected' : ''}>بازگشت داده‌شده</option></select><select id="loanSort"><option value="due_asc"${sort === 'due_asc' ? ' selected' : ''}>سررسید صعودی</option><option value="due_desc"${sort === 'due_desc' ? ' selected' : ''}>سررسید نزولی</option><option value="issue_desc"${sort === 'issue_desc' ? ' selected' : ''}>جدیدترین ثبت</option></select></div>
      <div class="table-wrap"><table><thead><tr><th>عضو</th><th>کتاب</th><th>تاریخ ثبت</th><th>سررسید</th><th>روز باقی‌مانده</th><th>تمدید</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>
      ${loans.length ? loans.map(loan => {
        const days = remainingDays(loan);
        const overdue = days !== null && days < 0;
        return `<tr><td>${escapeHtml(loan.members?.first_name)} ${escapeHtml(loan.members?.last_name)}<br><small>${escapeHtml(loan.members?.membership_code)}</small></td><td>${escapeHtml(loan.books?.title)}<br><small>${escapeHtml(loan.books?.reg_number)}</small></td><td>${toShamsi(loan.issue_at)}</td><td>${toShamsi(loan.due_at)}</td><td>${loan.returned_at ? '—' : `<span class="status ${overdue ? 'status-danger' : days <= 3 ? 'status-warning' : 'status-success'}">${escapeHtml(remainingLabel(loan))}</span>`}</td><td>${loan.returned_at ? '—' : `${loan.renew_count}/${state.settings.max_renewals_per_loan}`}</td><td><span class="status ${loan.returned_at ? 'status-neutral' : overdue ? 'status-danger' : 'status-success'}">${loan.returned_at ? 'بازگشت داده‌شده' : overdue ? 'دیرکرد' : 'جاری'}</span></td><td><div class="row-actions">${loan.returned_at ? '' : `<button class="row-btn" data-return-loan="${loan.id}">بازگرداندن</button><button class="row-btn" data-renew-loan="${loan.id}">تمدید</button>`}<button class="row-btn danger" data-delete-loan="${loan.id}">حذف</button></div></td></tr>`;
      }).join('') : '<tr><td colspan="8" class="empty-state">امانتی یافت نشد.</td></tr>'}
      </tbody></table></div><div class="pagination"><span>تعداد کل: ${total} — صفحه ${page} از ${pages}</span><button id="loanPrev" class="btn btn-soft"${page <= 1 ? ' disabled' : ''}>قبلی</button><button id="loanNext" class="btn btn-soft"${page >= pages ? ' disabled' : ''}>بعدی</button></div>`;
    let timer;
    $('#loanSearch').addEventListener('input', event => { window.clearTimeout(timer); timer = window.setTimeout(() => renderLoansList({ queryText: event.target.value, status, sort, page: 1, pageSize }), 250); });
    $('#loanStatus').addEventListener('change', event => renderLoansList({ queryText, status: event.target.value, sort, page: 1, pageSize }));
    $('#loanSort').addEventListener('change', event => renderLoansList({ queryText, status, sort: event.target.value, page: 1, pageSize }));
    $('#loanPrev').addEventListener('click', () => renderLoansList({ queryText, status, sort, page: page - 1, pageSize }));
    $('#loanNext').addEventListener('click', () => renderLoansList({ queryText, status, sort, page: page + 1, pageSize }));
    $$('[data-return-loan]').forEach(button => button.addEventListener('click', () => loanAction('return_loan', Number(button.dataset.returnLoan), 'کتاب بازگردانده شد.')));
    $$('[data-renew-loan]').forEach(button => button.addEventListener('click', () => loanAction('renew_loan', Number(button.dataset.renewLoan), 'امانت تمدید شد.')));
    $$('[data-delete-loan]').forEach(button => button.addEventListener('click', () => deleteLoan(Number(button.dataset.deleteLoan))));
  }

  async function loanAction(rpcName, loanId, successMessage) {
    try {
      await query(state.supabase.rpc(rpcName, { p_loan_id: loanId }));
      showToast(successMessage);
      await renderLoans();
    } catch (error) { handleError(error, 'عملیات امانت ناموفق بود'); }
  }

  async function deleteLoan(loanId) {
    if (!window.confirm('رکورد امانت حذف شود؟ در امانت جاری، موجودی کتاب به‌صورت تراکنشی بازگردانده می‌شود.')) return;
    await loanAction('delete_loan', loanId, 'رکورد امانت حذف شد.');
  }

  async function renderReports() {
    els.panelContent.innerHTML = `
      <h2 class="section-title">گزارش‌های مدیریتی</h2>
      <p class="section-note">گزارش مورد نظر را انتخاب و سپس چاپ کنید.</p>
      <div class="form-grid">
        <button class="btn btn-soft" data-report="members">فهرست کامل اعضا</button>
        <button class="btn btn-soft" data-report="books">فهرست کامل کتاب‌ها</button>
        <button class="btn btn-soft" data-report="available">کتاب‌های موجود</button>
        <button class="btn btn-soft" data-report="active">امانات جاری</button>
        <button class="btn btn-soft" data-report="due">سررسید امروز و فردا</button>
        <button class="btn btn-soft" data-report="overdue">دیرکردها</button>
        <button id="printReport" class="btn btn-primary" type="button">چاپ گزارش</button>
      </div>`;
    els.main.innerHTML = '<div class="empty-state">یک گزارش را از ستون کناری انتخاب کنید.</div>';
    $$('[data-report]').forEach(button => button.addEventListener('click', () => loadReport(button.dataset.report)));
    $('#printReport').addEventListener('click', printCurrentReport);
  }

  async function loadReport(type) {
    state.activeReport = type;
    let title = '';
    let headers = [];
    let rows = [];
    if (type === 'members') {
      title = 'گزارش کامل اعضا'; headers = ['کد', 'نام', 'تلفن', 'پایه', 'رشته', 'تعهد'];
      const data = await query(state.supabase.from('members').select('*').order('last_name'));
      rows = data.map(x => [x.membership_code, `${x.first_name} ${x.last_name}`, x.phone, x.grade, x.field, x.commitment ? 'دارد' : 'ندارد']);
    } else if (type === 'books' || type === 'available') {
      title = type === 'books' ? 'گزارش کامل کتاب‌ها' : 'کتاب‌های موجود'; headers = ['ثبت', 'عنوان', 'پایه', 'رشته', 'کل', 'موجود'];
      let builder = state.supabase.from('books').select('*').order('title'); if (type === 'available') builder = builder.gt('available', 0);
      const data = await query(builder); rows = data.map(x => [x.reg_number, x.title, x.grade, x.field, x.total, x.available]);
    } else {
      const now = new Date(); const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(23,59,59,999);
      let builder = state.supabase.from('loans').select('issue_at,due_at,returned_at,members(membership_code,first_name,last_name),books(reg_number,title)').is('returned_at', null).order('due_at');
      if (type === 'overdue') builder = builder.lt('due_at', now.toISOString());
      if (type === 'due') { const todayStart = new Date(now); todayStart.setHours(0,0,0,0); builder = builder.gte('due_at', todayStart.toISOString()).lte('due_at', tomorrow.toISOString()); }
      const data = await query(builder);
      title = type === 'overdue' ? 'گزارش دیرکردها' : type === 'due' ? 'سررسید امروز و فردا' : 'امانات جاری';
      headers = ['عضو', 'کتاب', 'ثبت', 'سررسید', 'وضعیت زمانی'];
      rows = data.map(x => [`${x.members?.first_name} ${x.members?.last_name}`, x.books?.title, toShamsi(x.issue_at), toShamsi(x.due_at), remainingLabel(x)]);
    }
    const table = `<h2 class="section-title">${escapeHtml(title)}</h2><div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty-state">داده‌ای وجود ندارد.</td></tr>`}</tbody></table></div>`;
    els.main.innerHTML = table;
    state.activeReport = { type, title, headers, rows };
  }

  function printCurrentReport() {
    if (!state.activeReport?.headers) { showToast('ابتدا یک گزارش را انتخاب کنید.', 'error'); return; }
    const { title, headers, rows } = state.activeReport;
    const perPage = 30;
    const pages = [];
    for (let i = 0; i < Math.max(rows.length, 1); i += perPage) {
      const chunk = rows.slice(i, i + perPage);
      pages.push(`<section class="print-page"><div class="report-header"><h2>${escapeHtml(state.settings.library_name)}</h2><h3>${escapeHtml(title)}</h3><div>${toShamsi(new Date(), true)}</div></div><table class="report-table"><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${chunk.length ? chunk.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">داده‌ای وجود ندارد.</td></tr>`}</tbody></table></section>`);
    }
    els.printArea.innerHTML = pages.join('');
    window.print();
    window.setTimeout(() => { els.printArea.innerHTML = ''; }, 800);
  }

  function cardHtml(member) {
    const photo = member.photo_data && member.photo_data.startsWith('data:image/') ? `<img class="print-card__photo" src="${member.photo_data}" alt="عکس عضو">` : '<div class="print-card__photo"></div>';
    return `<article class="print-card"><div class="print-card__title">${escapeHtml(state.settings.library_name)}</div><div class="print-card__info"><strong>کد عضویت:</strong> ${escapeHtml(member.membership_code)}<br><strong>نام:</strong> ${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)}<br><strong>پایه و رشته:</strong> ${escapeHtml(member.grade)} — ${escapeHtml(member.field)}</div>${photo}</article>`;
  }

  async function renderCards() {
    const members = await query(state.supabase.from('members').select('*').order('last_name'));
    els.panelContent.innerHTML = `<h2 class="section-title">چاپ کارت عضویت</h2><p class="section-note">کارت‌ها با اندازه استاندارد ۸۵×۵۴ میلی‌متر و چیدمان A4 چاپ می‌شوند.</p><div class="form-actions"><button id="selectAllCards" class="btn btn-soft">انتخاب همه</button><button id="clearAllCards" class="btn btn-outline">لغو انتخاب</button><button id="printSelectedCards" class="btn btn-primary">چاپ انتخاب‌شده‌ها</button></div>`;
    els.main.innerHTML = `<div class="toolbar"><input id="cardSearch" class="search-input" placeholder="جست‌وجوی عضو"></div><div id="cardMemberList" class="list-plain">${members.map(member => `<label class="list-item"><span><input class="card-check" type="checkbox" value="${member.id}"> ${escapeHtml(member.first_name)} ${escapeHtml(member.last_name)}</span><strong>${escapeHtml(member.membership_code)}</strong></label>`).join('')}</div>`;
    $('#selectAllCards').addEventListener('click', () => $$('.card-check').forEach(input => { input.checked = true; }));
    $('#clearAllCards').addEventListener('click', () => $$('.card-check').forEach(input => { input.checked = false; }));
    $('#cardSearch').addEventListener('input', event => {
      const q = event.target.value.trim().toLowerCase();
      $$('.list-item', $('#cardMemberList')).forEach(label => { label.style.display = label.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    });
    $('#printSelectedCards').addEventListener('click', () => {
      const ids = $$('.card-check:checked').map(input => Number(input.value));
      if (!ids.length) { showToast('حداقل یک عضو را انتخاب کنید.', 'error'); return; }
      printMemberCards(members.filter(member => ids.includes(member.id)));
    });
  }

  function printMemberCards(members) {
    const perPage = 8;
    const pages = [];
    for (let i = 0; i < members.length; i += perPage) pages.push(`<section class="print-page card-sheet">${members.slice(i, i + perPage).map(cardHtml).join('')}</section>`);
    els.printArea.innerHTML = pages.join('');
    window.print();
    window.setTimeout(() => { els.printArea.innerHTML = ''; }, 800);
  }

  function auditActionLabel(action) {
    return ({ insert: 'ثبت', update: 'ویرایش', delete: 'حذف', issue: 'ثبت امانت', return: 'بازگرداندن', renew: 'تمدید', restore: 'بازیابی پشتیبان', create_user: 'ایجاد کاربر', reset_password: 'تغییر رمز' })[action] || action;
  }

  function auditEntityLabel(entity) {
    return ({ members: 'اعضا', books: 'کتاب‌ها', loan: 'امانت', backup: 'پشتیبان', profile: 'کاربر' })[entity] || entity;
  }

  async function renderSettings() {
    if (!requireAdmin()) return;
    const [profiles, auditLogs] = await Promise.all([
      query(state.supabase.from('profiles').select('*').order('created_at')),
      query(state.supabase.from('audit_logs').select('action,entity_type,entity_id,created_at,profiles!audit_logs_actor_id_fkey(full_name,username)').order('created_at', { ascending: false }).limit(50))
    ]);
    els.panelContent.innerHTML = `
      <h2 class="section-title">تنظیمات کتابخانه</h2>
      <form id="settingsForm" class="form-grid">
        <div class="form-row"><label for="sLibraryName">نام کتابخانه</label><input id="sLibraryName" value="${escapeHtml(state.settings.library_name)}" required></div>
        <div class="form-row"><label for="sLoanDays">مهلت امانت</label><input id="sLoanDays" type="number" min="1" max="365" value="${state.settings.loan_days_default}"></div>
        <div class="form-row"><label for="sMaxLoans">حداکثر امانت</label><input id="sMaxLoans" type="number" min="1" max="50" value="${state.settings.max_books_per_member}"></div>
        <div class="form-row"><label for="sMaxRenew">دفعات تمدید</label><input id="sMaxRenew" type="number" min="0" max="20" value="${state.settings.max_renewals_per_loan}"></div>
        <div class="form-row"><label for="sRenewDays">روز هر تمدید</label><input id="sRenewDays" type="number" min="1" max="365" value="${state.settings.renew_days_per_extend}"></div>
        <div class="form-row"><label for="sGrades">پایه‌ها</label><input id="sGrades" value="${escapeHtml((state.settings.grades || []).join(','))}"></div>
        <div class="form-row"><label for="sFields">رشته‌ها</label><input id="sFields" value="${escapeHtml((state.settings.fields || []).join(','))}"></div>
        <div class="form-row"><label for="sLogo">نشان کتابخانه</label><input id="sLogo" type="file" accept="image/jpeg,image/png,image/webp"></div>
        <div class="form-actions"><button id="settingsSave" class="btn btn-primary" type="submit">ذخیره تنظیمات</button><button id="backupDownload" class="btn btn-soft" type="button">دریافت پشتیبان</button><button id="backupRestore" class="btn btn-outline" type="button">بازیابی پشتیبان</button></div>
      </form>
      <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
      <h2 class="section-title">معرفی کتابدار جدید</h2>
      <form id="librarianForm" class="form-grid">
        <div class="form-row"><label for="uFullName">نام کامل</label><input id="uFullName" required maxlength="120"></div>
        <div class="form-row"><label for="uUsername">نام کاربری</label><input id="uUsername" required maxlength="50" pattern="[A-Za-z0-9._-]+" dir="ltr"></div>
        <div class="form-row"><label for="uPassword">رمز عبور</label><input id="uPassword" type="password" required minlength="8" autocomplete="new-password" dir="ltr"></div>
        <div class="form-row"><label for="uRole">نقش</label><select id="uRole"><option value="librarian">کتابدار</option><option value="admin">مدیر سامانه</option></select></div>
        <div class="form-actions"><button id="librarianCreate" class="btn btn-accent" type="submit">ایجاد حساب کاربری</button></div>
      </form>`;

    els.main.innerHTML = `
      <h2 class="section-title">کاربران سامانه</h2>
      <div class="table-wrap"><table><thead><tr><th>نام کامل</th><th>نام کاربری</th><th>نقش</th><th>وضعیت</th><th>آخرین ورود</th><th>عملیات</th></tr></thead><tbody>
      ${profiles.map(profile => `<tr><td>${escapeHtml(profile.full_name)}</td><td dir="ltr">${escapeHtml(profile.username)}</td><td>${profile.role === 'admin' ? 'مدیر سامانه' : 'کتابدار'}</td><td><span class="status ${profile.active ? 'status-success' : 'status-danger'}">${profile.active ? 'فعال' : 'غیرفعال'}</span></td><td>${toShamsi(profile.last_login_at, true)}</td><td><div class="row-actions"><button class="row-btn" data-toggle-user="${profile.id}" data-active="${profile.active}">${profile.active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</button><button class="row-btn" data-reset-user="${profile.id}">تغییر رمز</button></div></td></tr>`).join('')}
      </tbody></table></div>
      <h2 class="section-title" style="margin-top:22px">آخرین رخدادهای امنیتی و عملیاتی</h2>
      <div class="table-wrap"><table><thead><tr><th>کاربر</th><th>عملیات</th><th>بخش</th><th>شناسه</th><th>زمان</th></tr></thead><tbody>
      ${auditLogs.length ? auditLogs.map(log => `<tr><td>${escapeHtml(log.profiles?.full_name || log.profiles?.username || 'سامانه')}</td><td>${escapeHtml(auditActionLabel(log.action))}</td><td>${escapeHtml(auditEntityLabel(log.entity_type))}</td><td>${escapeHtml(log.entity_id || '—')}</td><td>${toShamsi(log.created_at, true)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">رخدادی ثبت نشده است.</td></tr>'}
      </tbody></table></div>`;

    $('#sLogo').addEventListener('change', async event => {
      try { event.target.dataset.logoData = await resizeImage(event.target.files[0], 240, 240, .82); showToast('تصویر آماده ذخیره است.'); }
      catch (error) { handleError(error, 'خطا در نشان'); }
    });
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#librarianForm').addEventListener('submit', createLibrarian);
    $('#backupDownload').addEventListener('click', downloadBackup);
    $('#backupRestore').addEventListener('click', restoreBackup);
    $$('[data-toggle-user]').forEach(button => button.addEventListener('click', () => toggleUser(button.dataset.toggleUser, button.dataset.active !== 'true')));
    $$('[data-reset-user]').forEach(button => button.addEventListener('click', () => resetUserPassword(button.dataset.resetUser)));
  }

  async function saveSettings(event) {
    event.preventDefault();
    const button = $('#settingsSave');
    const parseList = value => value.split(',').map(item => item.trim()).filter(Boolean);
    const payload = {
      library_name: $('#sLibraryName').value.trim(),
      loan_days_default: Number($('#sLoanDays').value),
      max_books_per_member: Number($('#sMaxLoans').value),
      max_renewals_per_loan: Number($('#sMaxRenew').value),
      renew_days_per_extend: Number($('#sRenewDays').value),
      grades: parseList($('#sGrades').value), fields: parseList($('#sFields').value),
      updated_by: state.profile.id, updated_at: new Date().toISOString()
    };
    const logoData = $('#sLogo').dataset.logoData;
    if (logoData) payload.logo_data = logoData;
    if (!payload.library_name || payload.loan_days_default < 1 || payload.max_books_per_member < 1 || payload.renew_days_per_extend < 1) {
      showToast('مقادیر تنظیمات معتبر نیستند.', 'error'); return;
    }
    setBusy(button, true);
    try {
      await query(state.supabase.from('library_settings').update(payload).eq('id', 1));
      await loadSettings();
      showToast('تنظیمات ذخیره شد.');
      await renderSettings();
    } catch (error) { handleError(error, 'ذخیره تنظیمات ناموفق بود'); }
    finally { setBusy(button, false); }
  }

  async function invokeUserAdmin(body) {
    const { data, error } = await state.supabase.functions.invoke('create-librarian', { body });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'عملیات کاربر انجام نشد.');
    return data;
  }

  async function createLibrarian(event) {
    event.preventDefault();
    const button = $('#librarianCreate');
    const payload = { operation: 'create', full_name: $('#uFullName').value.trim(), username: normalizeUsername($('#uUsername').value), password: $('#uPassword').value, role: $('#uRole').value };
    if (!payload.full_name || !payload.username || payload.password.length < 8) { showToast('نام، نام کاربری معتبر و رمز حداقل ۸ کاراکتری لازم است.', 'error'); return; }
    setBusy(button, true);
    try {
      await invokeUserAdmin(payload);
      showToast('حساب کتابدار ایجاد شد.');
      await renderSettings();
    } catch (error) { handleError(error, 'ایجاد کتابدار ناموفق بود'); }
    finally { setBusy(button, false); }
  }

  async function toggleUser(userId, active) {
    if (userId === state.profile.id && !active) { showToast('نمی‌توانید حساب در حال استفاده خود را غیرفعال کنید.', 'error'); return; }
    try {
      await query(state.supabase.from('profiles').update({ active }).eq('id', userId));
      showToast(active ? 'حساب فعال شد.' : 'حساب غیرفعال شد.');
      await renderSettings();
    } catch (error) { handleError(error, 'تغییر وضعیت کاربر ناموفق بود'); }
  }

  async function resetUserPassword(userId) {
    const password = window.prompt('رمز عبور جدید را وارد کنید؛ حداقل ۸ کاراکتر:');
    if (!password) return;
    if (password.length < 8) { showToast('رمز عبور باید حداقل ۸ کاراکتر باشد.', 'error'); return; }
    try {
      await invokeUserAdmin({ operation: 'reset_password', user_id: userId, password });
      showToast('رمز عبور کاربر تغییر کرد.');
    } catch (error) { handleError(error, 'تغییر رمز ناموفق بود'); }
  }

  async function downloadBackup() {
    try {
      const [members, books, loans, settings, profiles] = await Promise.all([
        query(state.supabase.from('members').select('*').order('id')),
        query(state.supabase.from('books').select('*').order('id')),
        query(state.supabase.from('loans').select('*').order('id')),
        query(state.supabase.from('library_settings').select('*').eq('id', 1).single()),
        query(state.supabase.from('profiles').select('id,username,full_name,role,active,created_at').order('created_at'))
      ]);
      const backup = { version: 2, exported_at: new Date().toISOString(), library_settings: settings, members, books, loans, profiles_reference: profiles };
      downloadFile(JSON.stringify(backup, null, 2), `samak-backup-${new Date().toISOString().slice(0,10)}.json`);
    } catch (error) { handleError(error, 'تهیه پشتیبان ناموفق بود'); }
  }

  async function restoreBackup() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file) return;
      try {
        const backup = JSON.parse(await file.text());
        if (backup.version !== 2 || !Array.isArray(backup.members) || !Array.isArray(backup.books) || !Array.isArray(backup.loans)) throw new Error('ساختار فایل پشتیبان معتبر نیست.');
        if (!window.confirm('بازیابی، داده‌های اعضا، کتاب‌ها و امانات را به‌صورت تراکنشی جایگزین می‌کند. ادامه می‌دهید؟')) return;
        const verify = window.prompt('برای تأیید عبارت RESTORE را وارد کنید:');
        if (verify !== 'RESTORE') return;
        await query(state.supabase.rpc('restore_backup', { p_backup: backup }));
        await loadSettings();
        showToast('بازیابی پشتیبان کامل شد.');
        await showTab('dashboard');
      } catch (error) { handleError(error, 'بازیابی پشتیبان ناموفق بود'); }
    });
    input.click();
  }

  async function initialize() {
    try {
      assertConfig();
      if (!window.supabase?.createClient) throw new Error('کتابخانه Supabase بارگذاری نشد. اتصال اینترنت را بررسی کنید.');
      state.supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { headers: { 'x-application-name': 'samak-library' } }
      });

      els.loginForm.addEventListener('submit', login);
      els.logoutBtn.addEventListener('click', logout);
      els.themeToggle.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
      els.tabs.addEventListener('click', event => {
        const button = event.target.closest('[data-tab]');
        if (button) showTab(button.dataset.tab);
      });

      state.supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') leaveApp();
        if (event === 'TOKEN_REFRESHED') state.session = session;
      });
      const { data, error } = await state.supabase.auth.getSession();
      if (error) throw error;
      if (data.session) {
        try { await enterApp(data.session); }
        catch (error) { await state.supabase.auth.signOut(); els.loginError.textContent = friendlyError(error); leaveApp(); }
      } else leaveApp();
    } catch (error) {
      console.error(error);
      els.loginError.textContent = friendlyError(error);
      els.loginSubmit.disabled = true;
    }
  }

  initialize();
})();
