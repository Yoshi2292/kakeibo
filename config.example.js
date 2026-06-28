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

const ASSET_GROUPS = [
  { group: '銀行預金', items: ['ゆうちょ（父）', 'ゆうちょ（悠真）', '楽天銀行', '千葉銀行', '財形貯蓄'] },
  { group: '保険',     items: ['学資保険', '個人年金'] },
  { group: '株式資産', items: ['三菱UFJ証券', '楽天証券'] },
  { group: '貴金属資産', items: ['田中貴金属工業'] },
  { group: '年金残高', items: ['確定拠出年金'] },
];
const ASSET_CATEGORIES = ASSET_GROUPS.flatMap(g => g.items);

const LIABILITY_CATEGORIES = ['自動車ローン残高'];

const CASHFLOW_INCOME  = ['会社給与', 'その他収入'];
const CASHFLOW_EXPENSE = ['自動車ローン支払い', '株式投資', 'その他支出'];
