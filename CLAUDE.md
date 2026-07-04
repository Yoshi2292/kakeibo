# 家計簿アプリ — CLAUDE.md

## プロジェクト概要

家族（自分・妻・子）で共有するスマホ向け家計簿PWA。

- **フロントエンド**: GitHub Pages (静的HTML/CSS/JS、ES Modules)
- **OCRプロキシ**: Cloudflare Worker (`cloudflare-worker/`)
- **データストア**: Google Sheets（月別タブ + 複数管理シート）
- **認証**: Google OAuth2 (GSI)

## アーキテクチャ

```
index.html
  js/app.js        — メインコントローラ（セクション制御・全イベント）
  js/auth.js       — Google OAuth2 / トークン管理
  js/camera.js     — カメラ・画像入力・リサイズ
  js/ocr.js        — Claude API呼び出し (Cloudflare Worker経由)
  js/sheets.js     — Google Sheets書き込み（家計簿行の追加）
  js/stats.js      — 集計・グラフ（月次円グラフ・年次棒グラフ）
  js/assets.js     — 資産管理（月次残高入力・推移グラフ）
  js/cashflow.js   — 収支管理（月次収支入力・家計簿自動取込）
  js/forecast.js   — 収支予測ルール管理（期間ルールのCRUD）
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
| section-forecast | 収支予測ルール（期間・一時イベント） | assets(📅) |
| section-simulate | 将来資産シミュレーション | assets(🧮) |

## Sheets構成

| タブ名 | 用途 | 列構成 |
|---|---|---|
| `YYYY.M`（例: 2026.6） | 家計簿データ（月別） | B=日付, C=空白, D=大カテゴリ, E=中カテゴリ, F=支払先, G=金額, H=使用者 |
| `資産管理` | 資産残高（月次） | A=年月(YYYY-MM), B=カテゴリ, C=残高 |
| `キャッシュフロー` | 収支手動入力（月次） | A=年月(YYYY-MM), B=科目, C=金額 |
| `収支予測` | 収支予測期間ルール | A=開始年月(YYYY-MM), B=終了年月(YYYY-MM), C=項目名, D=収支区分(income\|expense), E=月額 |

備考:
- 旧形式の `ライフイベント` シートは廃止。一時イベント（start === end）は `収支予測` に統合。
- 家計簿シートは「新形式」（B列スタート + C列空白）と「旧形式」（B列スタート）を自動判定（stats.js / cashflow.js）。

## 設定（config.js）

```js
const CONFIG = { CLAUDE_PROXY_URL, GOOGLE_CLIENT_ID, SPREADSHEET_ID, SHEET_NAME, CLAUDE_MODEL, BUILD_TIME };
const CATEGORIES  = { '支出': [...], '収入': [...] };
const BUDGET      = { カテゴリ名: 予算額 };          // 月次支出グラフの予算ライン
const USERS       = ['パパ', 'ママ', '悠真'];
const ASSET_GROUPS = [{ group, items }];              // UIグループ表示用
const ASSET_CATEGORY_DEFS = [{ name, type }];         // type: 'asset' | 'liability'
const ASSET_CATEGORIES    = ASSET_CATEGORY_DEFS.filter(c => c.type !== 'liability').map(c => c.name);
const LIABILITY_CATEGORIES = ASSET_CATEGORY_DEFS.filter(c => c.type === 'liability').map(c => c.name);
const CASHFLOW_INCOME  = [...];   // キャッシュフロー収入科目
const CASHFLOW_EXPENSE = [...];   // キャッシュフロー支出科目
```

`config.js` は `.gitignore` 対象。GitHub Actions が `config.example.js` を参照して生成する。

## section-assets の内部タブ

| タブ | 機能 |
|---|---|
| 残高入力 | 資産・負債残高の月次入力。データなし時は「前月引継ぎ」ボタンを表示 |
| 収支 | 収入・支出の月次入力。家計（家計簿シートから自動取込）+ 手動科目。各科目に「前月」ボタンあり |
| 推移グラフ | 全期間の資産積み上げ棒グラフ＋純資産ライン |

## section-forecast の仕組み

期間ルール方式（旧: 年×科目のグリッド入力から刷新）。

- **定期ルール**: 開始年月〜終了年月（空欄=永続）+ 月額。例: 給与は「2020-04 〜 2038-03, ¥450,000」
- **一時イベント**: 開始年月 === 終了年月。例: 大学入学金「2030-04 〜 2030-04, ¥1,000,000」
- 追加・**編集**・削除が可能。編集時はフォームに値を復元して「✔ 更新」で保存。
- `fetchRules(token)` を `simulate.js` からも import して再利用。

## section-simulate の仕組み

- 直近月の資産残高を起点に、全期間の `収支予測` ルールを適用して20年分の月次残高を計算。
- Chart.js 折れ線グラフ。実績部分は緑の実線、予測部分は緑の破線。
- 一時イベント（start===end）は赤い縦線マーカーとラベルで表示（ラベルが重なる場合はY方向にずらす）。
- ズーム・スクロール: ピンチ/スワイプ（モバイル）と ◀▶−＋ボタン（PC）。「全期間」ボタンでリセット。

## 未保存警告

`assetsDirty` フラグ（`app.js`）で資産管理セクション内の変更を追跡。
- 入力・「前月」ボタン・「前月引継ぎ」操作 → `markDirty()`
- 保存成功・フォーム再読み込み → `clearDirty()`
- 戻るボタン・タブ切替・月切替時に `confirmLeave()` で confirm ダイアログを表示

## CDN依存

```html
<script src="https://accounts.google.com/gsi/client"></script>          <!-- Google Identity Services -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/..."></script>  <!-- Chart.js -->
<script src="https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/..."></script>  <!-- タッチ操作 (zoom plugin 依存) -->
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/..."></script>  <!-- ズーム・パン -->
```

## デプロイ

`.github/workflows/deploy.yml`:
- `actions/upload-pages-artifact` + `actions/deploy-pages` でGitHub Pages公式方式でデプロイ（`peaceiris` 方式は廃止）。
- `permissions: pages: write, id-token: write` が必要。
- シークレット: `CLAUDE_PROXY_URL`, `GOOGLE_CLIENT_ID`, `SPREADSHEET_ID`

## 開発上の注意

- `valueInputOption=RAW` を使用（`USER_ENTERED` だと `YYYY-MM` がシリアル番号に変換されるバグあり）。
- ES Modules (`type="module"`) 使用。`CONFIG` / `CATEGORIES` / `BUDGET` / `USERS` / `ASSET_GROUPS` / `ASSET_CATEGORY_DEFS` / `ASSET_CATEGORIES` / `LIABILITY_CATEGORIES` / `CASHFLOW_INCOME` / `CASHFLOW_EXPENSE` はグローバル変数（`config.js` で定義）。
- Service Worker キャッシュ名: `kakeibo-v4`（キャッシュ戦略を変更したらバージョンを上げること）。
- `forecast.js` と `simulate.js` は boot 時に API を呼ばない。ユーザーが画面を開いたときに初めてフェッチする。
