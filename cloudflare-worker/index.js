// Cloudflare Worker — Claude API プロキシ（Google トークン認証つき）
//
// デプロイ:      wrangler deploy
// シークレット:  wrangler secret put CLAUDE_API_KEY     # Anthropic API キー
//               wrangler secret put GOOGLE_CLIENT_ID   # config.js と同じ OAuth クライアント ID
//               wrangler secret put ALLOWED_EMAILS     # 許可する Google アカウント（カンマ区切り）
//
// 多層防御:
//  1. Authorization: Bearer <Google アクセストークン> を tokeninfo で検証
//     - aud が GOOGLE_CLIENT_ID と一致
//     - email が検証済みかつ ALLOWED_EMAILS に含まれる
//  2. Content-Length / ボディサイズ上限
//  3. messages の形の検証（想定形以外は 400）
//  4. model は許可リスト、max_tokens はサーバー算出（クライアント指定は信用しない）
//  5. CORS（ALLOWED_ORIGIN）はブラウザ向けにそのまま維持
//
// 注意: ここで渡ってくるアクセストークンは spreadsheets スコープを持つ生トークン。
//       発信者の身元確認にのみ使用し、リクエストヘッダ／トークンを絶対にログ出力しないこと。

// GitHub Pages の URL に合わせて変更してください（本番では必ず絞ること）
const ALLOWED_ORIGIN = 'https://yoshi2292.github.io';

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

// ── 上限値 ───────────────────────────────
// camera.js は最大 800px / JPEG q0.75 にリサイズ → 1枚 base64 で概ね 80–200KB。
// 複数枚 OCR の現実的上限を 10 枚としても ≈2MB。6MB はその約3倍の余裕。
const MAX_BODY_BYTES  = 6 * 1024 * 1024;
const MAX_IMAGES      = 10;
const MAX_IMAGE_DATA  = 3_500_000;   // base64 1枚あたり（デコード後 ≈2.6MB 相当）
const MAX_TEXT_LEN    = 8_000;

const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo?access_token=';

// レシート OCR で実際に使うモデルだけを許可（任意の高額モデルを叩かせない）
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
]);

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status, message) => json(status, { error: { message } });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return fail(405, 'Method Not Allowed');

    // 必須シークレットが無ければ fail-closed
    if (!env.CLAUDE_API_KEY || !env.GOOGLE_CLIENT_ID || !env.ALLOWED_EMAILS) {
      return fail(503, 'proxy not configured');
    }

    // ── 1. Google アクセストークン検証（ボディ読み込みより前） ──
    const authz = request.headers.get('Authorization') || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
    if (!token) return fail(401, 'missing bearer token');

    let claims;
    try {
      const r = await fetch(TOKENINFO + encodeURIComponent(token));
      if (!r.ok) return fail(403, 'token verification failed');
      claims = await r.json();
    } catch {
      return fail(403, 'token verification error');
    }
    if (claims.aud !== env.GOOGLE_CLIENT_ID) return fail(403, 'aud mismatch');
    if (claims.email_verified !== true && claims.email_verified !== 'true') {
      return fail(403, 'email not verified');
    }
    const allowed = String(env.ALLOWED_EMAILS)
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(String(claims.email || '').toLowerCase())) {
      return fail(403, 'email not allowed');
    }

    // ── 2. ボディサイズ上限（Content-Length で先に弾く。ヘッダ欠落も拒否 = fail-closed） ──
    const len = Number(request.headers.get('Content-Length'));
    if (!Number.isFinite(len) || len <= 0 || len > MAX_BODY_BYTES) {
      return fail(413, 'payload too large');
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, 'payload too large'); // 予備

    // ── 3. messages の形の検証 ──
    let body;
    try { body = JSON.parse(raw); } catch { return fail(400, 'invalid JSON'); }
    if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || body.messages.length !== 1) {
      return fail(400, 'unexpected messages shape');
    }
    const msg = body.messages[0];
    if (!msg || msg.role !== 'user' || !Array.isArray(msg.content) || msg.content.length === 0) {
      return fail(400, 'unexpected message content');
    }

    let imageCount = 0;
    for (const part of msg.content) {
      if (!part || typeof part !== 'object') return fail(400, 'bad content part');
      if (part.type === 'image') {
        const s = part.source;
        if (!s || s.type !== 'base64'
            || !/^image\/(jpeg|png|webp)$/.test(s.media_type || '')
            || typeof s.data !== 'string' || s.data.length === 0 || s.data.length > MAX_IMAGE_DATA) {
          return fail(400, 'bad image part');
        }
        imageCount++;
      } else if (part.type === 'text') {
        if (typeof part.text !== 'string' || part.text.length > MAX_TEXT_LEN) {
          return fail(400, 'bad text part');
        }
      } else {
        return fail(400, 'unknown content part type');
      }
    }
    if (imageCount < 1 || imageCount > MAX_IMAGES) return fail(400, 'image count out of range');

    // ── 4. model は許可リスト、max_tokens はサーバー算出 ──
    const model = ALLOWED_MODELS.has(body.model)
      ? body.model
      : (ALLOWED_MODELS.has(env.CLAUDE_MODEL) ? env.CLAUDE_MODEL : 'claude-sonnet-4-6');

    const upstreamBody = {
      model,
      max_tokens: Math.min(4096, 512 * imageCount),
      messages: body.messages,
    };

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(upstreamBody),
    });

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};
