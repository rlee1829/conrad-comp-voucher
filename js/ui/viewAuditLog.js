/* CompApp.viewAuditLog — F: 감사 로그. Global, cross-record view of every workflow mutation
   (CompApp.state.auditLog, populated by voucherWorkflow.js's logHist/pushAuditEntry).
   Filter by actor/action/date range, paginate, jump to record detail. */
window.CompApp = window.CompApp || {};
CompApp.viewAuditLog = (function () {
  "use strict";
  var $ = CompApp.ui.$;
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

  function populateActionFilter() {
    var sel = $('alFilterAction'); if (!sel) return;
    var cur = sel.value;
    var seen = {}, actions = [];
    entries().forEach(function (e) { if (e.action && !seen[e.action]) { seen[e.action] = true; actions.push(e.action); } });
    actions.sort();
    sel.innerHTML = '<option value="">전체 작업</option>' + actions.map(function (a) { return '<option value="' + esc(a) + '">' + esc(a) + '</option>'; }).join('');
    sel.value = actions.indexOf(cur) >= 0 ? cur : '';
  }

  function render() {
    populateActionFilter();
    var rows = filtered();
    var total = rows.length, pages = Math.max(1, Math.ceil(total / perPage));
    if (page > pages) page = pages;
    var slice = rows.slice((page - 1) * perPage, page * perPage);
    $('alTitle').textContent = '감사 로그 · ' + total + '건';
    var head = '<thead><tr><th>시각</th><th>행위자</th><th>작업</th><th>증서번호</th><th>상세</th></tr></thead>';
    var body = slice.map(function (e) {
      return '<tr><td class="date">' + esc(e.ts || '') + '</td><td>' + esc(e.actor || '') + '</td><td><span class="cat">' + esc(e.action || '') + '</span></td>'
        + '<td class="serial">' + (e.recordId ? '<button data-detail="' + e.recordId + '">' + esc(e.serial || '') + '</button>' : esc(e.serial || '—')) + '</td>'
        + '<td>' + esc(e.detail || '') + '</td></tr>';
    }).join('');
    $('alTable').innerHTML = head + '<tbody>' + (slice.length ? body : '<tr><td colspan="5"><div class="empty">기록이 없습니다.</div></td></tr>') + '</tbody>';
    var pg = $('alPager');
    if (total <= perPage) { pg.innerHTML = '<span class="pinfo">' + total + '건</span>'; }
    else {
      pg.innerHTML = '<span class="pinfo">' + total + '건 · ' + page + '/' + pages + '</span>'
        + '<button id="alPgFirst" ' + (page === 1 ? 'disabled' : '') + '>«</button><button id="alPgPrev" ' + (page === 1 ? 'disabled' : '') + '>‹ 이전</button>'
        + '<button id="alPgNext" ' + (page === pages ? 'disabled' : '') + '>다음 ›</button><button id="alPgLast" ' + (page === pages ? 'disabled' : '') + '>»</button>';
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
