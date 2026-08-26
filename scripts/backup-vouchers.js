/* Fetches every row of the `vouchers` table and writes it as a dated JSON snapshot under
   backups/. Run by .github/workflows/daily-backup.yml (GitHub Actions cron), not by the app
   itself. Each entry in the output array is a plain voucher record (schema.js shape, `id`
   included) — the same shape CompApp.dbCloud.putMany() expects, so a snapshot can be fed
   straight into the app's "백업에서 복원" (Restore from backup) feature, which upserts by id
   and never creates duplicate records (unlike 엑셀 가져오기, which always inserts fresh ids —
   see the 2026-08-25 incident notes in js/ui/viewImportExport.js). */
const fs = require('fs');
const path = require('path');

const SUPA_URL = 'https://foupxcgdopunvxecvwvn.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvdXB4Y2dkb3B1bnZ4ZWN2d3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MzM4MTYsImV4cCI6MjEwMTAwOTgxNn0.lXAI3yO92AKynI_rNCZBEGVlfDsyrzmNB7mtbftW7z4';
const PAGE = 1000;
const RETENTION_DAYS = 30;

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

function pruneOld(dir) {
  const files = fs.readdirSync(dir).filter(function (f) { return /^vouchers_\d{4}-\d{2}-\d{2}\.json$/.test(f); }).sort();
  const excess = files.length - RETENTION_DAYS;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(dir, files[i]));
    console.log('pruned old backup:', files[i]);
  }
}

(async function main() {
  const records = await fetchAll();
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(dir, 'vouchers_' + today + '.json');
  fs.writeFileSync(outPath, JSON.stringify(records));
  console.log('wrote', outPath, records.length, 'records');
  pruneOld(dir);
})().catch(function (e) { console.error('BACKUP FAILED', e); process.exit(1); });
