# 家計簿アプリ — CLAUDE.md

## プロジェクト概要

家族（自分・妻）で共有するスマホ向け家計簿PWA。

- **フロントエンド**: GitHub Pages (静的HTML/CSS/JS)
- **OCRプロキシ**: Cloudflare Worker (`cloudflare-worker/`)
- **データストア**: Google Sheets（月別タブ + 資産管理シート）
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
  css/style.css    — スタイル
  config.js        — 設定（SPREADSHEET_ID等、gitignore対象）
```

## セクション構成

| セクションID | 役割 |
|---|---|
| section-auth | ログイン画面 |
| section-camera | メイン（カメラ・手動入力） |
| section-form | OCR結果確認・編集・保存 |
| section-success | 保存完了 |
| section-stats | 家計集計（月次/年次グラフ） |
| section-assets | 資産管理（月次入力/推移グラフ） |

## Sheets構成

| タブ名 | 用途 | 列構成 |
|---|---|---|
| `YYYY.M`（例: 2026.6） | 家計簿データ（月別） | B=日付, C=空白, D=大カテゴリ, E=中カテゴリ, F=支払先, G=金額, H=使用者 |
| `資産管理` | 資産残高（月次） | A=年月(YYYY-MM), B=カテゴリ, C=残高 |

## 設定（config.js）

- `CATEGORIES`: 支出・収入の大/中カテゴリ
- `USERS`: 家族メンバー（パパ・ママ・悠真）
- `ASSET_CATEGORIES`: 資産カテゴリ一覧

## 開発上の注意

- `config.js` は `.gitignore` 対象。GitHub Actions が `config.example.js` から自動生成。
- シートは「新形式」（B列スタート + C列空白）と「旧形式」（B列スタート）を自動判定。
- Chart.js 4.4.0 をCDNから読み込み。
- ES Modules (`type="module"`)使用。`CONFIG`/`CATEGORIES`/`USERS`/`ASSET_CATEGORIES` はグローバル変数。

## feature/asset-management ブランチの変更内容

- `js/assets.js` 新規: 資産管理ロジック（Sheets読み書き・グラフ描画）
- `index.html`: `section-assets` 追加、カメラ画面に💰ボタン追加
- `js/app.js`: 資産管理セクションのイベント・ナビゲーション統合
- `css/style.css`: 資産入力フォーム・テーブルのスタイル追加
- `config.js` / `config.example.js`: `ASSET_CATEGORIES` 追加
