// 4社のAPIをブラウザから直接呼ぶ。キーはこの端末からAPI提供元へ送られるだけで、
// このサイトのサーバーには届かない（DeepSeek の中継をオンにしたときだけ例外）。
//
// 入力はどのAIでも共通の形:
//   system:   [{ text, cache: boolean }]  … 先頭から順に、変わらない部分
//   messages: [{ role: 'user' | 'assistant', text }]
// 出力: { text, usage: { input, cached, output }, stop }

export const PROVIDERS = {
  gemini: { label: 'Gemini（Google）', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
  claude: { label: 'Claude（Anthropic）', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'GPT（OpenAI）', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  deepseek: { label: 'DeepSeek', keyHint: 'sk-…', keyUrl: 'https://platform.deepseek.com/api_keys' },
};

export const MODEL_SUGGESTIONS = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
  openai: ['gpt-5-mini', 'gpt-5'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
};

const ANTHROPIC_VERSION = '2023-06-01';

export class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// 同じ役割のメッセージが続くと嫌がるAPIがあるので、まとめておく
function mergeTurns(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text += '\n\n' + m.text;
    else out.push({ role: m.role, text: m.text });
  }
  return out;
}

function deepseekBase(viaProxy) {
  return viaProxy ? '/api/deepseek' : 'https://api.deepseek.com';
}

// ---- リクエストの組み立て ----

function buildGemini({ model, key, system, messages }) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: {
      systemInstruction: { parts: system.map((s) => ({ text: s.text })) },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      })),
    },
  };
}

// Claude 5 世代だけが受け付けるパラメータ
function isClaude5(model) {
  return /^claude-(opus|sonnet|fable|mythos)-5/.test(model);
}

function buildClaude({ model, key, system, messages }) {
  const body = {
    model,
    max_tokens: 16000,
    stream: true,
    // ペルソナまでをキャッシュ。会話部分は自動キャッシュで末尾まで伸びていく
    system: system.map((s) => (s.cache
      ? { type: 'text', text: s.text, cache_control: { type: 'ephemeral' } }
      : { type: 'text', text: s.text })),
    cache_control: { type: 'ephemeral' },
    messages: messages.map((m) => ({ role: m.role, content: m.text })),
  };
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (isClaude5(model)) {
    // おしゃべりは深く考えなくていいので、思考量を抑えて料金を下げる
    body.output_config = { effort: 'low' };
    // 安全フィルタに止められたとき、サーバー側で別モデルに切り替えて続ける
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  return { url: 'https://api.anthropic.com/v1/messages', headers, body };
}

function buildOpenAiLike(base, { model, key, system, messages }) {
  return {
    url: `${base}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: {
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        // 分けて送るとキャッシュの先頭がずれることがあるので、1つにまとめる
        { role: 'system', content: system.map((s) => s.text).join('\n\n') },
        ...messages.map((m) => ({ role: m.role, content: m.text })),
      ],
    },
  };
}

// ---- ストリームの読み取り ----

async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk.split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) yield data;
    }
  }
  const tail = buf.trim();
  if (tail.startsWith('data:')) yield tail.slice(5).trimStart();
}

function parseJson(data) {
  try { return JSON.parse(data); } catch { return null; }
}

async function readGemini(response, onText) {
  const usage = { input: 0, cached: 0, output: 0 };
  let stop = '';
  for await (const data of sseEvents(response)) {
    const ev = parseJson(data);
    if (!ev) continue;
    if (ev.error) throw new LlmError(ev.error.message || 'Gemini のエラー');
    const cand = ev.candidates?.[0];
    for (const p of cand?.content?.parts || []) {
      if (p.text && !p.thought) onText(p.text);
    }
    if (cand?.finishReason) stop = cand.finishReason;
    if (ev.promptFeedback?.blockReason) stop = 'blocked:' + ev.promptFeedback.blockReason;
    const u = ev.usageMetadata;
    if (u) {
      usage.input = u.promptTokenCount || 0;
      usage.cached = u.cachedContentTokenCount || 0;
      usage.output = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    }
  }
  return { usage, stop };
}

async function readClaude(response, onText) {
  const usage = { input: 0, cached: 0, output: 0 };
  let stop = '';
  for await (const data of sseEvents(response)) {
    const ev = parseJson(data);
    if (!ev) continue;
    if (ev.type === 'error') throw new LlmError(ev.error?.message || 'Claude のエラー');
    if (ev.type === 'message_start') {
      const u = ev.message?.usage || {};
      usage.cached = u.cache_read_input_tokens || 0;
      usage.input = (u.input_tokens || 0) + usage.cached + (u.cache_creation_input_tokens || 0);
      usage.output = u.output_tokens || 0;
    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      onText(ev.delta.text);
    } else if (ev.type === 'message_delta') {
      if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
      if (ev.usage?.output_tokens != null) usage.output = ev.usage.output_tokens;
    }
  }
  return { usage, stop };
}

async function readOpenAiLike(response, onText) {
  const usage = { input: 0, cached: 0, output: 0 };
  let stop = '';
  for await (const data of sseEvents(response)) {
    if (data === '[DONE]') break;
    const ev = parseJson(data);
    if (!ev) continue;
    if (ev.error) throw new LlmError(ev.error.message || 'APIのエラー');
    const choice = ev.choices?.[0];
    if (choice?.delta?.content) onText(choice.delta.content);
    if (choice?.finish_reason) stop = choice.finish_reason;
    const u = ev.usage;
    if (u) {
      usage.input = u.prompt_tokens || 0;
      // OpenAI は prompt_tokens_details.cached_tokens、DeepSeek は prompt_cache_hit_tokens
      usage.cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
      usage.output = u.completion_tokens || 0;
    }
  }
  return { usage, stop };
}

async function errorMessage(response) {
  let detail = '';
  try {
    const j = await response.json();
    detail = j.error?.message || j.message || JSON.stringify(j).slice(0, 300);
  } catch { /* 本文なし */ }
  const hints = {
    400: 'リクエストの内容かモデル名が正しくないみたい。',
    401: 'APIキーが正しくないみたい。',
    403: 'このキーではこのモデルを使えないみたい。',
    404: 'モデル名が見つからないみたい。',
    429: '使いすぎか残高不足みたい。少し待つか、残高を確認してね。',
  };
  const hint = hints[response.status] || (response.status >= 500 ? 'AIのサーバーが混んでいるみたい。少し待ってからもう一度試してね。' : '');
  return `${hint}（${response.status}${detail ? `: ${detail}` : ''}）`;
}

/**
 * 会話を1回送る。onText にはストリーミングで届いた文字が順に渡される。
 */
export async function chat({ provider, model, key, system, messages, onText = () => {}, signal, deepseekViaProxy = false }) {
  if (!key) throw new LlmError('APIキーが入っていないよ。設定から入れてね。');
  if (!model) throw new LlmError('モデル名が入っていないよ。設定から入れてね。');

  const args = { model, key, system, messages: mergeTurns(messages) };
  let req;
  let reader;
  if (provider === 'gemini') { req = buildGemini(args); reader = readGemini; }
  else if (provider === 'claude') { req = buildClaude(args); reader = readClaude; }
  else if (provider === 'openai') { req = buildOpenAiLike('https://api.openai.com/v1', args); reader = readOpenAiLike; }
  else if (provider === 'deepseek') { req = buildOpenAiLike(deepseekBase(deepseekViaProxy), args); reader = readOpenAiLike; }
  else throw new LlmError('知らないAIの種類だよ: ' + provider);

  let response;
  try {
    response = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const extra = provider === 'deepseek' && !deepseekViaProxy
      ? ' DeepSeek はブラウザから直接つながらないことがあるので、設定の「DeepSeekはサイト経由で送る」を試してみてね。'
      : '';
    throw new LlmError('AIにつながらなかったよ。電波を確認してね。' + extra);
  }
  if (!response.ok) throw new LlmError(await errorMessage(response), response.status);

  let text = '';
  const { usage, stop } = await reader(response, (t) => { text += t; onText(t); });
  return { text, usage, stop };
}

/**
 * そのキーで使えるモデルの一覧を取ってくる（モデル名を打ち間違えないように）。
 */
export async function listModels({ provider, key, deepseekViaProxy = false }) {
  if (!key) throw new LlmError('先にAPIキーを入れてね。');
  let url;
  let headers;
  if (provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
    headers = { 'x-goog-api-key': key };
  } else if (provider === 'claude') {
    url = 'https://api.anthropic.com/v1/models?limit=1000';
    headers = { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' };
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/models';
    headers = { authorization: `Bearer ${key}` };
  } else {
    url = `${deepseekBase(deepseekViaProxy)}/models`;
    headers = { authorization: `Bearer ${key}` };
  }
  let response;
  try {
    response = await fetch(url, { headers, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new LlmError('AIにつながらなかったよ。');
  }
  if (!response.ok) throw new LlmError(await errorMessage(response), response.status);
  const j = await response.json();
  if (provider === 'gemini') {
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => n.startsWith('gemini'));
  }
  const ids = (j.data || []).map((m) => m.id);
  if (provider === 'openai') return ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(id));
  return ids;
}
