/* Fetches every row of the `vouchers` table and writes TWO dated snapshots under backups/:
     - vouchers_YYYY-MM-DD.json  — full record array (schema.js shape, `id` included). This is
       the real restore path: app → 가져오기/내보내기 → 백업에서 복원 (upserts by id, never
       creates duplicates, unlike 엑셀 가져오기 — see the 2026-08-25 incident notes).
     - vouchers_YYYY-MM-DD.xlsx  — the same data in the ORIGINAL ledger layout (EO_FB / EO_RM /
       HR sheets), so the ledger survives in a human-openable form even if the app itself
       becomes unusable. This mirrors js/export/exportWorkbook.js exportOriginalFormat().
       ⚠️ Do NOT re-import this xlsx — 엑셀 가져오기 assigns fresh ids and would duplicate
       everything. It is a read-only fallback copy only.

   Run by .github/workflows/daily-backup.yml (GitHub Actions cron), not by the app itself. */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'js', 'lib', 'xlsx.full.min.js'));

const SUPA_URL = 'https://foupxcgdopunvxecvwvn.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvdXB4Y2dkb3B1bnZ4ZWN2d3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MzM4MTYsImV4cCI6MjEwMTAwOTgxNn0.lXAI3yO92AKynI_rNCZBEGVlfDsyrzmNB7mtbftW7z4';
const PAGE = 1000;
// git 히스토리는 파일을 지워도 줄지 않으므로(옛 커밋에 그대로 남음) 이 값은 "저장소 웹에서
// 몇 일치를 바로 볼 수 있나"만 정한다. JSON+xlsx 두 벌이라 하루 ~5MB씩 커지는 걸 감안해 14일.
const RETENTION_DAYS = 14;

// ---- schema helpers (js/schema.js에서 필요한 부분만 그대로 옮김 — 서버에는 i18n/localStorage 없음) ----
const BUILTIN_CATALOG = {
  FB: [
    { id: 'fb_buffet2', name: 'ZEST 뷔페 (평일/주말 런치·디너) 2인' }, { id: 'fb_buffet_l2', name: 'ZEST 평일 런치 뷔페 2인' },
    { id: 'fb_buffet1', name: 'ZEST 뷔페 1인' }, { id: 'fb_val_50', name: 'F&B 금액권 ₩50,000' },
    { id: 'fb_val_100', name: 'F&B 금액권 ₩100,000' }, { id: 'fb_val_150', name: 'F&B 금액권 ₩150,000' },
    { id: 'fb_10g_drinkbread', name: '10G 음료 1 + 베이커리 1' }, { id: 'fb_10g_americano', name: '10G 아이스 아메리카노 1잔' },
    { id: 'fb_10g_beverage', name: '10G 음료 1잔' }, { id: 'fb_10g_cake', name: '10G 홀케이크 (₩68,000)' },
    { id: 'fb_atrio_pizza', name: 'ATRIO 피자 1판' }, { id: 'fb_atrio_coppia', name: 'ATRIO Coppia Set 2인' },
    { id: 'fb_37_tea', name: '37 Bar & Lounge 애프터눈티 2인' }, { id: 'fb_zest_dolsang', name: 'ZEST 돌상 패키지 (comp item 포함)' }
  ],
  RM: [
    { id: 'rm_deluxe_1n', name: 'Deluxe Room 1박 (조식 포함)' }, { id: 'rm_deluxe_2n', name: 'Deluxe Room 2박 (조식 포함)' },
    { id: 'rm_exec_1n', name: 'Executive Corner Suite 1박 (조식 포함)' }, { id: 'rm_king_1n', name: 'King Deluxe Corner Suite 1박 (조식 포함)' },
    { id: 'rm_val_10', name: 'Room & F&B 금액권 ₩10,000' }, { id: 'rm_val_50', name: 'Room & F&B 금액권 ₩50,000' },
    { id: 'rm_val_100', name: 'Room & F&B 금액권 ₩100,000' }
  ],
  HR: [
    { id: 'hr_fb100', name: 'F&B 금액권 ₩100,000', prefix: 'HRF' }, { id: 'hr_cake', name: '홀케이크 (₩68,000) · 10G', prefix: 'HRC' },
    { id: 'hr_buffet', name: 'ZEST 뷔페 2인 (평일/주말)', prefix: 'HRZ' }, { id: 'hr_drink', name: '10G 음료 1 + 베이커리 1', prefix: 'HRB' }
  ]
};
const CAT_LABEL = { VIP: 'For VIP', COMPLAINT: '컴플레인 보상', STAFF: '직원 복리후생', PARTNER: '제휴/마케팅', WEDDING: '웨딩' };

function makeProdLookup(catalog) {
  const byId = {};
  Object.keys(catalog).forEach(function (fam) {
    (catalog[fam] || []).forEach(function (p) { if (p && p.id) byId[p.id] = p; });
  });
  return byId;
}
function recordProductLabel(r, byId) {
  if (r.product) { const p = byId[r.product]; if (p && p.name) return p.name; if (r.product) return r.product; }
  return r.productText || '(원본 미기재)';
}
function normalizeBlackoutTags(r) {
  if (r && Array.isArray(r.blackoutTags)) return r.blackoutTags.slice();
  if (r && r.blackout) return [{ type: 'text', label: r.blackout }];
  return [];
}
function blackoutTagLabel(tag) {
  if (!tag) return '';
  if (tag.type === 'range') return (tag.from || '?') + ' ~ ' + (tag.to || '?');
  return tag.label || '';
}
function blackoutSummary(r) { return normalizeBlackoutTags(r).map(blackoutTagLabel).join('; '); }

// ---- fetch ----
async function page(from) {
  const to = from + PAGE - 1;
  const res = await fetch(SUPA_URL + '/rest/v1/vouchers?select=data&order=created_at.asc,id.asc', {
    headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, Range: from + '-' + to, 'Range-Unit': 'items' }
  });
  if (!res.ok && res.status !== 206) throw new Error('fetch failed ' + res.status + ' ' + await res.text());
  return res.json();
}
async function fetchAll() {
  let all = [], from = 0;
  while (true) {
    const rows = await page(from);
    all = all.concat(rows.map(function (r) { return r.data; }));
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
// 공유 카탈로그(관리자가 앱에서 추가/편집한 바우처 종류)도 가져와 상품명이 정확히 풀리도록 한다.
async function fetchCatalog() {
  try {
    const res = await fetch(SUPA_URL + '/rest/v1/meta?key=eq.compVoucherCatalog&select=data', {
      headers: { apikey: ANON, Authorization: 'Bearer ' + ANON }
    });
    if (!res.ok) return BUILTIN_CATALOG;
    const rows = await res.json();
    const s = rows[0] && rows[0].data;
    if (s && s.FB && s.RM) return { FB: s.FB, RM: s.RM, HR: s.HR || BUILTIN_CATALOG.HR };
  } catch (e) { console.warn('catalog fetch failed, using built-in:', e.message); }
  return BUILTIN_CATALOG;
}

// ---- xlsx (원본 형식) — js/export/exportWorkbook.js의 exportOriginalFormat()와 동일한 열 구성 ----
function bySerial(a, b) { const x = a.serial || '', y = b.serial || ''; return x < y ? -1 : x > y ? 1 : 0; }
function buildWorkbook(records, byId) {
  const fb = records.filter(function (r) { return r.fam === 'FB'; }).sort(bySerial);
  const rm = records.filter(function (r) { return r.fam === 'RM'; }).sort(bySerial);
  const hr = records.filter(function (r) { return r.fam === 'HR'; }).sort(bySerial);
  const wb = XLSX.utils.book_new();

  const fbHead = ['Serial No', 'Issued Date', 'Valid Date', 'Black-out Date', 'Status', 'Used Date', 'Contents benefit', 'Requested By', 'Remark', 'Remark1', 'Remark2', 'E-approval Doc. No.', '사유 카테고리'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([fbHead].concat(fb.map(function (r) {
    return [r.serial, r.issued, r.valid, blackoutSummary(r), r.status, r.usedDate || '', recordProductLabel(r, byId), r.req || '', r.remark || '', '', '', r.mate || '', CAT_LABEL[r.cat] || r.cat];
  }))), 'EO_FB');

  const rmHead = ['Serial number', 'Issued Date', 'Expire date', 'Black-out Date', 'Status', 'Used Date', 'Service included', 'Requested By', 'Purpose', 'Remark1', 'Remark2', 'E-approval Doc. No.', 'NOTES', 'Note2', '사유 카테고리'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([rmHead].concat(rm.map(function (r) {
    return [r.serial, r.issued, r.valid, blackoutSummary(r), r.status, r.usedDate || '', recordProductLabel(r, byId), r.req || '', r.purpose || '', r.remark || '', '', r.mate || '', '', '', CAT_LABEL[r.cat] || r.cat];
  }))), 'EO_RM');

  const hrHead = ['Serial No', 'Issued Date', 'Valid Date', 'Status', 'Used Date', 'Contents benefit', 'Voucher Type', 'Emp No', 'Name', 'Dept', 'Remark'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hrHead].concat(hr.map(function (r) {
    return [r.serial, r.issued, r.valid, r.status, r.usedDate || '', recordProductLabel(r, byId), r.purpose || '', '', '', '', r.remark || ''];
  }))), 'HR');

  return { wb: wb, counts: { FB: fb.length, RM: rm.length, HR: hr.length } };
}

// ---- prune ----
function pruneOld(dir, ext) {
  const re = new RegExp('^vouchers_\\d{4}-\\d{2}-\\d{2}\\.' + ext + '$');
  const files = fs.readdirSync(dir).filter(function (f) { return re.test(f); }).sort();
  const excess = files.length - RETENTION_DAYS;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(dir, files[i]));
    console.log('pruned old backup:', files[i]);
  }
}

(async function main() {
  const records = await fetchAll();
  const catalog = await fetchCatalog();
  const byId = makeProdLookup(catalog);

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);

  const jsonPath = path.join(dir, 'vouchers_' + today + '.json');
  fs.writeFileSync(jsonPath, JSON.stringify(records));
  console.log('wrote', jsonPath, records.length, 'records');

  const built = buildWorkbook(records, byId);
  const xlsxPath = path.join(dir, 'vouchers_' + today + '.xlsx');
  fs.writeFileSync(xlsxPath, XLSX.write(built.wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log('wrote', xlsxPath, JSON.stringify(built.counts));

  pruneOld(dir, 'json');
  pruneOld(dir, 'xlsx');
})().catch(function (e) { console.error('BACKUP FAILED', e); process.exit(1); });
