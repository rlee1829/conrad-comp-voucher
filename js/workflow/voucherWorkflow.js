/* CompApp.workflow — the sole mutation point for voucher records: issue/approve/reject/use/
   extend/void/edit/bulk actions + the detail modal. Ported verbatim from the prototype. */
window.CompApp = window.CompApp || {};
CompApp.workflow = (function () {
  "use strict";
  var $ = CompApp.ui.$, modal = CompApp.ui.modal, toast = CompApp.ui.toast, dateFieldHTML = CompApp.ui.dateFieldHTML;
  var schema = CompApp.schema;
  var esc = schema.esc, money = schema.money, normDate = schema.normDate, validDate = schema.validDate, daysUntil = schema.daysUntil, todayStr = schema.todayStr, effStatus = schema.effStatus;
  var CAT_LABEL = schema.CAT_LABEL, STATUS_LABEL = schema.STATUS_LABEL, STATUS_CLASS = schema.STATUS_CLASS, CATALOG = schema.CATALOG;
  var prod = schema.prod, prodName = schema.prodName;
  var state = CompApp.state;
  var operator = CompApp.operator;

  function records() { return CompApp.db.cache.records; }
  function recById(id) { return records().find(function (r) { return r.id === id; }); }
  function famMatch(r) { return CompApp.router.famMatch(r); }
  function selIds() { return Object.keys(state.selected).filter(function (id) { return state.selected[id]; }); }

  // F: global audit log — one entry per workflow action, independent of any single record's own
  // `history` array (which only that record's detail modal shows). Kept in CompApp.state.auditLog
  // (newest first, capped) and mirrored to the Supabase `audit_log` table when cloud is enabled.
  var AUDIT_CAP = 5000;
  function pushAuditEntry(entry) {
    entry.id = entry.id || schema.uid();
    entry.ts = entry.ts || todayStr();
    entry.actor = entry.actor || operator.actor();
    state.auditLog.unshift(entry);
    if (state.auditLog.length > AUDIT_CAP) state.auditLog.length = AUDIT_CAP;
    if (CompApp.cloudEnabled && CompApp.cloudEnabled()) {
      CompApp.dbCloud.logAudit(entry).catch(function (e) { console.warn('audit log cloud write failed', e); });
    }
    return entry;
  }
  function logHist(r, action, detail) {
    r.history = r.history || [];
    r.history.push({ ts: todayStr(), actor: operator.actor(), action: action, detail: detail });
    pushAuditEntry({ action: action, detail: detail, recordId: r.id, serial: r.serial, fam: r.fam });
  }
  // Mirror a mutated record (or list of them) to Supabase in the background when cloud is enabled.
  // The in-memory array stays the source every view reads synchronously — this never blocks the UI.
  function persist(list) {
    if (!(CompApp.cloudEnabled && CompApp.cloudEnabled())) return;
    (Array.isArray(list) ? list : [list]).forEach(function (r) {
      CompApp.dbCloud.put(r).catch(function (e) { console.warn('cloud save failed for', r.id, e); });
    });
  }

  // F: 1-step undo — tracks only the single most-recent mutation (not a full stack). Every mutating
  // action calls finishAction() right where it used to call toast() directly; the undo affordance
  // lives inside that toast and clears itself after one use.
  var lastAction = null;
  function snapshotBefore(list) { return (Array.isArray(list) ? list : [list]).map(function (r) { return JSON.parse(JSON.stringify(r)); }); }
  function finishAction(kind, payload, label, message) {
    lastAction = { kind: kind, label: label, payload: payload };
    toast(message, { actionLabel: '되돌리기', onAction: undo });
  }
  function undo() {
    if (!lastAction) return;
    var la = lastAction; lastAction = null; // one-shot — clear immediately so it can't be replayed
    if (la.kind === 'restore') {
      la.payload.forEach(function (snap) {
        var idx = records().findIndex(function (r) { return r.id === snap.id; });
        if (idx !== -1) records()[idx] = snap;
      });
      persist(la.payload);
      la.payload.forEach(function (snap) { pushAuditEntry({ action: '되돌리기', detail: la.label + ' 되돌림', recordId: snap.id, serial: snap.serial, fam: snap.fam }); });
    } else if (la.kind === 'remove') {
      la.payload.ids.forEach(function (id) {
        var idx = records().findIndex(function (r) { return r.id === id; });
        if (idx !== -1) records().splice(idx, 1);
        if (CompApp.cloudEnabled && CompApp.cloudEnabled()) CompApp.dbCloud.remove(id).catch(function (e) { console.warn('undo delete failed', e); });
      });
      pushAuditEntry({ action: '되돌리기', detail: la.label + ' 되돌림 (발행 취소)', recordId: null, serial: la.payload.serials.join(', '), fam: la.payload.fam });
    } else if (la.kind === 'reinsert') {
      la.payload.forEach(function (snap) { records().unshift(snap); });
      persist(la.payload);
      la.payload.forEach(function (snap) { pushAuditEntry({ action: '되돌리기', detail: la.label + ' 되돌림 (삭제 취소)', recordId: snap.id, serial: snap.serial, fam: snap.fam }); });
    }
    state.selected = {};
    CompApp.router.renderCounts(); CompApp.router.refresh();
    toast('되돌리기 완료');
  }

  // ---- issue (form submit) ----
  function issue() {
    var err = $('formerr'); err.textContent = '';
    if (!operator.getOp()) { operator.openOpModal(); return; }
    var issueFam = state.issueFam;
    var product = $('f-product').value, batch = $('f-batch').checked, qty = batch ? Math.max(1, parseInt($('f-qty').value, 10) || 1) : 1;
    var start = $('f-serial').value.trim() || CompApp.viewIssue.nextSerial(issueFam, product), iss = normDate($('f-issued').value), val = normDate($('f-valid').value);
    var purpose = $('f-purpose').value.trim(), req = $('f-req').value.trim(), mate = $('f-mate').value.trim(), gm = $('f-gm').checked;
    var amount = parseInt($('f-amount').value, 10); if (isNaN(amount)) amount = (prod(issueFam, product) || {}).amount || 0;
    var blackoutTags = CompApp.viewIssue.getBlackoutTags();
    if (!validDate(iss) || !validDate(val)) { err.textContent = '발행일과 만료일을 YYYY-MM-DD 형식으로 입력하세요.'; return; }
    if (!state.selectedCat) { err.textContent = '사유 카테고리를 선택하세요.'; return; }
    if (!purpose) { err.textContent = '세부 목적을 입력하세요.'; return; }
    if (!req) { err.textContent = '요청 부서/요청자를 입력하세요.'; return; }
    if (gm && !mate) { err.textContent = 'GM 승인 완료 시 Mate 승인번호는 필수입니다.'; return; }
    var status = gm ? 'ACTIVE' : 'PENDING', m = /^([A-Za-z]+)(\s?)(\d+)$/.exec(start);
    var issued = [];
    for (var k = 0; k < qty; k++) {
      var serial = m ? m[1] + m[2] + String(parseInt(m[3], 10) + k).padStart(m[3].length, '0') : start + (qty > 1 ? '-' + (k + 1) : '');
      var r = { id: schema.uid(), fam: issueFam, serial: serial, product: product, amount: amount, issued: iss, valid: val, cat: state.selectedCat, purpose: purpose, req: req, mate: gm ? mate : '', remark: $('f-remark').value.trim(), blackoutTags: blackoutTags.slice(), status: status, history: [] };
      logHist(r, '발행', gm ? ('발행·즉시활성 · Mate ' + mate) : '발행 (승인대기)');
      records().unshift(r);
      issued.push(r);
    }
    persist(issued);
    CompApp.router.renderCounts(); CompApp.router.go('list');
    finishAction('remove', { ids: issued.map(function (r) { return r.id; }), serials: issued.map(function (r) { return r.serial; }), fam: issueFam },
      '발행 (' + issued.length + '건)', (qty > 1 ? qty + '장 ' : '') + '발행 등록 완료' + (gm ? '' : ' (승인대기)'));
  }

  function rowAction(act, id) {
    var r = recById(id); if (!r) return;
    if (act === 'detail') return showDetail(r);
    if (act === 'edit') return editModal(r);
    if (act === 'approve') return approveModal([r]);
    if (act === 'reject') return rejectModal([r]);
    if (act === 'use') return useModal([r]);
    if (act === 'extend') return extendModal([r]);
    if (act === 'void') return voidModal([r]);
  }

  function bulkAction(kind) {
    var rs = selIds().map(recById).filter(Boolean).filter(famMatch);
    if (kind === 'clear') { state.selected = {}; CompApp.viewList.render(); return; }
    if (!rs.length) { toast('선택된 항목이 없습니다.'); return; }
    if (kind === 'approve') { var p = rs.filter(function (r) { return r.status === 'PENDING'; }); if (!p.length) { toast('승인대기 상태인 선택 항목이 없습니다.'); return; } return approveModal(p); }
    if (kind === 'reject') { var rj = rs.filter(function (r) { return r.status === 'PENDING'; }); if (!rj.length) { toast('승인대기 상태인 선택 항목이 없습니다.'); return; } return rejectModal(rj); }
    if (kind === 'use') { var a = rs.filter(function (r) { return r.status === 'ACTIVE'; }); if (!a.length) { toast('활성 상태인 선택 항목이 없습니다.'); return; } return useModal(a); }
    if (kind === 'extend') { var a2 = rs.filter(function (r) { return r.status === 'ACTIVE' || r.status === 'PENDING' || r.status === 'EXPIRED'; }); if (!a2.length) { toast('연장 가능한 항목이 없습니다.'); return; } return extendModal(a2); }
    if (kind === 'void') { var v = rs.filter(function (r) { return r.status === 'ACTIVE' || r.status === 'PENDING'; }); if (!v.length) { toast('취소 가능한 항목이 없습니다.'); return; } return voidModal(v); }
    if (kind === 'field') return fieldSetModal(rs);
    if (kind === 'delete') {
      if (!operator.isAdmin()) { toast('삭제 권한이 없습니다. (관리자만 가능)'); return; }
      return deleteModal(rs);
    }
  }

  // 관리자 전용: 선택한 바우처를 영구 삭제. 취소(VOID)와 달리 목록에서 완전히 제거됨 —
  // 오발행/테스트 데이터 정리용. 1단계 되돌리기로 복구 가능.
  function deleteModal(list) {
    modal({
      title: '바우처 삭제', sub: list.length + '건을 목록에서 완전히 삭제합니다. 이 작업은 관리자만 할 수 있습니다.',
      bodyHtml: '<div class="field"><label>삭제 사유<span class="req">*</span></label><input type="text" id="m-reason" placeholder="예: 오발행 / 테스트 데이터 / 중복 등록"></div>',
      wire: function (b) { b.querySelector('#m-reason').focus(); },
      buttons: [{ label: '취소' }, {
        label: '삭제', cls: 'btn-danger', onClick: function (b, setErr) {
          var rn = b.querySelector('#m-reason').value.trim();
          if (!rn) { setErr('삭제 사유를 입력하세요.'); return false; }
          var before = snapshotBefore(list);
          list.forEach(function (r) {
            var idx = records().findIndex(function (x) { return x.id === r.id; });
            if (idx !== -1) records().splice(idx, 1);
            if (CompApp.cloudEnabled && CompApp.cloudEnabled()) CompApp.dbCloud.remove(r.id).catch(function (e) { console.warn('cloud delete failed for', r.id, e); });
            pushAuditEntry({ action: '삭제', detail: '사유: ' + rn, recordId: r.id, serial: r.serial, fam: r.fam });
          });
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('reinsert', before, '삭제 (' + list.length + '건)', list.length + '건 삭제 완료');
        }
      }]
    });
  }

  function approveModal(list) {
    modal({
      title: 'GM 승인 처리', sub: list.length + '건을 활성화합니다. Mate 승인번호를 입력하세요.',
      bodyHtml: '<div class="field"><label>Mate 승인번호<span class="req">*</span></label><input type="text" id="m-mate" placeholder="예: 2025-4224"></div>',
      wire: function (b) { b.querySelector('#m-mate').focus(); },
      buttons: [{ label: '취소' }, {
        label: '승인 완료', cls: 'btn-primary', onClick: function (b, setErr) {
          var mate = b.querySelector('#m-mate').value.trim();
          if (!mate) { setErr('Mate 승인번호는 필수입니다.'); return false; }
          var before = snapshotBefore(list);
          list.forEach(function (r) { r.status = 'ACTIVE'; r.mate = mate; logHist(r, '승인', 'GM 승인 · Mate ' + mate); });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '승인 (' + list.length + '건)', list.length + '건 승인 완료');
        }
      }]
    });
  }
  function rejectModal(list) {
    modal({
      title: '요청 반려', sub: list.length + '건을 반려 처리합니다. 반려 사유를 입력하세요.',
      bodyHtml: '<div class="field"><label>반려 사유<span class="req">*</span></label><input type="text" id="m-reason" placeholder="예: 사유 불명확 / 중복 요청 / 예산 초과"></div>',
      wire: function (b) { b.querySelector('#m-reason').focus(); },
      buttons: [{ label: '취소' }, {
        label: '반려 처리', cls: 'btn-danger', onClick: function (b, setErr) {
          var rn = b.querySelector('#m-reason').value.trim();
          if (!rn) { setErr('반려 사유를 입력하세요.'); return false; }
          var before = snapshotBefore(list);
          list.forEach(function (r) { r.status = 'REJECTED'; r.rejectReason = rn; logHist(r, '반려', '사유: ' + rn); });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '반려 (' + list.length + '건)', list.length + '건 반려');
        }
      }]
    });
  }
  function useModal(list) {
    modal({
      title: '사용 처리', sub: list.length + '건을 사용 처리합니다.',
      bodyHtml: '<div class="field"><label>사용일<span class="req">*</span></label>' + dateFieldHTML('m-date', todayStr()) + '</div><div class="field"><label>사용 메모 <span class="opt">(선택)</span></label><input type="text" id="m-note" placeholder="예: 객실번호 / 투숙객명"></div>',
      buttons: [{ label: '취소' }, {
        label: '사용 처리', cls: 'btn-primary', onClick: function (b, setErr) {
          var d = normDate(b.querySelector('#m-date').value);
          if (!validDate(d)) { setErr('사용일을 선택하세요.'); return false; }
          var note = b.querySelector('#m-note').value.trim();
          var before = snapshotBefore(list);
          list.forEach(function (r) { r.status = 'USED'; r.usedDate = d; logHist(r, '사용', '사용일 ' + d + (note ? ' · ' + note : '')); });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '사용 처리 (' + list.length + '건)', list.length + '건 사용 처리');
        }
      }]
    });
  }
  function extendModal(list) {
    modal({
      title: '유효기간 연장', sub: list.length + '건 연장 · GM 재승인 필요',
      bodyHtml: '<div class="field"><label>새 만료일<span class="req">*</span></label>' + dateFieldHTML('m-valid', list[0].valid || '') + '</div><div class="field"><label>연장 승인 Mate 번호<span class="req">*</span></label><input type="text" id="m-mate" placeholder="예: 2026-2687"></div>',
      buttons: [{ label: '취소' }, {
        label: '연장', cls: 'btn-primary', onClick: function (b, setErr) {
          var nv = normDate(b.querySelector('#m-valid').value), nm = b.querySelector('#m-mate').value.trim();
          if (!validDate(nv)) { setErr('새 만료일을 선택하세요.'); return false; }
          if (!nm) { setErr('연장 승인 Mate 번호는 필수입니다.'); return false; }
          var before = snapshotBefore(list);
          list.forEach(function (r) {
            r.valid = nv; r.mate = (r.mate ? r.mate + ' → ' : '') + nm;
            if (r.status === 'PENDING' || r.status === 'EXPIRED') r.status = 'ACTIVE';
            logHist(r, '기간연장', '새 만료일 ' + nv + ' · Mate ' + nm);
          });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '기간연장 (' + list.length + '건)', list.length + '건 연장 완료');
        }
      }]
    });
  }
  function voidModal(list) {
    modal({
      title: '취소 처리', sub: list.length + '건을 취소(VOID)합니다.',
      bodyHtml: '<div class="field"><label>취소 사유<span class="req">*</span></label><input type="text" id="m-reason" placeholder="예: 오발행 / 요청 철회 / 분실"></div>',
      wire: function (b) { b.querySelector('#m-reason').focus(); },
      buttons: [{ label: '닫기' }, {
        label: '취소 처리', cls: 'btn-danger', onClick: function (b, setErr) {
          var rn = b.querySelector('#m-reason').value.trim();
          if (!rn) { setErr('취소 사유를 입력하세요.'); return false; }
          var before = snapshotBefore(list);
          list.forEach(function (r) { r.status = 'VOID'; r.voidReason = rn; logHist(r, '취소', '사유: ' + rn); });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '발행취소 (' + list.length + '건)', list.length + '건 취소');
        }
      }]
    });
  }
  var FIELD_OPTS = [{ k: 'valid', l: '만료일', t: 'date' }, { k: 'cat', l: '사유 카테고리', t: 'cat' }, { k: 'req', l: '요청자', t: 'text' }, { k: 'mate', l: 'Mate 승인번호', t: 'text' }, { k: 'blackout', l: 'Black-out 날짜', t: 'text' }, { k: 'remark', l: '비고', t: 'text' }];
  function fieldSetModal(list) {
    modal({
      title: '일괄 입력', sub: list.length + '건에 같은 값을 적용합니다.',
      bodyHtml: '<div class="field"><label>대상 필드</label><select id="fs-field">' + FIELD_OPTS.map(function (f) { return '<option value="' + f.k + '">' + f.l + '</option>'; }).join('') + '</select></div><div class="field" id="fs-valwrap"></div>',
      wire: function (b) {
        function r() {
          var f = FIELD_OPTS.find(function (x) { return x.k === b.querySelector('#fs-field').value; });
          var w = b.querySelector('#fs-valwrap');
          if (f.t === 'date') w.innerHTML = '<label>값</label>' + dateFieldHTML('fs-val', '');
          else if (f.t === 'cat') w.innerHTML = '<label>값</label><select id="fs-val"><option value="VIP">VIP 예우</option><option value="COMPLAINT">컴플레인 보상</option><option value="STAFF">직원 복리후생</option><option value="PARTNER">제휴/마케팅</option></select>';
          else w.innerHTML = '<label>값</label><input type="text" id="fs-val">';
          CompApp.ui.wireDateBoxes(w);
        }
        b.querySelector('#fs-field').addEventListener('change', r); r();
      },
      buttons: [{ label: '취소' }, {
        label: '적용', cls: 'btn-primary', onClick: function (b, setErr) {
          var f = b.querySelector('#fs-field').value, v = b.querySelector('#fs-val').value;
          if (f === 'valid') { v = normDate(v); if (!validDate(v)) { setErr('만료일을 YYYY-MM-DD 형식으로 입력하세요.'); return false; } }
          if (v === '') { setErr('값을 입력하세요.'); return false; }
          var fl = FIELD_OPTS.find(function (x) { return x.k === f; }).l;
          var before = snapshotBefore(list);
          list.forEach(function (r) {
            if (f === 'blackout') { r.blackoutTags = [{ type: 'text', label: v }]; }
            else { r[f] = v; }
            logHist(r, '일괄입력', fl + ' → ' + (f === 'cat' ? CAT_LABEL[v] : v));
          });
          persist(list);
          state.selected = {}; CompApp.router.refresh();
          finishAction('restore', before, '일괄입력 (' + list.length + '건)', list.length + '건 일괄 입력');
        }
      }]
    });
  }
  function editModal(r) {
    var catOpts = Object.keys(CAT_LABEL).map(function (c) { return '<option value="' + c + '" ' + (r.cat === c ? 'selected' : '') + '>' + CAT_LABEL[c] + '</option>'; }).join('');
    var prodOpts = (r.product ? '' : '<option value="" selected>가져온 원문 유지: ' + esc(r.productText || '') + '</option>') + CATALOG[r.fam].map(function (p) { return '<option value="' + p.id + '" ' + (r.product === p.id ? 'selected' : '') + '>' + p.name + '</option>'; }).join('');
    var boEditor = null;
    modal({
      title: '바우처 수정 · ' + r.serial, sub: '변경 사유를 반드시 입력해야 저장됩니다.', bodyHtml: '<div class="form-grid">'
        + '<div class="field full"><label>바우처 종류</label><select id="e-product">' + prodOpts + '</select></div>'
        + '<div class="field"><label>금액 (원)</label><input type="number" id="e-amount" value="' + (r.amount || 0) + '" step="1000"></div>'
        + '<div class="field"><label>만료일</label>' + dateFieldHTML('e-valid', r.valid || '') + '</div>'
        + '<div class="field"><label>사유 카테고리</label><select id="e-cat">' + catOpts + '</select></div>'
        + '<div class="field"><label>요청자</label><input type="text" id="e-req" value="' + esc(r.req || '') + '"></div>'
        + '<div class="field full"><label>세부 목적</label><textarea id="e-purpose">' + esc(r.purpose || '') + '</textarea></div>'
        + '<div class="field"><label>Mate 승인번호</label><input type="text" id="e-mate" value="' + esc(r.mate || '') + '"></div>'
        + '<div class="field"><label>비고</label><input type="text" id="e-remark" value="' + esc(r.remark || '') + '"></div>'
        + '<div class="field full"><label>Black-out 날짜</label><div id="e-blackout-editor"></div></div>'
        + '<div class="field full"><label>변경 사유<span class="req">*</span></label><input type="text" id="e-reason" placeholder="예: 증서번호 오타 수정 / 만료일 정정"></div></div>',
      wire: function (b) { boEditor = CompApp.ui.wireBlackoutEditor('e-bo', b.querySelector('#e-blackout-editor'), schema.normalizeBlackoutTags(r), CompApp.viewIssue.getBlackouts); },
      buttons: [{ label: '취소' }, {
        label: '저장', cls: 'btn-primary', onClick: function (b, setErr) {
          var reason = b.querySelector('#e-reason').value.trim(); if (!reason) { setErr('변경 사유를 입력해야 저장할 수 있습니다.'); return false; }
          var before = snapshotBefore(r)[0];
          var changes = []; function set(f, nv, lbl) { if (String(r[f] || '') !== String(nv || '')) { changes.push(lbl + ': ' + (r[f] || '—') + ' → ' + (nv || '—')); r[f] = nv; } }
          set('product', b.querySelector('#e-product').value, '종류'); set('amount', parseInt(b.querySelector('#e-amount').value, 10) || 0, '금액');
          set('valid', normDate(b.querySelector('#e-valid').value), '만료일'); set('cat', b.querySelector('#e-cat').value, '사유');
          set('req', b.querySelector('#e-req').value.trim(), '요청자'); set('purpose', b.querySelector('#e-purpose').value.trim(), '목적');
          set('mate', b.querySelector('#e-mate').value.trim(), 'Mate'); set('remark', b.querySelector('#e-remark').value.trim(), '비고');
          var oldBoSummary = schema.blackoutSummary(r), newBoTags = boEditor ? boEditor.getTags() : schema.normalizeBlackoutTags(r);
          r.blackoutTags = newBoTags; var newBoSummary = schema.blackoutSummary(r);
          if (oldBoSummary !== newBoSummary) changes.push('Black-out: ' + (oldBoSummary || '—') + ' → ' + (newBoSummary || '—'));
          if (!changes.length) { toast('변경된 내용이 없습니다.'); return; }
          logHist(r, '수정', reason + ' [' + changes.join(', ') + ']'); persist(r); CompApp.router.refresh();
          finishAction('restore', [before], '수정 (' + r.serial + ')', r.serial + ' 수정 저장');
        }
      }]
    });
  }
  function showDetail(r) {
    var es = effStatus(r);
    var hist = (r.history || []).slice().reverse().map(function (h) { return '<div class="hitem"><span class="ht">' + h.ts + '</span> · <b>' + h.action + '</b> · ' + esc(h.detail || '') + ' <span class="ht">(' + esc(h.actor || '') + ')</span></div>'; }).join('') || '<div class="hitem">이력 없음</div>';
    modal({
      title: r.serial, sub: schema.recordProductLabel(r), bodyHtml: '<dl class="kv">'
        + '<dt>상태</dt><dd><span class="badge ' + STATUS_CLASS[es] + '">' + STATUS_LABEL[es] + '</span></dd>'
        + '<dt>금액</dt><dd>' + money(r.amount) + '</dd>'
        + '<dt>발행일</dt><dd>' + r.issued + '</dd><dt>만료일</dt><dd>' + r.valid + (daysUntil(r.valid) < 0 ? ' <span style="color:var(--warn)">(만료 지남)</span>' : '') + '</dd>'
        + '<dt>사유</dt><dd><span class="cat">' + (CAT_LABEL[r.cat] || r.cat) + '</span></dd>'
        + '<dt>세부 목적</dt><dd>' + esc(r.purpose) + '</dd><dt>요청자</dt><dd>' + esc(r.req || '—') + '</dd>'
        + '<dt>Mate 승인</dt><dd class="mate-no">' + esc(r.mate || '—') + '</dd>'
        + (r.usedDate ? '<dt>사용일</dt><dd>' + r.usedDate + '</dd>' : '')
        + (r.voidReason ? '<dt>취소 사유</dt><dd>' + esc(r.voidReason) + '</dd>' : '')
        + (r.rejectReason ? '<dt>반려 사유</dt><dd>' + esc(r.rejectReason) + '</dd>' : '')
        + (schema.blackoutSummary(r) ? '<dt>Black-out</dt><dd>' + esc(schema.blackoutSummary(r)) + '</dd>' : '')
        + (schema.displayRemark(r.remark) ? '<dt>비고</dt><dd>' + esc(schema.displayRemark(r.remark)) + '</dd>' : '')
        + '</dl><div class="hist"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);margin-bottom:6px">변경 이력</div>' + hist + '</div>',
      buttons: [{ label: '닫기' }, { label: '인쇄', onClick: function () { setTimeout(function () { printRecord(r); }, 60); } }, { label: '수정', cls: 'btn-primary', onClick: function () { setTimeout(function () { editModal(r); }, 60); } }]
    });
  }

  // E: 바우처 발행 확인서 인쇄/PDF — populate the print-only slip and trigger the browser print dialog.
  function printRecord(r) {
    var slip = $('print-slip'); if (!slip) return;
    var es = effStatus(r);
    slip.innerHTML = '<div class="ps-head"><div class="ps-brand">Conrad Seoul</div><div class="ps-title">COMP Voucher 발행 확인서</div></div>'
      + '<dl class="ps-kv">'
      + '<dt>증서번호</dt><dd>' + esc(r.serial) + '</dd>'
      + '<dt>바우처 종류</dt><dd>' + esc(schema.recordProductLabel(r)) + '</dd>'
      + '<dt>발행일</dt><dd>' + esc(r.issued) + '</dd>'
      + '<dt>만료일</dt><dd>' + esc(r.valid) + '</dd>'
      + '<dt>사유</dt><dd>' + esc(CAT_LABEL[r.cat] || r.cat) + '</dd>'
      + '<dt>세부 목적</dt><dd>' + esc(r.purpose || '') + '</dd>'
      + '<dt>요청자</dt><dd>' + esc(r.req || '') + '</dd>'
      + '<dt>Mate 승인</dt><dd>' + esc(r.mate || '—') + '</dd>'
      + '<dt>상태</dt><dd>' + esc(STATUS_LABEL[es] || es) + '</dd>'
      + '</dl>';
    setTimeout(function () { window.print(); }, 50);
  }

  return {
    issue: issue, rowAction: rowAction, bulkAction: bulkAction, logHist: logHist,
    approveModal: approveModal, rejectModal: rejectModal, useModal: useModal, extendModal: extendModal, voidModal: voidModal,
    fieldSetModal: fieldSetModal, editModal: editModal, showDetail: showDetail, printRecord: printRecord,
    recById: recById, selIds: selIds
  };
})();
