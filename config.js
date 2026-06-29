const CONFIG = {
  CLAUDE_PROXY_URL: 'https://kakeibo-claude-proxy.isgk-kakeibo.workers.dev',
  GOOGLE_CLIENT_ID: '1095126929059-6b2boe8p3r1nrdu2clth74t7fmttgpt7.apps.googleusercontent.com',
  SPREADSHEET_ID:   '1484LHhhq76lmh3CmWZPNyDMVKrKkNGe44E3XN5zSSlw',
  SHEET_NAME:       '2025',
  CLAUDE_MODEL:     'claude-sonnet-4-6',
  BUILD_TIME:       '06/30 08:17',
};
const CATEGORIES = {
  '支出': ['食費','日用雑貨','外食費','医療費','被服費','電気代','水道代','交際費','スマホ通信費','スマホローン','都民共済','金・銀・プラチナ積立','プロバイダ料金','車関係費','フィットネス費','ペット費','教育費','娯楽費','税金','悠真おこづかい','その他'],
  '収入': ['給与','子供手当'],
};
const USERS = ['パパ','ママ','悠真'];
const ASSET_GROUPS = [
  {group:'銀行預金',items:['ゆうちょ（父）','ゆうちょ（悠真）','楽天銀行','千葉銀行','財形貯蓄']},
  {group:'保険',items:['東京海上日動終身保険','個人年金']},
  {group:'株式資産',items:['三菱UFJ証券','楽天証券']},
  {group:'貴金属資産',items:['田中貴金属工業']},
  {group:'年金残高',items:['確定拠出年金','退職金残高']},
];
const ASSET_CATEGORIES = ASSET_GROUPS.flatMap(g => g.items);
const LIABILITY_CATEGORIES = ['自動車ローン残高'];
const CASHFLOW_INCOME  = ['会社給与','会社賞与','その他収入'];
const CASHFLOW_EXPENSE = ['自動車ローン支払い','株式投資','アローワンス（父）','その他支出'];
