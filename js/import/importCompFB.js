/* CompApp.importCompFB — parses the EO_FB sheet from "Comp Voucher Update List_*.xlsx".
   Header (row 1): Serial No | Issued Date | Valid Date | Black-out Date | status | Used Date |
                   Contents benefit | Requested By | Remark | Remark1 | Remark2 | E-approval Doc. No. */
window.CompApp = window.CompApp || {};
CompApp.importCompFB = (function () {
  "use strict";
  var schema = CompApp.schema, mapper = CompApp.importMapper;

  function run(ws) {
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    var records = [], warnings = [];
    var read = 0, flagged = 0;
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var serialRaw = row[0];
      if (serialRaw == null || String(serialRaw).trim() === '') continue; // blank row, skip silently
      read++;
      var serial = String(serialRaw).replace(/\s+/g, '');
      var issuedRaw = row[1], validRaw = row[2], blackoutRaw = row[3], statusRaw = row[4], usedRaw = row[5];
      var contents = row[6], reqBy = row[7], remarkA = row[8], remarkB = row[9], remarkC = row[10], mate = row[11];

      var reasons = [];
      var issued = mapper.excelDateToStr(issuedRaw), valid = mapper.excelDateToStr(validRaw);
      if (!schema.validDate(issued)) { reasons.push('발행일 파싱 실패(원본: ' + (issuedRaw == null ? '공백' : issuedRaw) + ')'); issued = schema.todayStr(); }
      if (!schema.validDate(valid)) { reasons.push('만료일 파싱 실패(원본: ' + (validRaw == null ? '공백' : validRaw) + ')'); valid = schema.addMonths(issued, 12); }

      var sm = mapper.mapStatus(statusRaw);
      if (sm.needsReview) reasons.push('알 수 없는 원본 상태값: "' + sm.rawStatus + '"');

      var catInfer = mapper.inferCategory(contents, remarkA, remarkB, remarkC);
      if (catInfer.needsReview) reasons.push('사유 카테고리 자동추정 불확실');

      var usedDate = mapper.excelDateToStr(usedRaw);
      var contentsText = String(contents || '').trim();
      var amount = mapper.extractAmount(contentsText);

      var remark = mapper.joinNonEmpty([remarkA, remarkB, remarkC]);
      remark = mapper.appendReviewNote(remark, reasons);

      var r = {
        id: schema.uid(), fam: 'FB', serial: serial, product: '', productText: contentsText,
        amount: amount, issued: issued, valid: valid, cat: catInfer.cat,
        purpose: contentsText || '(원본 미기재)', req: String(reqBy || '').trim() || '(원본 미기재)',
        mate: String(mate || '').trim(), remark: remark,
        blackoutTags: blackoutRaw ? [{ type: 'text', label: mapper.cleanBlackoutText(blackoutRaw) }] : [],
        status: sm.status, needsReview: reasons.length > 0, history: []
      };
      if (sm.status === 'USED' && schema.validDate(usedDate)) r.usedDate = usedDate;
      r.history.push({ ts: issued, actor: '가져오기', action: '가져오기', detail: '엑셀 가져오기(EO_FB) · 원본 상태: ' + (sm.rawStatus || '(공백)') });
      if (reasons.length) { flagged++; warnings.push(serial + ': ' + reasons.join('; ')); }
      records.push(r);
    }
    return { records: records, rowsRead: read, rowsImported: records.length, rowsFlagged: flagged, warnings: warnings };
  }

  return { run: run };
})();
