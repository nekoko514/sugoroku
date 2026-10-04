import { PARK, START, timeOfDay, pickSeeds } from './data/park.js';
import { NODES, TOTAL_STEPS, nextChoices, stepOf, renderMap, scrollToNode } from './map.js';
import { pickAmbient } from './data/ambient.js';
import { SECRETS, trySecret, linksAt, linkText, secretById } from './data/secrets.js';
import * as store from './store.js';
import { chat, listModels, PROVIDERS, MODEL_SUGGESTIONS } from './llm.js';
import {
  buildSystem, buildMessages, arrivalText, compressionRequest, memoryRequest, unsummarizedSize, TOOLS, runTool, seenItems, FOUND_TAG,
} from './prompt.js';
import { toMarkdown, toJson, parseSave, fileBaseName, saveFile } from './exporter.js';

const $ = (id) => document.getElementById(id);

let settings = store.loadSettings();
let personas = store.loadPersonas();
let game = null; // 読み込みは一番下の「はじまり」で（移行用の定数を使うため）
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
  return NODES[game.position];
}

// 地図が一本道だったころのセーブデータ（位置が番号）を、今の形に直す
const OLD_ORDER = ['gate', 'fountain', 'merry', 'cups', 'churros', 'shooting', 'coaster', 'photo', 'haunted', 'mirror', 'bench', 'parade', 'splash', 'shop', 'wheel', 'fireworks'];
function migrateGame(g) {
  if (!g) return g;
  if (typeof g.position === 'number') g.position = OLD_ORDER[g.position] || START;
  if (!NODES[g.position]) g.position = START;
  if (!Array.isArray(g.trail)) g.trail = [g.position];
  if (!Array.isArray(g.found)) g.found = [];
  return g;
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
  document.documentElement.classList.add('chat-open');
  renderChat();
}

function closeChat() {
  $('view-chat').hidden = true;
  document.documentElement.classList.remove('chat-open');
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
  // 夢の図鑑（これまでに見つけた隠しアイテム）
  const got = new Set(store.loadCollection());
  $('book-count').textContent = `${SECRETS.filter((s) => got.has(s.id)).length} / ${SECRETS.length}`;
  $('book-list').replaceChildren(...SECRETS.map((s) => el('li', { class: got.has(s.id) ? 'got' : 'unknown', text: got.has(s.id) ? `✨ ${s.name}` : '？？？' })));
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
  $('pick-cast').checked = settings.cast !== false;
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
          const cast = $('pick-cast').checked;
          if (name !== settings.userName || cast !== (settings.cast !== false)) {
            settings = { ...settings, userName: name, cast };
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
    // スタッフなどほかの登場人物を出すか。ルールの文が変わるので、その一日のあいだは固定
    cast: settings.cast !== false,
    position: START,
    trail: [START], // 通ったマス（地図に足あとを描く）
    found: [], // 見つけた隠しアイテム（二人の持ち物）
    rolls: 0,
    log: [],
    summary: '',
    summaryUpto: 0,
    finished: false,
    memory: '',
    stats: { calls: 0, input: 0, cached: 0, output: 0 },
  };
  arrive(START);
  show('board');
  openChat();
  askPersona();
}

function arrive(id, route) {
  const square = NODES[id];
  const step = stepOf(id);
  const time = timeOfDay(step, TOTAL_STEPS);
  const cast = game.cast !== false;
  const seeds = pickSeeds(square, time, { cast });
  // 持ち物がきっかけで起こる出来事
  const links = linksAt(id, game.found || []);
  const text = arrivalText({
    square, step, total: TOTAL_STEPS, time, seeds, route, cast,
    personaName: game.persona.name, userName: game.userName,
    links: links.map((l) => ({ name: l.name, text: linkText(l, cast) })),
  });
  game.log.push({ t: 'arrive', square: id, step, time, seeds, route, text, ...(links.length ? { links: links.map((l) => l.id) } : {}) });
  if (square.kind === 'goal') game.finished = true;
  persist();
}

// ---------- ボード ----------

let pendingChoice = null; // 分かれ道で選んでいる途中なら { choices, resolve }

function renderBoard(scroll = true) {
  if (!game) return;
  const here = currentSquare();
  renderMap($('map'), {
    position: game.position,
    trail: game.trail,
    piece: game.persona.emoji || '🙂',
    choices: pendingChoice ? pendingChoice.choices.map((c) => c.to) : [],
  }, onMapTap);
  $('status-persona').textContent = `${game.persona.emoji || ''} ${game.persona.name}`;
  $('status-time').textContent = `🕒 ${timeOfDay(stepOf(game.position), TOTAL_STEPS)}`;
  $('status-rolls').textContent = `🎲 ${game.rolls}回`;
  $('btn-roll').hidden = !!pendingChoice;
  $('btn-roll').disabled = busy || game.finished;
  $('btn-roll').textContent = game.finished ? 'ゴール！おつかれさま' : 'サイコロを振る';
  if (!busy) {
    $('board-message').textContent = game.finished
      ? '会話を開くと、夢日記を書いてもらったり、思い出を書き出したりできるよ。'
      : `いまは ${here.emoji} ${here.name}`;
  }
  const s = game.stats;
  $('usage-total').textContent = s?.calls
    ? `ここまで ${s.calls}回の送信・${fmtUsage(s)}`
    : '';
  if (scroll) {
    requestAnimationFrame(() => {
      if (!document.documentElement.classList.contains('chat-open')) scrollToNode($('map'), game.position);
    });
  }
}

function onMapTap(id) {
  if (pendingChoice) {
    const c = pendingChoice.choices.find((x) => x.to === id);
    if (c) { pendingChoice.resolve(c); return; }
  }
  const n = NODES[id];
  toast(`${n.emoji} ${n.name}：${n.hint}`, 3000);
}

// 分かれ道でどっちへ行くか選んでもらう
function chooseBranch(choices) {
  return new Promise((resolve) => {
    pendingChoice = {
      choices,
      resolve: (c) => {
        pendingChoice = null;
        $('branch-panel').hidden = true;
        resolve(c);
      },
    };
    $('branch-buttons').replaceChildren(...choices.map((c) => {
      const to = NODES[c.to];
      return el('button', { class: 'btn branch-btn', type: 'button', onclick: () => pendingChoice?.resolve(c) },
        el('span', { class: 'branch-name', text: c.label }),
        el('span', { class: 'branch-to', text: `${to.emoji} ${to.name}へ` }));
    }));
    $('branch-panel').hidden = false;
    $('board-message').textContent = '分かれ道に着いたよ。地図の光っているマスをタップしても選べるよ。';
    renderBoard(false);
  });
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
    let route = null;
    $('board-message').textContent = `${value}が出た！`;
    // 1マスずつ進める。分かれ道では止まって、どっちへ行くか選んでもらう
    for (let left = value; left > 0; left--) {
      const choices = nextChoices(game.position);
      if (!choices.length) break; // ゴール
      let next = choices[0];
      if (choices.length > 1) {
        next = await chooseBranch(choices);
        route = next.label;
        $('board-message').textContent = `「${next.label}」へ！ あと${left}マス`;
      }
      game.position = next.to;
      game.trail.push(next.to);
      renderBoard();
      await wait(320);
    }
    const sq = currentSquare();
    game.rolls += 1;
    game.log.push({ t: 'roll', n: game.rolls, value, from, to: game.position, route });
    $('board-message').textContent = `${value}が出た！ ${sq.emoji} ${sq.name}に止まったよ`;
    arrive(game.position, route);
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
    messages: compressionRequest(game, settings.provider),
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
    tools: TOOLS, // 使わない呼び出しでも毎回同じものを渡す（キャッシュのため）
    onTool: (name, args) => runTool(name, args, { seen: seenItems(game), cast: game.cast !== false }),
  };
}

// 最後のやり取りが「考えた記録だけ」で文字がないときは、送り返すと嫌がられることがあるので外す
function trimRaw(raw) {
  const msgs = [...(raw?.messages || [])];
  const hasText = (m) => {
    if (m.parts) return m.parts.some((p) => p.text || p.functionCall);
    if (Array.isArray(m.content)) return m.content.some((b) => (b.type === 'text' && b.text) || b.type === 'tool_use');
    return !!m.content || !!m.tool_calls;
  };
  while (msgs.length && !hasText(msgs[msgs.length - 1])) msgs.pop();
  return { ...raw, messages: msgs };
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
  const sq = NODES[e.square];
  return el('div', { class: `place-card kind-${sq.kind}` },
    el('div', { class: 'place-name', text: `${sq.emoji} ${sq.name}` }),
    el('div', { class: 'muted small-print', text: `${(e.step ?? e.index) + 1}マス目・${e.time}` }),
    // 景色やイベントはペルソナだけが知っている。ユーザーにはペルソナの言葉で伝わる
    el('p', { class: 'muted small-print', text: sq.hint }),
    ...(e.links || []).map((id) => el('p', { class: 'link-note', text: `✨ 持ち物の「${secretById(id)?.name}」が、ここで何かにつながりそう` })));
}

function foundNote(id) {
  const s = secretById(id);
  const n = (game.found || []).indexOf(id) + 1;
  return el('div', { class: 'found-note', text: `✨ 見つけたもの：${s?.name}（今日 ${n || '?'}つめ）` });
}

function renderChat() {
  const log = $('chat-log');
  log.replaceChildren();
  for (const e of game.log) {
    if (e.t === 'roll') log.append(el('div', { class: 'roll-note', text: `🎲 ${e.n}投目：${e.value}が出た${e.route ? `（🪧 ${e.route}へ）` : ''}` }));
    else if (e.t === 'arrive') log.append(placeCard(e));
    else if (e.t === 'msg') {
      log.append(bubble(e.role, e.text, e.usage));
      if (e.ambient) log.append(ambientNote(e.ambient));
      for (const id of e.finds || []) log.append(foundNote(id));
    }
    else if (e.t === 'compress') log.append(el('div', { class: 'roll-note', text: '🧠 ここまでの思い出を整理したよ' }));
  }
  if (game.memory) {
    log.append(el('div', { class: 'diary' },
      el('div', { class: 'place-name', text: `📔 ${game.persona.name}の夢日記` }),
      el('p', { text: game.memory })));
  }
  const arrive = lastArrive();
  const sq = NODES[arrive?.square] || currentSquare();
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
    // ペルソナがショーケースを近くで見ても、ユーザーには見せない（いつもの「…」のまま）
    const looks = [];
    const finds = []; // この返事で見つけた隠しアイテム（返事が届いたら持ち物にする）
    let lookChars = 0;
    const res = await chat({
      ...aiArgs(),
      system: buildSystem(game),
      messages: buildMessages(game, settings.provider),
      onTool: (name, args) => {
        let out = runTool(name, args, { seen: [...seenItems(game), ...looks], cast: game.cast !== false });
        looks.push(String(args?.item || ''));
        // 近くで見た品物の奥に、隠しアイテムがあれば確率で見つかる
        const s = name === 'look_closer' && trySecret(String(args?.item || ''), { found: [...(game.found || []), ...finds] });
        if (s) {
          finds.push(s.id);
          out += `\n\n${FOUND_TAG}${s.found}`;
        }
        lookChars += out.length;
        return out;
      },
      onText: (t) => { textNode.textContent += t; scrollChat(); },
    });
    const text = res.text.trim();
    if (!text) {
      live.remove();
      const why = res.stop ? `（終了理由: ${res.stop}）` : '';
      showError(`返事が空っぽだったよ${why}。もう一度試してみてね。`);
      return;
    }
    game.log.push({
      t: 'msg', role: 'assistant', text, usage: res.usage, at: new Date().toISOString(),
      looks, lookChars, raw: trimRaw(res.raw), ...(finds.length ? { finds } : {}),
    });
    if (finds.length) {
      (game.found ||= []).push(...finds);
      store.addToCollection(finds);
    }
    addUsage(res.usage);
    persist();
    live.replaceWith(bubble('assistant', text, res.usage));
    for (const id of finds) $('chat-log').append(foundNote(id));
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
  const ambient = nextAmbient();
  game.log.push({ t: 'msg', role: 'user', text, at: new Date().toISOString(), ...(ambient ? { ambient: ambient.text } : {}) });
  if (ambient) (game.ambientUsed ||= []).push(ambient.id);
  persist();
  $('chat-log').append(bubble('user', text));
  if (ambient) $('chat-log').append(ambientNote(ambient.text));
  askPersona();
});

// 同じ場所で何回か話したら、ときどき「まわりの様子」が少し動く（BGMが変わる、風が吹く、など）
const AMBIENT_AFTER = 3; // この回数話したら起こりうる
const AMBIENT_CHANCE = 0.6; // 起こる確率
function nextAmbient() {
  let since = 0;
  let where = null;
  for (let i = game.log.length - 1; i >= 0; i--) {
    const e = game.log[i];
    if (e.t === 'arrive') { where = e; break; }
    if (e.t === 'msg' && e.role === 'user') {
      if (e.ambient) break;
      since += 1;
    }
  }
  if (!where || since + 1 < AMBIENT_AFTER || Math.random() >= AMBIENT_CHANCE) return null;
  return pickAmbient(where.square, where.time, { cast: game.cast !== false, used: game.ambientUsed || [] });
}

function ambientNote(text) {
  return el('div', { class: 'ambient-note', text: `♪ ${text}` });
}

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
// 話し足りたら、会話画面からそのままサイコロを振る
$('btn-next').addEventListener('click', () => {
  if (busy || game.finished) return;
  closeChat();
  rollDice();
});
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
      messages: memoryRequest(game, settings.provider),
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
    game = migrateGame(loaded);
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

game = migrateGame(store.loadGame());
buildDice();
$('park-name').textContent = PARK.name;
$('park-tagline').textContent = PARK.tagline;
document.title = PARK.name;
show('home');

if (!store.getKey(settings.provider)) {
  toast('はじめに ⚙︎ から、使うAIとAPIキーを設定してね。', 4000);
}
