// DeepSeek への中継（Cloudflare Pages Functions）。
// ブラウザから DeepSeek に直接つながらないとき用。設定でオンにした人だけが使う。
// APIキーは Authorization ヘッダーのまま DeepSeek へ渡すだけで、保存もログ出力もしない。

const UPSTREAM = 'https://api.deepseek.com';
const ALLOWED = {
  'chat/completions': 'POST',
  models: 'GET',
};

export async function onRequest({ request, params }) {
  const path = [].concat(params.path || []).join('/');
  const method = ALLOWED[path];
  if (!method || request.method !== method) {
    return new Response('Not found', { status: 404 });
  }

  // ほかのサイトから中継として使われないように、同じサイトからの呼び出しだけ通す
  const self = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (method === 'POST' && origin !== self) {
    return new Response('Forbidden', { status: 403 });
  }

  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) {
    return new Response('Missing API key', { status: 401 });
  }

  const upstream = await fetch(`${UPSTREAM}/${path}`, {
    method,
    headers: {
      authorization: auth,
      'content-type': 'application/json',
    },
    body: method === 'POST' ? request.body : undefined,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}
