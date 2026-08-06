/* CompApp.operator — operator identity (name+dept, localStorage), 요청자/승인자/관리자 role toggle,
   and the 승인자/관리자 명단 (approver/admin lists) that drive automatic role detection. */
window.CompApp = window.CompApp || {};
CompApp.operator = (function () {
  "use strict";
  var $ = CompApp.ui.$, modal = CompApp.ui.modal, toast = CompApp.ui.toast, esc = CompApp.schema.esc;
  var DEFAULT_DEPTS = CompApp.schema.DEFAULT_DEPTS;

  // ---- operator identity ----
  var OP_KEY = 'compVoucherOperator', DEPT_KEY = 'compVoucherDepts', DESIGN_KEY = 'compVoucherDesign';
  function getOp() { try { return JSON.parse(localStorage.getItem(OP_KEY) || 'null'); } catch (e) { return null; } }
  function opLabel() { var o = getOp(); return o ? (o.dept ? o.name + ' (' + o.dept + ')' : o.name) : ''; }
  function actor() { return opLabel() || '담당자'; }
  function getDepts() { var c = []; try { c = JSON.parse(localStorage.getItem(DEPT_KEY) || '[]'); } catch (e) {} return DEFAULT_DEPTS.concat(c.filter(function (d) { return DEFAULT_DEPTS.indexOf(d) < 0; })); }
  function renderOpCard() { $('opWho').textContent = opLabel() || '미등록'; }
  function fillDeptSelect() { $('op-dept').innerHTML = getDepts().map(function (d) { return '<option value="' + d + '">' + d + '</option>'; }).join('') + '<option value="__new">+ 새 부서 추가…</option>'; }
  function opEmail() { var o = getOp(); return (o && o.email) || ''; }
  // 담당자 이름이 요청자 칸 안에 들어 있으면 "본인이 낸 요청"으로 본다 — 요청자 칸은 "Hans Kim/Event"
  // 처럼 자유 텍스트라 정확히 일치하지 않기 때문. 남을 대신해 발행한 경우엔 매칭되지 않아 이메일이
  // 붙지 않고, 그때는 픽업 알림 화면에서 주소를 입력하게 된다(잘못된 사람에게 보내는 것보다 안전).
  function isSelfRequest(req) {
    var o = getOp(); if (!o || !o.name) return false;
    return String(req == null ? '' : req).toLowerCase().indexOf(String(o.name).trim().toLowerCase()) >= 0;
  }
  function openOpModal() {
    fillDeptSelect(); var o = getOp();
    if (o) { $('op-name').value = o.name || ''; $('op-dept').value = getDepts().indexOf(o.dept) >= 0 ? o.dept : getDepts()[0]; $('op-mail').value = o.email || ''; }
    $('op-custom-wrap').style.display = 'none'; $('op-err').textContent = ''; $('opBackdrop').classList.add('show'); $('op-name').focus();
  }
  $('op-dept').addEventListener('change', function () { $('op-custom-wrap').style.display = this.value === '__new' ? 'block' : 'none'; if (this.value === '__new') $('op-custom').focus(); });
  $('op-save').addEventListener('click', function () {
    var name = $('op-name').value.trim(), dept = $('op-dept').value;
    if (dept === '__new') {
      dept = $('op-custom').value.trim();
      if (dept) { var c = []; try { c = JSON.parse(localStorage.getItem(DEPT_KEY) || '[]'); } catch (e) {} if (c.indexOf(dept) < 0) c.push(dept); localStorage.setItem(DEPT_KEY, JSON.stringify(c)); }
    }
    var email = $('op-mail').value.trim();
    if (!name) { $('op-err').textContent = '이름을 입력하세요.'; return; }
    if (!dept) { $('op-err').textContent = '부서를 선택하거나 입력하세요.'; return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('op-err').textContent = '이메일 형식이 올바르지 않습니다.'; return; }
    localStorage.setItem(OP_KEY, JSON.stringify({ name: name, dept: dept, email: email }));
    $('opBackdrop').classList.remove('show'); renderOpCard();
    if ($('f-req') && !$('f-req').value.trim()) $('f-req').value = opLabel();
    var r = refreshRole();
    toast('담당자 등록: ' + opLabel() + ' · ' + ROLE_LABEL[r]);
  });
  $('opCard').addEventListener('click', openOpModal);

  // ---- role (요청자/승인자/관리자 모드) — 담당자 이름이 승인자·관리자 명단에 있으면 자동 전환 ----
  // Approver/admin lists are SHARED config (metaStore: Supabase `meta` table when cloud is on,
  // localStorage otherwise) so every operator sees the same lists — not per-browser like before.
  // NOTE: in cloud mode those lists are only in the metaStore cache AFTER metaStore.init() resolves,
  // which happens long after this file is parsed — so the role computed here at load time is just a
  // provisional value. refreshRole() re-runs the decision from init() (post-load) and whenever the
  // shared config changes, otherwise a listed approver/admin would stay stuck in 요청자 모드.
  // 두 키 모두 여기서 선언한다 — computeAutoRole()이 아래 관리자 블록의 isAdmin()을 호출하는데,
  // ADMIN_KEY를 그 블록에서 선언하면 var 호이스팅 때문에 이 시점엔 undefined가 된다.
  var APPR_KEY = 'compVoucherApprovers', ADMIN_KEY = 'compVoucherAdmins';
  var ROLE_LABEL = { requester: '요청자 모드', approver: '승인자 모드', admin: '관리자 모드' };
  function getApprovers() { return CompApp.metaStore.get(APPR_KEY, []); }
  function saveApprovers(a) { CompApp.metaStore.set(APPR_KEY, a); }
  function isApproverName(name) { var list = getApprovers().map(function (n) { return n.trim().toLowerCase(); }); return list.indexOf(String(name || '').trim().toLowerCase()) >= 0; }
  function computeAutoRole() {
    if (isAdmin()) return 'admin';           // 관리자 명단(또는 명단이 비어 부트스트랩 상태)
    var o = getOp();
    return (o && o.name && isApproverName(o.name)) ? 'approver' : 'requester';
  }
  // 승인 권한 보유 여부(명단 소속). 관리자는 승인 권한을 포함한다.
  function isListedApprover() { var o = getOp(); return isAdmin() || !!(o && o.name && isApproverName(o.name)); }
  var role = computeAutoRole();
  function applyRole(r) {
    // 모드 토글은 화면 필터지만 발행 시 자가 승인 여부까지 가른다 — 명단에 없는 사람이 임의로
    // 승인자/관리자 모드로 올라가지 못하게 여기서 강등시킨다.
    if (r === 'admin' && !isAdmin()) r = 'approver';
    if (r === 'approver' && !isListedApprover()) r = 'requester';
    role = r;
    document.querySelectorAll('#roleSwitch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.role === role ? 'true' : 'false'); });
    if (CompApp.viewIssue && CompApp.viewIssue.applyRoleUI) CompApp.viewIssue.applyRoleUI();
    if (CompApp.router && CompApp.router.refresh) CompApp.router.refresh();
  }
  // 자동 판정을 다시 돌린다(담당자 재등록 / 명단 변경 / 클라우드 설정 로딩 완료 시). 수동 토글은 리셋됨.
  function refreshRole() { updateMgmtLinks(); applyRole(computeAutoRole()); return role; }
  // 승인·관리 액션의 실제 게이트. 명단 소속(권한) + 현재 모드(화면 필터) 둘 다 만족해야 노출.
  function canApprove() { return (role === 'approver' || role === 'admin') && isListedApprover(); }
  function canAdmin() { return role === 'admin' && isAdmin(); }
  document.querySelectorAll('#roleSwitch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.role === role ? 'true' : 'false'); });
  $('roleSwitch').addEventListener('click', function (e) { var b = e.target.closest('button[data-role]'); if (!b) return; applyRole(b.dataset.role); });

  // ---- 관리자 명단 (승인자 명단을 편집할 수 있는 사람) — shared config, see note above ----
  function getAdmins() { return CompApp.metaStore.get(ADMIN_KEY, []); }
  function saveAdmins(a) { CompApp.metaStore.set(ADMIN_KEY, a); }
  function isAdminName(name) { var list = getAdmins().map(function (n) { return n.trim().toLowerCase(); }); return list.indexOf(String(name || '').trim().toLowerCase()) >= 0; }
  function isAdmin() { var admins = getAdmins(); if (!admins.length) return true; var o = getOp(); return !!(o && o.name && isAdminName(o.name)); }
  function updateMgmtLinks() {
    var can = isAdmin();
    var b1 = $('btnApproverManage'), b2 = $('btnAdminManage'), navIE = $('navImportExport');
    var roleAdminBtn = document.querySelector('#roleSwitch button[data-role="admin"]');
    var roleApprBtn = document.querySelector('#roleSwitch button[data-role="approver"]');
    if (b1) b1.style.display = can ? '' : 'none';
    if (b2) b2.style.display = can ? '' : 'none';
    if (navIE) navIE.style.display = can ? '' : 'none';
    // 명단에 있는 사람에게만 해당 모드 버튼을 노출 — 모드는 곧 발행 시 자가 승인 가능 여부이기도 하다.
    if (roleAdminBtn) roleAdminBtn.style.display = can ? '' : 'none';
    if (roleApprBtn) roleApprBtn.style.display = isListedApprover() ? '' : 'none';
  }
  updateMgmtLinks();

  function approverManageModal() {
    if (!isAdmin()) { toast('승인자 명단 관리 권한이 없습니다. (관리자만 편집 가능)'); return; }
    var bootstrap = !getAdmins().length;
    function body() {
      var list = getApprovers();
      return (bootstrap ? '<div class="modal-hint">※ 관리자 명단이 비어 있어 모든 담당자가 편집할 수 있습니다. 관리자를 지정하면 이후 관리자만 편집 가능합니다.</div>' : '')
        + (list.length ? list.map(function (p, i) { return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--line)"><span style="flex:1;font-size:13px">' + esc(p) + '</span><button type="button" class="btn btn-danger btn-sm pdel-appr" data-i="' + i + '">삭제</button></div>'; }).join('') : '<div class="empty">등록된 승인자가 없습니다. 이름을 추가하면 해당 담당자로 등록 시 자동으로 승인자 모드가 됩니다.</div>')
        + '<div style="display:flex;gap:8px;margin-top:12px"><input type="text" id="ap-new" placeholder="담당자 등록 시 사용할 이름 (예: Sam)"><button type="button" class="btn btn-primary btn-sm" id="ap-add" style="white-space:nowrap">추가</button></div>';
    }
    modal({
      title: '승인자 명단 관리', sub: '담당자 등록 화면에서 입력하는 이름과 정확히 일치해야 자동 인식됩니다.', bodyHtml: body(),
      buttons: [{ label: '닫기', onClick: function () { refreshRole(); } }],
      wire: function wire(b) {
        b.querySelectorAll('.pdel-appr').forEach(function (btn) { btn.addEventListener('click', function () { var arr = getApprovers(); arr.splice(parseInt(btn.dataset.i, 10), 1); saveApprovers(arr); b.innerHTML = body(); wire(b); }); });
        var add = b.querySelector('#ap-add'); if (add) add.addEventListener('click', function () { var v = b.querySelector('#ap-new').value.trim(); if (!v) return; var arr = getApprovers(); if (arr.indexOf(v) < 0) arr.push(v); saveApprovers(arr); b.innerHTML = body(); wire(b); });
      }
    });
  }
  $('btnApproverManage').addEventListener('click', approverManageModal);

  function adminManageModal() {
    if (!isAdmin()) { toast('관리자 명단 관리 권한이 없습니다.'); return; }
    var bootstrap = !getAdmins().length;
    function body() {
      var list = getAdmins();
      return (bootstrap ? '<div class="modal-hint">※ 관리자 명단이 비어 있어 모든 담당자가 편집할 수 있습니다. 여기서 지정하는 순간부터 명단에 있는 사람만 승인자·관리자 명단을 편집할 수 있습니다.</div>' : '')
        + (list.length ? list.map(function (p, i) { return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--line)"><span style="flex:1;font-size:13px">' + esc(p) + '</span><button type="button" class="btn btn-danger btn-sm pdel-admin" data-i="' + i + '">삭제</button></div>'; }).join('') : '<div class="empty">등록된 관리자가 없습니다 (= 현재 모든 담당자가 관리 가능).</div>')
        + '<div style="display:flex;gap:8px;margin-top:12px"><input type="text" id="ad-new" placeholder="담당자 등록 시 사용할 이름"><button type="button" class="btn btn-primary btn-sm" id="ad-add" style="white-space:nowrap">추가</button></div>';
    }
    modal({
      title: '관리자 명단 관리', sub: '승인자 명단·관리자 명단을 편집할 수 있는 사람을 지정합니다.', bodyHtml: body(),
      buttons: [{ label: '닫기', onClick: function () { refreshRole(); } }],
      wire: function wire(b) {
        b.querySelectorAll('.pdel-admin').forEach(function (btn) { btn.addEventListener('click', function () { var arr = getAdmins(); arr.splice(parseInt(btn.dataset.i, 10), 1); saveAdmins(arr); b.innerHTML = body(); wire(b); }); });
        var add = b.querySelector('#ad-add'); if (add) add.addEventListener('click', function () { var v = b.querySelector('#ad-new').value.trim(); if (!v) return; var arr = getAdmins(); if (arr.indexOf(v) < 0) arr.push(v); saveAdmins(arr); b.innerHTML = body(); wire(b); }); }
    });
  }
  $('btnAdminManage').addEventListener('click', adminManageModal);


  // ---- design switch ----
  function applyDesign(d) {
    document.documentElement.setAttribute('data-design', d);
    document.querySelectorAll('#designSwitch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.design === d ? 'true' : 'false'); });
    localStorage.setItem(DESIGN_KEY, d);
  }
  $('designSwitch').addEventListener('click', function (e) { var b = e.target.closest('button[data-design]'); if (!b) return; applyDesign(b.dataset.design); });
  $('themeBtn').addEventListener('click', function () {
    var root = document.documentElement, cur = root.getAttribute('data-theme');
    if (!cur) cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    root.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  });

  function init() {
    applyDesign(localStorage.getItem(DESIGN_KEY) || 'bronze');
    renderOpCard();
    refreshRole();   // 공유 명단(metaStore)이 로딩된 뒤 자동 판정을 다시 돌린다
    if (!getOp()) openOpModal();
  }

  return {
    getOp: getOp, opLabel: opLabel, actor: actor, opEmail: opEmail, isSelfRequest: isSelfRequest, getDepts: getDepts, openOpModal: openOpModal,
    getRole: function () { return role; }, applyRole: applyRole, computeAutoRole: computeAutoRole,
    refreshRole: refreshRole, canApprove: canApprove, canAdmin: canAdmin,
    getApprovers: getApprovers, isApproverName: isApproverName,
    getAdmins: getAdmins, isAdmin: isAdmin,
    DESIGN_KEY: DESIGN_KEY, applyDesign: applyDesign, init: init
  };
})();
