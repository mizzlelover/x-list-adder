// 运行在隔离世界 (isolated world)
// 职责：
// 1. 监听 X 页面 DOM，检测资料卡片 (data-testid="HoverCard") 出现
// 2. 从卡片解析 @handle，注入「+ List」按钮
// 3. 点击按钮弹出 Lists 选择菜单，通过消息让 background 调用 X API 完成加入
(() => {
  const OPS_KEY = '__xla_ops__';
  const BTN_CLASS = 'xla-btn';
  let panel = null;          // 菜单单例
  let panelOwnerBtn = null;  // 当前菜单归属的按钮
  let navEntry = null;       // 侧边栏 Lists 入口
  let navPanel = null;       // 侧边栏入口弹出的面板

  // ---------- 工具 ----------
  const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => {
    // service worker 可能未就绪，兜底
    if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
    else resolve(r || { error: 'no response' });
  }));

  // ---------- 接口自学习同步 ----------
  function syncOps() {
    try {
      const raw = sessionStorage.getItem(OPS_KEY);
      if (!raw) return;
      const ops = JSON.parse(raw);
      if (ops && Object.keys(ops).length) send({ type: 'syncOps', ops });
    } catch (e) { /* ignore */ }
  }

  // ---------- 解析 handle ----------
  const RESERVED = new Set([
    'i', 'home', 'explore', 'notifications', 'messages', 'search', 'settings',
    'compose', 'intent', 'hashtag', 'personalization', 'privacy', 'tos', 'help'
  ]);

  function findHandle(card) {
    // 优先 UserLink，再退化为通用的「单段路径」链接
    const candidates = [
      ...card.querySelectorAll('a[data-testid="UserLink"][href^="/"]'),
      ...card.querySelectorAll('a[href^="/"]')
    ];
    for (const a of candidates) {
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1];
    }
    return null;
  }

  // ---------- 解析用户 ID ----------
  // 首选：X 的关注按钮 data-testid 形如 "1234567-unfollow"，直接带用户 ID
  // 次选：页面自身 GraphQL 响应里采集到的 handle -> id 映射
  function findUserId(card, followBtn, handle) {
    const t = (followBtn && followBtn.getAttribute('data-testid')) || '';
    const m = t.match(/^(\d+)-(?:un)?follow$/);
    if (m) return m[1];

    // 兜底：遍历卡片内所有带数字前缀 testid 的元素
    for (const el of card.querySelectorAll('[data-testid]')) {
      const mm = (el.getAttribute('data-testid') || '').match(/^(\d+)-(?:un)?follow$/);
      if (mm) return mm[1];
    }

    try {
      const map = JSON.parse(sessionStorage.getItem('__xla_users__') || '{}');
      if (handle && map[handle.toLowerCase()]) return map[handle.toLowerCase()];
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---------- 主题探测 ----------
  function isDarkMode() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return true; // 取不到按深色处理（X 默认深色用户多）
    const lum = 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3];
    return lum < 128;
  }

  // ---------- 按钮注入 ----------
  function injectButton(card) {
    if (card.querySelector('.' + BTN_CLASS)) return; // 已注入
    const handle = findHandle(card);
    if (!handle) return;

    const followBtn =
      card.querySelector('[data-testid$="-unfollow"]') ||
      card.querySelector('[data-testid$="-follow"]');
    if (!followBtn) return;

    const btn = document.createElement('button');
    btn.className = BTN_CLASS;
    btn.title = '加入 List (@' + handle + ')';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>List</span>';
    const userId = findUserId(card, followBtn, handle);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 点击时再取一次，提高命中率（页面数据可能刚到位）
      togglePanel(btn, handle, findUserId(card, followBtn, handle) || userId);
    });

    // 直接采样 Following 按钮的真实样式，做到与 X 原生一致
    const cs = getComputedStyle(followBtn);
    const dark = isDarkMode();
    Object.assign(btn.style, {
      height: followBtn.offsetHeight + 'px',
      paddingLeft: '14px',
      paddingRight: '14px',
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      // X 次级按钮的标准配色：边框 + 文字随主题
      borderColor: dark ? 'rgb(83, 100, 113)' : 'rgb(207, 217, 222)',
      color: dark ? 'rgb(239, 243, 244)' : 'rgb(15, 20, 25)'
    });
    btn.style.setProperty('--xla-hover-bg', dark ? 'rgba(239,243,244,0.1)' : 'rgba(15,20,25,0.1)');

    // 与 Following 按钮同行排列
    const parent = followBtn.parentElement;
    const pcs = getComputedStyle(parent);
    if (pcs.display !== 'flex') parent.style.display = 'flex';
    parent.style.flexDirection = 'row';
    parent.style.alignItems = 'center';
    parent.style.gap = '8px';
    parent.insertBefore(btn, followBtn.nextSibling);

    card.dataset.xlaHandle = handle;
  }

  // ---------- 扫描 ----------
  function scan() {
    document.querySelectorAll('div[data-testid="HoverCard"]').forEach((card) => {
      if (!card.dataset.xlaHandle || !card.querySelector('.' + BTN_CLASS)) {
        injectButton(card);
      }
    });
    ensureNavEntry();
  }

  const mo = new MutationObserver(() => {
    // 节流
    if (scan._t) return;
    scan._t = setTimeout(() => { scan._t = null; scan(); }, 120);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  scan();

  // ---------- 菜单 ----------
  function closePanel() {
    if (panel) { panel.remove(); panel = null; panelOwnerBtn = null; }
    document.removeEventListener('click', onDocClick, true);
  }

  function onDocClick(e) {
    if (panel && !panel.contains(e.target) && e.target !== panelOwnerBtn) closePanel();
  }

  async function togglePanel(btn, handle, userId) {
    if (panel && panelOwnerBtn === btn) { closePanel(); return; }
    closePanel();
    panelOwnerBtn = btn;
    syncOps(); // 打开菜单前顺带同步一次学到的接口

    panel = document.createElement('div');
    panel.className = 'xla-panel ' + (isDarkMode() ? 'xla-dark' : 'xla-light');
    panel.innerHTML = '<div class="xla-panel-title">加入 @' + handle + ' 到…</div><div class="xla-panel-body"><div class="xla-panel-loading">加载中…</div></div>';
    document.body.appendChild(panel);
    document.addEventListener('click', onDocClick, true);

    const rect = btn.getBoundingClientRect();
    const pw = 260;
    let left = Math.min(rect.left, window.innerWidth - pw - 12);
    let top = rect.bottom + 8;
    if (top + 200 > window.innerHeight) top = Math.max(12, rect.top - 200);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';

    const { lists = [], error } = await send({ type: 'getLists' });
    const body = panel.querySelector('.xla-panel-body');
    if (error) { body.innerHTML = '<div class="xla-panel-err">' + esc(error) + '</div>'; return; }
    if (!lists.length) {
      body.innerHTML = '<div class="xla-panel-err">还没有配置 List。<br>点击扩展图标的弹窗进行添加。</div>';
      return;
    }
    body.innerHTML = '';
    lists.forEach((l) => {
      const item = document.createElement('div');
      item.className = 'xla-item';
      item.innerHTML = '<span class="xla-item-name">' + esc(l.name) + '</span><span class="xla-item-state"></span>';
      item.addEventListener('click', async () => {
        if (item.classList.contains('xla-loading')) return;
        const state = item.querySelector('.xla-item-state');
        item.classList.add('xla-loading');
        state.innerHTML = '<span class="xla-spinner"></span>';
        const res = await send({ type: 'addToList', listId: l.id, handle, userId });
        const already = res && res.error && /already/i.test(res.error);
        if ((res && res.ok) || already) {
          state.innerHTML = '<span class="xla-ok">✓</span>';
          closePanel();
          showToast(already ? '@' + handle + ' 已在「' + l.name + '」中' : '已加入「' + l.name + '」', true);
        } else {
          // 失败：保留菜单，展示错误原因
          item.classList.remove('xla-loading');
          state.textContent = '✗';
          state.style.color = 'rgb(244, 33, 46)';
          item.title = (res && res.error) || '失败';
          showToast('加入失败：' + ((res && res.error) || '未知错误'), false);
        }
      });
      body.appendChild(item);
    });
    const foot = document.createElement('div');
    foot.className = 'xla-panel-foot';
    foot.textContent = '在扩展图标弹窗中管理 Lists';
    panel.appendChild(foot);
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(text, ok) {
    let t = document.querySelector('.xla-toast');
    if (t) t.remove();
    if (toastTimer) clearTimeout(toastTimer);
    t = document.createElement('div');
    t.className = 'xla-toast ' + (isDarkMode() ? 'xla-dark' : 'xla-light');
    t.innerHTML =
      '<span class="xla-toast-icon" style="color:' + (ok ? 'rgb(0,186,124)' : 'rgb(244,33,46)') + '">' +
      (ok
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>') +
      '</span><span>' + esc(text) + '</span>';
    document.body.appendChild(t);
    // 触发过渡动画
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('xla-toast-show')));
    toastTimer = setTimeout(() => {
      t.classList.remove('xla-toast-show');
      setTimeout(() => t.remove(), 250);
    }, 2600);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- 侧边栏 Lists 入口 ----------
  // 把入口钉在 X 主导航栏最顶部，避开 X 灰度隐藏 Lists 菜单的问题
  function ensureNavEntry() {
    if (navEntry && document.contains(navEntry)) {
      // 节流：同步涉及强制重排，页面 DOM 频繁变动时不必每次都做
      const now = Date.now();
      if (now - (ensureNavEntry._t || 0) > 500) {
        ensureNavEntry._t = now;
        syncNavEntry();
      }
      return;
    }
    const home = document.querySelector('a[data-testid="AppTabBar_Home_Link"]');
    const nav = document.querySelector('header[role="banner"] nav[aria-label]') ||
                (home && home.closest('nav'));
    if (!nav) return;

    // X 重渲染后我们的节点可能还在
    const existing = nav.querySelector('.xla-nav-entry');
    if (existing) { navEntry = existing; syncNavEntry(); return; }

    const anchorEl = nav.querySelector('a[data-testid="AppTabBar_Home_Link"]') ||
                     nav.firstElementChild;
    if (!anchorEl) return;

    navEntry = document.createElement('div');
    navEntry.className = 'xla-nav-entry';
    navEntry.innerHTML =
      '<a class="xla-nav-link" href="/i/lists" title="我的 Lists">' +
        '<span class="xla-nav-icon">' +
          '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>' +
        '</span>' +
        '<span class="xla-nav-text">我的 Lists</span>' +
      '</a>';
    navEntry.querySelector('.xla-nav-link').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleNavPanel();
    });
    anchorEl.insertAdjacentElement('beforebegin', navEntry);
    syncNavEntry();
  }

  // 跟随 X 的响应式：窄屏时原生导航只显示图标，我们也同步隐藏文字
  function syncNavEntry() {
    if (!navEntry) return;
    const nav = navEntry.parentElement;
    const homeSpan = nav && nav.querySelector('[data-testid="AppTabBar_Home_Link"] span');
    const textVisible = !homeSpan || homeSpan.getBoundingClientRect().width > 0;
    const dark = isDarkMode();
    navEntry.classList.toggle('xla-icon-only', !textVisible);
    navEntry.classList.toggle('xla-dark', dark);
    navEntry.classList.toggle('xla-light', !dark);
    if (navPanel) positionNavPanel();
  }

  function positionNavPanel() {
    if (!navPanel || !navEntry) return;
    const r = navEntry.getBoundingClientRect();
    const pw = 264;
    let left = r.right + 12;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, r.left - pw - 12);
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 320));
    navPanel.style.left = left + 'px';
    navPanel.style.top = top + 'px';
  }

  async function toggleNavPanel() {
    if (navPanel) { closeNavPanel(); return; }
    navPanel = document.createElement('div');
    navPanel.className = 'xla-panel xla-nav-panel ' + (isDarkMode() ? 'xla-dark' : 'xla-light');
    navPanel.innerHTML =
      '<div class="xla-panel-title">我的 Lists</div>' +
      '<div class="xla-panel-body"><div class="xla-panel-loading">加载中…</div></div>';
    document.body.appendChild(navPanel);
    positionNavPanel();
    document.addEventListener('click', onNavDocClick, true);
    window.addEventListener('resize', positionNavPanel);

    const { lists = [], error } = await send({ type: 'getLists' });
    if (!navPanel) return; // 期间被关掉了
    const body = navPanel.querySelector('.xla-panel-body');
    if (error) { body.innerHTML = '<div class="xla-panel-err">' + esc(error) + '</div>'; return; }
    if (!lists.length) {
      body.innerHTML = '<div class="xla-panel-err">还没有 List。<br>点击扩展图标，在弹窗里同步或添加。</div>';
      return;
    }
    body.innerHTML = '';
    lists.forEach((l) => {
      const a = document.createElement('a');
      a.className = 'xla-item xla-item-link';
      a.href = '/i/lists/' + l.id;
      a.title = '打开「' + l.name + '」';
      a.innerHTML =
        '<span class="xla-item-name">' + esc(l.name) + '</span>' +
        '<span class="xla-item-go">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>' +
        '</span>';
      body.appendChild(a);
    });
    const foot = document.createElement('div');
    foot.className = 'xla-panel-foot';
    foot.textContent = '点击分组打开 X 原生 List 页面';
    navPanel.appendChild(foot);
  }

  function closeNavPanel() {
    if (navPanel) { navPanel.remove(); navPanel = null; }
    document.removeEventListener('click', onNavDocClick, true);
    window.removeEventListener('resize', positionNavPanel);
  }

  function onNavDocClick(e) {
    if (navPanel && !navPanel.contains(e.target) &&
        !(navEntry && navEntry.contains(e.target))) {
      closeNavPanel();
    }
  }

  // ---------- 样式 ----------
  const style = document.createElement('style');
  style.id = 'xla-style';
  style.textContent = `
    .${BTN_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      border: 1px solid;
      border-radius: 9999px;
      background: transparent;
      cursor: pointer;
      white-space: nowrap;
      box-sizing: border-box;
      transition: background-color 0.15s ease;
    }
    .${BTN_CLASS}:hover { background: var(--xla-hover-bg); }
    .${BTN_CLASS} svg { flex: none; }
    .xla-panel {
      position: fixed;
      z-index: 99999;
      width: 264px;
      border-radius: 16px;
      font-size: 14px;
      font-family: inherit;
      overflow: hidden;
      box-shadow: rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px;
    }
    .xla-panel.xla-dark {
      background: rgb(21, 32, 43);
      border: 1px solid rgb(56, 68, 77);
      color: rgb(231, 233, 234);
      box-shadow: rgba(255, 255, 255, 0.2) 0px 0px 15px, rgba(255, 255, 255, 0.15) 0px 0px 3px 1px;
    }
    .xla-panel.xla-light {
      background: rgb(255, 255, 255);
      border: 1px solid rgb(239, 243, 244);
      color: rgb(15, 20, 25);
    }
    .xla-panel-title {
      padding: 12px 16px;
      font-weight: 700;
    }
    .xla-dark .xla-panel-title { border-bottom: 1px solid rgb(56, 68, 77); }
    .xla-light .xla-panel-title { border-bottom: 1px solid rgb(239, 243, 244); }
    .xla-panel-body { max-height: 264px; overflow-y: auto; }
    .xla-panel-loading, .xla-panel-err { padding: 16px; color: rgb(113, 118, 123); }
    .xla-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px; cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .xla-dark .xla-item:hover { background: rgba(239, 243, 244, 0.03); }
    .xla-light .xla-item:hover { background: rgba(15, 20, 25, 0.03); }
    .xla-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .xla-item-state { margin-left: 8px; color: rgb(0, 186, 124); font-weight: 700; display: flex; align-items: center; }
    .xla-done .xla-item-name { color: rgb(113, 118, 123); }

    /* 加载中 */
    .xla-loading { cursor: default; }
    .xla-loading .xla-item-name { color: rgb(113, 118, 123); }
    .xla-spinner {
      display: inline-block;
      width: 13px; height: 13px;
      border-radius: 50%;
      border: 2px solid rgba(113, 118, 123, 0.85);
      border-top-color: transparent;
      animation: xla-spin 0.7s linear infinite;
    }
    @keyframes xla-spin { to { transform: rotate(360deg); } }

    /* 侧边栏入口 */
    .xla-nav-entry { display: flex; flex: none; }
    .xla-nav-link {
      display: flex;
      align-items: center;
      padding: 12px;
      border-radius: 9999px;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .xla-nav-entry.xla-dark .xla-nav-link { color: rgb(231, 233, 234); }
    .xla-nav-entry.xla-light .xla-nav-link { color: rgb(15, 20, 25); }
    .xla-nav-entry.xla-dark .xla-nav-link:hover { background: rgba(239, 243, 244, 0.1); }
    .xla-nav-entry.xla-light .xla-nav-link:hover { background: rgba(15, 20, 25, 0.1); }
    .xla-nav-icon {
      display: flex; align-items: center; justify-content: center;
      width: 26.25px; height: 26.25px;
    }
    .xla-nav-text {
      font-size: 20px; line-height: 24px;
      margin: 0 16px 0 20px;
      white-space: nowrap;
    }
    .xla-nav-entry.xla-icon-only .xla-nav-text { display: none; }

    /* 侧边栏面板里的链接行 */
    .xla-item-link { text-decoration: none; color: inherit; }
    .xla-item-go { display: flex; margin-left: 8px; opacity: 0; transition: opacity 0.15s ease; }
    .xla-item-link:hover .xla-item-go { opacity: 0.75; }
    .xla-panel-foot {
      padding: 10px 16px; font-size: 12px; color: rgb(113, 118, 123);
    }
    .xla-dark .xla-panel-foot { border-top: 1px solid rgb(56, 68, 77); }
    .xla-light .xla-panel-foot { border-top: 1px solid rgb(239, 243, 244); }
    .xla-toast {
      position: fixed;
      left: 50%;
      bottom: 32px;
      transform: translate(-50%, 16px);
      z-index: 100000;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      border-radius: 9999px;
      font-size: 14px;
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: none;
      max-width: 70vw;
    }
    .xla-toast.xla-toast-show { opacity: 1; transform: translate(-50%, 0); }
    .xla-toast.xla-dark {
      background: rgb(239, 243, 244);
      color: rgb(15, 20, 25);
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    }
    .xla-toast.xla-light {
      background: rgb(15, 20, 25);
      color: rgb(255, 255, 255);
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    }
    .xla-toast-icon { display: flex; }
  `;
  document.documentElement.appendChild(style);
})();
