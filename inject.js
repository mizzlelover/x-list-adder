// 运行在页面主世界 (MAIN world)，document_start 时注入
// 作用：
// 1. hook window.fetch，记录 X 网页端自己使用的 GraphQL 接口（含 queryId + features），
//    供插件"自愈"使用
// 2. 采集 X 自己的 UserByScreenName 响应，得到 handle -> rest_id 映射
// 数据存 sessionStorage，由 content.js 读取后同步给 background
(() => {
  const OPS_KEY = '__xla_ops__';
  const USERS_KEY = '__xla_users__';
  if (window.__xla_injected__) return;
  window.__xla_injected__ = true;

  // ---------- 接口路径解析 ----------
  function parseOp(url) {
    if (!url || !url.includes('/i/api/graphql/')) return null;
    const m = new URL(url, location.origin).pathname
      .match(/\/i\/api\/graphql\/([^/]+)\/([A-Za-z0-9_]+)/);
    return m ? { qid: m[1], opName: m[2] } : null;
  }

  function saveOp(op, url, bodyText) {
    try {
      let features = null;
      const f = new URL(url, location.origin).searchParams.get('features'); // GET: 在 query string
      if (f) { try { features = JSON.parse(f); } catch (e) {} }
      if (!features && bodyText) {                                          // POST: 在 JSON body
        try {
          const b = JSON.parse(bodyText);
          if (b && b.features) features = b.features;
        } catch (e) {}
      }

      const ops = JSON.parse(sessionStorage.getItem(OPS_KEY) || '{}');
      const prev = ops[op.opName];
      const prevQid = prev && typeof prev === 'object' ? prev.qid : prev;
      const prevFeatures = prev && typeof prev === 'object' ? prev.features : null;
      const featuresChanged = features &&
        JSON.stringify(prevFeatures) !== JSON.stringify(features);

      if (prevQid !== op.qid || featuresChanged) {
        ops[op.opName] = { qid: op.qid, features: features || prevFeatures || null };
        sessionStorage.setItem(OPS_KEY, JSON.stringify(ops));
      }
    } catch (e) { /* 记录失败不影响正常请求 */ }
  }

  // ---------- 采集 handle -> rest_id ----------
  function harvestUsers(json) {
    try {
      const r = json && json.data && json.data.user && json.data.user.result;
      if (!r || !r.rest_id) return;
      const sn = (r.legacy && r.legacy.screen_name) || (r.core && r.core.screen_name);
      if (!sn) return;
      const key = String(sn).toLowerCase();
      const map = JSON.parse(sessionStorage.getItem(USERS_KEY) || '{}');
      if (map[key] !== r.rest_id) {
        map[key] = r.rest_id;
        sessionStorage.setItem(USERS_KEY, JSON.stringify(map));
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- fetch hook ----------
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    let url = null, op = null;
    try {
      const input = args[0];
      const init = args[1];
      url = typeof input === 'string' ? input : input && input.url;
      op = parseOp(url);

      if (op) {
        if (typeof init?.body === 'string') {
          saveOp(op, url, init.body);
        } else if (input && typeof input === 'object' && input.method === 'POST' && input.clone) {
          // Request 对象：克隆读 body（异步，不阻塞）
          input.clone().text()
            .then((t) => saveOp(op, url, t))
            .catch(() => saveOp(op, url, null));
        } else {
          saveOp(op, url, null);
        }
      }
    } catch (e) { /* ignore */ }

    const p = origFetch.apply(this, args);

    // 采集用户映射
    try {
      if (op && op.opName === 'UserByScreenName') {
        p.then((res) => {
          try { res.clone().json().then(harvestUsers).catch(() => {}); } catch (e) {}
        }).catch(() => {});
      }
    } catch (e) { /* ignore */ }

    return p;
  };
})();
