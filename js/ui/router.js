/* CompApp.router — shared cross-view mutable state (scope/sort/paging/filters) + the static-section
   view switcher (index.html already contains all view markup; this just toggles .active + calls
   each view module's render()). Deliberately NOT the certledger inject-into-container pattern —
   kept identical to the original prototype's go()/setScope() to minimize Phase-1 behavioral risk. */
window.CompApp = window.CompApp || {};
CompApp.state = {
  fam: 'ALL', issueFam: 'FB', view: 'list', selectedCat: '',
  sortKey: 'serial', sortDir: 'desc', page: 1, perPage: 15,
  filterProductVal: '', selected: {}, ovState: { start: '', end: '' },
  auditLog: [] // F: global audit log, newest first — populated by voucherWorkflow.js mutations
};

CompApp.router = (function () {
  "use strict";
  var $ = CompApp.ui.$, toast = CompApp.ui.toast;
  var state = CompApp.state;

  function famMatch(r) { return state.fam === 'ALL' || r.fam === state.fam; }
  function famLabel(f) { return f === 'ALL' ? '전체' : (f === 'FB' ? 'F&B' : (f === 'RM' ? 'Room' : 'HR')); }
  function famBadge(f) {
    var cls = f === 'FB' ? 'tb-fb' : (f === 'RM' ? 'tb-rm' : 'tb-hr');
    var lab = f === 'FB' ? 'F&B' : (f === 'RM' ? 'Room' : 'HR');
    return '<span class="tbadge ' + cls + '">' + lab + '</span>';
  }

  function go(v) {
    if (v === 'importexport' && CompApp.operator && !CompApp.operator.isAdmin()) {
      toast('가져오기/내보내기는 관리자만 사용할 수 있습니다.');
      v = 'list';
    }
    state.view = v; state.selected = {};
    document.querySelectorAll('.navitem').forEach(function (n) { n.setAttribute('aria-current', n.dataset.view === v ? 'true' : 'false'); });
    ['overview', 'list', 'issue', 'integrity', 'importexport', 'auditlog'].forEach(function (k) { $('view-' + k).classList.toggle('active', k === v); });
    $('scopeSeg').style.display = (v === 'issue') ? 'none' : '';
    var famN = famLabel(state.fam);
    if (v === 'overview') { $('viewTitle').textContent = famN + ' 개요'; $('viewDesc').textContent = '발행일 기간 기준 집계'; CompApp.viewOverview.render(); }
    else if (v === 'list') { $('viewTitle').textContent = famN + ' 바우처 목록'; $('viewDesc').textContent = '정렬·다중선택·기간·종류 필터 지원'; CompApp.viewList.render(); }
    else if (v === 'issue') { if (state.fam !== 'ALL') state.issueFam = state.fam; $('viewTitle').textContent = '새 바우처 발행'; $('viewDesc').textContent = '타입 선택 후 발행 · GM 승인 시 즉시 활성'; CompApp.viewIssue.render(); }
    else if (v === 'integrity') { $('viewTitle').textContent = famN + ' 정합성 점검'; $('viewDesc').textContent = '데이터 이상 여부 자동 점검'; CompApp.viewIntegrity.render(); }
    else if (v === 'importexport') { $('viewTitle').textContent = '가져오기 / 내보내기'; $('viewDesc').textContent = '엑셀 대장 일괄 등록 · 현재 필터 내보내기'; CompApp.viewImportExport.render(); }
    else if (v === 'auditlog') { $('viewTitle').textContent = '감사 로그'; $('viewDesc').textContent = '전체 바우처에 걸친 작업 이력'; CompApp.viewAuditLog.render(); }
  }

  function setScope(f) {
    state.fam = f;
    document.querySelectorAll('#scopeSeg button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.fam === f ? 'true' : 'false'); });
    renderCounts();
  }

  function renderCounts() {
    var records = CompApp.db.cache.records;
    $('sc-all').textContent = records.length;
    $('sc-fb').textContent = records.filter(function (r) { return r.fam === 'FB'; }).length;
    $('sc-rm').textContent = records.filter(function (r) { return r.fam === 'RM'; }).length;
    $('sc-hr').textContent = records.filter(function (r) { return r.fam === 'HR'; }).length;
    $('nav-list-n').textContent = records.filter(famMatch).length;
    $('nav-appr-n').textContent = records.filter(function (r) { return famMatch(r) && r.status === 'PENDING'; }).length;
    $('nav-integ-n').textContent = CompApp.viewIntegrity.count(famMatch);
  }

  function refresh() {
    if (state.view === 'list') CompApp.viewList.render();
    else if (state.view === 'overview') CompApp.viewOverview.render();
    else if (state.view === 'integrity') CompApp.viewIntegrity.render();
    else if (state.view === 'auditlog') CompApp.viewAuditLog.render();
  }

  // drill-through from overview: set filters then open list
  function resetFilterInputs() { $('filterStatus').value = ''; $('filterCat').value = ''; state.filterProductVal = ''; $('filterText').value = ''; $('filterDateField').value = 'issued'; $('fDateFrom').value = ''; $('fDateTo').value = ''; }
  function goListFiltered(opts) {
    if (opts.fam) setScope(opts.fam);
    resetFilterInputs();
    $('filterStatus').value = opts.status || '';
    $('filterCat').value = opts.cat || '';
    $('filterText').value = opts.text || '';
    state.page = 1; renderCounts(); go('list');
    toast('목록 필터 적용');
  }

  function wireNav() {
    document.querySelectorAll('.navitem').forEach(function (n) {
      n.addEventListener('click', function () {
        if (n.dataset.view === 'approvals') {
          goListFiltered({ status: 'PENDING' });
          document.querySelectorAll('.navitem').forEach(function (x) { x.setAttribute('aria-current', x === n ? 'true' : 'false'); });
          return;
        }
        go(n.dataset.view);
      });
    });
    $('btnGoIssue').addEventListener('click', function () { go('issue'); });
    $('btnCancelIssue').addEventListener('click', function () { go('list'); });
    $('brandHome').addEventListener('click', function () { setScope('ALL'); go('overview'); toast('새로고침 · 개요'); });
    $('btnRefresh').addEventListener('click', function () {
      var b = $('btnRefresh'); b.classList.add('spin'); setTimeout(function () { b.classList.remove('spin'); }, 520);
      // 개요 화면에서는 기간(ovState)도 "이번 달" 기본값으로 되돌려 진짜 새로고침처럼 동작하게 함 —
      // 그냥 refresh()만 하면 이전에 직접 지정한 기간이 그대로 남아 오래된 조회로 보일 수 있음.
      if (state.view === 'overview') state.ovState = { start: '', end: '' };
      renderCounts(); refresh(); toast('새로고침됨');
    });
    $('scopeSeg').addEventListener('click', function (e) { var b = e.target.closest('button[data-fam]'); if (!b) return; setScope(b.dataset.fam); go(state.view); });
  }

  return {
    famMatch: famMatch, famLabel: famLabel, famBadge: famBadge,
    go: go, setScope: setScope, renderCounts: renderCounts, refresh: refresh,
    resetFilterInputs: resetFilterInputs, goListFiltered: goListFiltered, wireNav: wireNav
  };
})();
