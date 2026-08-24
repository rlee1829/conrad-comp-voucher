/* CompApp.importHR — parses "HR Voucher Tracking Sheet_*.xlsx", sheet "Sheet1".
   NOT a plain flat table: row1=title, row2=blank, rows3-6=product-code legend (HRC/HRZ/HRF/HRB),
   row7=the real header, data from row8 onward. (0-indexed: skip rows 0-6, header at index 6, data from index 7.)
   Header: Serial No (바우처 No) | Issued Date | Valid Date | Status | Used Date | Contents benefit |
           Voucher Type (근속,생일 etc) | Emp No | Name | Dept | Remark */
window.CompApp = window.CompApp || {};
CompApp.importHR = (function () {
  "use strict";
  var schema = CompApp.schema, mapper = CompApp.importMapper;
  var HEADER_ROW_INDEX = 6, DATA_START_INDEX = 7;
  var REQ_LABEL = 'HR'; // no per-row requester column in the source sheet, no person name either — keep it bare

  // Signature check so the pipeline never blindly assumes a single-sheet workbook is the HR file.
  function looksLikeHRSheet(rows) {
    var h = rows[HEADER_ROW_INDEX];
    return !!(h && /serial/i.test(String(h[0] || '')));
  }

  function prefixToId() {
    var map = {};
    schema.CATALOG.HR.forEach(function (p) { if (p.prefix) map[p.prefix] = p.id; });
    return map;
  }

  function run(rows) {
    var records = [], warnings = [];
    var read = 0, flagged = 0;
    var pmap = prefixToId();
    for (var i = DATA_START_INDEX; i < rows.length; i++) {
      var row = rows[i] || [];
      var serialRaw = row[0];
      if (serialRaw == null || String(serialRaw).trim() === '') continue;
      read++;
      var serial = String(serialRaw).trim().replace(/\s+/g, ''); // 원본은 "HRF 000006"처럼 공백이 있으나 앱 표기는 붙여 쓴다
      var issuedRaw = row[1], validRaw = row[2], statusRaw = row[3], usedRaw = row[4];
      var contents = row[5], voucherType = row[6], empNo = row[7], name = row[8], dept = row[9], sheetRemark = row[10];

      var reasons = [];
      var issued = mapper.excelDateToStr(issuedRaw), valid = mapper.excelDateToStr(validRaw);
      if (!schema.validDate(issued)) { reasons.push('발행일 파싱 실패(원본: ' + (issuedRaw == null ? '공백' : issuedRaw) + ')'); issued = schema.todayStr(); }
      if (!schema.validDate(valid)) { reasons.push('만료일 파싱 실패(원본: ' + (validRaw == null ? '공백' : validRaw) + ')'); valid = schema.addMonths(issued, 6); }

      var sm = mapper.mapStatus(statusRaw);
      if (sm.needsReview) reasons.push('알 수 없는 원본 상태값: "' + sm.rawStatus + '"');

      var m = /^([A-Za-z]+)/.exec(serial);
      var prefix = m ? m[1] : '';
      var productId = pmap[prefix] || '';
      var contentsText = String(contents || '').trim();
      if (!productId) reasons.push('제품 접두어 "' + prefix + '" 매칭 실패');
      var amount = productId ? (schema.prod('HR', productId) || {}).amount || 0 : mapper.extractAmount(contentsText);

      var usedDate = mapper.excelDateToStr(usedRaw);
      var empPart = mapper.joinNonEmpty([empNo, name], ' ');
      var remark = empPart ? (empPart + (dept ? ' / ' + String(dept).trim() : '')) : '';
      remark = mapper.joinNonEmpty([remark, sheetRemark]);
      remark = mapper.appendReviewNote(remark, reasons);

      var r = {
        id: schema.uid(), fam: 'HR', serial: serial, product: productId, productText: productId ? '' : contentsText,
        amount: amount, issued: issued, valid: valid, cat: 'STAFF',
        purpose: String(voucherType || '').trim() || '(원본 미기재)', req: REQ_LABEL,
        mate: '', remark: remark, blackoutTags: [],
        status: sm.status, needsReview: reasons.length > 0, history: []
      };
      if (sm.status === 'USED' && schema.validDate(usedDate)) r.usedDate = usedDate;
      r.history.push({ ts: issued, actor: '가져오기', action: '가져오기', detail: '엑셀 가져오기(HR) · 원본 상태: ' + (sm.rawStatus || '(공백)') });
      if (reasons.length) { flagged++; warnings.push(serial + ': ' + reasons.join('; ')); }
      records.push(r);
    }
    return { records: records, rowsRead: read, rowsImported: records.length, rowsFlagged: flagged, warnings: warnings };
  }

  return { run: run, looksLikeHRSheet: looksLikeHRSheet, HEADER_ROW_INDEX: HEADER_ROW_INDEX, DATA_START_INDEX: DATA_START_INDEX };
})();
