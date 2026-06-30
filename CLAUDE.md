# 家計簿アプリ — CLAUDE.md

## プロジェクト概要

家族（自分・妻）で共有するスマホ向け家計簿PWA。

- **フロントエンド**: GitHub Pages (静的HTML/CSS/JS)
- **OCRプロキシ**: Cloudflare Worker (`cloudflare-worker/`)
- **データストア**: Google Sheets（月別タブ + 複数管理シート）
- **認証**: Google OAuth2 (GSI)

## アーキテクチャ

```
index.html
  js/app.js        — メインコントローラ（セクション制御・イベント）
  js/auth.js       — Google OAuth2 / トークン管理
  js/camera.js     — カメラ・画像入力
  js/ocr.js        — Claude API呼び出し (Cloudflare Worker経由)
  js/sheets.js     — Google Sheets書き込み（家計簿行の追加）
  js/stats.js      — 集計・グラフ（月次円グラフ・年次棒グラフ）
  js/assets.js     — 資産管理（月次残高入力・推移グラフ）
  js/cashflow.js   — 収支管理（月次収支入力・家計簿自動取込）
  js/forecast.js   — 収支予測（年次入力・ライフイベント管理）
  js/simulate.js   — 将来資産シミュレーション（グラフ描画）
  css/style.css    — スタイル
  config.js        — 設定（SPREADSHEET_ID等、gitignore対象）
```

## セクション構成

| セクションID | 役割 | 遷移元 |
|---|---|---|
| section-auth | ログイン画面 | 起動時 |
| section-camera | メイン（カメラ・手動入力） | ログイン後 |
| section-form | OCR結果確認・編集・保存 | camera |
| section-success | 保存完了 | form |
| section-stats | 家計集計（月次/年次グラフ） | camera(📈) |
| section-assets | 資産管理（残高入力/収支/推移グラフ） | camera(💰) |
| section-forecast | 収支予測・ライフイベント入力 | assets(📅) |
| section-simulate | 将来資産シミュレーション | assets(🧮) |

## Sheets構成

| タブ名 | 用途 | 列構成 |
|---|---|---|
| `YYYY.M`（例: 2026.6） | 家計簿データ（月別） | B=日付, C=空白, D=大カテゴリ, E=中カテゴリ, F=支払先, G=金額, H=使用者 |
| `資産管理` | 資産残高（月次） | A=年月(YYYY-MM), B=カテゴリ, C=残高 |
| `キャッシュフロー` | 収支手動入力（月次） | A=年月(YYYY-MM), B=科目, C=金額 |
| `収支予測` | 年次収支予測 | A=年, B=科目, C=金額 |
| `ライフイベント` | ライフイベント一覧 | A=年, B=イベント名, C=金額 |

## 設定（config.js）

```js
const CONFIG = { CLAUDE_PROXY_URL, GOOGLE_CLIENT_ID, SPREADSHEET_ID, SHEET_NAME, CLAUDE_MODEL, BUILD_TIME };
const CATEGORIES  = { '支出': [...], '収入': [...] };
const BUDGET      = { カテゴリ名: 予算額 };  // 月次支出グラフの予算ライン
const USERS       = ['パパ', 'ママ', '悠真'];
const ASSET_GROUPS = [{ group, items }];          // UIグループ表示用
const ASSET_CATEGORY_DEFS = [{ name, type }];     // type: 'asset' | 'liability'
const ASSET_CATEGORIES    = ASSET_CATEGORY_DEFS.filter(c => c.type !== 'liability').map(c => c.name);
const LIABILITY_CATEGORIES = ASSET_CATEGORY_DEFS.filter(c => c.type === 'liability').map(c => c.name);
const CASHFLOW_INCOME  = [...];
const CASHFLOW_EXPENSE = [...];
```

## section-assets の内部タブ

| タブ | 機能 |
|---|---|
| 残高入力 | 資産・負債残高の月次入力。データなし時は「前月引継ぎ」ボタンを表示 |
| 収支 | 収入・支出の月次入力。家計（家計簿シートから自動取込）+ 手動科目。各科目に前月ボタンあり |
| 推移グラフ | 全期間の資産積み上げ棒グラフ＋純資産ライン |

## 未保存警告

`assetsDirty` フラグで資産管理セクション内の変更を追跡。
- 入力・前月ボタン・引継ぎ操作 → `markDirty()`
- 保存成功・フォーム再読み込み → `clearDirty()`
- 戻るボタン・タブ切替・月切替時に `confirmLeave()` で confirm ダイアログ

## 開発上の注意

- `config.js` は `.gitignore` 対象。GitHub Actions が `config.example.js` から自動生成。
- シートは「新形式」（B列スタート + C列空白）と「旧形式」（B列スタート）を自動判定（stats.js / cashflow.js）。
- `valueInputOption=RAW` を使用（USER_ENTERED だと年月文字列がシリアル番号に変換されるバグあり）。
- Chart.js 4.4.0 をCDNから読み込み。
- ES Modules (`type="module"`)使用。`CONFIG` / `CATEGORIES` / `BUDGET` / `USERS` / `ASSET_GROUPS` / `ASSET_CATEGORY_DEFS` / `ASSET_CATEGORIES` / `LIABILITY_CATEGORIES` / `CASHFLOW_INCOME` / `CASHFLOW_EXPENSE` はグローバル変数。
- Service Worker キャッシュ名: `kakeibo-v4`（更新時はバージョンを上げること）。
