/* CompApp.viewIntegrity — D: 데이터 정합성 점검. Pure check function over the records array +
   a simple issues table, jump-to-detail on 증서번호 click. */
window.CompApp = window.CompApp || {};
CompApp.viewIntegrity = (function () {
  "use strict";
  var $ = CompApp.ui.$;
  var schema = CompApp.schema;
  var effStatus = schema.effStatus, esc = schema.esc;

  function records() { return CompApp.db.cache.records; }
  function famMatch(r) { return CompApp.router.famMatch(r); }

  var TYPE_LABEL = { DUP_SERIAL: '증서번호 중복', MISSING_MATE: 'Mate 승인번호 누락', BAD_DATE_RANGE: '만료일<발행일', EXPIRED_STILL_ACTIVE: '만료 미처리' };

  // Pure over the given records array — safe to call from anywhere (badge counts, later phases' tests).
  function runCheck(recs) {
    var issues = [];
    var bySerial = {};
    recs.forEach(function (r) { if (!r.serial) return; (bySerial[r.serial] = bySerial[r.serial] || []).push(r); });
    Object.keys(bySerial).forEach(function (s) {
      var list = bySerial[s];
      if (list.length > 1) list.forEach(function (r) { issues.push({ type: 'DUP_SERIAL', severity: 'high', recordId: r.id, serial: r.serial, message: '증서번호 "' + s + '"가 ' + list.length + '건에서 중복 사용됨' }); });
    });
    function wasImported(r) { return (r.history || []).some(function (h) { return h.action === '가져오기'; }); }
    recs.forEach(function (r) {
      // 가져온 과거 데이터(특히 HR)는 원본 자체에 Mate 승인번호가 없는 경우가 많음 — 앞으로 직접
      // 발행하는 건에 대해서만 이 검사를 적용하고, 이관된 이력은 대상에서 제외.
      if (r.status === 'ACTIVE' && !r.mate && !wasImported(r)) issues.push({ type: 'MISSING_MATE', severity: 'medium', recordId: r.id, serial: r.serial, message: '활성 상태이지만 Mate 승인번호가 없음' });
      if (r.valid && r.issued && r.valid < r.issued) issues.push({ type: 'BAD_DATE_RANGE', severity: 'high', recordId: r.id, serial: r.serial, message: '만료일(' + r.valid + ')이 발행일(' + r.issued + ')보다 빠름' });
      if (effStatus(r) === 'EXPIRED_PENDING') issues.push({ type: 'EXPIRED_STILL_ACTIVE', severity: 'low', recordId: r.id, serial: r.serial, message: '만료일(' + r.valid + ')이 지났지만 상태가 아직 활성 — 만료 처리 필요' });
    });
    return issues;
  }

  function count(famMatchFn) { return runCheck(records().filter(famMatchFn || famMatch)).length; }

  function render() {
    var issues = runCheck(records().filter(famMatch));
    $('integTitle').textContent = '정합성 점검 · ' + issues.length + '건';
    var head = '<thead><tr><th>문제유형</th><th>증서번호</th><th>설명</th></tr></thead>';
    var body = issues.map(function (x) {
      return '<tr><td><span class="badge b-expired">' + (TYPE_LABEL[x.type] || x.type) + '</span></td>'
        + '<td class="serial"><button data-detail="' + x.recordId + '">' + esc(x.serial) + '</button></td>'
        + '<td>' + esc(x.message) + '</td></tr>';
    }).join('');
    $('integTable').innerHTML = head + '<tbody>' + (issues.length ? body : '<tr><td colspan="3"><div class="empty">발견된 문제가 없습니다.</div></td></tr>') + '</tbody>';
  }
  $('integTable').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-detail]'); if (!b) return;
    var r = CompApp.workflow.recById(b.dataset.detail); if (r) CompApp.workflow.showDetail(r);
  });

  return { render: render, runCheck: runCheck, count: count };
})();
