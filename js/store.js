// ブラウザ内の保存。APIキーもペルソナもこの端末の外には出ない。
// localStorage が使えない環境（プライベートブラウズなど）でも落ちないように、全部 try/catch で包む。

const PREFIX = 'sugoroku:';
const memory = new Map(); // 「保存しない」設定のキーや、storage が使えないときの退避先

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw != null) return JSON.parse(raw);
  } catch { /* 読めないときは fallback */ }
  return memory.has(key) ? memory.get(key) : fallback;
}

function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  memory.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch { /* noop */ }
}

// ---- 設定 ----
export const DEFAULT_SETTINGS = {
  provider: 'gemini',
  models: {
    gemini: 'gemini-2.5-flash',
    claude: 'claude-opus-5-5',
    openai: 'gpt-5-mini',
    deepseek: 'deepseek-chat',
  },
  rememberKeys: true,
  deepseekViaProxy: false,
  userName: '',
  cast: true, // スタッフなど、ほかの登場人物も出す
  compressAt: 8000, // 要約していない会話がこの文字数を超えたら、次のマスへ進む前に圧縮する
};

export function loadSettings() {
  const s = read('settings', {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    models: { ...DEFAULT_SETTINGS.models, ...(s.models || {}) },
  };
}

export function saveSettings(settings) {
  write('settings', settings);
  if (!settings.rememberKeys) {
    // 保存しない設定に切り替えたら、保存済みのキーは消してメモリだけに残す
    const keys = read('keys', {});
    remove('keys');
    memory.set('keys', keys);
  }
}

// ---- APIキー ----
export function getKey(provider) {
  return (read('keys', {}) || {})[provider] || '';
}

export function setKey(provider, value, remember) {
  const keys = { ...(read('keys', {}) || {}), [provider]: value };
  if (remember) {
    write('keys', keys);
  } else {
    remove('keys');
    memory.set('keys', keys);
  }
}

export function clearKeys() {
  remove('keys');
}

// ---- ペルソナ ----
export function loadPersonas() {
  return read('personas', []);
}

export function savePersonas(list) {
  return write('personas', list);
}

// ---- 進行中のゲーム ----
export function loadGame() {
  return read('game', null);
}

export function saveGame(game) {
  return write('game', game);
}

export function clearGame() {
  remove('game');
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
