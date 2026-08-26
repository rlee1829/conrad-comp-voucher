/* CompApp.viewList — 바우처 목록: sort/multi-select/bulk actions/inline filters/pagination.
   Ported verbatim from the prototype. */
window.CompApp = window.CompApp || {};
CompApp.viewList = (function () {
  "use strict";
  var $ = CompApp.ui.$, modal = CompApp.ui.modal, toast = CompApp.ui.toast;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };
  var schema = CompApp.schema;
  var esc = schema.esc, normDate = schema.normDate, effStatus = schema.effStatus;
  var CAT_LABEL = schema.CAT_LABEL, STATUS_LABEL = schema.STATUS_LABEL, STATUS_CLASS = schema.STATUS_CLASS, CATALOG = schema.CATALOG;
  var prodName = schema.prodName, prodById = schema.prodById, productFam = schema.productFam;
  var state = CompApp.state;
  var canApprove, canAdmin; // 승인/관리 액션 노출 여부 — 매 render()마다 현재 모드 기준으로 갱신

  function records() { return CompApp.db.cache.records; }
  function famMatch(r) { return CompApp.router.famMatch(r); }
  function famBadge(f) { return CompApp.router.famBadge(f); }

  // 지금 걸려 있는 필터를 사람이 읽을 수 있는 형태로. 목록이 비었을 때 "왜 비었는지" 보여주는 용도.
  function activeFilters() {
    var out = [];
    var fs = $('filterStatus').value, fc = $('filterCat').value, ft = $('filterText').value.trim();
    var dF = normDate($('fDateFrom').value), dT = normDate($('fDateTo').value);
    var dLabel = { issued: t('발행일'), valid: t('만료일'), usedDate: t('사용일') }[$('filterDateField').value] || t('발행일');
    if (fs) out.push(t('상태: ') + schema.statusLabel(fs));
    if (fc) out.push(t('사유: ') + schema.catLabel(fc));
    if (state.filterProductVal) { var p = prodById(state.filterProductVal); out.push(t('종류: ') + ((p && t(p.name)) || state.filterProductVal)); }
    if (state.filterPickup) out.push(t('픽업: ') + (state.filterPickup === 'OPEN' ? t('인쇄대기+픽업대기') : schema.pickupLabel(state.filterPickup)));
    if (dF || dT) out.push(dLabel + ': ' + (dF || '…') + ' ~ ' + (dT || '…'));
    if (ft) out.push(t('검색: ') + ft);
    return out;
  }
  // opts.ignoreStatus — 상태 필터만 빼고 거른다. 미니칩(상태별 건수)이 나머지 필터를 그대로 반영하게
  // 해서, "총 발행" 칩 숫자와 실제 목록 건수가 어긋나 보이지 않도록 하기 위한 것.
  function filtered(opts) {
    opts = opts || {};
    var fs = $('filterStatus').value, fc = $('filterCat').value, ft = $('filterText').value.trim().toLowerCase();
    var dField = $('filterDateField').value, dF = normDate($('fDateFrom').value), dT = normDate($('fDateTo').value);
    var rows = records().filter(function (r) {
      if (!famMatch(r)) return false;
      if (fc && r.cat !== fc) return false;
      if (state.filterProductVal && r.product !== state.filterProductVal) return false;
      if (state.filterPickup) {
        var pk = schema.pickupState(r);
        if (state.filterPickup === 'OPEN' ? (pk !== 'TOPRINT' && pk !== 'TOPICKUP') : pk !== state.filterPickup) return false;
      }
      if (dF || dT) {
        var dv = (dField === 'valid' ? r.valid : dField === 'usedDate' ? r.usedDate : r.issued) || '';
        if (dF && dv < dF) return false;
        if (dT && dv > dT) return false;
      }
      // "전체 상태"(fs가 빈 값)일 때는 승인대기·반려를 목록에서 뺀다 — 이 목록은 발행이 완료된
      // 건(ACTIVE/USED/EXPIRED/VOID)만 다루고, 승인대기는 승인 대기함에서 따로 본다. 미니칩
      // 집계(ignoreStatus)는 그대로 전체를 세서 승인대기·반려 칩 숫자는 계속 정확하게 보여준다.
      if (!opts.ignoreStatus) {
        if (fs) { if (r.status !== fs) return false; }
        else if (r.status === 'PENDING' || r.status === 'REJECTED') return false;
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
    // 상태 필터를 제외한 나머지 필터를 반영한다 — 상태 필터가 없으면 "총 발행" 칩 = 목록 건수.
    var rs = filtered({ ignoreStatus: true }), by = { PENDING: 0, ACTIVE: 0, USED: 0, EXPIRED: 0, VOID: 0, REJECTED: 0 };
    rs.forEach(function (r) { by[r.status]++; });
    var data = [
      { k: t('총 발행'), v: rs.length, f: '' }, { k: t('승인대기'), v: by.PENDING, f: 'PENDING' }, { k: t('ACTIVE'), v: by.ACTIVE, f: 'ACTIVE' },
      { k: t('USED'), v: by.USED, f: 'USED' }, { k: t('반려'), v: by.REJECTED, f: 'REJECTED' }, { k: t('EXPIRED'), v: by.EXPIRED, f: 'EXPIRED' }, { k: t('VOID'), v: by.VOID, f: 'VOID' }
    ];
    var cur = $('filterStatus').value;
    $('chips').innerHTML = data.map(function (d) { return '<button type="button" class="mini-chip' + (cur === d.f ? ' active' : '') + '" data-fstat="' + d.f + '"><b>' + d.v + '</b>' + d.k + '</button>'; }).join('');
  }
  function populateProductFilter() {
    var sel = $('filterProduct'); if (!sel) return;
    var fams = state.fam === 'ALL' ? ['FB', 'RM', 'HR'] : [state.fam];
    if (state.filterProductVal && (!prodById(state.filterProductVal) || (state.fam !== 'ALL' && productFam(state.filterProductVal) !== state.fam))) state.filterProductVal = '';
    var html = '<option value="">' + t('전체 종류') + '</option>';
    fams.forEach(function (f) { html += '<optgroup label="' + (f === 'FB' ? 'F&B' : (f === 'RM' ? 'Room' : 'HR')) + '">' + CATALOG[f].map(function (p) { return '<option value="' + p.id + '">' + t(p.name) + '</option>'; }).join('') + '</optgroup>'; });
    sel.innerHTML = html; sel.value = state.filterProductVal;
  }
  function render() {
    canApprove = CompApp.operator.canApprove(); canAdmin = CompApp.operator.canAdmin();
    populateProductFilter(); renderChips();  // 종류 필터를 먼저 정리해야(타입 전환 시 해제됨) 칩 건수가 맞는다
    var rows = filtered(), total = rows.length, pages = Math.max(1, Math.ceil(total / state.perPage));
    if (state.page > pages) state.page = pages;
    var slice = rows.slice((state.page - 1) * state.perPage, state.page * state.perPage);
    var allSel = slice.length > 0 && slice.every(function (r) { return state.selected[r.id]; });
    var head = '<thead><tr>'
      + '<th class="chkcol"><input type="checkbox" id="selAll" ' + (allSel ? 'checked' : '') + '></th>'
      + th('serial', t('증서번호')) + '<th>' + t('타입') + '</th>' + th('product', t('바우처 종류')) + th('issued', t('발행일')) + th('valid', t('만료일')) + '<th>' + t('사용일') + '</th>' + th('status', t('상태'))
      + '<th>' + t('사유 / 세부목적') + '</th><th>' + t('요청자 항목') + '</th><th>' + t('Mate 승인') + '</th><th>' + t('비고') + '</th><th></th></tr></thead>';
    var body = slice.map(function (r) {
      var es = effStatus(r), sel = state.selected[r.id];
      var acts = '';
      if (r.status === 'PENDING' && canApprove) { acts += '<button class="approve-a" data-act="approve" data-id="' + r.id + '">' + t('승인') + '</button>'; acts += '<button class="reject-a" data-act="reject" data-id="' + r.id + '">' + CompApp.i18n.t2('반려', 'Reject') + '</button>'; }
      // 만료 건도 사용 처리 대상 — 만료일 전에 실제로 사용한 걸 뒤늦게 등록하는 경우가 많다(사용일 검증은 useModal에서).
      if ((r.status === 'ACTIVE' || r.status === 'EXPIRED') && canAdmin) acts += '<button data-act="use" data-id="' + r.id + '">' + CompApp.i18n.t2('사용', 'Use') + '</button>';
      if ((r.status === 'ACTIVE' || r.status === 'EXPIRED') && canApprove) acts += '<button data-act="extend" data-id="' + r.id + '">' + t('연장') + '</button>';
      if ((r.status === 'PENDING' || r.status === 'ACTIVE') && canAdmin) acts += '<button data-act="void" data-id="' + r.id + '">' + t('취소') + '</button>';
      acts += '<button data-act="edit" data-id="' + r.id + '">' + t('수정') + '</button>';
      var prodLabel = schema.recordProductLabel(r);
      return '<tr class="' + (sel ? 'sel' : '') + '">'
        + '<td class="chkcol"><input type="checkbox" class="rowchk" data-id="' + r.id + '" ' + (sel ? 'checked' : '') + '></td>'
        + '<td class="serial"><button data-act="detail" data-id="' + r.id + '">' + r.serial + '</button></td>'
        + '<td>' + famBadge(r.fam) + '</td>'
        + '<td class="prod" title="' + esc(prodLabel) + '">' + esc(prodLabel) + '</td>'
        + '<td class="date">' + r.issued + '</td><td class="date">' + r.valid + '</td><td class="date">' + (r.usedDate || '—') + '</td>'
        + '<td><span class="badge ' + STATUS_CLASS[es] + '">' + schema.statusLabel(es) + '</span></td>'
        + '<td class="cat-purpose" title="' + esc(schema.catLabel(r.cat) + ' — ' + (r.purpose || '')) + '"><span class="cat">' + schema.catLabel(r.cat) + '</span> <span class="purpose-inline">' + esc(r.purpose) + '</span></td>'
        + '<td class="req-by">' + esc(r.req || '') + '</td>'
        + '<td class="mate-no">' + esc(r.mate || '—') + '</td>'
        + '<td class="remark-cell" title="' + esc(schema.displayRemark(r.remark)) + '">' + (schema.displayRemark(r.remark) ? esc(schema.displayRemark(r.remark)) : '—') + '</td>'
        + '<td><div class="rowact">' + acts + '</div></td></tr>';
    }).join('');
    // 비었을 때는 "왜" 비었는지까지 보여준다 — 필터가 걸려 있으면 그 조건과 해제 버튼을 함께.
    var af = activeFilters();
    var emptyHtml = af.length
      ? '<div class="empty">' + t('필터 조건에 맞는 바우처가 없습니다.') + '<div class="empty-filters">' + t('적용 중: ') + esc(af.join(' · ')) + ' <span class="dim">(' + CompApp.router.famLabel(state.fam) + ' ' + t('전체 ') + records().filter(famMatch).length + t('건') + ')</span></div><button type="button" class="btn btn-ghost btn-sm" id="emptyClearFilter">' + t('필터 해제') + '</button></div>'
      : '<div class="empty">' + t('표시할 바우처가 없습니다.') + '</div>';
    $('listTable').innerHTML = head + '<tbody>' + (slice.length ? body : '<tr><td colspan="13">' + emptyHtml + '</td></tr>') + '</tbody>';
    var ecf = $('emptyClearFilter'); if (ecf) ecf.addEventListener('click', clearFilters);
    var cf = $('btnClearFilter');
    cf.textContent = af.length ? t('필터 해제') + ' (' + af.length + ')' : t('필터 해제');
    cf.classList.toggle('filter-on', af.length > 0);
    cf.title = af.length ? t('적용 중: ') + af.join(' · ') : '';
    renderBulkbar();
    var pg = $('pager');
    if (total <= state.perPage) { pg.innerHTML = '<span class="pinfo">' + total + t('건') + '</span>'; }
    else {
      pg.innerHTML = '<span class="pinfo">' + total + t('건') + '</span>'
        + '<button id="pgFirst" ' + (state.page === 1 ? 'disabled' : '') + '>«</button><button id="pgPrev" ' + (state.page === 1 ? 'disabled' : '') + '>‹ ' + t('이전') + '</button>'
        + '<span class="pg-jump-wrap"><input type="number" id="pgJump" class="pg-jump" min="1" max="' + pages + '" value="' + state.page + '"> / ' + pages + '</span>'
        + '<button id="pgNext" ' + (state.page === pages ? 'disabled' : '') + '>' + t('다음') + ' ›</button><button id="pgLast" ' + (state.page === pages ? 'disabled' : '') + '>»</button>';
      $('pgFirst').onclick = function () { state.page = 1; render(); }; $('pgPrev').onclick = function () { state.page--; render(); };
      $('pgNext').onclick = function () { state.page++; render(); }; $('pgLast').onclick = function () { state.page = pages; render(); };
      var jumpEl = $('pgJump');
      function doJump() {
        var v = parseInt(jumpEl.value, 10);
        if (isNaN(v)) { jumpEl.value = state.page; return; }
        v = Math.max(1, Math.min(pages, v));
        if (v !== state.page) { state.page = v; render(); } else { jumpEl.value = state.page; }
      }
      jumpEl.addEventListener('change', doJump);
      jumpEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJump(); });
    }
  }
  function renderBulkbar() {
    var ids = Object.keys(state.selected).filter(function (id) { return state.selected[id]; });
    var w = $('bulkbarWrap');
    if (!ids.length) { w.innerHTML = ''; return; }
    w.innerHTML = '<div class="bulkbar"><span class="cntsel">' + ids.length + t('건 선택') + '</span>'
      + (canApprove ? '<button data-bulk="approve">' + t('승인') + '</button><button data-bulk="reject">' + CompApp.i18n.t2('반려', 'Reject') + '</button>' : '')
      + (canAdmin ? '<button data-bulk="use">' + t('사용처리') + '</button>' : '')
      + (canApprove ? '<button data-bulk="extend">' + t('기간연장') + '</button>' : '')
      + (canAdmin ? '<button data-bulk="void">' + t('발행취소') + '</button>' : '')
      + (canApprove ? '<button data-bulk="printed">' + t('인쇄완료') + '</button><button data-bulk="notify">' + t('픽업 알림') + '</button><button data-bulk="pickedup">' + t('픽업완료') + '</button>' : '')
      + '<button data-bulk="field">' + t('일괄입력') + '</button>'
      + (canAdmin ? '<button data-bulk="delete" class="reject-a">' + t('삭제') + '</button>' : '')
      + '<button data-bulk="clear">' + t('선택해제') + '</button></div>';
  }
  function clearFilters() { CompApp.router.resetFilterInputs(); state.page = 1; render(); }
  $('btnClearFilter').addEventListener('click', clearFilters);

  $('filterStatus').addEventListener('change', function () { state.page = 1; render(); });
  $('filterCat').addEventListener('change', function () { state.page = 1; render(); });
  $('filterProduct').addEventListener('change', function () { state.filterProductVal = this.value; state.page = 1; render(); });
  $('filterPickup').addEventListener('change', function () { state.filterPickup = this.value; state.page = 1; render(); });
  $('chips').addEventListener('click', function (e) { var c = e.target.closest('.mini-chip'); if (!c) return; $('filterStatus').value = c.dataset.fstat; state.page = 1; render(); });
  $('filterDateField').addEventListener('change', function () { state.page = 1; render(); });
  ['fDateFrom', 'fDateTo'].forEach(function (id) { $(id).addEventListener('change', function () { state.page = 1; render(); }); });
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
