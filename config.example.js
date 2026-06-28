// config.example.js — テンプレート。実値は config.js に記述（gitignore 対象）
// GitHub Pages へのデプロイ時は GitHub Actions がシークレットから自動生成します。
// ローカル確認用は: cp config.example.js config.js して実値を記入してください。

const CONFIG = {
  // Cloudflare Worker の URL（Claude API プロキシ）
  // 例: https://kakeibo-claude-proxy.your-name.workers.dev
  CLAUDE_PROXY_URL: 'YOUR_CLOUDFLARE_WORKER_URL',

  // Google OAuth2 クライアントID（Google Cloud Console > 認証情報 で取得）
  // 例: 123456789-abcdefg.apps.googleusercontent.com
  GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',

  // Google スプレッドシート ID
  // URL https://docs.google.com/spreadsheets/d/★ここ★/edit の ★部分
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',

  // スプレッドシートのシート名（タブ名）
  SHEET_NAME: '2025',

  // 使用する Claude モデル
  CLAUDE_MODEL: 'claude-sonnet-4-6',
};

// ─────────────────────────────────────────────────
// カテゴリ設定
// キー = 大カテゴリ、値 = 中カテゴリの配列
// 追加・変更はここだけ編集すれば OK
// ─────────────────────────────────────────────────
const CATEGORIES = {
  '支出': [
    '医療費',
    '食費',
    '外食費',
    '車関係費',
    '日用雑貨',
    '被服費',
  ],
  '収入': [
    '給与',
    'その他収入',
  ],
};

const ASSET_CATEGORIES = [
  '現金',
  '銀行預金',
  '株式・ETF',
  '投資信託',
  '保険・年金',
  'その他',
];
