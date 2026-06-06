import { getToken } from './auth.js';

function dateToSheetName(dateStr) {
  const d = new Date(dateStr || Date.now());
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}.${now.getMonth() + 1}`;
  }
  return `${d.getFullYear()}.${d.getMonth() + 1}`;
}

async function sheetsFetch(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message ?? `Sheets API エラー (${res.status})`;
    console.error('[kakeibo] sheetsFetch error:', msg, url);
    throw new Error(msg);
  }
  return res.json();
}

const BASE = () => `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;

const HEADER_ROW = ['日付', '', '大カテゴリ', '中カテゴリ', '支払先', '金額', '使用者'];

// シートが存在しなければ作成してヘッダーを書き込む。
// 戻り値: { nextRow, hasGapCol }
//   hasGapCol=true  → 新形式（B=日付, C=空白, D=大カテゴリ … H=使用者）
//   hasGapCol=false → 旧形式（B=日付, C=大カテゴリ … G=使用者）
async function ensureSheet(token, sheetName) {
  const colRange    = encodeURIComponent(`'${sheetName}'!B:B`);
  const headerRange = encodeURIComponent(`'${sheetName}'!B1:H1`);
  try {
    const [colRes, headerRes] = await Promise.all([
      sheetsFetch(token, `${BASE()}/values/${colRange}`),
      sheetsFetch(token, `${BASE()}/values/${headerRange}`),
    ]);
    const nextRow  = (colRes.values?.length ?? 0) + 1;
    const header   = headerRes.values?.[0] ?? [];
    // ヘッダー2列目（C1）が空文字 → 新形式
    const hasGapCol = header.length >= 2 && header[1] === '';
    console.log(`[kakeibo] シート "${sheetName}" フォーマット: ${hasGapCol ? '新形式' : '旧形式'}, nextRow: ${nextRow}`);
    return { nextRow, hasGapCol };
  } catch (e) {
    if (!e.message.includes('Unable to parse range') && !e.message.includes('not found')) throw e;
  }

  // シートを新規作成（sheetId を取得）
  console.log(`[kakeibo] シート "${sheetName}" を新規作成します`);
  const createRes = await sheetsFetch(token, `${BASE()}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
  });
  const sheetId = createRes.replies[0].addSheet.properties.sheetId;

  // ヘッダー行を書き込む（新形式）
  await sheetsFetch(token, `${BASE()}/values/${headerRange}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [HEADER_ROW] }),
  });

  // 書式を適用（ヘッダー色・交互背景色・フィルター）
  const HEADER_COLOR  = { red: 0.122, green: 0.380, blue: 0.553 }; // ダークブルー
  const BAND1_COLOR   = { red: 0.839, green: 0.918, blue: 0.973 }; // ライトブルー
  const BAND2_COLOR   = { red: 1,     green: 1,     blue: 1     }; // 白
  const WHITE         = { red: 1,     green: 1,     blue: 1     };
  const cols          = { startColumnIndex: 1, endColumnIndex: 8 }; // B〜H

  await sheetsFetch(token, `${BASE()}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        // ヘッダー行：濃いブルー背景・白太字
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, ...cols },
            cell: {
              userEnteredFormat: {
                backgroundColor: HEADER_COLOR,
                textFormat: { bold: true, foregroundColor: WHITE },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        // データ行：1行おきにライトブルー
        {
          addBanding: {
            bandedRange: {
              range: { sheetId, startRowIndex: 1, ...cols },
              rowProperties: { firstBandColor: BAND1_COLOR, secondBandColor: BAND2_COLOR },
            },
          },
        },
        // フィルター（ヘッダー行に▼を付ける）
        {
          setBasicFilter: {
            filter: { range: { sheetId, startRowIndex: 0, ...cols } },
          },
        },
      ],
    }),
  });

  return { nextRow: 2, hasGapCol: true }; // ヘッダーが1行目なのでデータは2行目から
}

export async function appendRow(fields) {
  const token = await getToken();
  const sheetName = dateToSheetName(fields.date);
  console.log('[kakeibo] appendRow:', { sheetName, fields });

  if (fields.date) {
    const d = new Date(fields.date);
    const now = new Date();
    const diffMonths = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (Math.abs(diffMonths) > 6) {
      console.warn(`[kakeibo] 日付が現在から${diffMonths}ヶ月ずれています。シートタブ: ${sheetName}`);
    }
  }

  const { nextRow, hasGapCol } = await ensureSheet(token, sheetName);

  // シートのフォーマットに合わせてデータを書き込む
  const row = hasGapCol
    ? [fields.date ?? '', '',  fields.large_category ?? '', fields.medium_category ?? '', fields.store ?? '', fields.amount ?? '', fields.user ?? ''] // B:H
    : [fields.date ?? '',     fields.large_category ?? '', fields.medium_category ?? '', fields.store ?? '', fields.amount ?? '', fields.user ?? '']; // B:G
  const endCol = hasGapCol ? 'H' : 'G';

  const writeRange = encodeURIComponent(`'${sheetName}'!B${nextRow}:${endCol}${nextRow}`);
  return sheetsFetch(token, `${BASE()}/values/${writeRange}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [row] }),
  });
}
