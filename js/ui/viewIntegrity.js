/* CompApp.viewIntegrity — D: 데이터 정합성 점검. Pure check function over the records array +
   a simple issues table, jump-to-detail on 증서번호 click. CAT_UNCERTAIN rows (가져오기 시 사유
   카테고리 자동추정) get their own checkbox + [확인] action — reviewing and confirming one clears
   its review marker so it drops out of this list next render. Selection is local to this view
   (separate from the voucher list's state.selected). */
window.CompApp = window.CompApp || {};
CompApp.viewIntegrity = (function () {
  "use strict";
  var $ = CompApp.ui.$, toast = CompApp.ui.toast;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };
  var schema = CompApp.schema;
  var effStatus = schema.effStatus, esc = schema.esc;
  var selected = {}; // recordId -> true, CAT_UNCERTAIN rows only

  function records() { return CompApp.db.cache.records; }
  function famMatch(r) { return CompApp.router.famMatch(r); }

  var TYPE_LABEL = { DUP_SERIAL: '증서번호 중복', MISSING_MATE: 'Mate 승인번호 누락', BAD_DATE_RANGE: '만료일<발행일', EXPIRED_STILL_ACTIVE: '만료 미처리', CAT_UNCERTAIN: '사유 카테고리 미확인' };
  var CAT_REVIEW_REASON = '사유 카테고리 자동추정 불확실';

  // Pure over the given records array — safe to call from anywhere (badge counts, later phases' tests).
  // Issue messages are composed at check-time (not translated later), so t() runs inline here.
  function runCheck(recs) {
    var issues = [];
    var bySerial = {};
    recs.forEach(function (r) { if (!r.serial) return; (bySerial[r.serial] = bySerial[r.serial] || []).push(r); });
    Object.keys(bySerial).forEach(function (s) {
      var list = bySerial[s];
      if (list.length > 1) list.forEach(function (r) { issues.push({ type: 'DUP_SERIAL', severity: 'high', recordId: r.id, serial: r.serial, message: t('증서번호 "') + s + t('"가 ') + list.length + t('건에서 중복 사용됨') }); });
    });
    function wasImported(r) { return (r.history || []).some(function (h) { return h.action === '가져오기'; }); }
    recs.forEach(function (r) {
      // 가져온 과거 데이터(특히 HR)는 원본 자체에 Mate 승인번호가 없는 경우가 많음 — 앞으로 직접
      // 발행하는 건에 대해서만 이 검사를 적용하고, 이관된 이력은 대상에서 제외.
      if (r.status === 'ACTIVE' && !r.mate && !wasImported(r)) issues.push({ type: 'MISSING_MATE', severity: 'medium', recordId: r.id, serial: r.serial, message: t('활성 상태이지만 Mate 승인번호가 없음') });
      if (r.valid && r.issued && r.valid < r.issued) issues.push({ type: 'BAD_DATE_RANGE', severity: 'high', recordId: r.id, serial: r.serial, message: t('만료일(') + r.valid + t(')이 발행일(') + r.issued + t(')보다 빠름') });
      if (effStatus(r) === 'EXPIRED_PENDING') issues.push({ type: 'EXPIRED_STILL_ACTIVE', severity: 'low', recordId: r.id, serial: r.serial, message: t('만료일(') + r.valid + t(')이 지났지만 상태가 아직 활성 — 만료 처리 필요') });
      if (r.remark && r.remark.indexOf(CAT_REVIEW_REASON) >= 0) issues.push({ type: 'CAT_UNCERTAIN', severity: 'low', recordId: r.id, serial: r.serial, message: t('가져오기 시 사유 카테고리를 자동추정함 — 실제 사유가 맞는지 확인 필요') });
    });
    return issues;
  }

  function count(famMatchFn) { return runCheck(records().filter(famMatchFn || famMatch)).length; }

  function render() {
    var issues = runCheck(records().filter(famMatch));
    // stale selections (row no longer in the list, e.g. already confirmed) don't linger
    var stillThere = {}; issues.forEach(function (x) { if (x.type === 'CAT_UNCERTAIN') stillThere[x.recordId] = true; });
    Object.keys(selected).forEach(function (id) { if (!stillThere[id]) delete selected[id]; });

    $('integTitle').textContent = t('정합성 점검') + ' · ' + issues.length + t('건');
    var head = '<thead><tr><th class="chkcol"></th><th>' + t('문제유형') + '</th><th>' + t('증서번호') + '</th><th>' + t('설명') + '</th><th></th></tr></thead>';
    var body = issues.map(function (x) {
      var isCat = x.type === 'CAT_UNCERTAIN';
      var chk = isCat ? '<input type="checkbox" class="rowchk" data-id="' + x.recordId + '" ' + (selected[x.recordId] ? 'checked' : '') + '>' : '';
      var act = isCat ? '<button data-confirm="' + x.recordId + '">' + t('확인') + '</button>' : '';
      return '<tr><td class="chkcol">' + chk + '</td><td><span class="badge b-expired">' + t(TYPE_LABEL[x.type] || x.type) + '</span></td>'
        + '<td class="serial"><button data-detail="' + x.recordId + '">' + esc(x.serial) + '</button></td>'
        + '<td>' + esc(x.message) + '</td>'
        + '<td><div class="rowact">' + act + '</div></td></tr>';
    }).join('');
    $('integTable').innerHTML = head + '<tbody>' + (issues.length ? body : '<tr><td colspan="5"><div class="empty">' + t('발견된 문제가 없습니다.') + '</div></td></tr>') + '</tbody>';
    renderBulkbar();
  }

  function renderBulkbar() {
    var ids = Object.keys(selected).filter(function (id) { return selected[id]; });
    var w = $('integBulkbarWrap');
    if (!w) return;
    if (!ids.length) { w.innerHTML = ''; return; }
    w.innerHTML = '<div class="bulkbar"><span class="cntsel">' + ids.length + t('건 선택') + '</span>'
      + '<button data-bulkconfirm="1">' + t('선택 확인') + '</button>'
      + '<button data-bulkclear="1">' + t('선택해제') + '</button></div>';
  }

  $('integTable').addEventListener('click', function (e) {
    if (e.target.classList.contains('rowchk')) {
      var id = e.target.dataset.id;
      if (e.target.checked) selected[id] = true; else delete selected[id];
      renderBulkbar();
      return;
    }
    var cf = e.target.closest('button[data-confirm]');
    if (cf) { var r = CompApp.workflow.recById(cf.dataset.confirm); if (r) CompApp.workflow.confirmCatReviewModal([r]); return; }
    var b = e.target.closest('button[data-detail]');
    if (b) { var rec = CompApp.workflow.recById(b.dataset.detail); if (rec) CompApp.workflow.showDetail(rec); }
  });

  $('integBulkbarWrap') && $('integBulkbarWrap').addEventListener('click', function (e) {
    if (e.target.closest('button[data-bulkclear]')) { selected = {}; renderBulkbar(); render(); return; }
    var bc = e.target.closest('button[data-bulkconfirm]');
    if (bc) {
      var ids = Object.keys(selected).filter(function (id) { return selected[id]; });
      var list = ids.map(function (id) { return CompApp.workflow.recById(id); }).filter(Boolean);
      if (!list.length) { toast(t('선택된 항목이 없습니다.')); return; }
      CompApp.workflow.confirmCatReviewModal(list);
      selected = {};
    }
  });

  return { render: render, runCheck: runCheck, count: count };
})();
