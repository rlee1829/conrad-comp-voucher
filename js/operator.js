/* CompApp.operator — operator identity (name+dept, localStorage), 요청자/승인자 role toggle,
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
  function openOpModal() {
    fillDeptSelect(); var o = getOp();
    if (o) { $('op-name').value = o.name || ''; $('op-dept').value = getDepts().indexOf(o.dept) >= 0 ? o.dept : getDepts()[0]; }
    $('op-custom-wrap').style.display = 'none'; $('op-err').textContent = ''; $('opBackdrop').classList.add('show'); $('op-name').focus();
  }
  $('op-dept').addEventListener('change', function () { $('op-custom-wrap').style.display = this.value === '__new' ? 'block' : 'none'; if (this.value === '__new') $('op-custom').focus(); });
  $('op-save').addEventListener('click', function () {
    var name = $('op-name').value.trim(), dept = $('op-dept').value;
    if (dept === '__new') {
      dept = $('op-custom').value.trim();
      if (dept) { var c = []; try { c = JSON.parse(localStorage.getItem(DEPT_KEY) || '[]'); } catch (e) {} if (c.indexOf(dept) < 0) c.push(dept); localStorage.setItem(DEPT_KEY, JSON.stringify(c)); }
    }
    if (!name) { $('op-err').textContent = '이름을 입력하세요.'; return; }
    if (!dept) { $('op-err').textContent = '부서를 선택하거나 입력하세요.'; return; }
    localStorage.setItem(OP_KEY, JSON.stringify({ name: name, dept: dept }));
    $('opBackdrop').classList.remove('show'); renderOpCard();
    if ($('f-req') && !$('f-req').value.trim()) $('f-req').value = opLabel();
    var r = computeAutoRole(); applyRole(r); updateMgmtLinks();
    toast('담당자 등록: ' + opLabel() + ' · ' + (r === 'approver' ? '승인자 모드' : '요청자 모드'));
  });
  $('opCard').addEventListener('click', openOpModal);

  // ---- role (요청자/승인자 모드) — 담당자 이름이 승인자 명단에 있으면 자동 전환 ----
  // Approver/admin lists are SHARED config (metaStore: Supabase `meta` table when cloud is on,
  // localStorage otherwise) so every operator sees the same lists — not per-browser like before.
  var APPR_KEY = 'compVoucherApprovers';
  function getApprovers() { return CompApp.metaStore.get(APPR_KEY, []); }
  function saveApprovers(a) { CompApp.metaStore.set(APPR_KEY, a); }
  function isApproverName(name) { var list = getApprovers().map(function (n) { return n.trim().toLowerCase(); }); return list.indexOf(String(name || '').trim().toLowerCase()) >= 0; }
  function computeAutoRole() { var o = getOp(); if (!o || !o.name) return 'approver'; return isApproverName(o.name) ? 'approver' : 'requester'; }
  var role = computeAutoRole();
  function applyRole(r) {
    role = r;
    document.querySelectorAll('#roleSwitch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.role === r ? 'true' : 'false'); });
    if (CompApp.router && CompApp.router.refresh) CompApp.router.refresh();
  }
  document.querySelectorAll('#roleSwitch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.role === role ? 'true' : 'false'); });
  $('roleSwitch').addEventListener('click', function (e) { var b = e.target.closest('button[data-role]'); if (!b) return; applyRole(b.dataset.role); });

  // ---- 관리자 명단 (승인자 명단을 편집할 수 있는 사람) — shared config, see note above ----
  var ADMIN_KEY = 'compVoucherAdmins';
  function getAdmins() { return CompApp.metaStore.get(ADMIN_KEY, []); }
  function saveAdmins(a) { CompApp.metaStore.set(ADMIN_KEY, a); }
  function isAdminName(name) { var list = getAdmins().map(function (n) { return n.trim().toLowerCase(); }); return list.indexOf(String(name || '').trim().toLowerCase()) >= 0; }
  function isAdmin() { var admins = getAdmins(); if (!admins.length) return true; var o = getOp(); return !!(o && o.name && isAdminName(o.name)); }
  function updateMgmtLinks() { var can = isAdmin(); var b1 = $('btnApproverManage'), b2 = $('btnAdminManage'); if (b1) b1.style.display = can ? '' : 'none'; if (b2) b2.style.display = can ? '' : 'none'; }
  updateMgmtLinks();

  function approverManageModal() {
    if (!isAdmin()) { toast('승인자 명단 관리 권한이 없습니다. (관리자만 편집 가능)'); return; }
    var bootstrap = !getAdmins().length;
    function body() {
      var list = getApprovers();
      return (bootstrap ? '<div class="sb-hint" style="margin:0 0 10px">※ 관리자 명단이 비어 있어 모든 담당자가 편집할 수 있습니다. 관리자를 지정하면 이후 관리자만 편집 가능합니다.</div>' : '')
        + (list.length ? list.map(function (p, i) { return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--line)"><span style="flex:1;font-size:13px">' + esc(p) + '</span><button type="button" class="btn btn-danger btn-sm pdel-appr" data-i="' + i + '">삭제</button></div>'; }).join('') : '<div class="empty">등록된 승인자가 없습니다. 이름을 추가하면 해당 담당자로 등록 시 자동으로 승인자 모드가 됩니다.</div>')
        + '<div style="display:flex;gap:8px;margin-top:12px"><input type="text" id="ap-new" placeholder="담당자 등록 시 사용할 이름 (예: Sam)"><button type="button" class="btn btn-primary btn-sm" id="ap-add" style="white-space:nowrap">추가</button></div>';
    }
    modal({
      title: '승인자 명단 관리', sub: '담당자 등록 화면에서 입력하는 이름과 정확히 일치해야 자동 인식됩니다.', bodyHtml: body(),
      buttons: [{ label: '닫기', onClick: function () { var r = computeAutoRole(); applyRole(r); } }],
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
      return (bootstrap ? '<div class="sb-hint" style="margin:0 0 10px">※ 관리자 명단이 비어 있어 모든 담당자가 편집할 수 있습니다. 여기서 지정하는 순간부터 명단에 있는 사람만 승인자·관리자 명단을 편집할 수 있습니다.</div>' : '')
        + (list.length ? list.map(function (p, i) { return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--line)"><span style="flex:1;font-size:13px">' + esc(p) + '</span><button type="button" class="btn btn-danger btn-sm pdel-admin" data-i="' + i + '">삭제</button></div>'; }).join('') : '<div class="empty">등록된 관리자가 없습니다 (= 현재 모든 담당자가 관리 가능).</div>')
        + '<div style="display:flex;gap:8px;margin-top:12px"><input type="text" id="ad-new" placeholder="담당자 등록 시 사용할 이름"><button type="button" class="btn btn-primary btn-sm" id="ad-add" style="white-space:nowrap">추가</button></div>';
    }
    modal({
      title: '관리자 명단 관리', sub: '승인자 명단·관리자 명단을 편집할 수 있는 사람을 지정합니다.', bodyHtml: body(),
      buttons: [{ label: '닫기', onClick: function () { updateMgmtLinks(); } }],
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
    if (!getOp()) openOpModal();
  }

  return {
    getOp: getOp, opLabel: opLabel, actor: actor, getDepts: getDepts, openOpModal: openOpModal,
    getRole: function () { return role; }, applyRole: applyRole, computeAutoRole: computeAutoRole,
    getApprovers: getApprovers, isApproverName: isApproverName,
    getAdmins: getAdmins, isAdmin: isAdmin,
    DESIGN_KEY: DESIGN_KEY, applyDesign: applyDesign, init: init
  };
})();
