/* CompApp.exportWorkbook — rebuilds an .xlsx from the currently filtered list (data-only,
   no styling carryover) via SheetJS aoa_to_sheet/writeFile. */
window.CompApp = window.CompApp || {};
CompApp.exportWorkbook = (function () {
  "use strict";
  var schema = CompApp.schema;

  function exportFiltered() {
    var rows = CompApp.viewList.filtered();
    var famLabel = CompApp.router.famLabel;
    var head = ['증서번호', '타입', '바우처 종류', '발행일', '만료일', '사유', '세부목적', '요청자', 'Mate 승인', '상태'];
    var aoa = [head];
    rows.forEach(function (r) {
      var es = schema.effStatus(r);
      aoa.push([
        r.serial, famLabel(r.fam), schema.recordProductLabel(r), r.issued, r.valid,
        schema.CAT_LABEL[r.cat] || r.cat, r.purpose || '', r.req || '', r.mate || '', schema.STATUS_LABEL[es] || es
      ]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '바우처 목록');
    var stamp = schema.todayStr().replace(/-/g, '');
    XLSX.writeFile(wb, 'COMP_Voucher_export_' + stamp + '.xlsx');
    return rows.length;
  }

  // 원본 형식 전체 내보내기 — 원래 가져오기가 기대하는 열 순서(EO_FB/EO_RM/HR Tracking Sheet의
  // 헤더)를 그대로 따르고, 계열별로 시트를 나눈다. 필터와 무관하게 항상 전체 데이터를 담는다
  // (백업·대조용 — 재가져오기하면 새 id로 전부 중복 등록되니 실제 복원용으로는 쓰지 말 것).
  // 원본에 없던 "사유 카테고리"만 맨 끝에 참고용으로 덧붙인다(HR은 항상 STAFF라 생략).
  function byField(r) { var v = r.serial || ''; return v; }
  function sortBySerial(list) { return list.slice().sort(function (a, b) { return byField(a) < byField(b) ? -1 : byField(a) > byField(b) ? 1 : 0; }); }

  function exportOriginalFormat() {
    var all = CompApp.db.cache.records;
    var fb = sortBySerial(all.filter(function (r) { return r.fam === 'FB'; }));
    var rm = sortBySerial(all.filter(function (r) { return r.fam === 'RM'; }));
    var hr = sortBySerial(all.filter(function (r) { return r.fam === 'HR'; }));

    var wb = XLSX.utils.book_new();

    var fbHead = ['Serial No', 'Issued Date', 'Valid Date', 'Black-out Date', 'Status', 'Used Date', 'Contents benefit', 'Requested By', 'Remark', 'Remark1', 'Remark2', 'E-approval Doc. No.', '사유 카테고리'];
    var fbAoa = [fbHead].concat(fb.map(function (r) {
      return [r.serial, r.issued, r.valid, schema.blackoutSummary(r), r.status, r.usedDate || '', schema.recordProductLabel(r), r.req || '', r.remark || '', '', '', r.mate || '', schema.CAT_LABEL[r.cat] || r.cat];
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fbAoa), 'EO_FB');

    var rmHead = ['Serial number', 'Issued Date', 'Expire date', 'Black-out Date', 'Status', 'Used Date', 'Service included', 'Requested By', 'Purpose', 'Remark1', 'Remark2', 'E-approval Doc. No.', 'NOTES', 'Note2', '사유 카테고리'];
    var rmAoa = [rmHead].concat(rm.map(function (r) {
      return [r.serial, r.issued, r.valid, schema.blackoutSummary(r), r.status, r.usedDate || '', schema.recordProductLabel(r), r.req || '', r.purpose || '', r.remark || '', '', r.mate || '', '', '', schema.CAT_LABEL[r.cat] || r.cat];
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rmAoa), 'EO_RM');

    var hrHead = ['Serial No', 'Issued Date', 'Valid Date', 'Status', 'Used Date', 'Contents benefit', 'Voucher Type', 'Emp No', 'Name', 'Dept', 'Remark'];
    var hrAoa = [hrHead].concat(hr.map(function (r) {
      // 원본은 사번·이름·부서가 별도 칸이었지만, 이 앱은 그 세 값을 비고 하나로 합쳐서 저장한다
      // (원본 컬럼으로 되돌릴 방법이 없음 — Emp No/Name/Dept는 비워두고 비고에 그대로 둔다).
      return [r.serial, r.issued, r.valid, r.status, r.usedDate || '', schema.recordProductLabel(r), r.purpose || '', '', '', '', r.remark || ''];
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hrAoa), 'HR');

    var stamp = schema.todayStr().replace(/-/g, '');
    XLSX.writeFile(wb, 'COMP_Voucher_원본형식_전체_' + stamp + '.xlsx');
    return { FB: fb.length, RM: rm.length, HR: hr.length };
  }

  return { exportFiltered: exportFiltered, exportOriginalFormat: exportOriginalFormat };
})();
