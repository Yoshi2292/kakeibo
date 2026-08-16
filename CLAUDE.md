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
  js/assets.js     — 資産管理（月次残高入力・利回り読み書き・推移グラフ）
  js/cashflow.js   — 収支管理（月次収支入力・家計簿自動取込）
  js/forecast.js   — 収支予測ルール管理（期間ルールのCRUD）
  js/simulate.js   — 将来資産シミュレーション（グラフ描画）
  js/csvimport.js  — クレジットカード明細CSV取込（解析・支払先正規化・重複判定・中カテゴリ対応表）
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
| section-csvimport | クレジットカード明細CSV取込 | camera(📄) |

## Sheets構成

| タブ名 | 用途 | 列構成 |
|---|---|---|
| `YYYY.M`（例: 2026.6） | 家計簿データ（月別） | B=日付, C=空白, D=大カテゴリ, E=中カテゴリ, F=支払先, G=金額, H=使用者 |
| `資産管理` | 資産残高（月次） | A=年月(YYYY-MM), B=カテゴリ, C=残高 |
| `キャッシュフロー` | 収支手動入力（月次） | A=年月(YYYY-MM), B=科目, C=金額 |
| `収支予測` | 収支予測期間ルール | A=開始年月(YYYY-MM), B=終了年月(YYYY-MM), C=項目名, D=収支区分(income\|expense), E=金額, F=振替先カテゴリ（空欄可）, G=適用月（0=毎月, 1-12=毎年X月） |
| `支払先カテゴリ` | CSV取込時の支払先→中カテゴリ対応表（学習用） | A=支払先（正規化後）, B=中カテゴリ, C=選択件数 |
| `利回り設定` | 資産カテゴリ別年間利回り | A=カテゴリ名, B=年利% |

備考:
- 旧形式の `ライフイベント` シートは廃止。一時イベント（start === end）は `収支予測` に統合。
- 家計簿シートは「新形式」（B列スタート + C列空白）と「旧形式」（B列スタート）を自動判定（stats.js / cashflow.js）。
- `収支予測` G列は後から追加。既存行はG列なし → `Number(row[6]) || 0` で毎月扱いに互換。

## 設定（config.js）

```js
const CONFIG = { CLAUDE_PROXY_URL, GOOGLE_CLIENT_ID, SPREADSHEET_ID, SHEET_NAME, CLAUDE_MODEL, BUILD_TIME };
const CATEGORIES  = { '支出': [...], '収入': [...] };
const BUDGET      = { カテゴリ名: 予算額 };          // 月次支出グラフの予算ライン
const USERS       = ['パパ', 'ママ', '悠真'];
const ASSET_GROUPS = [{ group, items }];              // UIグループ表示用
const ASSET_CATEGORY_DEFS = [{ name, type, expectedReturn }];
  // type: 'asset' | 'liability'
  // expectedReturn: 年利%のデフォルト値（0=利回りなし）
const ASSET_CATEGORIES    = ASSET_CATEGORY_DEFS.filter(c => c.type !== 'liability').map(c => c.name);
const LIABILITY_CATEGORIES = ASSET_CATEGORY_DEFS.filter(c => c.type === 'liability').map(c => c.name);
const CASHFLOW_INCOME  = [...];   // キャッシュフロー収入科目
const CASHFLOW_EXPENSE = [...];   // キャッシュフロー支出科目
```

`config.js` は `.gitignore` 対象。GitHub Actions が `config.example.js` を参照して生成する。

## section-assets の内部タブ

| タブ | 機能 |
|---|---|
| 残高入力 | 資産・負債残高の月次入力。各資産カテゴリに利回り%入力欄あり。データなし時は「前月引継ぎ」ボタンを表示 |
| 収支 | 収入・支出の月次入力。家計（家計簿シートから自動取込）+ 手動科目。各科目に「前月」ボタンあり |
| 推移グラフ | 全期間の資産積み上げ棒グラフ＋純資産ライン |

### 利回り入力の仕組み（assets.js / app.js）

- 残高入力フォームの各資産カテゴリ行に `rate-input-{カテゴリ名}` の入力欄を表示（負債カテゴリには表示しない）
- デフォルト値: `利回り設定` シート保存値 > `ASSET_CATEGORY_DEFS.expectedReturn` の順で優先
- 保存時: `saveReturnRates(rates)` で `利回り設定` シート A2:B を上書き
- `loadReturnRates()` / `saveReturnRates()` は `assets.js` からエクスポート、`app.js` と `simulate.js` が import

## section-forecast の仕組み

期間ルール方式（旧: 年×科目のグリッド入力から刷新）。

- **定期ルール（毎月）**: 開始年月〜終了年月（空欄=永続）+ 月額。例: 給与「2020-04 〜 2038-03, ¥450,000/月」
- **定期ルール（毎年）**: 頻度を「毎年」にすると適用月（1〜12）を選択。金額は年額入力。例: ボーナス「2024-04 〜 2038-03, ¥1,000,000/年（6月）」。シートG列に適用月を保存。
- **一時イベント**: 開始年月 === 終了年月。例: 大学入学金「2030-04 〜 2030-04, ¥1,000,000」
- **振替先**: expense/income ルールに振替先カテゴリを設定可能（シートF列）。
  - expense + 振替先あり: floatingCash を減らし、振替先カテゴリ残高に同額を加算（積立NISA等、純資産変動なし・以後複利成長）
  - income + 振替先あり: floatingCash を増やさず振替先カテゴリに直接入金（退職金等）
  - 振替先なしは従来通り（収入=floatingCash増、支出=floatingCash減）
  - 振替先が LIABILITY_CATEGORIES の場合は categoryBalances への加算をスキップ
- 追加・**編集**・削除が可能。編集時はフォームに値を復元して「✔ 更新」で保存。
- `fetchRules(token)` を `simulate.js` からも import して再利用。
- カードのバッジ: 収入（緑）/ 支出（赤）/ 一時（橙）/ 年次（紫）/ 振替（青）

## section-simulate の仕組み

- 直近月の資産残高を起点に、収支予測ルールを適用して **2070年12月まで**の月次残高を計算。
- カテゴリ別残高を個別に追跡し、それぞれの月次利回り（年利/12）で複利成長させる（負債・floatingCashは成長なし）。
- 利回りは `利回り設定` シートの保存値を優先、なければ `ASSET_CATEGORY_DEFS.expectedReturn` を使用。
- `floatingCash`（利回り0）: 収支予測の income/expense の差分を積む。振替先なしの収入・支出はここに反映。
- Chart.js 折れ線グラフ。実績部分は緑の実線、予測部分は緑の破線。
- 一時イベント（start===end）は赤い縦線マーカーとラベルで表示（ラベルが重なる場合はY方向にずらす）。
- ズーム・スクロール: ピンチ/スワイプ（モバイル）と ◀▶−＋ボタン（PC）。「全期間」ボタンでリセット。
- 利回り設定が1件以上ある場合、ラベルに「想定利回り反映済み」を表示。

### シミュレーション計算ロジック（月次ループ）

```js
// 1. 各資産カテゴリを複利成長
for (const [cat, rate] of Object.entries(monthlyRates)) {
  if (rate > 0 && !LIABILITY_CATEGORIES.includes(cat) && cat in categoryBalances)
    categoryBalances[cat] *= (1 + rate);
}
// 2. 収支ルールを適用（毎年ルールは month === r.applyMonth のみ）
const active = rules.filter(r => {
  if (!(ym >= r.start && (!r.end || ym <= r.end))) return false;
  if (r.applyMonth > 0) return month === r.applyMonth;
  return true;
});
for (const r of active) { /* income/expense + transfer 分岐 */ }
// 3. 純資産 = Σ(資産カテゴリ) - Σ(負債カテゴリ) + floatingCash
```

## section-csvimport の仕組み

クレジットカード（現状セゾンカード形式）の利用明細CSVを読み込み、家計簿へ一括登録する。大カテゴリは常に「支出」固定。

- **CSV解析** (`csvimport.js` の `parseCardCsv`): 「利用日,」で始まる行をヘッダーとして検出し、「ご利用店名及び商品名」「利用金額」列を取得。文字コードはUTF-8 BOM判定 → 失敗時UTF-8 fatalデコード → 失敗時 `shift_jis` の順で自動判定（`readCsvFile`）。
- **支払先の正規化** (`normalizePayee`): 「アマゾン」で始まる店名 → `Amazon`、「サンドラツグ／サンドラッグ」を含む店名（`QP/サンドラツグ` 等）→ `サンドラッグ` に統一。ハードコードされたルールで、必要に応じて関数内に追加する。
- **重複判定** (`fetchExistingSignatures`): CSVの日付から対象月シート（`YYYY.M`）を割り出して読み込み、`日付|支払先|金額` の組み合わせが既存行と一致する明細を「重複の可能性」としてデフォルト非選択にする（CSV内の重複行同士も同様に検出）。日付セルはSheetsのシリアル値/文字列どちらでも比較できるよう変換。
- **中カテゴリ対応表**（シート `支払先カテゴリ`）: 支払先ごとに過去選択した中カテゴリと選択回数を保持。取込時に候補を件数の多い順に表示し、複数候補がある場合は行に「候補: A(3) / B(1)」のヒントを表示（最多候補を初期選択、ユーザーが変更可能）。登録確定時に選択結果を件数+1または新規行として反映（`commitPayeeCategoryChoices`）。
- **登録フロー**: 各行にチェックボックス（重複はデフォルトOFF）・支払先（編集可）・中カテゴリ選択・使用者選択を表示。「選択したN件を登録」で `appendRow` を順次実行し、成功した行はリストから消える（失敗・非選択・重複はチェックが残るので再確認・再実行しやすい）。

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
- `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4` でGitHub Pages公式方式でデプロイ（`peaceiris` 方式は廃止）。
- `permissions: contents: read, pages: write, id-token: write` が必要。
- `environment: name: github-pages` が必要（`deploy-pages` の要件）。
- シークレット: `CLAUDE_PROXY_URL`, `GOOGLE_CLIENT_ID`, `SPREADSHEET_ID`

## Service Worker

- キャッシュ名: `kakeibo-v5`（キャッシュ戦略を変更したらバージョンを上げること）。
- アイコン・マニフェストのみキャッシュ優先、JS/CSS/HTML は `cache: 'no-store'` でHTTPキャッシュをバイパスしてネットワーク優先。
- activate 時に旧バージョンキャッシュ（名前が異なるもの）を全削除。

## 開発上の注意

- `valueInputOption=RAW` を使用（`USER_ENTERED` だと `YYYY-MM` がシリアル番号に変換されるバグあり）。
- ES Modules (`type="module"`) 使用。`CONFIG` / `CATEGORIES` / `BUDGET` / `USERS` / `ASSET_GROUPS` / `ASSET_CATEGORY_DEFS` / `ASSET_CATEGORIES` / `LIABILITY_CATEGORIES` / `CASHFLOW_INCOME` / `CASHFLOW_EXPENSE` はグローバル変数（`config.js` で定義）。
- `forecast.js` と `simulate.js` は boot 時に API を呼ばない。ユーザーが画面を開いたときに初めてフェッチする。
- 収支予測の毎年ルール: G列が0または空 → 毎月適用（後方互換）。1〜12 → 毎年その月のみ適用。
