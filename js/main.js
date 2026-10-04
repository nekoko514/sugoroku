import { PARK, SQUARES, timeOfDay } from './data/park.js';
import * as store from './store.js';
import { chat, listModels, PROVIDERS, MODEL_SUGGESTIONS } from './llm.js';
import {
  buildSystem, buildMessages, arrivalText, compressionRequest, memoryRequest, unsummarizedSize,
} from './prompt.js';
import { toMarkdown, toJson, parseSave, fileBaseName, saveFile } from './exporter.js';

const $ = (id) => document.getElementById(id);
const TOTAL = SQUARES.length;
const BOARD_COLS = 4;

let settings = store.loadSettings();
let personas = store.loadPersonas();
let game = store.loadGame();
let busy = false;
let editingPersonaId = null;

// ---------- 小さな道具 ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v; // AIの返事も含めて、文字は必ず textContent で入れる
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

let toastTimer;
function toast(message, ms = 2600) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function persist() {
  if (game && !store.saveGame(game)) toast('保存できなかったよ。容量がいっぱいかも。書き出しておいてね。', 5000);
}

function fmtUsage(u) {
  if (!u) return '';
  const pct = u.input ? Math.round((u.cached / u.input) * 100) : 0;
  return `入力 ${u.input.toLocaleString()}（キャッシュ ${pct}%）・出力 ${u.output.toLocaleString()}`;
}

function addUsage(u) {
  if (!u) return;
  const s = game.stats || (game.stats = { calls: 0, input: 0, cached: 0, output: 0 });
  s.calls += 1;
  s.input += u.input;
  s.cached += u.cached;
  s.output += u.output;
}

function currentSquare() {
  return SQUARES[game.position];
}

function lastArrive() {
  for (let i = game.log.length - 1; i >= 0; i--) if (game.log[i].t === 'arrive') return game.log[i];
  return null;
}

// ---------- 画面の切り替え ----------

function show(view) {
  for (const v of ['home', 'board']) $(`view-${v}`).hidden = v !== view;
  $('btn-home').hidden = view === 'home';
  if (view === 'home') renderHome();
  if (view === 'board') renderBoard();
}

function openChat() {
  $('view-chat').hidden = false;
  document.body.classList.add('chat-open');
  renderChat();
}

function closeChat() {
  $('view-chat').hidden = true;
  document.body.classList.remove('chat-open');
  renderBoard();
}

// ---------- ホーム ----------

function renderHome() {
  $('btn-continue').hidden = !game;
  const list = $('persona-list');
  list.replaceChildren();
  if (!personas.length) list.append(el('li', { class: 'muted', text: 'まだ誰もいないよ。' }));
  for (const p of personas) {
    list.append(el('li', {},
      el('button', { class: 'persona-item', type: 'button', onclick: () => editPersona(p.id) },
        el('span', { class: 'p-emoji', text: p.emoji || '🙂' }),
        el('span', { class: 'p-name', text: p.name }),
        el('span', { class: 'muted', text: '編集' }))));
  }
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('pwa-hint').hidden = !(isIos && !standalone);
}

// ---------- ペルソナ ----------

function editPersona(id) {
  editingPersonaId = id;
  const p = personas.find((x) => x.id === id) || { name: '', emoji: '', systemPrompt: '', knowledge: '' };
  $('persona-dlg-title').textContent = id ? 'ペルソナを編集' : 'ペルソナを追加';
  $('p-name').value = p.name;
  $('p-emoji').value = p.emoji;
  $('p-system').value = p.systemPrompt;
  $('p-knowledge').value = p.knowledge;
  $('btn-delete-persona').hidden = !id;
  updatePersonaSize();
  $('dlg-persona').showModal();
}

function updatePersonaSize() {
  const n = $('p-system').value.length + $('p-knowledge').value.length;
  $('p-size').textContent = `シスプロとナレッジ: ${n.toLocaleString()}文字。毎回送られる部分だけど、キャッシュが効くと割安になるよ。`;
}

$('p-system').addEventListener('input', updatePersonaSize);
$('p-knowledge').addEventListener('input', updatePersonaSize);

$('p-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  for (const f of files) {
    if (f.size > 2_000_000) { toast(`${f.name} は大きすぎるよ（2MBまで）`); continue; }
    const text = await f.text();
    const cur = $('p-knowledge').value.trim();
    $('p-knowledge').value = (cur ? cur + '\n\n' : '') + `## ${f.name}\n${text.trim()}`;
  }
  e.target.value = '';
  updatePersonaSize();
});

$('dlg-persona').addEventListener('close', () => {
  if ($('dlg-persona').returnValue !== 'save') return;
  const data = {
    name: $('p-name').value.trim() || 'なまえ未設定',
    emoji: $('p-emoji').value.trim() || '🙂',
    systemPrompt: $('p-system').value,
    knowledge: $('p-knowledge').value,
  };
  if (editingPersonaId) {
    personas = personas.map((p) => (p.id === editingPersonaId ? { ...p, ...data } : p));
  } else {
    personas.push({ id: store.newId(), ...data });
  }
  if (!store.savePersonas(personas)) toast('保存できなかったよ。ナレッジが大きすぎるかも。', 5000);
  renderHome();
});

$('btn-delete-persona').addEventListener('click', () => {
  if (!confirm('このペルソナを削除する？')) return;
  personas = personas.filter((p) => p.id !== editingPersonaId);
  store.savePersonas(personas);
  $('dlg-persona').close('deleted');
  renderHome();
});

$('btn-add-persona').addEventListener('click', () => editPersona(null));

// ---------- 設定 ----------

function fillProviderUi(provider) {
  $('set-model').value = settings.models[provider] || '';
  $('set-key').value = store.getKey(provider);
  $('set-key').placeholder = PROVIDERS[provider].keyHint;
  $('key-link').href = PROVIDERS[provider].keyUrl;
  $('row-proxy').hidden = provider !== 'deepseek';
  const dl = $('model-list');
  dl.replaceChildren(...MODEL_SUGGESTIONS[provider].map((m) => el('option', { value: m })));
}

function openSettings() {
  const sel = $('set-provider');
  sel.replaceChildren(...Object.entries(PROVIDERS).map(([id, p]) => el('option', { value: id, text: p.label })));
  sel.value = settings.provider;
  $('set-username').value = settings.userName;
  $('set-remember').checked = settings.rememberKeys;
  $('set-proxy').checked = settings.deepseekViaProxy;
  $('set-compress').value = settings.compressAt;
  fillProviderUi(settings.provider);
  $('dlg-settings').showModal();
}

// AIを切り替えたら、それまで入力していたモデルとキーを覚えておく
let lastProvider = null;
$('set-provider').addEventListener('focus', () => { lastProvider = $('set-provider').value; });
$('set-provider').addEventListener('change', () => {
  if (lastProvider) {
    settings.models[lastProvider] = $('set-model').value.trim();
    store.setKey(lastProvider, $('set-key').value.trim(), $('set-remember').checked);
  }
  lastProvider = $('set-provider').value;
  fillProviderUi(lastProvider);
});

$('btn-fetch-models').addEventListener('click', async () => {
  const provider = $('set-provider').value;
  try {
    $('btn-fetch-models').disabled = true;
    const models = await listModels({ provider, key: $('set-key').value.trim(), deepseekViaProxy: $('set-proxy').checked });
    $('model-list').replaceChildren(...models.map((m) => el('option', { value: m })));
    toast(`${models.length}個のモデルが見つかったよ。モデル欄をタップすると選べるよ。`);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    $('btn-fetch-models').disabled = false;
  }
});

$('btn-clear-keys').addEventListener('click', () => {
  if (!confirm('この端末に保存したAPIキーを全部消す？')) return;
  store.clearKeys();
  $('set-key').value = '';
  toast('キーを消したよ。');
});

$('dlg-settings').addEventListener('close', () => {
  if ($('dlg-settings').returnValue !== 'save') return;
  const provider = $('set-provider').value;
  settings = {
    ...settings,
    provider,
    userName: $('set-username').value.trim(),
    rememberKeys: $('set-remember').checked,
    deepseekViaProxy: $('set-proxy').checked,
    compressAt: Math.max(2000, Number($('set-compress').value) || store.DEFAULT_SETTINGS.compressAt),
    models: { ...settings.models, [provider]: $('set-model').value.trim() },
  };
  store.setKey(provider, $('set-key').value.trim(), settings.rememberKeys);
  store.saveSettings(settings);
  toast('保存したよ。');
  if (!$('view-board').hidden) renderBoard();
});

$('btn-settings').addEventListener('click', openSettings);

// ---------- ゲームの開始 ----------

function openPicker() {
  $('pick-username').value = settings.userName;
  const list = $('pick-list');
  list.replaceChildren();
  $('pick-empty').hidden = personas.length > 0;
  for (const p of personas) {
    list.append(el('li', {},
      el('button', {
        class: 'persona-item', type: 'button',
        onclick: () => {
          const name = $('pick-username').value.trim();
          if (!name) {
            toast('先に、あなたの呼び名を入れてね。');
            $('pick-username').focus();
            return;
          }
          if (name !== settings.userName) {
            settings = { ...settings, userName: name };
            store.saveSettings(settings);
          }
          $('dlg-pick').close();
          startGame(p);
        },
      },
      el('span', { class: 'p-emoji', text: p.emoji || '🙂' }),
      el('span', { class: 'p-name', text: p.name }))));
  }
  $('dlg-pick').showModal();
}

function startGame(persona) {
  if (game && !confirm('いま遊んでいる一日は終わりになるよ。先に書き出しておいた？ 新しく始める？')) return;
  game = {
    id: store.newId(),
    startedAt: new Date().toISOString(),
    // 途中でペルソナを編集しても会話が崩れない（キャッシュも保たれる）ように、開始時の内容を写しておく
    persona: { id: persona.id, name: persona.name, emoji: persona.emoji, systemPrompt: persona.systemPrompt, knowledge: persona.knowledge },
    userName: settings.userName,
    position: 0,
    rolls: 0,
    log: [],
    summary: '',
    summaryUpto: 0,
    finished: false,
    memory: '',
    stats: { calls: 0, input: 0, cached: 0, output: 0 },
  };
  arrive(0);
  show('board');
  openChat();
  askPersona();
}

function arrive(index) {
  const square = SQUARES[index];
  const event = square.events[Math.floor(Math.random() * square.events.length)];
  const time = timeOfDay(index, TOTAL);
  game.log.push({ t: 'arrive', square: square.id, index, time, event, text: arrivalText({ square, index, total: TOTAL, time, event, personaName: game.persona.name }) });
  if (square.kind === 'goal') game.finished = true;
  persist();
}

// ---------- ボード ----------

function renderBoard() {
  if (!game) return;
  const board = $('board');
  board.replaceChildren();
  SQUARES.forEach((sq, i) => {
    const li = el('li', { class: `sq sq-${sq.kind}${i === game.position ? ' here' : ''}${i < game.position ? ' past' : ''}` },
      el('span', { class: 'sq-emoji', text: sq.emoji }),
      el('span', { class: 'sq-name', text: sq.name }));
    if (i === game.position) li.append(el('span', { class: 'piece', text: game.persona.emoji || '🙂', 'aria-label': '現在地' }));
    // 4列で行ごとに向きを変える（すごろくらしいジグザグの道）
    const row = Math.floor(i / BOARD_COLS);
    const col = i % BOARD_COLS;
    li.style.gridRow = String(row + 1);
    li.style.gridColumn = String((row % 2 === 0 ? col : BOARD_COLS - 1 - col) + 1);
    board.append(li);
  });
  $('status-persona').textContent = `${game.persona.emoji || ''} ${game.persona.name}`;
  $('status-time').textContent = `🕒 ${timeOfDay(game.position, TOTAL)}`;
  $('status-rolls').textContent = `🎲 ${game.rolls}回`;
  $('btn-roll').disabled = busy || game.finished;
  $('btn-roll').textContent = game.finished ? 'ゴール！おつかれさま' : 'サイコロを振る';
  $('board-message').textContent = game.finished
    ? '会話を開くと、日記を書いてもらったり、思い出を書き出したりできるよ。'
    : `いまは ${currentSquare().emoji} ${currentSquare().name}`;
  const s = game.stats;
  $('usage-total').textContent = s?.calls
    ? `ここまで ${s.calls}回の送信・${fmtUsage(s)}`
    : '';
  requestAnimationFrame(() => board.querySelector('.here')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

// ---------- サイコロ（CSSの立方体） ----------

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// 面の置き場所と、その面を正面に向けるための回転
const FACES = [
  { value: 1, cls: 'front', show: [0, 0] },
  { value: 6, cls: 'back', show: [0, 180] },
  { value: 3, cls: 'right', show: [0, -90] },
  { value: 4, cls: 'left', show: [0, 90] },
  { value: 5, cls: 'top', show: [-90, 0] },
  { value: 2, cls: 'bottom', show: [90, 0] },
];
let diceTurns = 0;

function buildDice() {
  const cube = $('dice');
  cube.replaceChildren(...FACES.map((f) => {
    const face = el('div', { class: `face ${f.cls}` });
    for (let i = 0; i < 9; i++) face.append(el('span', { class: PIPS[f.value].includes(i) ? 'pip' : 'pip off' }));
    return face;
  }));
  setDice(1, false);
}

function setDice(value, animate) {
  const cube = $('dice');
  const [rx, ry] = FACES.find((f) => f.value === value).show;
  cube.classList.toggle('spinning', animate);
  // 360度の倍数を足して、毎回ちゃんと転がって見えるようにする
  const t = diceTurns * 720;
  cube.style.transform = `rotateX(${t + rx}deg) rotateY(${t + ry}deg)`;
}

async function spinDice(value) {
  diceTurns += 1;
  setDice(value, true);
  await wait(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 50 : 1200);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rollDice() {
  if (busy || !game || game.finished) return;
  busy = true;
  renderBoard();
  try {
    // 会話が長くなっていたら、進む前に思い出をまとめて、送る量を減らす
    if (unsummarizedSize(game) > settings.compressAt) {
      $('board-message').textContent = '🧠 ここまでの思い出を整理しているよ…';
      try {
        await compress();
      } catch (e) {
        toast(`思い出の整理に失敗したよ（${e.message}）。このまま進むね。`, 5000);
      }
    }
    const value = 1 + Math.floor(Math.random() * 6);
    await spinDice(value);
    $('dice-result').textContent = `${value}が出た`;

    const from = game.position;
    const to = Math.min(TOTAL - 1, from + value);
    game.rolls += 1;
    game.log.push({ t: 'roll', n: game.rolls, value, from, to });
    // 1マスずつ進める
    for (let p = from + 1; p <= to; p++) {
      game.position = p;
      renderBoard();
      await wait(220);
    }
    const sq = SQUARES[to];
    $('board-message').textContent = `${value}が出た！ ${sq.emoji} ${sq.name}に止まったよ`;
    arrive(to);
    await wait(700);
  } finally {
    busy = false;
  }
  openChat();
  askPersona();
}

async function compress() {
  const before = game.log.length;
  const res = await chat({
    ...aiArgs(),
    system: buildSystem(game),
    messages: compressionRequest(game),
  });
  if (!res.text.trim()) throw new Error('要約が空だった');
  addUsage(res.usage);
  game.summary = res.text.trim();
  game.summaryUpto = before;
  game.log.push({ t: 'compress', at: new Date().toISOString(), summary: game.summary });
  persist();
}

// ---------- 会話 ----------

function aiArgs() {
  return {
    provider: settings.provider,
    model: settings.models[settings.provider],
    key: store.getKey(settings.provider),
    deepseekViaProxy: settings.deepseekViaProxy,
  };
}

function bubble(role, text, usage) {
  const who = role === 'assistant' ? game.persona.name : (game.userName || 'あなた');
  const node = el('div', { class: `msg ${role}` },
    el('div', { class: 'msg-who', text: role === 'assistant' ? `${game.persona.emoji || ''} ${who}` : who }),
    el('div', { class: 'msg-text', text }));
  if (usage) node.append(el('div', { class: 'msg-usage', text: fmtUsage(usage) }));
  return node;
}

function placeCard(e) {
  const sq = SQUARES.find((s) => s.id === e.square);
  return el('div', { class: `place-card kind-${sq.kind}` },
    el('div', { class: 'place-name', text: `${sq.emoji} ${sq.name}` }),
    el('div', { class: 'muted small-print', text: `${e.index + 1}マス目・${e.time}` }),
    el('p', { text: sq.scene }),
    el('p', { class: 'place-event', text: `✨ ${e.event}` }),
    el('p', { class: 'muted small-print', text: `アイテム: ${sq.items.join('、')}` }));
}

function renderChat() {
  const log = $('chat-log');
  log.replaceChildren();
  for (const e of game.log) {
    if (e.t === 'roll') log.append(el('div', { class: 'roll-note', text: `🎲 ${e.n}投目：${e.value}が出た` }));
    else if (e.t === 'arrive') log.append(placeCard(e));
    else if (e.t === 'msg') log.append(bubble(e.role, e.text, e.usage));
    else if (e.t === 'compress') log.append(el('div', { class: 'roll-note', text: '🧠 ここまでの思い出を整理したよ' }));
  }
  if (game.memory) {
    log.append(el('div', { class: 'diary' },
      el('div', { class: 'place-name', text: `📔 ${game.persona.name}の夢日記` }),
      el('p', { text: game.memory })));
  }
  const arrive = lastArrive();
  const sq = SQUARES.find((s) => s.id === arrive?.square) || currentSquare();
  $('chat-place').textContent = `${sq.emoji} ${sq.name}`;
  $('chat-sub').textContent = `${game.persona.emoji || ''} ${game.persona.name}と一緒`;
  $('chat-goal').hidden = !game.finished;
  $('btn-next').hidden = game.finished;
  updateChatControls();
  scrollChat();
}

function scrollChat() {
  const log = $('chat-log');
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

function updateChatControls() {
  $('btn-send').disabled = busy;
  $('btn-next').disabled = busy;
  $('btn-memory').disabled = busy;
  $('btn-memory').textContent = game?.memory ? '📔 夢日記を書き直してもらう' : '📔 目が覚めたら、夢日記を書いてもらう';
}

function showError(message) {
  $('chat-error-text').textContent = message;
  $('chat-error').hidden = false;
}

// 会話の末尾（マス到着かユーザーの発言）に、ペルソナが返事をする
async function askPersona() {
  if (busy) return;
  busy = true;
  $('chat-error').hidden = true;
  updateChatControls();
  const live = bubble('assistant', '');
  live.classList.add('typing');
  $('chat-log').append(live);
  scrollChat();
  const textNode = live.querySelector('.msg-text');
  try {
    const res = await chat({
      ...aiArgs(),
      system: buildSystem(game),
      messages: buildMessages(game),
      onText: (t) => { textNode.textContent += t; scrollChat(); },
    });
    const text = res.text.trim();
    if (!text) {
      live.remove();
      const why = res.stop ? `（終了理由: ${res.stop}）` : '';
      showError(`返事が空っぽだったよ${why}。もう一度試してみてね。`);
      return;
    }
    game.log.push({ t: 'msg', role: 'assistant', text, usage: res.usage, at: new Date().toISOString() });
    addUsage(res.usage);
    persist();
    live.replaceWith(bubble('assistant', text, res.usage));
  } catch (e) {
    live.remove();
    showError(e.message || String(e));
  } finally {
    busy = false;
    updateChatControls();
    scrollChat();
  }
}

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (busy) return;
  const text = $('chat-text').value.trim();
  if (!text) return;
  $('chat-text').value = '';
  autosize();
  game.log.push({ t: 'msg', role: 'user', text, at: new Date().toISOString() });
  persist();
  $('chat-log').append(bubble('user', text));
  askPersona();
});

// Enterで送信、Shift+Enterで改行（スマホのキーボードでは改行ボタンのまま）
$('chat-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) {
    e.preventDefault();
    $('chat-form').requestSubmit();
  }
});

function autosize() {
  const t = $('chat-text');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 140) + 'px';
}
$('chat-text').addEventListener('input', autosize);

$('btn-retry').addEventListener('click', () => askPersona());
$('btn-next').addEventListener('click', closeChat);
$('btn-close-chat').addEventListener('click', closeChat);

$('btn-memory').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  updateChatControls();
  $('chat-error').hidden = true;
  const live = el('div', { class: 'diary typing' },
    el('div', { class: 'place-name', text: `📔 ${game.persona.name}の夢日記` }),
    el('p', { text: '' }));
  $('chat-log').querySelector('.diary')?.remove();
  $('chat-log').append(live);
  scrollChat();
  const p = live.querySelector('p');
  try {
    const res = await chat({
      ...aiArgs(),
      system: buildSystem(game),
      messages: memoryRequest(game),
      onText: (t) => { p.textContent += t; scrollChat(); },
    });
    if (!res.text.trim()) throw new Error('日記が空っぽだったよ。もう一度試してみてね。');
    game.memory = res.text.trim();
    addUsage(res.usage);
    persist();
    live.classList.remove('typing');
  } catch (e) {
    live.remove();
    showError(e.message || String(e));
  } finally {
    busy = false;
    updateChatControls();
  }
});

// ---------- 書き出し・読み込み ----------

function openExport() {
  if (!game) return;
  $('dlg-export').showModal();
}

$('btn-export').addEventListener('click', openExport);
$('btn-export-2').addEventListener('click', openExport);
$('btn-export-md').addEventListener('click', () => saveFile(`${fileBaseName(game)}.md`, toMarkdown(game), 'text/markdown'));
$('btn-export-json').addEventListener('click', () => saveFile(`${fileBaseName(game)}.json`, toJson(game), 'application/json'));

$('input-import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const loaded = parseSave(await f.text());
    if (game && !confirm('いま遊んでいる一日と入れ替わるよ。読み込む？')) return;
    game = loaded;
    persist();
    toast('読み込んだよ。');
    show('board');
  } catch (err) {
    toast(err.message || '読み込めなかったよ。', 5000);
  }
});

// ---------- はじまり ----------

$('btn-new').addEventListener('click', openPicker);
$('btn-continue').addEventListener('click', () => show('board'));
$('btn-roll').addEventListener('click', rollDice);
$('btn-open-chat').addEventListener('click', openChat);
$('btn-home').addEventListener('click', () => { closeChat(); show('home'); });

buildDice();
$('park-name').textContent = PARK.name;
$('park-tagline').textContent = PARK.tagline;
document.title = PARK.name;
show('home');

if (!store.getKey(settings.provider)) {
  toast('はじめに ⚙︎ から、使うAIとAPIキーを設定してね。', 4000);
}
