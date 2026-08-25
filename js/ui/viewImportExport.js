/* CompApp.viewImportExport — E: 가져오기/내보내기. File picker -> importPipeline, summary shown
   inline; 내보내기 exports the currently-active list filter via exportWorkbook.
   이 파이프라인엔 "갱신" 모드가 없다 — 매번 파일의 모든 행을 새 id로 등록한다(기존 레코드를
   덮어쓰지 않음). 그래서 이미 등록된 증서번호가 섞인 파일을 다시 올리면 전부 중복 생성된다
   (2026-08-25 실사고: 882쌍/1,764건 중복 발생). doImport()가 실제로 쓰기 전에 겹치는 증서번호
   수를 미리 세어 확인 모달을 띄우고, 실행 시 감사 로그에 실제 담당자·시각으로 기록을 남긴다
   (기존엔 가져오기가 감사 로그에 전혀 안 남아서, 이 사고를 누가 언제 일으켰는지 추적이 불가능했음). */
window.CompApp = window.CompApp || {};
CompApp.viewImportExport = (function () {
  "use strict";
  var $ = CompApp.ui.$, modal = CompApp.ui.modal, toast = CompApp.ui.toast;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };
  var t2 = function (ko, en) { return CompApp.i18n ? CompApp.i18n.t2(ko, en) : ko; };

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

  function runImport(file, dupCount) {
    var btn = $('btnDoImport'); btn.disabled = true; btn.textContent = t('가져오는 중…');
    CompApp.importPipeline.importFile(file).then(function (res) {
      btn.disabled = false; btn.textContent = t('가져오기');
      $('ieFile').value = '';
      renderSummary(res);
      toast(res.rowsImported + t('건 가져오기 완료'));
      CompApp.router.renderCounts(); CompApp.router.refresh();
      // 실제 담당자·시각으로 감사 로그에 남긴다 — 레코드별 history의 "가져오기" 항목은 원본
      // 발행일을 ts로 쓰기 때문에(그 증서 자체의 이야기용) 언제·누가 이 실행을 눌렀는지는
      // 여기 남기지 않으면 어디에도 기록되지 않는다.
      if (CompApp.workflow && CompApp.workflow.pushAuditEntry) {
        CompApp.workflow.pushAuditEntry({
          action: '가져오기 실행',
          detail: file.name + ' · ' + res.rowsImported + '건 (F&B ' + (res.byFamily.FB || 0) + ' · Room ' + (res.byFamily.RM || 0) + ' · HR ' + (res.byFamily.HR || 0) + ')'
            + (dupCount ? ' · 기존 증서번호와 겹침 ' + dupCount + '건 (경고 확인 후 진행)' : ''),
          batchId: CompApp.schema.uid()
        });
      }
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = t('가져오기');
      toast(t('가져오기 실패: ') + (e && e.message ? e.message : e));
      console.error(e);
    });
  }

  function doImport() {
    var input = $('ieFile');
    if (!input.files || !input.files[0]) { toast(t('가져올 파일을 선택하세요.')); return; }
    var file = input.files[0];
    var btn = $('btnDoImport'); btn.disabled = true; btn.textContent = t('확인 중…');
    CompApp.importPipeline.previewSerials(file).then(function (serials) {
      var existing = {}; CompApp.db.cache.records.forEach(function (r) { existing[r.serial] = true; });
      var dupCount = serials.filter(function (s) { return existing[s]; }).length;
      btn.disabled = false; btn.textContent = t('가져오기');
      if (!dupCount) { runImport(file, 0); return; }
      modal({
        title: t('이미 등록된 증서번호가 있습니다'),
        sub: t('이 파일의 증서번호 중 ') + dupCount + t('건이 이미 목록에 있습니다. 이 기능은 갱신이 아니라 매번 새로 등록하는 방식이라, 그대로 진행하면 그 ') + dupCount + t('건이 전부 중복으로 다시 생깁니다.'),
        bodyHtml: '<div style="font-size:13px;color:var(--ink-2)">' + t('요청자·비고 등 일부만 고친 파일이라면, 가져오기 대신 목록에서 해당 건을 직접 [수정]하는 것을 권장합니다.') + '</div>',
        buttons: [
          { label: t2('취소', 'Cancel') },
          { label: t('그래도 가져오기'), cls: 'btn-danger', onClick: function () { runImport(file, dupCount); } }
        ]
      });
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
