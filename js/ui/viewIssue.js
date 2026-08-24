/* CompApp.viewIssue — 새 발행 form: type/product/category selection, serial auto-numbering,
   purpose/black-out presets, catalog menu (add/edit/delete product types). Ported verbatim. */
window.CompApp = window.CompApp || {};
CompApp.viewIssue = (function () {
  "use strict";
  var $ = CompApp.ui.$, modal = CompApp.ui.modal, toast = CompApp.ui.toast;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };
  var t2 = function (ko, en) { return CompApp.i18n ? CompApp.i18n.t2(ko, en) : ko; };
  var schema = CompApp.schema;
  var esc = schema.esc, normDate = schema.normDate, validDate = schema.validDate, addMonths = schema.addMonths, todayStr = schema.todayStr;
  var CATALOG = schema.CATALOG, productFam = schema.productFam, saveCatalog = schema.saveCatalog;
  var state = CompApp.state;
  var operator = CompApp.operator;
  var blackoutEditor = null;
  var catUserPicked = false; // true once the operator has explicitly clicked a 사유 카테고리 button — blocks further auto-suggestion from overriding their choice

  function records() { return CompApp.db.cache.records; }

  // ---- issue form ----
  function serialPrefix(f, product) { if (f === 'HR') { var p = schema.prod(f, product); return (p && p.prefix) || 'HR'; } return f; }
  function nextSerial(f, product) {
    // 접두어와 번호는 붙여 쓴다(HRF000006). 예전엔 HR만 공백을 넣었으나 표기를 전 계열 통일함.
    var pre = serialPrefix(f, product), mx = 0;
    records().forEach(function (r) {
      if (!r.serial) return;
      var clean = String(r.serial).replace(/\s/g, '');
      if (clean.indexOf(pre) === 0) { var num = clean.slice(pre.length).match(/^0*(\d+)/); if (num) mx = Math.max(mx, parseInt(num[1], 10)); }
    });
    var base = (f === 'FB' ? 12280 : (f === 'RM' ? 10318 : 0));
    return pre + String((mx || base) + 1).padStart(6, '0');
  }
  function renderProductSelect() { $('f-product').innerHTML = CATALOG[state.issueFam].map(function (p) { return '<option value="' + p.id + '" data-months="' + p.defMonths + '" data-amt="' + p.amount + '">' + t(p.name) + '</option>'; }).join(''); onProductChange(); }
  function rebuildProductOptions() {
    var cur = $('f-product').value;
    $('f-product').innerHTML = CATALOG[state.issueFam].map(function (p) { return '<option value="' + p.id + '" data-months="' + p.defMonths + '" data-amt="' + p.amount + '">' + t(p.name) + '</option>'; }).join('');
    if (CATALOG[state.issueFam].some(function (p) { return p.id === cur; })) $('f-product').value = cur;
  }
  function onProductChange() {
    var o = $('f-product').selectedOptions[0]; var m = o ? parseInt(o.dataset.months, 10) : 12;
    $('prodhint').textContent = t('기본 유효기간') + ' ' + m + t('개월'); recalcValid();
    if ($('f-serial')) $('f-serial').value = nextSerial(state.issueFam, $('f-product').value);
    renderSerialHint(); if ($('prodMenu')) renderProdMenu();
  }
  function setIssueFam(f) {
    state.issueFam = f;
    document.querySelectorAll('#f-type button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.fam === f ? 'true' : 'false'); });
    if (f === 'HR') {
      catUserPicked = true; applyCatSelection('STAFF', false);
      $('f-remark').placeholder = t('예: 201268 임서영 / Atrio Kitchen (사번·이름·부서)');
      $('f-req').value = $('f-req').value || operator.opLabel();
    } else {
      // HR을 떠나면 강제 지정을 풀어서, 새 타입에서 세부 목적 기반 자동 추천이 다시 동작하게 함.
      if (catUserPicked && state.selectedCat === 'STAFF') { catUserPicked = false; applyCatSelection('', false); }
      $('f-remark').placeholder = t('추가 메모');
    }
    populatePurposePresets(); renderProductSelect(); renderSerialHint();
  }
  // right-side catalog menu — full issuable list; click to select, ✎ edit, ✕ delete
  function renderProdMenu() {
    var cur = $('f-product') ? $('f-product').value : '';
    var html = '';
    ['FB', 'RM', 'HR'].forEach(function (f) {
      html += '<div class="pm-group">' + t(f === 'FB' ? 'F&B 바우처' : (f === 'RM' ? 'Room 바우처' : 'HR 근속 바우처')) + '</div>';
      html += CATALOG[f].map(function (p) {
        var on = (state.issueFam === f && p.id === cur);
        return '<div class="pm-item' + (on ? ' active' : '') + '">'
          + '<button type="button" class="pm-pick" data-id="' + p.id + '" data-fam="' + f + '">' + esc(t(p.name)) + '</button>'
          + '<span class="pm-acts"><button type="button" class="pedit" data-id="' + p.id + '" data-fam="' + f + '" title="' + t('수정') + '">✎</button><button type="button" class="pdel" data-id="' + p.id + '" data-fam="' + f + '" title="' + t('삭제') + '">✕</button></span>'
          + '</div>';
      }).join('');
    });
    $('prodMenu').innerHTML = html;
  }
  function productModal(existing) {
    modal({
      title: existing ? t('바우처 종류 수정') : t('바우처 종류 추가'), sub: existing ? t('이 종류의 정보를 수정합니다.') : t('발행 가능 목록에 새 종류를 추가합니다 (이 브라우저에 저장).'), bodyHtml:
        '<div class="field"><label>' + t('타입') + '<span class="req">*</span></label><select id="ap-fam"' + (existing ? ' disabled' : '') + '><option value="FB">' + t('F&B 바우처') + '</option><option value="RM">' + t('Room 바우처') + '</option></select></div>'
        + '<div class="field"><label>' + t('종류명') + '<span class="req">*</span></label><input type="text" id="ap-name" value="' + (existing ? esc(t(existing.name)) : '') + '" placeholder="' + esc(t('예: 37 Bar 시그니처 칵테일 2잔')) + '"></div>'
        + '<div class="field"><label>' + t('금액') + ' <span class="opt">(' + t('금액권만 · 원') + ')</span></label><input type="number" id="ap-amt" value="' + (existing ? (existing.amount || 0) : 0) + '" step="1000"></div>'
        + '<div class="field"><label>' + t('기본 유효기간 (개월)') + '<span class="req">*</span></label><input type="number" id="ap-months" value="' + (existing ? (existing.defMonths || 12) : 12) + '" min="1" max="60"></div>',
      wire: function (b) { b.querySelector('#ap-fam').value = existing ? productFam(existing.id) : state.issueFam; b.querySelector('#ap-name').focus(); },
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: existing ? t('저장') : t('추가'), cls: 'btn-primary', onClick: function (b, setErr) {
          var f = b.querySelector('#ap-fam').value, name = b.querySelector('#ap-name').value.trim();
          if (!name) { setErr(t('종류명을 입력하세요.')); return false; }
          var amount = parseInt(b.querySelector('#ap-amt').value, 10) || 0, months = parseInt(b.querySelector('#ap-months').value, 10) || 12;
          if (existing) {
            existing.name = name; existing.amount = amount; existing.defMonths = months; saveCatalog();
            if (productFam(existing.id) === state.issueFam) { var wasSel = $('f-product').value === existing.id; rebuildProductOptions(); if (wasSel) onProductChange(); else renderProdMenu(); }
            else renderProdMenu();
            toast(t('종류 수정: ') + name);
          } else {
            var p = { id: f.toLowerCase() + '_c' + Date.now(), fam: f, name: name, amount: amount, defMonths: months };
            CATALOG[f].push(p); saveCatalog(); setIssueFam(f); $('f-product').value = p.id; onProductChange(); toast(t('종류 추가: ') + name);
          }
        }
      }]
    });
  }
  function deleteProduct(f, id) {
    var p = CATALOG[f].find(function (x) { return x.id === id; }); if (!p) return;
    var used = records().filter(function (r) { return r.product === id; }).length;
    var body = used
      ? '<div style="font-size:13px;color:var(--stop);font-weight:640">⚠ ' + t('이미 발행된 ') + used + t('건이 이 종류를 사용 중입니다.') + '</div><div style="font-size:12.5px;color:var(--ink-2);margin-top:8px;line-height:1.6">' + t('삭제해도 기존 발행 기록과 종류명은 그대로 유지되며, 앞으로 ') + '<b>' + t('신규 발행 목록에서만') + '</b>' + t(' 제외됩니다. 더 이상 사용하지 않는 종류일 때만 삭제하세요.') + '</div>'
      : '<div style="font-size:13px;color:var(--ink-2)">' + t('이 작업은 되돌릴 수 없습니다.') + '</div>';
    modal({
      title: t('종류 삭제 · ') + t(p.name), sub: used ? t('발행 이력 있는 종류 — 삭제 전 확인') : ' ', bodyHtml: body,
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: used ? t('그래도 삭제') : t('삭제'), cls: 'btn-danger', onClick: function () {
          if (used) { schema.getRetired()[id] = p; schema.saveRetired(); }
          CATALOG[f] = CATALOG[f].filter(function (x) { return x.id !== id; }); saveCatalog();
          if (state.issueFam === f) renderProductSelect(); renderProdMenu();
          toast(t('종류 삭제됨') + (used ? t(' (기존 ') + used + t('건 기록 유지)') : ''));
        }
      }]
    });
  }
  function recalcValid() {
    var iss = normDate($('f-issued').value), o = $('f-product').selectedOptions[0], m = o ? parseInt(o.dataset.months, 10) : 12;
    if (validDate(iss)) { CompApp.ui.setDate('f-issued', iss); CompApp.ui.setDate('f-valid', addMonths(iss, m)); }
  }
  function renderSerialHint() {
    var b = $('f-batch').checked, q = b ? Math.max(1, parseInt($('f-qty').value, 10) || 1) : 1, s = $('f-serial').value.trim() || nextSerial(state.issueFam, $('f-product').value), m = /^([A-Za-z]+)(\s?)(\d+)$/.exec(s);
    if (!b || q <= 1) { $('serialhint').textContent = t('단건 발행 · 번호 ') + s; return; }
    if (!m) { $('serialhint').textContent = t('연번 ') + q + t('장'); return; }
    $('serialhint').textContent = t('연번 ') + q + t('장 · ') + s + ' → ' + m[1] + m[2] + String(parseInt(m[3], 10) + q - 1).padStart(m[3].length, '0');
  }
  $('f-batch').addEventListener('change', function () { $('f-qty').disabled = !this.checked; if (this.checked && (parseInt($('f-qty').value, 10) || 1) < 2) $('f-qty').value = 2; if (!this.checked) $('f-qty').value = 1; renderSerialHint(); });
  $('f-product').addEventListener('change', onProductChange);
  $('f-issued').addEventListener('change', recalcValid);
  $('f-qty').addEventListener('input', renderSerialHint);
  $('f-serial').addEventListener('input', renderSerialHint);
  // 사유 카테고리 선택 반영 — auto=true는 세부목적 텍스트로부터의 자동 추천(아직 직접 고른 게
  // 아니면 계속 덮어쓸 수 있음), auto=false는 버튼을 직접 클릭한 경우(그 뒤로는 자동 추천이
  // 절대 덮어쓰지 않음 — catUserPicked로 잠금).
  function applyCatSelection(cat, auto) {
    state.selectedCat = cat;
    document.querySelectorAll('#f-cat button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.cat === cat ? 'true' : 'false'); });
    var hint = $('cathint');
    if (hint) hint.textContent = auto ? t('세부 목적으로 자동 추천됨 — 직접 선택 시 고정됩니다.') : '';
  }
  document.querySelectorAll('#f-cat button').forEach(function (b) { b.addEventListener('click', function () { catUserPicked = true; applyCatSelection(b.dataset.cat, false); }); });
  // 세부 목적을 입력할 때마다 키워드로 카테고리를 추천 — HR은 항상 STAFF로 고정이라 대상 아님,
  // 이미 사람이 직접 고른 뒤에는(catUserPicked) 건드리지 않음. 매칭 실패 시 마지막 추천을
  // 그대로 두고(깜빡임 방지), 매칭되면 그 값으로 갱신.
  $('f-purpose').addEventListener('input', function () {
    if (state.issueFam === 'HR' || catUserPicked) return;
    var guess = CompApp.importMapper.suggestCategory(this.value);
    if (guess && guess !== state.selectedCat) applyCatSelection(guess, true);
  });
  $('f-type').addEventListener('click', function (e) { var b = e.target.closest('button[data-fam]'); if (!b) return; setIssueFam(b.dataset.fam); });
  $('prodMenu').addEventListener('click', function (e) {
    var ed = e.target.closest('.pedit'); if (ed) { productModal(CATALOG[ed.dataset.fam].find(function (x) { return x.id === ed.dataset.id; })); return; }
    var dl = e.target.closest('.pdel'); if (dl) { deleteProduct(dl.dataset.fam, dl.dataset.id); return; }
    var pk = e.target.closest('.pm-pick'); if (!pk) return; if (pk.dataset.fam !== state.issueFam) setIssueFam(pk.dataset.fam); $('f-product').value = pk.dataset.id; onProductChange();
  });
  $('btnAddProduct').addEventListener('click', function () { productModal(); });

  // frequently-used 세부목적 presets
  var PURPOSE_KEY = 'compVoucherPurposes';
  var DEFAULT_PURPOSES = ['Service Anniversary 포상', 'Company of the Month', '컴플레인 보상 (객실)', '컴플레인 보상 (F&B)', 'Conrad Miles 포인트 교환', '타 호텔 바우처 교환', '임직원 복리후생', '이벤트 럭키드로우 경품', '인플루언서/미디어 협찬'];
  var HR_PURPOSES = ['근속 2주년', '근속 3주년', '근속 4주년', '근속 5주년', '근속 6주년', '근속 7주년', '근속 8주년', '근속 9주년', '근속 10주년', '근속 11주년', '근속 12주년', '근속 13주년', '생일 (TM Birthday)'];
  function getPurposes() { return CompApp.metaStore.get(PURPOSE_KEY, DEFAULT_PURPOSES.slice()); }
  function savePurposes(a) { CompApp.metaStore.set(PURPOSE_KEY, a); }
  function populatePurposePresets() {
    var sel = $('f-purpose-preset'); if (!sel) return;
    var hr = (state.issueFam === 'HR'); var list = hr ? HR_PURPOSES : getPurposes();
    sel.innerHTML = '<option value="">' + (hr ? t('근속연차 / 생일 선택…') : t('자주 쓰는 목적 선택…')) + '</option>' + list.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
    sel.value = '';
  }
  $('f-purpose-preset').addEventListener('change', function () { if (this.value) $('f-purpose').value = this.value; });
  $('btnPurposeManage').addEventListener('click', purposeManageModal);

  // Black-out 날짜 presets
  var BLACKOUT_KEY = 'compVoucherBlackouts';
  var DEFAULT_BLACKOUTS = ['블랙아웃 없음', '주말·공휴일 제외', '12/24-25, 12/31-1/1 제외', '설·추석 연휴 제외', '성수기(4-5월) 주말 제외'];
  function getBlackouts() { return CompApp.metaStore.get(BLACKOUT_KEY, DEFAULT_BLACKOUTS.slice()); }
  function saveBlackouts(a) { CompApp.metaStore.set(BLACKOUT_KEY, a); }
  $('btnBlackoutManage').addEventListener('click', blackoutManageModal);
  function blackoutManageModal() {
    function body() { var list = getBlackouts(); return (list.length ? list.map(function (p, i) { return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--line)"><span style="flex:1;font-size:13px">' + esc(p) + '</span><button type="button" class="btn btn-danger btn-sm pdel-bo" data-i="' + i + '">' + t('삭제') + '</button></div>'; }).join('') : '<div class="empty">' + t('목록이 비어 있습니다.') + '</div>') + '<div style="display:flex;gap:8px;margin-top:12px"><input type="text" id="bo-new" placeholder="' + esc(t('새 Black-out 추가')) + '"><button type="button" class="btn btn-primary btn-sm" id="bo-add" style="white-space:nowrap">' + t('추가') + '</button></div>'; }
    modal({
      title: t('Black-out 프리셋 관리'), sub: t('발행 폼에서 "프리셋에서 추가"로 선택할 수 있는 목록입니다.'), bodyHtml: body(), buttons: [{ label: t('닫기') }], wire: function wire(b) {
        b.querySelectorAll('.pdel-bo').forEach(function (btn) { btn.addEventListener('click', function () { var arr = getBlackouts(); arr.splice(parseInt(btn.dataset.i, 10), 1); saveBlackouts(arr); b.innerHTML = body(); wire(b); if (blackoutEditor) blackoutEditor.refreshPresets(); }); });
        var add = b.querySelector('#bo-add'); if (add) add.addEventListener('click', function () { var v = b.querySelector('#bo-new').value.trim(); if (!v) return; var arr = getBlackouts(); if (arr.indexOf(v) < 0) arr.push(v); saveBlackouts(arr); b.innerHTML = body(); wire(b); if (blackoutEditor) blackoutEditor.refreshPresets(); });
      }
    });
  }
  function purposeManageModal() {
    function body() { var list = getPurposes(); return (list.length ? list.map(function (p, i) { return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--line)"><span style="flex:1;font-size:13px">' + esc(p) + '</span><button type="button" class="btn btn-danger btn-sm pdel-purpose" data-i="' + i + '">' + t('삭제') + '</button></div>'; }).join('') : '<div class="empty">' + t('목록이 비어 있습니다.') + '</div>') + '<div style="display:flex;gap:8px;margin-top:12px"><input type="text" id="pp-new" placeholder="' + esc(t('새 목적 추가')) + '"><button type="button" class="btn btn-primary btn-sm" id="pp-add" style="white-space:nowrap">' + t('추가') + '</button></div>'; }
    modal({
      title: t('자주 쓰는 목적 관리'), sub: t('선택 시 세부 목적에 자동 입력됩니다.'), bodyHtml: body(), buttons: [{ label: t('닫기') }], wire: function wire(b) {
        b.querySelectorAll('.pdel-purpose').forEach(function (btn) { btn.addEventListener('click', function () { var arr = getPurposes(); arr.splice(parseInt(btn.dataset.i, 10), 1); savePurposes(arr); b.innerHTML = body(); wire(b); populatePurposePresets(); }); });
        var add = b.querySelector('#pp-add'); if (add) add.addEventListener('click', function () { var v = b.querySelector('#pp-new').value.trim(); if (!v) return; var arr = getPurposes(); if (arr.indexOf(v) < 0) arr.push(v); savePurposes(arr); b.innerHTML = body(); wire(b); populatePurposePresets(); });
      }
    });
  }
  // 요청자 모드에서는 스스로 GM 승인 처리를 할 수 없다 — 승인대기로만 등록되고, 승인자가 승인 대기함에서
  // 승인한다. 다만 Mate 승인번호는 요청자도 적어 올릴 수 있다(이미 받았다면). 모드는 발행 화면에
  // 머무는 중에도 바뀔 수 있어서(사이드바 토글) 폼 초기화와 분리해 둔다.
  function applyRoleUI() {
    var canAppr = operator.canApprove();
    $('f-gm-row').style.display = canAppr ? '' : 'none';
    $('f-gm-note').style.display = canAppr ? 'none' : '';
    $('f-gm-label-opt').textContent = canAppr ? t('(이미 승인받았다면 바로 활성화)') : t('(Mate 번호는 받았으면 입력, 아니면 비워두기)');
    $('f-mate-opt').textContent = canAppr ? t('(GM 승인 완료 시 필수)') : t('(선택)');
    $('btnIssue').textContent = canAppr ? t('발행 등록') : t('발행 요청');
    if (!canAppr) $('f-gm').checked = false;  // Mate 번호는 지우지 않는다 — 요청에 함께 실어 보낸다
  }
  function resetForm() {
    $('f-batch').checked = false; $('f-qty').value = 1; $('f-qty').disabled = true; CompApp.ui.setDate('f-issued', todayStr());
    $('f-purpose').value = ''; populatePurposePresets(); $('f-req').value = operator.opLabel();
    $('f-mate').value = ''; $('f-remark').value = ''; $('f-gm').checked = false;
    applyRoleUI();
    blackoutEditor = CompApp.ui.wireBlackoutEditor('f-bo', $('f-blackout-editor'), [], getBlackouts);
    catUserPicked = false; applyCatSelection('', false); $('formerr').textContent = '';
    document.querySelectorAll('#f-type button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.fam === state.issueFam ? 'true' : 'false'); });
    if (state.issueFam === 'HR') {
      catUserPicked = true; applyCatSelection('STAFF', false);
      $('f-remark').placeholder = t('예: 201268 임서영 / Atrio Kitchen (사번·이름·부서)');
    } else { $('f-remark').placeholder = t('추가 메모'); }
    renderProductSelect(); renderSerialHint();
  }
  $('btnIssue').addEventListener('click', function () { CompApp.workflow.issue(); });
  $('btnReset').addEventListener('click', resetForm);

  function render() { resetForm(); renderProdMenu(); }

  // Re-applies translated labels without resetting the form — used when the language toggles
  // while the operator is mid-way through filling in the issue form, so nothing they typed is lost.
  function relabel() {
    rebuildProductOptions();
    var o = $('f-product').selectedOptions[0]; var m = o ? parseInt(o.dataset.months, 10) : 12;
    $('prodhint').textContent = t('기본 유효기간') + ' ' + m + t('개월');
    renderProdMenu(); populatePurposePresets(); applyRoleUI(); renderSerialHint();
    $('f-remark').placeholder = state.issueFam === 'HR' ? t('예: 201268 임서영 / Atrio Kitchen (사번·이름·부서)') : t('추가 메모');
    if (blackoutEditor && blackoutEditor.relabel) blackoutEditor.relabel();
    var hint = $('cathint');
    if (hint && hint.textContent) hint.textContent = t('세부 목적으로 자동 추천됨 — 직접 선택 시 고정됩니다.');
  }

  function getBlackoutTags() { return blackoutEditor ? blackoutEditor.getTags() : []; }

  return { render: render, relabel: relabel, applyRoleUI: applyRoleUI, nextSerial: nextSerial, serialPrefix: serialPrefix, getBlackoutTags: getBlackoutTags, getBlackouts: getBlackouts };
})();
