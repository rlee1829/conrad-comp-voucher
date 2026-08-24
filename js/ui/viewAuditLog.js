/* CompApp.viewAuditLog — F: 감사 로그. Global, cross-record view of every workflow mutation
   (CompApp.state.auditLog, populated by voucherWorkflow.js's logHist/pushAuditEntry).
   Filter by actor/action/date range, paginate, jump to record detail. */
window.CompApp = window.CompApp || {};
CompApp.viewAuditLog = (function () {
  "use strict";
  var $ = CompApp.ui.$;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };
  var schema = CompApp.schema;
  var esc = schema.esc, normDate = schema.normDate;
  var state = CompApp.state;
  var page = 1, perPage = 30;

  function entries() { return state.auditLog || []; }

  function filtered() {
    var actorText = ($('alFilterActor').value || '').trim().toLowerCase();
    var actionSel = $('alFilterAction').value || '';
    var from = normDate($('alFrom').value), to = normDate($('alTo').value);
    return entries().filter(function (e) {
      if (actorText && (e.actor || '').toLowerCase().indexOf(actorText) < 0) return false;
      if (actionSel && e.action !== actionSel) return false;
      if (from && (e.ts || '') < from) return false;
      if (to && (e.ts || '') > to) return false;
      return true;
    });
  }

  // 같은 배치(batchId)로 기록된 항목(일괄 승인/반려/사용/연장/취소/일괄입력/자동 만료 등)을
  // 감사 로그 화면에서 한 줄로 묶어 보여준다 — batchId가 없는 항목(발행/수정 등 단건 작업,
  // 또는 이 기능 도입 전 기록)은 그대로 개별 줄로 표시.
  function groupEntries(rows) {
    var seen = {}, out = [];
    rows.forEach(function (e) {
      if (e.batchId && seen[e.batchId]) { seen[e.batchId].items.push(e); return; }
      var g = { items: [e] };
      if (e.batchId) seen[e.batchId] = g;
      out.push(g);
    });
    return out;
  }

  function populateActionFilter() {
    var sel = $('alFilterAction'); if (!sel) return;
    var cur = sel.value;
    var seen = {}, actions = [];
    entries().forEach(function (e) { if (e.action && !seen[e.action]) { seen[e.action] = true; actions.push(e.action); } });
    actions.sort();
    sel.innerHTML = '<option value="">' + t('전체 작업') + '</option>' + actions.map(function (a) { return '<option value="' + esc(a) + '">' + esc(t(a)) + '</option>'; }).join('');
    sel.value = actions.indexOf(cur) >= 0 ? cur : '';
  }

  function render() {
    populateActionFilter();
    var groups = groupEntries(filtered());
    var total = groups.length, pages = Math.max(1, Math.ceil(total / perPage));
    if (page > pages) page = pages;
    var slice = groups.slice((page - 1) * perPage, page * perPage);
    $('alTitle').textContent = t('감사 로그') + ' · ' + total + t('건');
    var head = '<thead><tr><th>' + t('시각') + '</th><th>' + t('행위자') + '</th><th>' + t('작업') + '</th><th>' + t('증서번호') + '</th><th>' + t('상세') + '</th></tr></thead>';
    var body = slice.map(function (g) {
      var e = g.items[0], n = g.items.length;
      var detail = n > 1 ? (t('증서번호 ') + esc(e.serial || '') + (CompApp.i18n ? CompApp.i18n.t2(' 외 ' + (n - 1) + '건', ' and ' + (n - 1) + ' more') : ' 외 ' + (n - 1) + '건')) : esc(e.detail || '');
      return '<tr><td class="date">' + esc(e.ts || '') + '</td><td>' + esc(e.actor || '') + '</td><td><span class="cat">' + esc(t(e.action || '')) + '</span></td>'
        + '<td class="serial">' + (e.recordId ? '<button data-detail="' + e.recordId + '">' + esc(e.serial || '') + '</button>' : esc(e.serial || '—')) + '</td>'
        + '<td>' + detail + '</td></tr>';
    }).join('');
    $('alTable').innerHTML = head + '<tbody>' + (slice.length ? body : '<tr><td colspan="5"><div class="empty">' + t('기록이 없습니다.') + '</div></td></tr>') + '</tbody>';
    var pg = $('alPager');
    if (total <= perPage) { pg.innerHTML = '<span class="pinfo">' + total + t('건') + '</span>'; }
    else {
      pg.innerHTML = '<span class="pinfo">' + total + t('건') + ' · ' + page + '/' + pages + '</span>'
        + '<button id="alPgFirst" ' + (page === 1 ? 'disabled' : '') + '>«</button><button id="alPgPrev" ' + (page === 1 ? 'disabled' : '') + '>‹ ' + t('이전') + '</button>'
        + '<button id="alPgNext" ' + (page === pages ? 'disabled' : '') + '>' + t('다음') + ' ›</button><button id="alPgLast" ' + (page === pages ? 'disabled' : '') + '>»</button>';
      $('alPgFirst').onclick = function () { page = 1; render(); }; $('alPgPrev').onclick = function () { page--; render(); };
      $('alPgNext').onclick = function () { page++; render(); }; $('alPgLast').onclick = function () { page = pages; render(); };
    }
  }

  $('alFilterActor').addEventListener('input', function () { page = 1; render(); });
  $('alFilterAction').addEventListener('change', function () { page = 1; render(); });
  ['alFrom', 'alTo'].forEach(function (id) { $(id).addEventListener('change', function () { page = 1; render(); }); });
  $('btnAlClear').addEventListener('click', function () {
    $('alFilterActor').value = ''; $('alFilterAction').value = '';
    CompApp.ui.setDate('alFrom', ''); CompApp.ui.setDate('alTo', ''); page = 1; render();
  });
  $('alTable').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-detail]'); if (!b) return;
    var r = CompApp.workflow.recById(b.dataset.detail); if (r) CompApp.workflow.showDetail(r);
  });

  return { render: render };
})();
