// 4社のAPIをブラウザから直接呼ぶ。キーはこの端末からAPI提供元へ送られるだけで、
// このサイトのサーバーには届かない（DeepSeek の中継をオンにしたときだけ例外）。
//
// 入力はどのAIでも共通の形:
//   system:   [{ text, cache: boolean }]  … 先頭から順に、変わらない部分
//   messages: [{ role: 'user' | 'assistant', text }]  … ふつうの発言
//             または { native: そのAI専用の形のメッセージ }  … 前の返事をそのまま送り返すとき
//   tools:    [{ name, description, params: { 引数名: 説明 } }]  … 毎回同じものを渡す（キャッシュのため）
//   onTool(name, args) … AIが道具を使ったときに呼ばれる。返した文字がAIに届く（ユーザーには見えない）
// 出力: { text, usage: { input, cached, output }, stop, raw: { provider, model, messages: [そのAI専用の形] } }
//
// raw は「この返事」を作るまでにやり取りしたもの全部（道具の呼び出しと結果を含む）。
// 次の会話で同じAIに送り返すと、先頭がそっくり同じになるのでキャッシュが効く。
// Gemini と Claude は、道具を使った返事の「考えた記録」もそのまま送り返す必要がある。

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
const MAX_ROUNDS = 5; // 道具を使って考え直す回数の上限（無限ループ防止）

export class LlmError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function deepseekBase(viaProxy) {
  return viaProxy ? '/api/deepseek' : 'https://api.deepseek.com';
}

// ---------- AIごとの書き方 ----------

const gemini = {
  url: ({ model }) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
  headers: ({ key }) => ({ 'content-type': 'application/json', 'x-goog-api-key': key }),
  text: (role, text) => ({ role: role === 'assistant' ? 'model' : 'user', parts: [{ text }] }),
  role: (m) => (m.role === 'model' ? 'assistant' : 'user'),
  merge: (a, b) => ({ role: a.role, parts: [...a.parts, ...b.parts] }),
  tools: (tools) => [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, { type: 'STRING', description: d }])),
        required: Object.keys(t.params),
      },
    })),
  }],
  body: ({ system, messages, tools }) => {
    const body = {
      systemInstruction: { parts: system.map((s) => ({ text: s.text })) },
      contents: messages,
    };
    if (tools.length) body.tools = gemini.tools(tools);
    return body;
  },
  async read(response, onText) {
    const parts = [];
    const usage = { input: 0, cached: 0, output: 0 };
    let stop = '';
    for await (const data of sseEvents(response)) {
      const ev = parseJson(data);
      if (!ev) continue;
      if (ev.error) throw new LlmError(ev.error.message || 'Gemini のエラー');
      const cand = ev.candidates?.[0];
      for (const p of cand?.content?.parts || []) {
        if (p.thought) continue; // 考えた中身は頼んでいないので、来ても使わない
        if (p.functionCall) {
          parts.push(p); // thoughtSignature ごとそのまま残す（送り返すときに必要）
        } else if (p.text != null || p.thoughtSignature) {
          const last = parts[parts.length - 1];
          if (last && last.text != null && !last.functionCall) {
            last.text += p.text || '';
            if (p.thoughtSignature) last.thoughtSignature = p.thoughtSignature;
          } else {
            parts.push({ ...p, text: p.text || '' });
          }
          if (p.text) onText(p.text);
        }
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
    const calls = parts.filter((p) => p.functionCall).map((p, i) => ({
      id: p.functionCall.id || `call_${i}`,
      name: p.functionCall.name,
      args: p.functionCall.args || {},
    }));
    const text = parts.filter((p) => p.text).map((p) => p.text).join('');
    return { message: { role: 'model', parts }, calls, text, usage, stop };
  },
  results: (calls, outputs) => [{
    role: 'user',
    parts: calls.map((c, i) => ({
      functionResponse: { ...(c.id.startsWith('call_') ? {} : { id: c.id }), name: c.name, response: { result: outputs[i] } },
    })),
  }],
};

// Claude 5 世代だけが受け付けるパラメータ
function isClaude5(model) {
  return /^claude-(opus|sonnet|fable|mythos)-5/.test(model);
}

const claude = {
  url: () => 'https://api.anthropic.com/v1/messages',
  headers: ({ key, model }) => {
    const h = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    // 安全フィルタに止められたとき、サーバー側で別モデルに切り替えて続ける
    if (isClaude5(model)) h['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    return h;
  },
  text: (role, text) => ({ role, content: [{ type: 'text', text }] }),
  role: (m) => m.role,
  merge: (a, b) => ({ role: a.role, content: [...toBlocks(a.content), ...toBlocks(b.content)] }),
  body: ({ model, system, messages, tools }) => {
    const body = {
      model,
      max_tokens: 16000,
      stream: true,
      // 道具の説明〜ペルソナまでをキャッシュ。会話部分は自動キャッシュで末尾まで伸びていく
      system: system.map((s) => (s.cache
        ? { type: 'text', text: s.text, cache_control: { type: 'ephemeral' } }
        : { type: 'text', text: s.text })),
      cache_control: { type: 'ephemeral' },
      messages,
    };
    if (tools.length) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: 'object',
          properties: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, { type: 'string', description: d }])),
          required: Object.keys(t.params),
        },
      }));
    }
    if (isClaude5(model)) {
      // おしゃべりは深く考えなくていいので、思考量を抑えて料金を下げる
      body.output_config = { effort: 'low' };
      body.fallbacks = 'default';
    }
    return body;
  },
  async read(response, onText) {
    const blocks = [];
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
      } else if (ev.type === 'content_block_start') {
        const b = { ...ev.content_block };
        if (b.type === 'tool_use') { b.input = {}; b._json = ''; }
        blocks[ev.index] = b;
      } else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index];
        const d = ev.delta || {};
        if (!b) continue;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; onText(d.text); }
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        else if (d.type === 'input_json_delta') b._json += d.partial_json;
      } else if (ev.type === 'content_block_stop') {
        const b = blocks[ev.index];
        if (b?.type === 'tool_use') {
          b.input = parseJson(b._json || '{}') || {};
          delete b._json;
        }
      } else if (ev.type === 'message_delta') {
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        if (ev.usage?.output_tokens != null) usage.output = ev.usage.output_tokens;
      }
    }
    let content = blocks.filter(Boolean);
    // 途中で別モデルに切り替わったときは、切り替わる前の考えた記録と道具の呼び出しを送り返さない
    const fb = content.map((b) => b.type).lastIndexOf('fallback');
    if (fb >= 0) {
      content = [
        ...content.slice(0, fb).filter((b) => b.type === 'text'),
        ...content.slice(fb + 1),
      ];
    }
    content = content.filter((b) => b.type !== 'fallback' && !(b.type === 'text' && !b.text));
    const calls = content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (stop === 'refusal') throw new LlmError('AIがこの返事を断ったみたい。少し言い方を変えて、もう一度試してみてね。');
    return { message: { role: 'assistant', content }, calls, text, usage, stop };
  },
  results: (calls, outputs) => [{
    role: 'user',
    content: calls.map((c, i) => ({ type: 'tool_result', tool_use_id: c.id, content: outputs[i] })),
  }],
};

function toBlocks(content) {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

function openAiLike(name) {
  return {
    url: ({ deepseekViaProxy }) => (name === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : `${deepseekBase(deepseekViaProxy)}/chat/completions`),
    headers: ({ key }) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    text: (role, text) => ({ role, content: text }),
    role: (m) => m.role,
    merge: (a, b) => (a.role === 'user' && typeof a.content === 'string' && typeof b.content === 'string'
      ? { role: 'user', content: `${a.content}\n\n${b.content}` }
      : null),
    // 前の返事の「考えた中身」（DeepSeek）は、新しい会話では送り返さない
    clean: (m) => {
      if (m.reasoning_content == null) return m;
      const { reasoning_content: _r, ...rest } = m;
      return rest;
    },
    body: ({ model, system, messages, tools }) => {
      const body = {
        model,
        stream: true,
        stream_options: { include_usage: true },
        // 分けて送るとキャッシュの先頭がずれることがあるので、1つにまとめる
        messages: [{ role: 'system', content: system.map((s) => s.text).join('\n\n') }, ...messages],
      };
      if (tools.length) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: {
              type: 'object',
              properties: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, { type: 'string', description: d }])),
              required: Object.keys(t.params),
            },
          },
        }));
      }
      return body;
    },
    async read(response, onText) {
      const usage = { input: 0, cached: 0, output: 0 };
      let stop = '';
      let text = '';
      let reasoning = '';
      const toolCalls = [];
      for await (const data of sseEvents(response)) {
        if (data === '[DONE]') break;
        const ev = parseJson(data);
        if (!ev) continue;
        if (ev.error) throw new LlmError(ev.error.message || 'APIのエラー');
        const choice = ev.choices?.[0];
        const d = choice?.delta || {};
        if (d.content) { text += d.content; onText(d.content); }
        if (d.reasoning_content) reasoning += d.reasoning_content;
        for (const tc of d.tool_calls || []) {
          const i = tc.index ?? toolCalls.length;
          const cur = toolCalls[i] || (toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.function.name += tc.function.name;
          if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
        }
        if (choice?.finish_reason) stop = choice.finish_reason;
        const u = ev.usage;
        if (u) {
          usage.input = u.prompt_tokens || 0;
          // OpenAI は prompt_tokens_details.cached_tokens、DeepSeek は prompt_cache_hit_tokens
          usage.cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
          usage.output = u.completion_tokens || 0;
        }
      }
      const message = { role: 'assistant', content: text || null };
      const calls = toolCalls.filter(Boolean);
      if (calls.length) message.tool_calls = calls;
      if (reasoning && calls.length) message.reasoning_content = reasoning; // 道具を使う途中だけ必要
      return {
        message,
        calls: calls.map((c) => ({ id: c.id, name: c.function.name, args: parseJson(c.function.arguments || '{}') || {} })),
        text,
        usage,
        stop,
      };
    },
    results: (calls, outputs) => calls.map((c, i) => ({ role: 'tool', tool_call_id: c.id, content: outputs[i] })),
  };
}

const ADAPTERS = { gemini, claude, openai: openAiLike('openai'), deepseek: openAiLike('deepseek') };

// 共通の形のメッセージを、そのAI専用の形に並べ直す。同じ役割が続くところはまとめる
function prepare(ad, items) {
  const out = [];
  for (const it of items) {
    let m = it.native ? (ad.clean ? ad.clean(it.native) : it.native) : ad.text(it.role, it.text);
    const last = out[out.length - 1];
    if (last && ad.role(last) === ad.role(m) && ad.role(m) !== 'tool') {
      const merged = ad.merge(last, m);
      if (merged) { out[out.length - 1] = merged; continue; }
    }
    out.push(m);
  }
  return out;
}

// ---------- ストリームの読み取り ----------

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

async function post(ad, args, messages, signal) {
  let response;
  try {
    response = await fetch(ad.url(args), {
      method: 'POST',
      headers: ad.headers(args),
      body: JSON.stringify(ad.body({ ...args, messages })),
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const extra = args.provider === 'deepseek' && !args.deepseekViaProxy
      ? ' DeepSeek はブラウザから直接つながらないことがあるので、設定の「DeepSeekはサイト経由で送る」を試してみてね。'
      : '';
    throw new LlmError('AIにつながらなかったよ。電波を確認してね。' + extra);
  }
  if (!response.ok) throw new LlmError(await errorMessage(response), response.status);
  return response;
}

/**
 * 会話を1回送る。AIが道具を使ったら onTool で答えを作って渡し、返事ができるまで続ける。
 * onText にはストリーミングで届いた文字が順に渡される（道具のやり取りは渡さない）。
 */
export async function chat({
  provider, model, key, system, messages, tools = [], onTool, onText = () => {}, signal,
  deepseekViaProxy = false, maxToolCalls = 3,
}) {
  if (!key) throw new LlmError('APIキーが入っていないよ。設定から入れてね。');
  if (!model) throw new LlmError('モデル名が入っていないよ。設定から入れてね。');
  const ad = ADAPTERS[provider];
  if (!ad) throw new LlmError('知らないAIの種類だよ: ' + provider);

  const args = { provider, model, key, system, tools, deepseekViaProxy };
  const history = prepare(ad, messages);
  const turn = []; // この返事のために増えたやり取り
  const usage = { input: 0, cached: 0, output: 0 };
  let text = '';
  let stop = '';
  let used = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await post(ad, args, [...history, ...turn], signal);
    let started = false;
    const r = await ad.read(response, (t) => {
      // 道具を使ったあとに続きを話すときは、改行でつなぐ
      if (!started && text && !text.endsWith('\n')) { text += '\n'; onText('\n'); }
      started = true;
      text += t;
      onText(t);
    });
    usage.input += r.usage.input;
    usage.cached += r.usage.cached;
    usage.output += r.usage.output;
    stop = r.stop;
    turn.push(r.message);
    if (!r.calls.length || !onTool) break;

    // 道具の答えを作って、AIに続きを考えてもらう
    const outputs = [];
    for (const c of r.calls) {
      used += 1;
      outputs.push(used > maxToolCalls
        ? `（この返事では、もう${maxToolCalls}つ見ました。いま分かっていることで話してください）`
        : String(await onTool(c.name, c.args)));
    }
    turn.push(...ad.results(r.calls, outputs));
    if (round === MAX_ROUNDS - 1) stop = 'tool_limit';
  }

  return { text, usage, stop, raw: { provider, model, messages: turn } };
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
