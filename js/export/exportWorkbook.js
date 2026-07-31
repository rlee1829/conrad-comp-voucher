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

  return { exportFiltered: exportFiltered };
})();
