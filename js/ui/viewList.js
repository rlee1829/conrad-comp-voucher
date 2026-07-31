/* CompApp.viewList — 바우처 목록: sort/multi-select/bulk actions/inline filters/pagination.
   Ported verbatim from the prototype. */
window.CompApp = window.CompApp || {};
CompApp.viewList = (function () {
  "use strict";
  var $ = CompApp.ui.$, modal = CompApp.ui.modal, toast = CompApp.ui.toast;
  var schema = CompApp.schema;
  var esc = schema.esc, normDate = schema.normDate, effStatus = schema.effStatus;
  var CAT_LABEL = schema.CAT_LABEL, STATUS_LABEL = schema.STATUS_LABEL, STATUS_CLASS = schema.STATUS_CLASS, CATALOG = schema.CATALOG;
  var prodName = schema.prodName, prodById = schema.prodById, productFam = schema.productFam;
  var state = CompApp.state;
  var role; // read fresh each render via CompApp.operator.getRole()

  function records() { return CompApp.db.cache.records; }
  function famMatch(r) { return CompApp.router.famMatch(r); }
  function famBadge(f) { return CompApp.router.famBadge(f); }

  function filtered() {
    var fs = $('filterStatus').value, fc = $('filterCat').value, ft = $('filterText').value.trim().toLowerCase();
    var iF = normDate($('fIssFrom').value), iT = normDate($('fIssTo').value), vF = normDate($('fValFrom').value), vT = normDate($('fValTo').value);
    var rows = records().filter(function (r) {
      if (!famMatch(r)) return false;
      if (fc && r.cat !== fc) return false;
      if (state.filterProductVal && r.product !== state.filterProductVal) return false;
      if (iF && (r.issued || '') < iF) return false;
      if (iT && (r.issued || '') > iT) return false;
      if (vF && (r.valid || '') < vF) return false;
      if (vT && (r.valid || '') > vT) return false;
      if (fs) {
        if (fs === 'EXPIRED_PENDING') { if (effStatus(r) !== 'EXPIRED_PENDING') return false; }
        else if (fs === 'ACTIVE') { if (effStatus(r) !== 'ACTIVE') return false; }
        else if (fs === 'EXPVOID') { var es = effStatus(r); if (!(es === 'EXPIRED_PENDING' || r.status === 'EXPIRED' || r.status === 'VOID')) return false; }
        else if (r.status !== fs) return false;
      }
      if (ft && (r.serial + ' ' + r.purpose + ' ' + r.req + ' ' + schema.recordProductLabel(r)).toLowerCase().indexOf(ft) < 0) return false;
      return true;
    });
    rows.sort(function (a, b) {
      var av, bv;
      switch (state.sortKey) {
        case 'issued': av = a.issued; bv = b.issued; break;
        case 'valid': av = a.valid; bv = b.valid; break;
        case 'amount': av = a.amount || 0; bv = b.amount || 0; break;
        case 'product': av = schema.recordProductLabel(a); bv = schema.recordProductLabel(b); break;
        case 'status': av = effStatus(a); bv = effStatus(b); break;
        default: av = a.serial; bv = b.serial;
      }
      if (av < bv) return state.sortDir === 'asc' ? -1 : 1;
      if (av > bv) return state.sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return rows;
  }
  function th(key, label, cls) {
    var arr = state.sortKey === key ? '<span class="arr">' + (state.sortDir === 'asc' ? '▲' : '▼') + '</span>' : '';
    return '<th class="sortable' + (cls ? ' ' + cls : '') + '" data-sort="' + key + '">' + label + arr + '</th>';
  }
  function renderChips() {
    var rs = records().filter(famMatch), by = { PENDING: 0, ACTIVE: 0, USED: 0, EXPIRED: 0, VOID: 0, REJECTED: 0 };
    rs.forEach(function (r) { by[r.status]++; });
    var expp = rs.filter(function (r) { return effStatus(r) === 'EXPIRED_PENDING'; }).length;
    var data = [{ k: '총 발행', v: rs.length, f: '' }, { k: '승인대기', v: by.PENDING, f: 'PENDING' }, { k: '활성', v: by.ACTIVE - expp, f: 'ACTIVE' }, { k: '사용', v: by.USED, f: 'USED' }, { k: '반려', v: by.REJECTED, f: 'REJECTED' }, { k: '만료·미처리/취소', v: by.EXPIRED + by.VOID + expp, f: 'EXPVOID' }];
    var cur = $('filterStatus').value;
    $('chips').innerHTML = data.map(function (d) { return '<button type="button" class="mini-chip' + (cur === d.f ? ' active' : '') + '" data-fstat="' + d.f + '"><b>' + d.v + '</b>' + d.k + '</button>'; }).join('');
  }
  function populateProductFilter() {
    var sel = $('filterProduct'); if (!sel) return;
    var fams = state.fam === 'ALL' ? ['FB', 'RM', 'HR'] : [state.fam];
    if (state.filterProductVal && (!prodById(state.filterProductVal) || (state.fam !== 'ALL' && productFam(state.filterProductVal) !== state.fam))) state.filterProductVal = '';
    var html = '<option value="">전체 종류</option>';
    fams.forEach(function (f) { html += '<optgroup label="' + (f === 'FB' ? 'F&B' : (f === 'RM' ? 'Room' : 'HR')) + '">' + CATALOG[f].map(function (p) { return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('') + '</optgroup>'; });
    sel.innerHTML = html; sel.value = state.filterProductVal;
  }
  function render() {
    role = CompApp.operator.getRole();
    renderChips(); populateProductFilter();
    var rows = filtered(), total = rows.length, pages = Math.max(1, Math.ceil(total / state.perPage));
    if (state.page > pages) state.page = pages;
    var slice = rows.slice((state.page - 1) * state.perPage, state.page * state.perPage);
    var allSel = slice.length > 0 && slice.every(function (r) { return state.selected[r.id]; });
    var head = '<thead><tr>'
      + '<th class="chkcol"><input type="checkbox" id="selAll" ' + (allSel ? 'checked' : '') + '></th>'
      + th('serial', '증서번호') + '<th>타입</th>' + th('product', '바우처 종류') + th('issued', '발행일') + th('valid', '만료일') + '<th>사용일</th>'
      + '<th>사유 / 세부목적</th><th>요청자</th><th>Mate 승인</th><th>비고</th>' + th('status', '상태') + '<th></th></tr></thead>';
    var body = slice.map(function (r) {
      var es = effStatus(r), sel = state.selected[r.id];
      var acts = '';
      if (r.status === 'PENDING' && role === 'approver') { acts += '<button class="approve-a" data-act="approve" data-id="' + r.id + '">승인</button>'; acts += '<button class="reject-a" data-act="reject" data-id="' + r.id + '">반려</button>'; }
      if (r.status === 'ACTIVE') acts += '<button data-act="use" data-id="' + r.id + '">사용</button>';
      if (r.status === 'ACTIVE' || r.status === 'EXPIRED') acts += '<button data-act="extend" data-id="' + r.id + '">연장</button>';
      if (r.status === 'PENDING' || r.status === 'ACTIVE') acts += '<button data-act="void" data-id="' + r.id + '">취소</button>';
      acts += '<button data-act="edit" data-id="' + r.id + '">수정</button>';
      acts += '<button data-act="clone" data-id="' + r.id + '">복제</button>';
      var prodLabel = schema.recordProductLabel(r);
      return '<tr class="' + (sel ? 'sel' : '') + '">'
        + '<td class="chkcol"><input type="checkbox" class="rowchk" data-id="' + r.id + '" ' + (sel ? 'checked' : '') + '></td>'
        + '<td class="serial"><button data-act="detail" data-id="' + r.id + '">' + r.serial + '</button></td>'
        + '<td>' + famBadge(r.fam) + '</td>'
        + '<td class="prod" title="' + esc(prodLabel) + '">' + esc(prodLabel) + '</td>'
        + '<td class="date">' + r.issued + '</td><td class="date">' + r.valid + '</td><td class="date">' + (r.usedDate || '—') + '</td>'
        + '<td><span class="cat">' + (CAT_LABEL[r.cat] || r.cat) + '</span><div class="purpose-detail">' + esc(r.purpose) + '</div></td>'
        + '<td class="req-by">' + esc(r.req || '') + '</td>'
        + '<td class="mate-no">' + esc(r.mate || '—') + '</td>'
        + '<td class="remark-cell" title="' + esc(r.remark || '') + '">' + (r.remark ? esc(r.remark) : '—') + '</td>'
        + '<td><span class="badge ' + STATUS_CLASS[es] + '">' + STATUS_LABEL[es] + '</span></td>'
        + '<td><div class="rowact">' + acts + '</div></td></tr>';
    }).join('');
    $('listTable').innerHTML = head + '<tbody>' + (slice.length ? body : '<tr><td colspan="13"><div class="empty">표시할 바우처가 없습니다.</div></td></tr>') + '</tbody>';
    renderBulkbar();
    var pg = $('pager');
    if (total <= state.perPage) { pg.innerHTML = '<span class="pinfo">' + total + '건</span>'; }
    else {
      pg.innerHTML = '<span class="pinfo">' + total + '건 · ' + state.page + '/' + pages + '</span>'
        + '<button id="pgFirst" ' + (state.page === 1 ? 'disabled' : '') + '>«</button><button id="pgPrev" ' + (state.page === 1 ? 'disabled' : '') + '>‹ 이전</button>'
        + '<button id="pgNext" ' + (state.page === pages ? 'disabled' : '') + '>다음 ›</button><button id="pgLast" ' + (state.page === pages ? 'disabled' : '') + '>»</button>';
      $('pgFirst').onclick = function () { state.page = 1; render(); }; $('pgPrev').onclick = function () { state.page--; render(); };
      $('pgNext').onclick = function () { state.page++; render(); }; $('pgLast').onclick = function () { state.page = pages; render(); };
    }
  }
  function renderBulkbar() {
    var ids = Object.keys(state.selected).filter(function (id) { return state.selected[id]; });
    var w = $('bulkbarWrap');
    if (!ids.length) { w.innerHTML = ''; return; }
    w.innerHTML = '<div class="bulkbar"><span class="cntsel">' + ids.length + '건 선택</span>'
      + (role === 'approver' ? '<button data-bulk="approve">승인</button><button data-bulk="reject">반려</button>' : '')
      + '<button data-bulk="use">사용처리</button>'
      + '<button data-bulk="extend">기간연장</button><button data-bulk="void">발행취소</button>'
      + '<button data-bulk="field">일괄입력</button>'
      + (CompApp.operator.isAdmin() ? '<button data-bulk="delete" class="reject-a">삭제</button>' : '')
      + '<button data-bulk="clear">선택해제</button></div>';
  }
  function clearFilters() { CompApp.router.resetFilterInputs(); state.page = 1; render(); }
  $('btnClearFilter').addEventListener('click', clearFilters);

  $('filterStatus').addEventListener('change', function () { state.page = 1; render(); });
  $('filterCat').addEventListener('change', function () { state.page = 1; render(); });
  $('filterProduct').addEventListener('change', function () { state.filterProductVal = this.value; state.page = 1; render(); });
  $('chips').addEventListener('click', function (e) { var c = e.target.closest('.mini-chip'); if (!c) return; $('filterStatus').value = c.dataset.fstat; state.page = 1; render(); });
  ['fIssFrom', 'fIssTo', 'fValFrom', 'fValTo'].forEach(function (id) { $(id).addEventListener('change', function () { state.page = 1; render(); }); });
  $('filterText').addEventListener('input', function () { state.page = 1; render(); });
  $('listTable').addEventListener('click', function (e) {
    var s = e.target.closest('th.sortable');
    if (s) { var k = s.dataset.sort; if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; else { state.sortKey = k; state.sortDir = 'asc'; } render(); return; }
    if (e.target.id === 'selAll') { var rows = filtered().slice((state.page - 1) * state.perPage, state.page * state.perPage); var on = e.target.checked; rows.forEach(function (r) { if (on) state.selected[r.id] = true; else delete state.selected[r.id]; }); render(); return; }
    if (e.target.classList.contains('rowchk')) { var id = e.target.dataset.id; if (e.target.checked) state.selected[id] = true; else delete state.selected[id]; render(); return; }
    var b = e.target.closest('button[data-act]'); if (!b) return; CompApp.workflow.rowAction(b.dataset.act, b.dataset.id);
  });
  $('bulkbarWrap').addEventListener('click', function (e) { var b = e.target.closest('button[data-bulk]'); if (!b) return; CompApp.workflow.bulkAction(b.dataset.bulk); });

  return { render: render, filtered: filtered };
})();
