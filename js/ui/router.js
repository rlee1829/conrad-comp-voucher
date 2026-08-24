/* CompApp.router — shared cross-view mutable state (scope/sort/paging/filters) + the static-section
   view switcher (index.html already contains all view markup; this just toggles .active + calls
   each view module's render()). Deliberately NOT the certledger inject-into-container pattern —
   kept identical to the original prototype's go()/setScope() to minimize Phase-1 behavioral risk. */
window.CompApp = window.CompApp || {};
CompApp.state = {
  fam: 'ALL', issueFam: 'FB', view: 'list', selectedCat: '',
  sortKey: 'serial', sortDir: 'desc', page: 1, perPage: 20,
  filterProductVal: '', selected: {}, ovState: { start: '', end: '' },
  filterPickup: '', // '' | TOPRINT | TOPICKUP | PICKED — 픽업 흐름 필터(상태 필터와 별개 축)
  listOpts: null,   // 지금 목록 화면이 어느 대기함으로 열린 것인지(goListFiltered 인자). 평범한 목록이면 null

  auditLog: [] // F: global audit log, newest first — populated by voucherWorkflow.js mutations
};

CompApp.router = (function () {
  "use strict";
  var $ = CompApp.ui.$, toast = CompApp.ui.toast;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };
  var state = CompApp.state;

  function famMatch(r) { return state.fam === 'ALL' || r.fam === state.fam; }
  function famLabel(f) { return f === 'ALL' ? t('전체') : (f === 'FB' ? 'F&B' : (f === 'RM' ? 'Room' : 'HR')); }
  function famBadge(f) {
    var cls = f === 'FB' ? 'tb-fb' : (f === 'RM' ? 'tb-rm' : 'tb-hr');
    var lab = f === 'FB' ? 'F&B' : (f === 'RM' ? 'Room' : 'HR');
    return '<span class="tbadge ' + cls + '">' + lab + '</span>';
  }

  // Title/desc are also recomputed standalone (no navigation) when the language toggles, so the
  // current screen's header updates without re-navigating or losing form state.
  function renderTitle() {
    var famN = famLabel(state.fam), v = state.view;
    if (v === 'list' && state.listOpts && state.listOpts.title) {
      $('viewTitle').textContent = famN + ' ' + t(state.listOpts.title);
      $('viewDesc').textContent = t(state.listOpts.desc || '');
      return;
    }
    if (v === 'overview') { $('viewTitle').textContent = famN + ' ' + t('개요'); $('viewDesc').textContent = t('발행일 기간 기준 집계'); }
    else if (v === 'list') { $('viewTitle').textContent = famN + ' ' + t('바우처 목록'); $('viewDesc').textContent = t('정렬·다중선택·기간·종류 필터 지원'); }
    else if (v === 'issue') { $('viewTitle').textContent = t('새 바우처 발행'); $('viewDesc').textContent = t('타입 선택 후 발행 · GM 승인 시 즉시 활성'); }
    else if (v === 'integrity') { $('viewTitle').textContent = famN + ' ' + t('정합성 점검'); $('viewDesc').textContent = t('데이터 이상 여부 자동 점검'); }
    else if (v === 'importexport') { $('viewTitle').textContent = t('가져오기 / 내보내기'); $('viewDesc').textContent = t('엑셀 대장 일괄 등록 · 현재 필터 내보내기'); }
    else if (v === 'auditlog') { $('viewTitle').textContent = t('감사 로그'); $('viewDesc').textContent = t('전체 바우처에 걸친 작업 이력'); }
  }
  function go(v) {
    if (v === 'importexport' && CompApp.operator && !CompApp.operator.isAdmin()) {
      toast(t('가져오기/내보내기는 관리자만 사용할 수 있습니다.'));
      v = 'list';
    }
    // 목록 화면에 "그냥" 들어오면 대기함 맥락은 사라진다. 대기함으로 들어오는 goListFiltered는
    // go('list') 이후에 다시 맥락을 세우므로, 여기서 지우는 게 모든 경로에 일관되게 먹는다.
    if (v === 'list') state.listOpts = null;
    state.view = v; state.selected = {};
    document.querySelectorAll('.navitem').forEach(function (n) { n.setAttribute('aria-current', n.dataset.view === v ? 'true' : 'false'); });
    ['overview', 'list', 'issue', 'integrity', 'importexport', 'auditlog'].forEach(function (k) { $('view-' + k).classList.toggle('active', k === v); });
    $('scopeSeg').style.display = (v === 'issue') ? 'none' : '';
    if (v === 'issue' && state.fam !== 'ALL') state.issueFam = state.fam;
    renderTitle();
    if (v === 'overview') CompApp.viewOverview.render();
    else if (v === 'list') CompApp.viewList.render();
    else if (v === 'issue') CompApp.viewIssue.render();
    else if (v === 'integrity') CompApp.viewIntegrity.render();
    else if (v === 'importexport') CompApp.viewImportExport.render();
    else if (v === 'auditlog') CompApp.viewAuditLog.render();
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
    $('nav-pickup-n').textContent = records.filter(function (r) {
      if (!famMatch(r)) return false;
      var p = CompApp.schema.pickupState(r);
      return p === 'TOPRINT' || p === 'TOPICKUP';
    }).length;
    $('nav-integ-n').textContent = CompApp.viewIntegrity.count(famMatch);
  }

  function refresh() {
    if (state.view === 'list') CompApp.viewList.render();
    else if (state.view === 'overview') CompApp.viewOverview.render();
    else if (state.view === 'integrity') CompApp.viewIntegrity.render();
    else if (state.view === 'auditlog') CompApp.viewAuditLog.render();
  }

  // drill-through from overview: set filters then open list
  function resetFilterInputs() { $('filterStatus').value = ''; $('filterCat').value = ''; state.filterProductVal = ''; $('filterText').value = ''; $('filterDateField').value = 'issued'; $('fDateFrom').value = ''; $('fDateTo').value = ''; state.filterPickup = ''; $('filterPickup').value = ''; }
  function goListFiltered(opts) {
    if (opts.fam) setScope(opts.fam);
    resetFilterInputs();
    state.filterPickup = opts.pickup || '';
    $('filterPickup').value = state.filterPickup;
    $('filterStatus').value = opts.status || '';
    $('filterCat').value = opts.cat || '';
    $('filterText').value = opts.text || '';
    state.page = 1; renderCounts(); go('list');
    // 목록으로 열되 사이드바에서는 눌린 메뉴(예: 승인 대기함)를 현재 위치로 표시하고,
    // 제목도 그 대기함 이름으로 바꾼다 — 같은 목록 화면이지만 어디에 있는지 헷갈리지 않도록.
    if (opts.nav) document.querySelectorAll('.navitem').forEach(function (x) { x.setAttribute('aria-current', x.dataset.view === opts.nav ? 'true' : 'false'); });
    if (opts.title) { $('viewTitle').textContent = famLabel(state.fam) + ' ' + t(opts.title); $('viewDesc').textContent = t(opts.desc || ''); }
    if (opts.nav) state.listOpts = opts;   // 타입 탭을 바꿔도 이 대기함에 그대로 머무르도록 기억
    if (!opts.silent) toast(t('목록 필터 적용'));
  }

  function wireNav() {
    document.querySelectorAll('.navitem').forEach(function (n) {
      n.addEventListener('click', function () {
        // 세 메뉴가 같은 목록 화면을 쓰되 각자의 필터를 갖는다 — 대기함에 걸린 필터가 목록으로
        // 따라오지 않도록, 어느 쪽으로 이동하든 진입 시점에 필터를 자기 것으로 다시 세팅한다.
        if (n.dataset.view === 'approvals') { goListFiltered({ status: 'PENDING', nav: 'approvals', silent: true, title: '승인 대기함', desc: 'Mate 승인번호 확인 후 승인 · 번호가 없으면 대기 유지' }); return; }
        // 픽업 대기함 = 인쇄대기 + 픽업대기(아직 요청자 손에 안 넘어간 건). title/desc는 goListFiltered
        // 안에서 t()로 번역되므로, 여기 리터럴은 원문 그대로 두고 그 자체를 사전 키로 쓴다.
        if (n.dataset.view === 'pickup') { goListFiltered({ pickup: 'OPEN', nav: 'pickup', silent: true, title: '픽업 대기함', desc: '인쇄완료 표시 → 요청자 알림 → 픽업완료' }); return; }
        if (n.dataset.view === 'list') { resetFilterInputs(); state.page = 1; go('list'); return; }
        go(n.dataset.view);
      });
    });
    $('btnGoIssue').addEventListener('click', function () { go('issue'); });
    $('btnCancelIssue').addEventListener('click', function () { go('list'); });
    $('brandHome').addEventListener('click', function () { setScope('ALL'); go('overview'); toast(t('새로고침 · 개요')); });
    $('btnRefresh').addEventListener('click', function () {
      var b = $('btnRefresh'); b.classList.add('spin'); setTimeout(function () { b.classList.remove('spin'); }, 520);
      // 개요 화면에서는 기간(ovState)도 "이번 달" 기본값으로 되돌려 진짜 새로고침처럼 동작하게 함 —
      // 그냥 refresh()만 하면 이전에 직접 지정한 기간이 그대로 남아 오래된 조회로 보일 수 있음.
      if (state.view === 'overview') state.ovState = { start: '', end: '' };
      renderCounts(); refresh(); toast(t('새로고침됨'));
    });
    $('scopeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-fam]'); if (!b) return;
      var keep = (state.view === 'list') ? state.listOpts : null;   // 대기함에 있었다면 타입만 바꾸고 그대로 머문다
      setScope(b.dataset.fam);
      if (keep) goListFiltered(keep); else go(state.view);
    });
  }

  return {
    famMatch: famMatch, famLabel: famLabel, famBadge: famBadge,
    go: go, setScope: setScope, renderCounts: renderCounts, refresh: refresh, renderTitle: renderTitle,
    resetFilterInputs: resetFilterInputs, goListFiltered: goListFiltered, wireNav: wireNav
  };
})();
