const $ = (sel) => document.querySelector(sel);
const send = (msg) => new Promise((resolve) =>
  chrome.runtime.sendMessage(msg, (r) => {
    if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
    else resolve(r || { error: 'no response' });
  })
);

function setStatus(text, isErr = false) {
  const el = $('#status');
  el.textContent = text;
  el.className = isErr ? 'err' : '';
  if (text && !isErr) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 2500);
}

function extractListId(str) {
  const s = String(str).trim();
  const m = s.match(/x\.com\/i\/lists\/(\d+)/) || s.match(/twitter\.com\/i\/lists\/(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return null;
}

let lists = [];

async function render() {
  const box = $('#lists');
  const badge = $('#count');
  if (lists.length) {
    badge.style.display = '';
    badge.textContent = lists.length;
  } else {
    badge.style.display = 'none';
  }

  if (!lists.length) {
    box.innerHTML =
      '<div class="empty">' +
      '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>' +
      '还没有 List<br>点上方「从 X 同步」，或粘贴链接手动添加</div>';
    return;
  }
  box.innerHTML = '';
  lists.forEach((l, i) => {
    const div = document.createElement('div');
    div.className = 'list-item';

    const icon = document.createElement('span');
    icon.className = 'list-icon';
    icon.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>';

    const mid = document.createElement('div');
    mid.style.flex = '1';
    mid.style.minWidth = '0';
    const name = document.createElement('span');
    name.className = 'list-name';
    name.textContent = l.name;
    name.title = l.name;
    const idEl = document.createElement('span');
    idEl.className = 'list-id';
    idEl.textContent = 'id: ' + l.id;
    mid.appendChild(name);
    mid.appendChild(idEl);

    const del = document.createElement('button');
    del.className = 'del';
    del.title = '移除';
    del.textContent = '×';
    del.addEventListener('click', async () => {
      lists.splice(i, 1);
      await send({ type: 'saveLists', lists });
      render();
    });

    div.appendChild(icon);
    div.appendChild(mid);
    div.appendChild(del);
    box.appendChild(div);
  });
}

async function load() {
  const res = await send({ type: 'getLists' });
  lists = res.lists || [];
  render();
}

$('#fetch').addEventListener('click', async () => {
  setStatus('拉取中…');
  const res = await send({ type: 'fetchOwnedLists' });
  if (res.error) { setStatus(res.error, true); return; }
  // 按 id 去重合并，拉取的覆盖名字
  const map = new Map(lists.map((l) => [l.id, l]));
  res.lists.forEach((l) => map.set(l.id, l));
  lists = [...map.values()];
  await send({ type: 'saveLists', lists });
  render();
  setStatus('已拉取 ' + res.lists.length + ' 个 Lists');
});

$('#add').addEventListener('click', async () => {
  const id = extractListId($('#input').value);
  if (!id) { setStatus('无法识别 List 链接或 ID', true); return; }
  if (lists.some((l) => l.id === id)) { setStatus('该 List 已存在', true); return; }
  lists.push({ id, name: 'List ' + id });
  await send({ type: 'saveLists', lists });
  $('#input').value = '';
  render();
  setStatus('已添加');
});

$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#add').click();
});

load();
