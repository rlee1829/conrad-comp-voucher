/* CompApp.importPipeline — reads a user-selected .xlsx File via SheetJS, detects which sheets are
   present (EO_FB/EO_RM -> Comp Voucher ledger, single-sheet w/ HR signature -> HR tracking sheet),
   runs the matching pipeline(s), inserts the resulting records into CompApp.db.cache.records
   (the same array every workflow/view function reads), and mirrors them to Supabase in one batched
   upsert when cloud is enabled. Never bypasses CompApp.db.cache.records — imported vouchers behave
   identically to manually-issued ones everywhere else in the app. */
window.CompApp = window.CompApp || {};
CompApp.importPipeline = (function () {
  "use strict";

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('파일을 읽을 수 없습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }

  function importFile(file) {
    return readFile(file).then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array', cellDates: true });
      var parts = [];

      if (wb.Sheets['EO_FB']) parts.push(CompApp.importCompFB.run(wb.Sheets['EO_FB']));
      if (wb.Sheets['EO_RM']) parts.push(CompApp.importCompRM.run(wb.Sheets['EO_RM']));

      if (!parts.length) {
        // Not the Comp Voucher ledger — check whether it's the HR tracking sheet (single sheet,
        // legend-then-header signature) before assuming anything.
        if (wb.SheetNames.length === 1) {
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
          if (CompApp.importHR.looksLikeHRSheet(rows)) parts.push(CompApp.importHR.run(rows));
        }
      }

      if (!parts.length) {
        return Promise.reject(new Error('인식할 수 없는 파일 형식입니다. EO_FB/EO_RM 시트가 있는 COMP 바우처 대장이거나, HR Voucher Tracking Sheet 형식이어야 합니다.'));
      }

      var allRecords = [], rowsRead = 0, rowsImported = 0, rowsFlagged = 0, warnings = [];
      parts.forEach(function (p) {
        allRecords = allRecords.concat(p.records);
        rowsRead += p.rowsRead; rowsImported += p.rowsImported; rowsFlagged += p.rowsFlagged;
        warnings = warnings.concat(p.warnings);
      });

      var arr = CompApp.db.cache.records;
      allRecords.forEach(function (r) { arr.unshift(r); });

      if (CompApp.cloudEnabled && CompApp.cloudEnabled() && allRecords.length) {
        CompApp.dbCloud.putMany(allRecords).catch(function (e) { console.warn('cloud import sync failed', e); });
      }

      return { rowsRead: rowsRead, rowsImported: rowsImported, rowsFlagged: rowsFlagged, warnings: warnings, byFamily: summarizeByFamily(allRecords) };
    });
  }

  function summarizeByFamily(records) {
    var out = { FB: 0, RM: 0, HR: 0 };
    records.forEach(function (r) { if (out[r.fam] != null) out[r.fam]++; });
    return out;
  }

  return { importFile: importFile };
})();
