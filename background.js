// Background service worker
// 职责：调用 X 网页端自身的接口完成"加入 List"操作，复用浏览器登录态
// - getLists / saveLists：管理本地保存的 Lists
// - fetchOwnedLists：拉取"我拥有的 Lists"
// - addToList：把指定用户加入指定 List

const API = 'https://x.com/i/api';
const BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// ---------- 基础 ----------
async function getCsrf() {
  const c = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' });
  return c ? c.value : '';
}

async function baseHeaders() {
  return {
    authorization: BEARER,
    'x-csrf-token': await getCsrf(),
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    referer: 'https://x.com/home'
  };
}

// ---------- 业务 ----------
async function addToList(listId, handle, userId) {
  // 用户 ID 由 content script 从页面 DOM 直接读取
  if (!userId) {
    throw new Error('没能从页面读取到 @' + handle + ' 的用户 ID，请刷新页面后重试');
  }

  const body = new URLSearchParams({
    list_id: String(listId),
    user_id: String(userId)
  });

  const r = await fetch(`${API}/1.1/lists/members/create.json`, {
    method: 'POST',
    headers: {
      ...(await baseHeaders()),
      'content-type': 'application/x-www-form-urlencoded'
    },
    credentials: 'include',
    body: body.toString()
  });

  const j = await r.json().catch(() => null);
  // 成功时返回被添加用户的完整 JSON（含 id_str），失败时返回 { errors: [...] }
  if (r.ok && j && (j.id_str || j.id)) return { ok: true };

  const msg = (j && j.errors && j.errors[0] && j.errors[0].message) || ('HTTP ' + r.status);
  if (/already/i.test(msg)) return { ok: true, already: true };
  throw new Error(msg);
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
  return true; // 异步响应
});
