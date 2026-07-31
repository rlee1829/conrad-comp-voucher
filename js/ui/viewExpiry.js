/* CompApp.viewExpiry — 만료 대기열: ACTIVE vouchers expiring within 30 days (or already past). */
window.CompApp = window.CompApp || {};
CompApp.viewExpiry = (function () {
  "use strict";
  var $ = CompApp.ui.$, toast = CompApp.ui.toast;
  var schema = CompApp.schema;
  var CAT_LABEL = schema.CAT_LABEL, daysUntil = schema.daysUntil;
  var prodName = schema.prodName;

  function records() { return CompApp.db.cache.records; }
  function famMatch(r) { return CompApp.router.famMatch(r); }
  function famBadge(f) { return CompApp.router.famBadge(f); }
  function famLabel(f) { return CompApp.router.famLabel(f); }

  function render() {
    var rows = records().filter(function (r) { return famMatch(r) && r.status === 'ACTIVE' && daysUntil(r.valid) <= 30; }).sort(function (a, b) { return daysUntil(a.valid) - daysUntil(b.valid); });
    $('expTitle').textContent = famLabel(CompApp.state.fam) + ' 만료 대기 · ' + rows.length + '건';
    var head = '<thead><tr><th class="chkcol"><input type="checkbox" id="expSelAll"></th><th>증서번호</th><th>타입</th><th>바우처 종류</th><th>만료일</th><th>D-day</th><th>사유</th><th>상태</th></tr></thead>';
    var body = rows.map(function (r) {
      var d = daysUntil(r.valid); var lbl = d < 0 ? '만료 ' + (-d) + '일 경과' : 'D-' + d; var cls = d < 0 ? 'b-expired' : 'b-active';
      return '<tr><td class="chkcol"><input type="checkbox" class="expchk" data-id="' + r.id + '"></td><td class="serial">' + r.serial + '</td><td>' + famBadge(r.fam) + '</td><td>' + prodName(r.fam, r.product) + '</td><td class="date">' + r.valid + '</td><td><span class="badge ' + cls + '">' + lbl + '</span></td><td><span class="cat">' + (CAT_LABEL[r.cat] || r.cat) + '</span></td><td><span class="badge b-active">활성</span></td></tr>';
    }).join('');
    $('expTable').innerHTML = head + '<tbody>' + (rows.length ? body : '<tr><td colspan="8"><div class="empty">만료 임박 바우처가 없습니다.</div></td></tr>') + '</tbody>';
    var sa = $('expSelAll'); if (sa) sa.addEventListener('change', function () { document.querySelectorAll('.expchk').forEach(function (c) { c.checked = sa.checked; }); });
  }
  $('btnExpireSel').addEventListener('click', function () {
    var ids = Array.prototype.slice.call(document.querySelectorAll('.expchk:checked')).map(function (c) { return c.dataset.id; });
    if (!ids.length) { toast('만료 처리할 항목을 선택하세요.'); return; }
    ids.map(CompApp.workflow.recById).forEach(function (r) { if (r) { r.status = 'EXPIRED'; CompApp.workflow.logHist(r, '만료', '만료 처리 (만료일 ' + r.valid + ')'); } });
    toast(ids.length + '건 만료 처리'); CompApp.router.renderCounts(); render();
  });

  return { render: render };
})();
