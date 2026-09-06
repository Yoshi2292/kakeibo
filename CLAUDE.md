# 家計簿アプリ — CLAUDE.md

## プロジェクト概要

家族（パパ・ママ・悠真）で共有するスマホ向け家計簿 PWA。
レシート撮影 → Claude OCR → Google Sheets 記帳、資産管理・将来シミュレーションまで行う。

- **フロントエンド**: GitHub Pages（静的 HTML/CSS/JS、ES Modules、PWA）
  公開 URL: https://yoshi2292.github.io/kakeibo/ ／ リポジトリ: `Yoshi2292/kakeibo`
- **OCR プロキシ**: Cloudflare Worker（`cloudflare-worker/`、Claude API キーを隠すだけの薄い中継）
- **データストア**: Google Sheets（月別タブ＋管理シート群、ブラウザから直接 read/write）
- **認証**: Google OAuth2（GIS、scope=`spreadsheets`）。トークンはメモリ保持のみ（リロードで再ログイン）

## データフロー

```
                         ┌──────────────────────────────┐
   git push main ─▶ Actions│  GitHub Pages（静的 PWA）      │
   （config.js を生成）    │  index.html + js/*.js         │
                         └───────┬───────────────┬──────┘
                                 │ ①OCRのみ       │ ②読み書き全部
                                 ▼               ▼
                    ┌───────────────────┐  ┌────────────────────────┐
                    │ Cloudflare Worker  │  │ Google Sheets API v4    │
                    │ x-api-key を付与    │  │ (ブラウザから直接叩く)     │
                    └────────┬──────────┘  └────────────────────────┘
                             ▼
                    api.anthropic.com/v1/messages
```

- **① レシート OCR のときだけ** Worker を経由する。ブラウザが画像 base64 を `CONFIG.CLAUDE_PROXY_URL` に POST → Worker が `env.CLAUDE_API_KEY` を `x-api-key` に付けて `api.anthropic.com/v1/messages` へ中継し、レスポンスをそのまま返す。
  - **アクセス制御（多層）**: リクエストは `Authorization: Bearer <Google アクセストークン>` 必須（`ocr.js` が `auth.js` の `getToken()` で付与）。Worker は Google の `tokeninfo` で検証し、`aud === GOOGLE_CLIENT_ID` かつ `email` が検証済みで `ALLOWED_EMAILS`（カンマ区切り）に含まれなければ 403。外れたトークン無し=401。
  - Worker はボディも検証する: `Content-Length` とサイズ上限（6MB）、`messages` の形（`user` 1件・`content` は image/text のみ・画像は base64 の jpeg/png/webp・枚数 1–10）、外れると 400/413。
  - `model` は許可リスト（`claude-haiku-4-5-20251001` / `claude-sonnet-4-6`）で検証、`max_tokens` は Worker が画像枚数から算出。クライアント指定は信用しない。
  - CORS は `cloudflare-worker/index.js` の `ALLOWED_ORIGIN`（現在 `https://yoshi2292.github.io`）に固定。ブラウザしか従わないため上記トークン検証が実質的な防御線。
- **② それ以外のデータ操作はすべてブラウザ → Google Sheets REST API v4 直**。自前バックエンドは無い。ログインアカウントに対象スプレッドシートの編集権限が必要。
- シートのタブは各モジュールの `ensureSheet()` が必要時に自動生成する。

## コマンド

このリポジトリには **`package.json` が無い**（ルート・`cloudflare-worker/` とも）。ビルド／依存管理ツールは使っていない。

| 目的 | コマンド | 補足 |
|---|---|---|
| ローカル起動 | **専用スクリプト無し**。`cp config.example.js config.js` で実値を記入し、リポジトリ直下を静的 HTTP で配信する（例: `python3 -m http.server`）。`file://` は ES Modules / Service Worker / fetch が動かないので不可 | この配信コマンド自体はリポジトリで定義されていない一般的な手段 |
| Worker のローカル実行 | `npx wrangler dev`（`cloudflare-worker/` で実行） | `wrangler` は未インストール。`npx` かグローバル導入が必要。`wrangler dev` はリポジトリには明記されていない標準的な使い方 |
| Worker のデプロイ | `npx wrangler deploy`（`cloudflare-worker/` で実行） | `cloudflare-worker/index.js` 冒頭コメントに記載。**CI 化されていない・手動** |
| Worker のシークレット登録 | `npx wrangler secret put CLAUDE_API_KEY` | `cloudflare-worker/index.js` / `wrangler.toml` に記載 |
| フロントのデプロイ | `git push origin main`（または GitHub Actions 画面から `workflow_dispatch`） | `.github/workflows/deploy.yml`。ローカルからのデプロイコマンドは無い |
| Lint | **無し**（ESLint 等の設定ファイルなし） | — |
| 自動テスト | **無し**（テストランナー・テストファイルなし） | 変更後の最低限の構文確認は `node --check js/<file>.js`（パースのみ。`CONFIG` 等の未定義参照は検出しない） |

## デプロイ

| 対象 | 方法 |
|---|---|
| フロント | `main` push → `.github/workflows/deploy.yml`。`rsync` でコピー（`config.js` / `config.example.js` / `cloudflare-worker` / `.github` / `.gitignore` を除外）→ シークレット `CLAUDE_PROXY_URL` / `GOOGLE_CLIENT_ID` / `SPREADSHEET_ID` から `config.js` を生成 → `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4` |
| Worker | **手動** `npx wrangler deploy`（`cloudflare-worker/`）。シークレット3種: `npx wrangler secret put CLAUDE_API_KEY` / `GOOGLE_CLIENT_ID` / `ALLOWED_EMAILS` |

- **Worker のシークレット**（すべて `wrangler secret put`。リポジトリに直書きしない）:
  - `CLAUDE_API_KEY` … Anthropic API キー
  - `GOOGLE_CLIENT_ID` … `config.js` の `CONFIG.GOOGLE_CLIENT_ID` と同値。OCR リクエストの `aud` 照合に使用
  - `ALLOWED_EMAILS` … OCR を許可する Google アカウントのメールをカンマ区切り（例 `a@example.com,b@example.com`）。**家族の増減時はここを更新して再デプロイ**
  - `CLAUDE_MODEL` は秘密でないので `wrangler.toml` の `[vars]`。OCR 許可モデルを増やすときは `index.js` の `ALLOWED_MODELS` も合わせる
- `deploy.yml` に必要な設定: `permissions: contents:read / pages:write / id-token:write`、`environment: name: github-pages`。
- `config.js` は `.gitignore` 対象。生成される `config.js` の `CATEGORIES` 等は **`deploy.yml` 内にもハードコードされている**（ローカルの `config.js` とは別物）。

## 作業ルール

- **`config.js` は絶対にコミットしない**（`.gitignore` 対象。実 API キー・スプレッドシート ID が入る）。作業後は `git status` で未ステージを確認する。
- **実際の明細データ・口座残高をコンテキストに貼らない**。共有・添付するサンプルは列構造だけ残して値をマスクしたものを使う（例: 金額を `xxxx`、支払先を `＊＊＊` に置換）。
- **Google Sheets への書き込みを伴う変更**（`appendRow` / `saveMonthAssets` / `saveCashflow` / `addRule` 系 / `saveReturnRates` / `commitPayeeCategoryChoices` を通る経路）は、**実行前に必ず確認を取る**。検証は本番と別のスプレッドシートのコピーに対して行う。
- **`CATEGORIES` 等を変更するときは 3 箇所すべてを更新する**:
  1. `config.js`（ローカル確認用）
  2. `.github/workflows/deploy.yml` の `config.js` 生成ブロック（本番）
  3. `js/ocr.js` の `CATEGORIES_HINT`（OCR プロンプトのカテゴリ候補）
  1 箇所でも漏れると **本番だけ壊れる**（ローカルでは気づけない）。同じく `USERS` / `BUDGET` / `ASSET_*` / `CASHFLOW_*` を変えるときは `config.js` と `deploy.yml` の両方。
- **Worker でリクエストヘッダ／トークンをログ出力しない**。OCR の `Authorization` ヘッダは `spreadsheets` スコープを持つ生の Google アクセストークン（身元確認のために流用している。「既知の課題」参照）。`console.log(request.headers)` やヘッダ丸ごとのオブザーバビリティ連携を入れると権限が漏れる。ログするなら `email` だけに絞る。
- **`main` で直接作業しない**。作業ブランチを切り、PR 経由でマージする。

## 検証

自動テストは無いので、変更箇所に応じて以下を手動で確認する。

### 共通
1. 変更した JS を `node --check js/<file>.js` で構文確認。
2. ローカルを HTTP 配信し、ブラウザの DevTools コンソールを開いた状態で起動 → boot 時にエラーが出ないこと（`[kakeibo] ...` のログは正常）。
3. `config.js` の `SPREADSHEET_ID` を**使い捨てのコピーシート**に向け、そのシートを編集できる Google アカウントでログイン。
4. `git status` で `config.js` がステージされていないこと。

### 変更した機能ごと
- **レシート OCR / 手動入力**: 撮影 or ライブラリ選択 → OCR → 確認フォーム → 保存 → 対象月タブ `YYYY.M` に 1 行増え、`日付 / 大 / 中 / 支払先 / 金額 / 使用者` が正しい列に入ること。自動保存モードでも同じ結果になること。
- **CSV 取込**: マスク済みサンプル CSV で一覧表示 → 重複バッジ・中カテゴリ候補が出る → 「選択した N 件を登録」で行が消え、シートに追加され、`支払先カテゴリ` の件数が更新されること。失敗行はチェックが残ること。
- **集計（stats）**: 月次／年次タブでグラフが描画され合計金額が妥当。**新形式・旧形式どちらのタブでも列ズレが無い**こと。
- **資産管理・残高入力**: 「前月引継ぎ」→ 保存 → リロードで復元。`資産管理` シートの A 列が `YYYY-MM` の**文字列**で入っている（日付シリアル値になっていない）こと。
- **資産管理・収支**: 「家計（家計簿より）」に当月支出合計が自動表示、「前月」ボタン、保存 → 復元。
- **収支予測（forecast）**: ルールの追加／編集／削除後、一覧とシート `収支予測` A:G が一致。適用月（G 列 0/1–12）・振替先（F 列）が保存されること。
- **シミュレーション（simulate）**: 実線（実績）＋破線（予測）で描画、一時イベントの赤い縦線、ズーム／パン操作、`利回り設定` があるとラベルに「想定利回り反映済み」。
- **Service Worker を変更した場合**: `sw.js` の `CACHE` 名を上げ、DevTools > Application > Service Workers で旧 SW 破棄・新 SW 有効化を確認。JS/CSS が `no-store` で最新取得されること。

### デプロイ後
- GitHub Actions が成功。公開 URL でバージョン表記（`BUILD_TIME`）が更新されていること。
- Worker を変更した場合は `wrangler deploy` 後に実機で OCR が通ること。

## ファイル構成

### ルート

| パス | 役割 |
|---|---|
| `index.html` | 全画面のマークアップ。9 セクションを `.active` クラスで切替。末尾で CDN と `config.js` を読み込む |
| `config.js` | 実値の設定＋分類マスター（`CONFIG` / `CATEGORIES` / `USERS` / `BUDGET` / `ASSET_GROUPS` / `ASSET_CATEGORY_DEFS` / `ASSET_CATEGORIES` / `LIABILITY_CATEGORIES` / `CASHFLOW_INCOME` / `CASHFLOW_EXPENSE` をグローバル変数として定義）。`.gitignore` 対象、本番は Actions が生成 |
| `config.example.js` | 上記のテンプレート（唯一 git 追跡される設定ファイル） |
| `sw.js` | Service Worker（キャッシュ名 `kakeibo-v5`） |
| `manifest.json` / `icons/` / `css/` | PWA 資材 |
| `APIKeys.txt` | ローカルのみのメモ（git 未追跡）。`.gitignore` には未記載なので誤コミット注意 |
| `Readme.md` | 利用者向けガイド＋更新履歴 |
| `.github/workflows/deploy.yml` | GitHub Pages デプロイ＋`config.js` 生成 |
| `cloudflare-worker/index.js`, `wrangler.toml` | Claude API プロキシ |

### js/（ES Modules、`app.js` がエントリ）

| ファイル | 役割 | 触るシート |
|---|---|---|
| `app.js` | メインコントローラ。全 import・状態管理・イベントバインド・セクション制御・資産/収支/CSV/集計の描画ロジック | — |
| `auth.js` | Google OAuth2（GIS token client、scope=`spreadsheets`）。トークンはメモリ保持のみ | — |
| `camera.js` | `camera-input` / `gallery-input` からの画像取得、canvas でリサイズ（既定 800px）、JPEG base64 化 | — |
| `ocr.js` | プロンプト生成（`CATEGORIES_HINT` をハードコード）、Worker 経由で Claude Messages API を呼び、JSON を抽出 | — |
| `sheets.js` | 家計簿 1 行の追加（`appendRow`）。月別タブの自動生成・書式付与・新旧フォーマット判定 | `YYYY.M` |
| `stats.js` | 月次/年次の集計と Chart.js 描画。ヘッダーから列位置を推定 | `YYYY.M`（読取） |
| `assets.js` | 資産残高の read/write（upsert）、利回り設定の read/write、純資産推移グラフ | `資産管理`, `利回り設定` |
| `cashflow.js` | 月次収支の read/write、家計簿シートから当月「支出」合計を自動集計 | `キャッシュフロー`, `YYYY.M`（読取） |
| `forecast.js` | 収支予測ルールの CRUD（削除/更新は A2:G を clear→全行再 append）、ルール一覧 UI | `収支予測` |
| `simulate.js` | 直近残高＋予測ルール＋利回りで 2070 年 12 月まで月次シミュレーション、Chart.js 折れ線 | `資産管理`, `収支予測`, `利回り設定`（読取） |
| `csvimport.js` | カード明細 CSV パース、支払先正規化、重複判定、支払先→中カテゴリ対応表の read/write | `支払先カテゴリ`, `YYYY.M`（読取） |
| `categories.js` | `リスト` シートから追加中カテゴリを read、新規行を append | `リスト` |

## 画面セクション構成

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

## スプレッドシートのスキーマ

**単一の定義ファイルは無く、2 系統に分散している。**

### (A) シートの列名（＝各モジュールの `ensureSheet()` 内リテラル）

| タブ | 列 | 定義場所 |
|---|---|---|
| `YYYY.M`（家計簿・月別。タブ名はゼロ埋めなし。例 `2026.6`） | B=日付, C=空, D=大カテゴリ, E=中カテゴリ, F=支払先, G=金額, H=使用者 | `sheets.js` `HEADER_ROW` |
| `資産管理` | A=年月(`YYYY-MM`), B=カテゴリ, C=残高 | `assets.js` |
| `キャッシュフロー` | A=年月(`YYYY-MM`), B=科目, C=金額 | `cashflow.js` |
| `収支予測` | A=開始年月, B=終了年月, C=項目名, D=収支区分, E=金額, F=振替先, G=適用月 | `forecast.js` |
| `利回り設定` | A=カテゴリ, B=利回り% | `assets.js` |
| `支払先カテゴリ` | A=支払先(正規化後), B=中カテゴリ, C=件数 | `csvimport.js` |
| `リスト` | A=項目, B=大カテゴリ（アプリから追加した行のみ B 列が入る） | `categories.js`（ヘッダー生成なし。既存シート前提） |

- 旧 `ライフイベント` シートは廃止。一時イベントは `収支予測` に `開始年月 === 終了年月` で統合。
- `リスト` タブは元々スプレッドシート側の入力規則用に手動作成されたシートで、既存行の多くは B 列が空。アプリは B 列が `支出`/`収入` の行だけを追加中カテゴリとして読むため、既存の空 B 列行とは干渉しない。

### 家計簿シートの新形式／旧形式判定（4 モジュールで実装が 2 通り）

- **新形式**: B=日付, C=空, D=大カテゴリ … H=使用者
- **旧形式**: B=日付, C=大カテゴリ … G=使用者
- 判定方法が分かれている（**整形済みシートでは結果は一致するが、実装は別物**）:
  - **`sheets.js` / `csvimport.js`**: ヘッダー行の C1（`header[1]`）が空文字なら新形式（`hasGapCol`）。以降は固定オフセットで列を取る（`csvimport.js`: store=`hasGapCol?4:3`, amount=`hasGapCol?5:4`）。
  - **`stats.js` / `cashflow.js`**: ヘッダーから「大」を含むセルを `findIndex(h => String(h).includes('大'))` で探し、中カテゴリ=+1・金額=+3 で相対参照。見つからない場合は新形式の索引（大=2, 金額=5）にフォールバック。C1 は見ていない。
  - 変則ヘッダー（C1 に空白文字が入る等）には `sheets.js` / `csvimport.js` 系が弱い。

### (B) 分類コード体系（＝ `config.js`。本番は `deploy.yml` が同内容を再定義）

- `CATEGORIES = { '支出': […], '収入': […] }` … 大カテゴリは `支出`/`収入` の 2 値。中カテゴリのマスター一覧
- `USERS` … 使用者
- `BUDGET` … 中カテゴリ名 → 予算額（月次グラフの予算ライン）
- `ASSET_CATEGORY_DEFS = [{ name, type: 'asset' | 'liability', expectedReturn }]`
  → `ASSET_CATEGORIES` / `LIABILITY_CATEGORIES` はここから派生
- `ASSET_GROUPS` … 残高入力画面のグループ表示用
- `CASHFLOW_INCOME` / `CASHFLOW_EXPENSE` … キャッシュフローの手動科目

英字コードは次の 2 組だけ:
- **収支区分**（`収支予測` D 列）: `'income'` / `'expense'` — `forecast.js` / `simulate.js` のリテラル
- **資産種別**: `'asset'` / `'liability'` — `ASSET_CATEGORY_DEFS[].type`

その他のコード規約:
- **適用月**（`収支予測` G 列）: `0`=毎月、`1`–`12`=毎年その月のみ。空欄は `Number(row[6]) || 0` で毎月扱い（後方互換）
- **一時イベント**: 専用フラグは無く `開始年月 === 終了年月` で表現
- **OCR 用カテゴリヒント**: `ocr.js` の `CATEGORIES_HINT` に中カテゴリ一覧を**別途ハードコード**（`config.js` と手動同期。「作業ルール」参照）

### (C) 値の書式規約

- 年月列は `YYYY-MM`（資産管理・キャッシュフロー・収支予測・利回り設定）
- 家計簿の日付は `YYYY-MM-DD` 文字列（Sheets のシリアル値で入っている行にも `csvimport.js` の `cellToISODate` が両対応）
- 月別タブ名は `YYYY.M`（`sheets.js` `dateToSheetName`）
- **`valueInputOption` は用途で固定**:
  - `USER_ENTERED`: 家計簿 1 行の追加（`sheets.js` `appendRow`）、全シートのヘッダー行書き込み、既存セルの更新 `values:batchUpdate`（`cashflow.js` / `assets.js` — 更新するのは**金額セルのみ**）
  - `RAW`: `:append` + `insertDataOption=INSERT_ROWS` による行追加すべて（`categories.js` / `forecast.js` の追加・全行再書き込み / `cashflow.js`・`assets.js` の新規行 / `saveReturnRates` / `commitPayeeCategoryChoices`）
  - 年月列（`YYYY-MM`）を書くのは RAW の append のみ。`USER_ENTERED` だと `YYYY-MM` が日付シリアル値に変換されるため。`USER_ENTERED` の `values:batchUpdate` は金額セルしか触らないので影響しない。

## 毎月／更新時の手作業

### 毎月（アプリ画面で入力。コード変更なし）

1. **レシート記録**: 撮影 → OCR 確認 → 保存 ／ 手動入力 ／ カード明細 CSV 取込。月別タブは自動生成
2. **資産管理・残高入力**: 各口座・資産の残高を手入力（「前月引継ぎ」で前月値をコピー可）＋各資産の利回り%
3. **資産管理・収支**: 会社給与・賞与・手動支出科目を入力（「前月」ボタンあり）。家計簿からの当月支出合計は自動

### 設定・コードの手動更新が要る工程

| 変更内容 | 手を入れる箇所 |
|---|---|
| 中カテゴリ追加（恒久反映） | アプリの「＋新規カテゴリ」で `リスト` シートには入るが、恒久化には `config.js` `CATEGORIES` ＋ `deploy.yml` 生成ブロック ＋ `ocr.js` `CATEGORIES_HINT` の**3 箇所**を手動同期 |
| 大カテゴリ追加 | 不可（`支出`/`収入` の 2 値固定） |
| 口座・資産カテゴリ、`BUDGET`、`USERS`、`CASHFLOW_*` の増減 | `config.js` と `deploy.yml` の**2 箇所**を手動同期 |
| 対応カード会社の追加 | `csvimport.js` `parseCardCsv` がセゾン形式（`利用日,` ヘッダー）決め打ち。他社は改修必要 |
| 支払先の表記ゆれ | `csvimport.js` `normalizePayee` にルールをハードコード追記 |
| Service Worker のキャッシュ戦略変更 | `sw.js` の `kakeibo-v5` を手動インクリメント |
| Worker 側の変更 | 手動 `wrangler deploy`（CI 化されていない） |
| GitHub Pages の公開 URL 変更 | `cloudflare-worker/index.js` `ALLOWED_ORIGIN` を手動修正 |
| 年替わり | `CONFIG.SHEET_NAME`（`'2025'` 固定）・`BUILD_TIME` はズレたまま。月別タブは日付から生成されるので実害は小さいが放置状態 |

## 開発上の注意

- ES Modules（`type="module"`）使用。`CONFIG` / `CATEGORIES` / `BUDGET` / `USERS` / `ASSET_GROUPS` / `ASSET_CATEGORY_DEFS` / `ASSET_CATEGORIES` / `LIABILITY_CATEGORIES` / `CASHFLOW_INCOME` / `CASHFLOW_EXPENSE` はグローバル変数（`config.js` で定義）。
- `forecast.js` と `simulate.js` は boot 時に API を呼ばない。ユーザーが画面を開いたときに初めてフェッチする。
- 認証トークンはメモリのみ（リロードで再ログイン）。
- `CONFIG.SHEET_NAME`（`'2025'`）は現状ほぼ形骸フィールド（`app.js` は `BUILD_TIME` のみ表示に使用、月別タブは日付から生成）。

## 既知の課題

### 家計簿シートの新旧フォーマット判定が 2 実装に分裂している（技術的負債）

- `sheets.js` / `csvimport.js` は「ヘッダー行 C1（`header[1]`）が空文字か」で新旧を判定し、固定オフセットで列を取る。
- `stats.js` / `cashflow.js` は「ヘッダーに『大』を含むセルを `findIndex` で探す」方式で大カテゴリ列を特定し、中=+1・金額=+3 で相対参照する（見つからなければ新形式索引にフォールバック）。
- 整形済みの新形式・旧形式シートでは**両者の結果は一致する**が、変則ヘッダー（C1 に空白文字が入る、見出し語が「大区分」など別表記、列が 1 つずれている等）では**解釈が割れうる**。
- そのとき症状は「**記帳（`appendRow`）は通るが、集計だけがずれる**」形で顕在化する。`sheets.js` の判定で書き込んだ列位置と、`stats.js` / `cashflow.js` の判定で読む列位置が食い違うため、家計簿への追加は成功し続けるのに月次/年次グラフやキャッシュフローの家計自動取込だけが誤った金額を出す。書き込み側が無事なので気づきにくい。
- **将来の統一方針**: 判定ロジックを 1 つの関数（例: `detectSheetLayout(header)` → `{ dateIdx, largeIdx, mediumIdx, storeIdx, amountIdx, userIdx }`）に切り出し、`sheets.js` / `stats.js` / `cashflow.js` / `csvimport.js` の 4 ファイルがそれを参照する形にする（実装は未着手）。

### OCR 認証に Sheets のアクセストークンを流用している（意識的な妥協）

- Worker が必要としているのは「発信者が許可アカウントか」だけだが、送っているのは `spreadsheets` スコープ付きの生アクセストークン＝そのユーザーのスプレッドシートを読み書きできる権限そのもの。最小権限から外れている。
- Worker は自分のコードなので即座の実害は無いが、**ヘッダをログ／オブザーバビリティに流した瞬間に権限が漏れる**。→「作業ルール」に禁止事項として明記済み。
- 本来は ID トークン（JWT）を送り `tokeninfo?id_token=` で検証するのが筋。ID トークンは身元の主張のみで、盗まれても Sheets は触れない。ただし GIS の token client から ID トークンは取れず、`google.accounts.id` 側の導線を別途足す追加工数が要るため見送り。
- 残存リスク: トークン有効期限（≈1時間）内はリプレイ可能。現状は許容。

---

以下は機能別の詳細仕様（旧 CLAUDE.md からマージ）。

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

## 新規中カテゴリの追加（categories.js）

手動入力/OCR確認フォームの中カテゴリ選択（`#field-medium-cat`）と、CSV取込一覧の各行の中カテゴリ選択（`.csv-medium-select`）の両方に「＋ 新規カテゴリを追加...」を選択肢として追加。

- `loadCustomCategories()`: シート `リスト` の A:B 列を読み、B列（大カテゴリ）が `支出`/`収入` の行だけを `{ 支出: [...], 収入: [...] }` として返す（モジュール内キャッシュあり）。既存の空B列行は無視されるため、シート側で別用途に使われている既存データと干渉しない。
- `addCustomCategory(largeCat, name)`: `リスト` シートのA:B列末尾に `[項目, 大カテゴリ]` を1行追加。
- `app.js` 側は `mediumOptionList(largeCat)` で `CATEGORIES[largeCat]`（静的設定）と `customCategories[largeCat]`（シート由来）をマージして選択肢を生成。「＋ 新規カテゴリを追加...」選択時は `window.prompt` で名称入力 → 既存候補と同名ならそのまま採用、なければ `addCustomCategory` で追加してから選択肢を再構築。
- 大カテゴリそのものの新規作成は不可（既存の「支出」「収入」いずれかの下に追加するのみ）。CSV取込側は大カテゴリが常に「支出」固定のため、追加時も自動的に「支出」扱い。
- 追加した中カテゴリは即座にセッション内キャッシュへ反映されるため、同じセッション内であれば再取得なしで他の選択肢（フォーム・CSV一覧の全行）にも反映される。

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

## Service Worker

- キャッシュ名: `kakeibo-v5`（キャッシュ戦略を変更したらバージョンを上げること）。
- アイコン・マニフェストのみキャッシュ優先、JS/CSS/HTML は `cache: 'no-store'` でHTTPキャッシュをバイパスしてネットワーク優先。
- activate 時に旧バージョンキャッシュ（名前が異なるもの）を全削除。
