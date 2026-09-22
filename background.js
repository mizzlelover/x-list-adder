// Background service worker
// 职责：所有 X API 调用（带登录态 cookie + csrf + bearer）
// - getLists / saveLists：管理用户保存的 Lists
// - fetchOwnedLists：拉取"我拥有的 Lists"
// - addToList：handle -> rest_id -> CreateListItem（GraphQL，失败回退 v1.1）

const BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const API = 'https://x.com/i/api';

// 内置兜底 queryId；被"自学习"到的覆盖
const DEFAULT_OPS = {
  UserByScreenName: { qid: 'G3KGOOz9YmkunRYEhC9udg', features: null }
};

const UBSN_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_feature_can_gift_premium: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true
};

// ---------- 基础 ----------
async function getCsrf() {
  const c = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' });
  return c ? c.value : '';
}

async function baseHeaders() {
  const h = {
    authorization: BEARER,
    'x-csrf-token': await getCsrf(),
    'content-type': 'application/json',
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    referer: 'https://x.com/home'
  };
  return h;
}

// ops 存储兼容：值可能是旧格式字符串 qid，或新格式 { qid, features }
function normalizeOps(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (!v) continue;
    out[k] = typeof v === 'string' ? { qid: v, features: null } : v;
  }
  return out;
}

async function getOps() {
  const { ops = {} } = await chrome.storage.local.get('ops');
  return { ...DEFAULT_OPS, ...normalizeOps(ops) };
}

// 从 GraphQL 响应提取错误信息；无错误返回 null
function gqlError(j) {
  if (j && Array.isArray(j.errors) && j.errors.length) {
    return j.errors[0].message || 'GraphQL error';
  }
  return null;
}

function graphqlUrl(qid, opName, variables, features) {
  const p = new URLSearchParams();
  p.set('variables', JSON.stringify(variables));
  if (features) p.set('features', JSON.stringify(features));
  return `${API}/graphql/${qid}/${opName}?${p.toString()}`;
}

// ---------- 业务 ----------
async function resolveUserId(handle) {
  const key = String(handle).toLowerCase();
  const { userIdCache = {} } = await chrome.storage.local.get('userIdCache');
  if (userIdCache[key]) return userIdCache[key];

  const ops = await getOps();
  const op = ops.UserByScreenName;
  let detail = 'no queryId';
  if (op && op.qid) {
    const url = graphqlUrl(
      op.qid,
      'UserByScreenName',
      { screen_name: handle, withGrokTranslatedBio: false },
      op.features || UBSN_FEATURES
    );
    try {
      const r = await fetch(url, { headers: await baseHeaders(), credentials: 'include' });
      const j = await r.json().catch(() => null);
      const err = gqlError(j);
      if (r.ok && !err) {
        const id = j && j.data && j.data.user && j.data.user.result && j.data.user.result.rest_id;
        if (id) {
          userIdCache[key] = id;
          await chrome.storage.local.set({ userIdCache });
          return id;
        }
      }
      detail = err || ('HTTP ' + r.status);
    } catch (e) {
      detail = e.message;
    }
  }
  throw new Error('无法解析 @' + handle + ' 的用户 ID（' + detail + '）。请先打开该用户主页，或在 X 网页端手动把它加入一次 List，让插件学习到最新接口。');
}

// X 的"加入 List"mutation 在不同版本里叫过不同名字，逐个尝试
const ADD_OP_NAMES = ['ListAddMember', 'CreateListItem', 'AddListMember'];

async function addToList(listId, handle, userId) {
  const uid = userId || await resolveUserId(handle);
  const ops = await getOps();
  const tried = [];

  // 1) GraphQL mutation
  // 注意：X 的 GraphQL 失败时也常返回 HTTP 200，必须检查 body 里的 errors
  for (const name of ADD_OP_NAMES) {
    const op = ops[name];
    if (!op || !op.qid) continue;
    try {
      const body = { variables: { listId: String(listId), userId: String(uid) }, queryId: op.qid };
      if (op.features) body.features = op.features;
      const r = await fetch(`${API}/graphql/${op.qid}/${name}`, {
        method: 'POST',
        headers: await baseHeaders(),
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(() => null);
      const err = gqlError(j);
      if (r.ok && !err) return { ok: true };
      if (err && /already|member/i.test(err)) return { ok: true, already: true };
      tried.push(name + ': ' + (err || ('HTTP ' + r.status)));
    } catch (e) {
      tried.push(name + ': ' + e.message);
    }
  }

  // 2) v1.1 兜底
  const body = new URLSearchParams({ list_id: String(listId), user_id: String(uid) });
  try {
    const r2 = await fetch(`${API}/1.1/lists/members/create.json`, {
      method: 'POST',
      headers: {
        authorization: BEARER,
        'x-csrf-token': await getCsrf(),
        'content-type': 'application/x-www-form-urlencoded',
        'x-twitter-auth-type': 'OAuth2Session',
        referer: 'https://x.com/home'
      },
      credentials: 'include',
      body: body.toString()
    });
    const j2 = await r2.json().catch(() => null);
    // v1.1 成功时返回被添加用户的完整 JSON（含 id_str），失败时返回 {errors:[...]}
    if (r2.ok && j2 && (j2.id_str || j2.id)) return { ok: true };
    const msg2 = (j2 && j2.errors && j2.errors[0] && j2.errors[0].message) ||
      ('HTTP ' + r2.status);
    if (/already/i.test(msg2)) return { ok: true, already: true };
    tried.push('v1.1: ' + msg2);
  } catch (e) {
    tried.push('v1.1: ' + e.message);
  }

  throw new Error(tried.join(' / ') + '。请先在 X 网页端手动把任意用户加入一次 List，让插件学习到当前接口后重试。');
}

async function fetchOwnedLists() {
  const r = await fetch(`${API}/1.1/lists/ownerships.json?count=100`, {
    headers: await baseHeaders(),
    credentials: 'include'
  });
  if (!r.ok) throw new Error('获取 Lists 失败 (HTTP ' + r.status + ')，请确认已登录 x.com');
  const j = await r.json();
  return (j.lists || []).map((l) => ({ id: l.id_str, name: l.name }));
}

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'syncOps': {
          const { ops = {} } = await chrome.storage.local.get('ops');
          await chrome.storage.local.set({ ops: { ...ops, ...msg.ops } });
          sendResponse({ ok: true });
          break;
        }
        case 'getLists': {
          const { lists = [] } = await chrome.storage.local.get('lists');
          sendResponse({ lists });
          break;
        }
        case 'saveLists': {
          await chrome.storage.local.set({ lists: msg.lists || [] });
          sendResponse({ ok: true });
          break;
        }
        case 'fetchOwnedLists': {
          sendResponse({ lists: await fetchOwnedLists() });
          break;
        }
        case 'addToList': {
          sendResponse(await addToList(msg.listId, msg.handle, msg.userId));
          break;
        }
        default:
          sendResponse({ error: 'unknown message: ' + msg.type });
      }
    } catch (e) {
      sendResponse({ error: e.message || String(e) });
    }
  })();
  return true; // 异步
});
