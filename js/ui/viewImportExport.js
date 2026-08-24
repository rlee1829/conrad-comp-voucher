/* CompApp.viewImportExport — E: 가져오기/내보내기. File picker -> importPipeline, summary shown
   inline; 내보내기 exports the currently-active list filter via exportWorkbook. */
window.CompApp = window.CompApp || {};
CompApp.viewImportExport = (function () {
  "use strict";
  var $ = CompApp.ui.$, toast = CompApp.ui.toast;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };

  function renderSummary(res) {
    var box = $('ieSummary'); if (!box) return;
    if (!res) { box.innerHTML = ''; return; }
    var byFam = res.byFamily || {};
    var html = '<div class="ie-result">'
      + '<div><b>' + res.rowsRead + '</b>' + t('행 읽음 · ') + '<b>' + res.rowsImported + '</b>' + t('건 가져오기 완료') + ' (F&B ' + (byFam.FB || 0) + ' · Room ' + (byFam.RM || 0) + ' · HR ' + (byFam.HR || 0) + ')</div>'
      + (res.rowsFlagged ? '<div style="color:var(--warn)">⚠ ' + res.rowsFlagged + t('건은 검토가 필요합니다 (비고란에 표시됨 · 아래 목록에서 확인 가능)') + '</div>' : '<div style="color:var(--ok)">' + t('검토 필요 항목 없음') + '</div>')
      + '</div>';
    if (res.warnings && res.warnings.length) {
      html += '<div class="hist"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);margin-bottom:6px">' + t('검토 필요 상세 (최대 30건 표시)') + '</div>'
        + res.warnings.slice(0, 30).map(function (w) { return '<div class="hitem">' + CompApp.schema.esc(w) + '</div>'; }).join('') + '</div>';
    }
    box.innerHTML = html;
  }

  function doImport() {
    var input = $('ieFile');
    if (!input.files || !input.files[0]) { toast(t('가져올 파일을 선택하세요.')); return; }
    var btn = $('btnDoImport'); btn.disabled = true; btn.textContent = t('가져오는 중…');
    CompApp.importPipeline.importFile(input.files[0]).then(function (res) {
      btn.disabled = false; btn.textContent = t('가져오기');
      input.value = '';
      renderSummary(res);
      toast(res.rowsImported + t('건 가져오기 완료'));
      CompApp.router.renderCounts(); CompApp.router.refresh();
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = t('가져오기');
      toast(t('가져오기 실패: ') + (e && e.message ? e.message : e));
      console.error(e);
    });
  }

  function doExport() {
    var n = CompApp.exportWorkbook.exportFiltered();
    toast(n + t('건 내보내기 완료 (현재 필터 기준)'));
  }

  function render() { renderSummary(null); }

  $('btnDoImport').addEventListener('click', doImport);
  $('btnDoExport').addEventListener('click', doExport);

  return { render: render };
})();
