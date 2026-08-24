/* CompApp.workflow — the sole mutation point for voucher records: issue/approve/reject/use/
   extend/void/edit/bulk actions + the detail modal. Ported verbatim from the prototype. */
window.CompApp = window.CompApp || {};
CompApp.workflow = (function () {
  "use strict";
  var $ = CompApp.ui.$, modal = CompApp.ui.modal, toast = CompApp.ui.toast, dateFieldHTML = CompApp.ui.dateFieldHTML;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };
  var t2 = function (ko, en) { return CompApp.i18n ? CompApp.i18n.t2(ko, en) : ko; };
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
  function logHist(r, action, detail, batchId) {
    r.history = r.history || [];
    r.history.push({ ts: todayStr(), actor: operator.actor(), action: action, detail: detail });
    var entry = { action: action, detail: detail, recordId: r.id, serial: r.serial, fam: r.fam };
    if (batchId) entry.batchId = batchId;
    pushAuditEntry(entry);
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
    toast(message, { actionLabel: t('되돌리기'), onAction: undo });
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
    toast(t('되돌리기 완료'));
  }

  // ---- issue (form submit) ----
  function issue() {
    var err = $('formerr'); err.textContent = '';
    if (!operator.getOp()) { operator.openOpModal(); return; }
    var issueFam = state.issueFam;
    var product = $('f-product').value, batch = $('f-batch').checked, qty = batch ? Math.max(1, parseInt($('f-qty').value, 10) || 1) : 1;
    // 직접 입력한 증서번호도 공백은 제거한다 — 표기는 접두어+번호 붙여쓰기로 통일(HRF000006).
    var start = ($('f-serial').value.trim() || CompApp.viewIssue.nextSerial(issueFam, product)).replace(/\s+/g, '');
    var iss = normDate($('f-issued').value), val = normDate($('f-valid').value);
    var purpose = $('f-purpose').value.trim(), req = $('f-req').value.trim();
    // 요청자 모드는 자가 승인 불가 — 승인 권한이 있을 때만 GM 승인 체크가 유효하다(폼에서도 숨겨두지만
    // 상태가 남아 새어 들어오지 않도록 여기서 한 번 더 막는다). 요청자 발행은 항상 승인대기로 들어간다.
    // Mate 승인번호는 요청자도 미리 적어 올릴 수 있다 — 승인자는 그 번호를 확인하고 승인만 하면 된다.
    var canAppr = operator.canApprove();
    var gm = canAppr && $('f-gm').checked, mate = $('f-mate').value.trim();
    // 픽업 알림 수신 주소는 담당자 등록에 적어둔 이메일을 요청 건에 그대로 실어 보낸다(별도 명단 없음).
    // 남을 대신해 발행하는 경우(요청자 칸에 내 이름이 없음)엔 붙이지 않는다 — 오발송 방지.
    var reqEmail = operator.isSelfRequest(req) ? operator.opEmail() : '';
    var amount = (prod(issueFam, product) || {}).amount || 0;
    var blackoutTags = CompApp.viewIssue.getBlackoutTags();
    if (!validDate(iss) || !validDate(val)) { err.textContent = t('발행일과 만료일을 YYYY-MM-DD 형식으로 입력하세요.'); return; }
    if (!state.selectedCat) { err.textContent = t('사유 카테고리를 선택하세요.'); return; }
    if (!purpose) { err.textContent = t('세부 목적을 입력하세요.'); return; }
    if (!req) { err.textContent = t('요청 부서/요청자를 입력하세요.'); return; }
    if (gm && !mate) { err.textContent = t('GM 승인 완료 시 Mate 승인번호는 필수입니다.'); return; }
    var status = gm ? 'ACTIVE' : 'PENDING', m = /^([A-Za-z]+)(\s?)(\d+)$/.exec(start);
    var issued = [];
    for (var k = 0; k < qty; k++) {
      var serial = m ? m[1] + m[2] + String(parseInt(m[3], 10) + k).padStart(m[3].length, '0') : start + (qty > 1 ? '-' + (k + 1) : '');
      var r = { id: schema.uid(), fam: issueFam, serial: serial, product: product, amount: amount, issued: iss, valid: val, cat: state.selectedCat, purpose: purpose, req: req, reqEmail: reqEmail, mate: mate, remark: $('f-remark').value.trim(), blackoutTags: blackoutTags.slice(), status: status, history: [] };
      logHist(r, '발행', gm ? ('발행·즉시활성 · Mate ' + mate) : ('발행 요청 (승인대기) · ' + (mate ? 'Mate ' + mate : 'Mate 번호 미기재')));
      records().unshift(r);
      issued.push(r);
    }
    persist(issued);
    CompApp.router.renderCounts();
    // 승인대기로 들어간 건은 목록이 아니라 승인 대기함으로 보낸다 — 요청이 어디로 갔는지 바로 보이도록.
    if (status === 'PENDING') CompApp.router.goListFiltered({ status: 'PENDING', nav: 'approvals', silent: true, title: '승인 대기함', desc: 'Mate 승인번호 확인 후 승인 · 번호가 없으면 대기 유지' });
    else CompApp.router.go('list');
    finishAction('remove', { ids: issued.map(function (r) { return r.id; }), serials: issued.map(function (r) { return r.serial; }), fam: issueFam },
      '발행 (' + issued.length + '건)', (qty > 1 ? qty + t('장 ') : '') + (gm ? t('발행 등록 완료') : t('발행 요청 완료 (승인대기)')));
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
    if (!rs.length) { toast(t('선택된 항목이 없습니다.')); return; }
    if (kind === 'approve') { var p = rs.filter(function (r) { return r.status === 'PENDING'; }); if (!p.length) { toast(t('승인대기 상태인 선택 항목이 없습니다.')); return; } return approveModal(p); }
    if (kind === 'reject') { var rj = rs.filter(function (r) { return r.status === 'PENDING'; }); if (!rj.length) { toast(t('승인대기 상태인 선택 항목이 없습니다.')); return; } return rejectModal(rj); }
    if (kind === 'use') { var a = rs.filter(function (r) { return r.status === 'ACTIVE' || r.status === 'EXPIRED'; }); if (!a.length) { toast(t('사용 처리 가능한(활성·만료) 선택 항목이 없습니다.')); return; } return useModal(a); }
    if (kind === 'extend') { var a2 = rs.filter(function (r) { return r.status === 'ACTIVE' || r.status === 'PENDING' || r.status === 'EXPIRED'; }); if (!a2.length) { toast(t('연장 가능한 항목이 없습니다.')); return; } return extendModal(a2); }
    if (kind === 'void') { var v = rs.filter(function (r) { return r.status === 'ACTIVE' || r.status === 'PENDING'; }); if (!v.length) { toast(t('취소 가능한 항목이 없습니다.')); return; } return voidModal(v); }
    // 픽업 흐름 — 승인자/관리자만. 각 단계에 해당하는 건만 골라서 넘긴다.
    if (kind === 'printed' || kind === 'notify' || kind === 'pickedup') {
      if (!operator.canApprove()) { toast(t('픽업 처리 권한이 없습니다. (승인자·관리자만 가능)')); return; }
      var want = kind === 'printed' ? 'TOPRINT' : 'TOPICKUP';
      var pk = rs.filter(function (r) { return schema.pickupState(r) === want; });
      if (!pk.length) { toast(kind === 'printed' ? t('인쇄대기 상태인 선택 항목이 없습니다.') : t('픽업대기 상태인 선택 항목이 없습니다. (먼저 [인쇄완료] 표시)')); return; }
      if (kind === 'printed') return markPrintedModal(pk);
      if (kind === 'notify') return notifyPickupModal(pk);
      return markPickedUpModal(pk);
    }
    if (kind === 'field') return fieldSetModal(rs);
    if (kind === 'delete') {
      if (!operator.canAdmin()) { toast(t('삭제 권한이 없습니다. (관리자 모드에서만 가능)')); return; }
      return deleteModal(rs);
    }
  }

  // 관리자 전용: 선택한 바우처를 영구 삭제. 취소(VOID)와 달리 목록에서 완전히 제거됨 —
  // 오발행/테스트 데이터 정리용. 1단계 되돌리기로 복구 가능.
  function deleteModal(list) {
    modal({
      title: t('바우처 삭제'), sub: list.length + t('건을 목록에서 완전히 삭제합니다. 이 작업은 관리자만 할 수 있습니다.'),
      bodyHtml: '<div class="field"><label>' + t('삭제 사유') + '<span class="req">*</span></label><input type="text" id="m-reason" placeholder="' + esc(t('예: 오발행 / 테스트 데이터 / 중복 등록')) + '"></div>',
      wire: function (b) { b.querySelector('#m-reason').focus(); },
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('삭제'), cls: 'btn-danger', onClick: function (b, setErr) {
          var rn = b.querySelector('#m-reason').value.trim();
          if (!rn) { setErr(t('삭제 사유를 입력하세요.')); return false; }
          var before = snapshotBefore(list);
          var batchId = schema.uid();
          list.forEach(function (r) {
            var idx = records().findIndex(function (x) { return x.id === r.id; });
            if (idx !== -1) records().splice(idx, 1);
            if (CompApp.cloudEnabled && CompApp.cloudEnabled()) CompApp.dbCloud.remove(r.id).catch(function (e) { console.warn('cloud delete failed for', r.id, e); });
            pushAuditEntry({ action: '삭제', detail: '사유: ' + rn, recordId: r.id, serial: r.serial, fam: r.fam, batchId: batchId });
          });
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('reinsert', before, '삭제 (' + list.length + '건)', list.length + t('건 삭제 완료'));
        }
      }]
    });
  }

  // 요청자가 요청 시 Mate 승인번호를 미리 적어 올릴 수 있으므로, 승인 화면은 그 번호를 그대로 보여주고
  // 승인자는 확인만 하면 되게 한다. 번호가 없는 요청은 승인할 수 없고(입력 필수) 대기함에 남는다 —
  // 나중에 번호가 나오면 [수정]이나 [일괄입력]으로 채워 넣은 뒤 승인하면 된다.
  function approveModal(list) {
    var mates = list.map(function (r) { return (r.mate || '').trim(); });
    var filled = mates.filter(Boolean);
    var uniq = filled.filter(function (v, i, a) { return a.indexOf(v) === i; });
    var pre = uniq.length === 1 ? uniq[0] : '';
    var hint;
    if (!filled.length) hint = t('요청 시 기재된 Mate 승인번호가 없습니다. 승인번호를 입력해야 승인할 수 있습니다 — 아직 GM 승인 전이라면 그대로 두고 대기함에 남겨두세요.');
    else if (uniq.length === 1 && filled.length === list.length) hint = t('요청 시 기재된 번호입니다. 확인 후 승인하세요.');
    else hint = t('선택한 ') + list.length + t('건 중 ') + (list.length - filled.length) + t('건은 번호가 없고, 기재된 번호는 ') + uniq.length + t('종류입니다. 여기 입력한 번호가 ') + list.length + t('건 전체에 적용됩니다.');
    modal({
      title: t('GM 승인 처리'), sub: list.length + t('건을 활성화합니다. Mate 승인번호를 확인하세요.'),
      bodyHtml: '<div class="modal-hint">' + hint + '</div>'
        + '<div class="field"><label>' + t('Mate 승인번호') + '<span class="req">*</span></label><input type="text" id="m-mate" placeholder="' + esc(t('예: 2026-4224')) + '" value="' + esc(pre) + '"></div>',
      wire: function (b) { b.querySelector('#m-mate').focus(); },
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('승인 완료'), cls: 'btn-primary', onClick: function (b, setErr) {
          var mate = b.querySelector('#m-mate').value.trim();
          if (!mate) { setErr(t('Mate 승인번호는 필수입니다. 아직 번호가 없다면 승인하지 말고 대기함에 두세요.')); return false; }
          var before = snapshotBefore(list);
          var batchId = schema.uid();
          list.forEach(function (r) {
            var prev = (r.mate || '').trim();
            r.status = 'ACTIVE'; r.mate = mate;
            logHist(r, '승인', 'GM 승인 · Mate ' + mate + (prev && prev !== mate ? ' (요청 시 기재: ' + prev + ')' : ''), batchId);
          });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '승인 (' + list.length + '건)', list.length + t('건 승인 완료'));
        }
      }]
    });
  }
  function rejectModal(list) {
    modal({
      title: t('요청 반려'), sub: list.length + t('건을 반려 처리합니다. 반려 사유를 입력하세요.'),
      bodyHtml: '<div class="field"><label>' + t('반려 사유') + '<span class="req">*</span></label><input type="text" id="m-reason" placeholder="' + esc(t('예: 사유 불명확 / 중복 요청 / 예산 초과')) + '"></div>',
      wire: function (b) { b.querySelector('#m-reason').focus(); },
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('반려 처리'), cls: 'btn-danger', onClick: function (b, setErr) {
          var rn = b.querySelector('#m-reason').value.trim();
          if (!rn) { setErr(t('반려 사유를 입력하세요.')); return false; }
          var before = snapshotBefore(list);
          var batchId = schema.uid();
          list.forEach(function (r) { r.status = 'REJECTED'; r.rejectReason = rn; logHist(r, '반려', '사유: ' + rn, batchId); });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '반려 (' + list.length + '건)', list.length + t('건 반려'));
        }
      }]
    });
  }
  // 만료(EXPIRED) 건도 대상에 포함된다 — 유효기간 안에 실제로 사용한 바우처를 만료일이 지난 뒤에
  // 뒤늦게 등록하는 경우가 실무에서 가장 흔하기 때문. 대신 사용일이 만료일보다 늦으면 막는다
  // (그건 소급 등록이 아니라 만료 후 사용이므로 먼저 [연장]으로 만료일을 조정해야 함).
  function useModal(list) {
    var expiredCnt = list.filter(function (r) { return r.status === 'EXPIRED'; }).length;
    var minValid = list.reduce(function (m, r) { return (r.valid && (!m || r.valid < m)) ? r.valid : m; }, '');
    var defDate = (minValid && minValid < todayStr()) ? minValid : todayStr();  // 선택 건 전체에 유효한 가장 늦은 날짜
    modal({
      title: t('사용 처리'), sub: list.length + t('건을 사용 처리합니다.') + (expiredCnt ? t(' (만료 ') + expiredCnt + t('건 포함)') : ''),
      bodyHtml: (expiredCnt ? '<div class="modal-hint">※ ' + t('만료된 바우처 ') + expiredCnt + t('건이 포함되어 있습니다. 만료일 이전에 실제로 사용한 건을 뒤늦게 등록하는 경우이므로, ') + '<b>' + t('실제 사용한 날짜') + '</b>' + t('를 입력하세요(만료일 이후 날짜는 입력할 수 없습니다).') + '</div>' : '')
        + '<div class="field"><label>' + t('사용일') + '<span class="req">*</span></label>' + dateFieldHTML('m-date', defDate) + '</div><div class="field"><label>' + t('사용 메모') + ' <span class="opt">' + t('(선택)') + '</span></label><input type="text" id="m-note" placeholder="' + esc(t('예: 객실번호 / 투숙객명')) + '"></div>',
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('사용 처리'), cls: 'btn-primary', onClick: function (b, setErr) {
          var d = normDate(b.querySelector('#m-date').value);
          if (!validDate(d)) { setErr(t('사용일을 선택하세요.')); return false; }
          var late = list.filter(function (r) { return r.valid && d > r.valid; });
          if (late.length) {
            setErr(t('사용일이 만료일보다 늦습니다 — ') + late.slice(0, 3).map(function (r) { return r.serial + t('(만료 ') + r.valid + ')'; }).join(', ')
              + (late.length > 3 ? t2(' 외 ' + (late.length - 3) + '건', ' and ' + (late.length - 3) + ' more') : '')
              + t2('. 실제 사용일로 고치거나, 만료 후 사용을 인정하려면 먼저 [연장]으로 만료일을 조정하세요.', '. Correct the use date, or [Extend] the expiry first if the late use should be honored.'));
            return false;
          }
          var note = b.querySelector('#m-note').value.trim();
          var before = snapshotBefore(list);
          var batchId = schema.uid();
          list.forEach(function (r) {
            var retro = r.status === 'EXPIRED';
            r.status = 'USED'; r.usedDate = d;
            logHist(r, '사용', '사용일 ' + d + (retro ? ' · 만료 후 소급 등록(만료일 ' + r.valid + ')' : '') + (note ? ' · ' + note : ''), batchId);
          });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '사용 처리 (' + list.length + '건)', list.length + t('건 사용 처리'));
        }
      }]
    });
  }
  // ---- 픽업 흐름: 인쇄완료 → (요청자 알림) → 픽업완료 ----
  // 인쇄 자체는 전용 용지·프린터로 따로 하므로 앱은 "인쇄했다"는 표시만 받는다.
  function markPrintedModal(list) {
    modal({
      title: t('인쇄 완료 표시'), sub: list.length + t('건을 인쇄 완료(픽업 대기)로 표시합니다.'),
      bodyHtml: '<div class="modal-hint">' + t('실물 인쇄가 끝난 건만 표시하세요. 표시하면 ') + '<b>' + t('픽업 대기함') + '</b>' + t('으로 넘어가고, 요청자에게 픽업 알림을 보낼 수 있습니다.') + '</div>'
        + '<div class="field"><label>' + t('인쇄일') + '<span class="req">*</span></label>' + dateFieldHTML('m-date', todayStr()) + '</div>',
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('인쇄 완료'), cls: 'btn-primary', onClick: function (b, setErr) {
          var d = normDate(b.querySelector('#m-date').value);
          if (!validDate(d)) { setErr(t('인쇄일을 입력하세요.')); return false; }
          var before = snapshotBefore(list);
          var batchId = schema.uid();
          list.forEach(function (r) { r.printedAt = d; r.printedBy = operator.actor(); logHist(r, '인쇄완료', '인쇄일 ' + d, batchId); });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '인쇄완료 (' + list.length + '건)', list.length + t('건 인쇄 완료 · 픽업 대기'));
        }
      }]
    });
  }

  // 요청자별로 묶어 Outlook 새 메일을 열어 준다(mailto). 서버·API 키 없이 회사 메일 그대로 나가고,
  // 발신자가 실제 담당자라 회신도 자연스럽다. 보내기는 사람이 누른다.
  function notifyPickupModal(list) {
    var PLACE_KEY = 'compVoucherPickupPlace';
    var place = CompApp.metaStore.get(PLACE_KEY, '4층 Finance Office (평일 09:00–17:00)');
    // 주소는 레코드에 실려 있다(요청자가 담당자 등록 때 적은 이메일). 없는 건 — 과거 이관분이나
    // 대리 발행분 — 은 여기서 한 번 입력하면 그 레코드에 저장돼 다음부터는 자동으로 잡힌다.
    var groups = [];
    list.forEach(function (r) {
      var req = (r.req || '').trim() || t('(요청자 미기재)');
      var mail = (r.reqEmail || '').trim();
      var key = mail ? mail.toLowerCase() : ('?' + req.toLowerCase());
      var g = null;
      groups.forEach(function (x) { if (x.key === key) g = x; });
      if (!g) { g = { key: key, name: req, req: req, email: mail, recs: [] }; groups.push(g); }
      g.recs.push(r);
    });
    function body() {
      return '<div class="modal-hint">' + t('요청자별로 메일을 나눠 엽니다. [메일 열기]를 누르면 Outlook에 내용이 채워진 새 메일이 뜨고, ') + '<b>' + t('보내기는 직접') + '</b>' + t(' 누르시면 됩니다. 주소는 요청자가 담당자 등록 때 적은 이메일이 자동으로 들어오고, 비어 있으면 여기서 입력하면 ') + '<b>' + t('해당 건에 저장') + '</b>' + t('돼 다음부터 자동으로 잡힙니다.') + '</div>'
        + '<div class="field"><label>' + t('픽업 안내 문구') + '</label><input type="text" id="pk-place" value="' + esc(place) + '"></div>'
        + groups.map(function (g, i) {
          return '<div class="pkrow" data-i="' + i + '">'
            + '<div class="pkrow-h"><b>' + esc(g.name) + '</b> <span class="dim">· ' + g.recs.length + t('건') + '</span>'
            + (g.recs[0] && g.recs[0].notifiedAt ? ' <span class="dim">' + t2('(알림 ' + esc(g.recs[0].notifiedAt) + ')', '(notified ' + esc(g.recs[0].notifiedAt) + ')') + '</span>' : '') + '</div>'
            + '<div class="pkrow-b"><input type="text" class="pk-mail" data-i="' + i + '" placeholder="' + esc(t('이메일 주소')) + '" value="' + esc(g.email) + '">'
            + '<button type="button" class="btn btn-primary btn-sm pk-open" data-i="' + i + '">' + t('메일 열기') + '</button></div>'
            + '<div class="pkrow-s">' + esc(g.recs.map(function (r) { return r.serial; }).slice(0, 6).join(', ')) + (g.recs.length > 6 ? t2(' 외 ' + (g.recs.length - 6) + '건', ' and ' + (g.recs.length - 6) + ' more') : '') + '</div>'
            + '</div>';
        }).join('');
    }
    function mailBody(g, placeText) {
      var lines = ['안녕하세요, ' + g.name + '님', '', '요청하신 COMP 바우처가 준비되었습니다. 아래 안내에 따라 수령해 주세요.', ''];
      g.recs.slice(0, 30).forEach(function (r) {
        lines.push('· ' + r.serial + ' | ' + schema.recordProductLabel(r) + ' | 유효기간 ~' + (r.valid || '') + (r.purpose ? ' | ' + r.purpose : ''));
      });
      if (g.recs.length > 30) lines.push('· 외 ' + (g.recs.length - 30) + '건');
      lines.push('', '픽업 장소: ' + placeText, '', '감사합니다.', 'Conrad Seoul Finance');
      return lines.join('\r\n');
    }
    modal({
      title: t('픽업 알림'), sub: list.length + t('건') + t(' · 요청자 ') + groups.length + t('명'), bodyHtml: body(),
      buttons: [{ label: t('닫기') }],
      wire: function wire(b) {
        b.querySelectorAll('.pk-open').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var i = parseInt(btn.dataset.i, 10), g = groups[i];
            var mail = b.querySelector('.pk-mail[data-i="' + i + '"]').value.trim();
            if (!mail) { toast(t('이메일 주소를 입력하세요.')); return; }
            var placeText = b.querySelector('#pk-place').value.trim();
            if (placeText !== place) { place = placeText; CompApp.metaStore.set(PLACE_KEY, place); }
            var subject = '[Conrad Seoul] COMP 바우처 ' + g.recs.length + '건 픽업 안내';
            window.location.href = 'mailto:' + encodeURIComponent(mail)
              + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(mailBody(g, placeText));
            var today = todayStr(), batchId = schema.uid();
            g.recs.forEach(function (r) {
              r.notifiedAt = today; r.notifiedTo = mail;
              if (!r.reqEmail) r.reqEmail = mail;   // 다음 알림 때 다시 묻지 않도록 레코드에 남긴다
              logHist(r, '픽업 알림', mail + ' 앞 메일 작성', batchId);
            });
            persist(g.recs);
            g.email = mail;
            CompApp.router.refresh();
            toast(g.name + t('님 앞 메일을 열었습니다 (') + g.recs.length + t('건) — Outlook에서 보내기를 눌러주세요.'));
            b.innerHTML = body(); wire(b);
          });
        });
      }
    });
  }

  function markPickedUpModal(list) {
    var notNotified = list.filter(function (r) { return !r.notifiedAt; }).length;
    modal({
      title: t('픽업 완료'), sub: list.length + t('건을 요청자가 수령한 것으로 처리합니다.'),
      bodyHtml: (notNotified ? '<div class="modal-hint">' + notNotified + t('건은 아직 픽업 알림을 보내지 않은 건입니다. 직접 전달하신 경우라면 그대로 진행하세요.') + '</div>' : '')
        + '<div class="field"><label>' + t('수령일') + '<span class="req">*</span></label>' + dateFieldHTML('m-date', todayStr()) + '</div>'
        + '<div class="field"><label>' + t('수령자') + ' <span class="opt">' + t('(선택)') + '</span></label><input type="text" id="m-by" placeholder="' + esc(t('비우면 요청자 이름으로 기록')) + '"></div>',
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('픽업 완료'), cls: 'btn-primary', onClick: function (b, setErr) {
          var d = normDate(b.querySelector('#m-date').value);
          if (!validDate(d)) { setErr(t('수령일을 입력하세요.')); return false; }
          var by = b.querySelector('#m-by').value.trim();
          var before = snapshotBefore(list);
          var batchId = schema.uid();
          list.forEach(function (r) {
            r.pickedUpAt = d; r.pickedUpBy = by || (r.req || '');
            logHist(r, '픽업완료', '수령일 ' + d + (r.pickedUpBy ? ' · ' + r.pickedUpBy : ''), batchId);
          });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '픽업완료 (' + list.length + '건)', list.length + t('건 픽업 완료'));
        }
      }]
    });
  }

  function extendModal(list) {
    modal({
      title: t('유효기간 연장'), sub: list.length + t('건 연장 · GM 재승인 필요'),
      bodyHtml: '<div class="field"><label>' + t('새 만료일') + '<span class="req">*</span></label>' + dateFieldHTML('m-valid', list[0].valid || '') + '</div><div class="field"><label>' + t('연장 승인 Mate 번호') + '<span class="req">*</span></label><input type="text" id="m-mate" placeholder="' + esc(t('예: 2026-2687')) + '"></div>',
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('연장'), cls: 'btn-primary', onClick: function (b, setErr) {
          var nv = normDate(b.querySelector('#m-valid').value), nm = b.querySelector('#m-mate').value.trim();
          if (!validDate(nv)) { setErr(t('새 만료일을 선택하세요.')); return false; }
          if (!nm) { setErr(t('연장 승인 Mate 번호는 필수입니다.')); return false; }
          var before = snapshotBefore(list);
          var batchId = schema.uid();
          list.forEach(function (r) {
            r.valid = nv; r.mate = (r.mate ? r.mate + ' → ' : '') + nm;
            if (r.status === 'PENDING' || r.status === 'EXPIRED') r.status = 'ACTIVE';
            logHist(r, '기간연장', '새 만료일 ' + nv + ' · Mate ' + nm, batchId);
          });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '기간연장 (' + list.length + '건)', list.length + t('건 연장 완료'));
        }
      }]
    });
  }
  function voidModal(list) {
    modal({
      title: t('취소 처리'), sub: list.length + t('건을 취소(VOID)합니다.'),
      bodyHtml: '<div class="field"><label>' + t('취소 사유') + '<span class="req">*</span></label><input type="text" id="m-reason" placeholder="' + esc(t('예: 오발행 / 요청 철회 / 분실')) + '"></div>',
      wire: function (b) { b.querySelector('#m-reason').focus(); },
      buttons: [{ label: t('닫기') }, {
        label: t('취소 처리'), cls: 'btn-danger', onClick: function (b, setErr) {
          var rn = b.querySelector('#m-reason').value.trim();
          if (!rn) { setErr(t('취소 사유를 입력하세요.')); return false; }
          var before = snapshotBefore(list);
          var batchId = schema.uid();
          list.forEach(function (r) { r.status = 'VOID'; r.voidReason = rn; logHist(r, '취소', '사유: ' + rn, batchId); });
          persist(list);
          state.selected = {}; CompApp.router.renderCounts(); CompApp.router.refresh();
          finishAction('restore', before, '발행취소 (' + list.length + '건)', list.length + t('건 취소'));
        }
      }]
    });
  }
  var FIELD_OPTS = [{ k: 'valid', l: '만료일', t: 'date' }, { k: 'cat', l: '사유 카테고리', t: 'cat' }, { k: 'req', l: '요청자', t: 'text' }, { k: 'mate', l: 'Mate 승인번호', t: 'text' }, { k: 'blackout', l: 'Black-out 날짜', t: 'text' }, { k: 'remark', l: '비고', t: 'text' }];
  function fieldSetModal(list) {
    modal({
      title: t('일괄 입력'), sub: list.length + t('건에 같은 값을 적용합니다.'),
      bodyHtml: '<div class="field"><label>' + t('대상 필드') + '</label><select id="fs-field">' + FIELD_OPTS.map(function (f) { return '<option value="' + f.k + '">' + t(f.l) + '</option>'; }).join('') + '</select></div><div class="field" id="fs-valwrap"></div>',
      wire: function (b) {
        function r() {
          var f = FIELD_OPTS.find(function (x) { return x.k === b.querySelector('#fs-field').value; });
          var w = b.querySelector('#fs-valwrap');
          if (f.t === 'date') w.innerHTML = '<label>' + t('값') + '</label>' + dateFieldHTML('fs-val', '');
          else if (f.t === 'cat') w.innerHTML = '<label>' + t('값') + '</label><select id="fs-val"><option value="VIP">' + t('VIP 예우') + '</option><option value="COMPLAINT">' + t('컴플레인 보상') + '</option><option value="STAFF">' + t('직원 복리후생') + '</option><option value="PARTNER">' + t('제휴/마케팅') + '</option></select>';
          else w.innerHTML = '<label>' + t('값') + '</label><input type="text" id="fs-val">';
          CompApp.ui.wireDateBoxes(w);
        }
        b.querySelector('#fs-field').addEventListener('change', r); r();
      },
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('적용'), cls: 'btn-primary', onClick: function (b, setErr) {
          var f = b.querySelector('#fs-field').value, v = b.querySelector('#fs-val').value;
          if (f === 'valid') { v = normDate(v); if (!validDate(v)) { setErr(t('만료일을 YYYY-MM-DD 형식으로 입력하세요.')); return false; } }
          if (v === '') { setErr(t('값을 입력하세요.')); return false; }
          var fl = FIELD_OPTS.find(function (x) { return x.k === f; }).l;
          var before = snapshotBefore(list);
          var batchId = schema.uid();
          list.forEach(function (r) {
            if (f === 'blackout') { r.blackoutTags = [{ type: 'text', label: v }]; }
            else { r[f] = v; }
            logHist(r, '일괄입력', fl + ' → ' + (f === 'cat' ? CAT_LABEL[v] : v), batchId);
          });
          persist(list);
          state.selected = {}; CompApp.router.refresh();
          finishAction('restore', before, '일괄입력 (' + list.length + '건)', list.length + t('건 일괄 입력'));
        }
      }]
    });
  }
  function editModal(r) {
    var catOpts = Object.keys(CAT_LABEL).map(function (c) { return '<option value="' + c + '" ' + (r.cat === c ? 'selected' : '') + '>' + schema.catLabel(c) + '</option>'; }).join('');
    var prodOpts = (r.product ? '' : '<option value="" selected>' + t('가져온 원문 유지: ') + esc(r.productText || '') + '</option>') + CATALOG[r.fam].map(function (p) { return '<option value="' + p.id + '" ' + (r.product === p.id ? 'selected' : '') + '>' + t(p.name) + '</option>'; }).join('');
    var boEditor = null;
    modal({
      title: t('바우처 수정 · ') + r.serial, sub: t('변경 사유를 반드시 입력해야 저장됩니다.'), bodyHtml: '<div class="form-grid">'
        + '<div class="field full"><label>' + t('바우처 종류') + '</label><select id="e-product">' + prodOpts + '</select></div>'
        + '<div class="field"><label>' + t('금액 (원)') + '</label><input type="number" id="e-amount" value="' + (r.amount || 0) + '" step="1000"></div>'
        + '<div class="field"><label>' + t('만료일') + '</label>' + dateFieldHTML('e-valid', r.valid || '') + '</div>'
        + '<div class="field"><label>' + t('사유 카테고리') + '</label><select id="e-cat">' + catOpts + '</select></div>'
        + '<div class="field"><label>' + t('요청자') + '</label><input type="text" id="e-req" value="' + esc(r.req || '') + '"></div>'
        + '<div class="field"><label>' + t('요청자 이메일') + ' <span class="opt">' + t('(픽업 알림용)') + '</span></label><input type="text" id="e-reqmail" value="' + esc(r.reqEmail || '') + '"></div>'
        + '<div class="field full"><label>' + t('세부 목적') + '</label><textarea id="e-purpose">' + esc(r.purpose || '') + '</textarea></div>'
        + '<div class="field"><label>' + t('Mate 승인번호') + '</label><input type="text" id="e-mate" value="' + esc(r.mate || '') + '"></div>'
        + '<div class="field"><label>' + t('비고') + '</label><input type="text" id="e-remark" value="' + esc(r.remark || '') + '"></div>'
        + '<div class="field full"><label>' + t('Black-out 날짜') + '</label><div id="e-blackout-editor"></div></div>'
        + '<div class="field full"><label>' + t('변경 사유') + '<span class="req">*</span></label><input type="text" id="e-reason" placeholder="' + esc(t('예: 증서번호 오타 수정 / 만료일 정정')) + '"></div></div>',
      wire: function (b) { boEditor = CompApp.ui.wireBlackoutEditor('e-bo', b.querySelector('#e-blackout-editor'), schema.normalizeBlackoutTags(r), CompApp.viewIssue.getBlackouts); },
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('저장'), cls: 'btn-primary', onClick: function (b, setErr) {
          var reason = b.querySelector('#e-reason').value.trim(); if (!reason) { setErr(t('변경 사유를 입력해야 저장할 수 있습니다.')); return false; }
          var before = snapshotBefore(r)[0];
          var changes = []; function set(f, nv, lbl) { if (String(r[f] || '') !== String(nv || '')) { changes.push(lbl + ': ' + (r[f] || '—') + ' → ' + (nv || '—')); r[f] = nv; } }
          set('product', b.querySelector('#e-product').value, '종류'); set('amount', parseInt(b.querySelector('#e-amount').value, 10) || 0, '금액');
          set('valid', normDate(b.querySelector('#e-valid').value), '만료일'); set('cat', b.querySelector('#e-cat').value, '사유');
          set('req', b.querySelector('#e-req').value.trim(), '요청자'); set('purpose', b.querySelector('#e-purpose').value.trim(), '목적');
          set('mate', b.querySelector('#e-mate').value.trim(), 'Mate'); set('remark', b.querySelector('#e-remark').value.trim(), '비고');
          set('reqEmail', b.querySelector('#e-reqmail').value.trim(), '요청자 이메일');
          var oldBoSummary = schema.blackoutSummary(r), newBoTags = boEditor ? boEditor.getTags() : schema.normalizeBlackoutTags(r);
          r.blackoutTags = newBoTags; var newBoSummary = schema.blackoutSummary(r);
          if (oldBoSummary !== newBoSummary) changes.push('Black-out: ' + (oldBoSummary || '—') + ' → ' + (newBoSummary || '—'));
          if (!changes.length) { toast(t('변경된 내용이 없습니다.')); return; }
          logHist(r, '수정', reason + ' [' + changes.join(', ') + ']'); persist(r); CompApp.router.refresh();
          finishAction('restore', [before], '수정 (' + r.serial + ')', r.serial + t(' 수정 저장'));
        }
      }]
    });
  }
  function showDetail(r) {
    var es = effStatus(r);
    var hist = (r.history || []).slice().reverse().map(function (h) { return '<div class="hitem"><span class="ht">' + h.ts + '</span> · <b>' + t(h.action) + '</b> · ' + esc(h.detail || '') + ' <span class="ht">(' + esc(h.actor || '') + ')</span></div>'; }).join('') || '<div class="hitem">' + t('이력 없음') + '</div>';
    modal({
      title: r.serial, sub: schema.recordProductLabel(r), bodyHtml: '<dl class="kv">'
        + '<dt>' + t('상태') + '</dt><dd><span class="badge ' + STATUS_CLASS[es] + '">' + schema.statusLabel(es) + '</span></dd>'
        + '<dt>' + t('금액') + '</dt><dd>' + money(r.amount) + '</dd>'
        + '<dt>' + t('발행일') + '</dt><dd>' + r.issued + '</dd><dt>' + t('만료일') + '</dt><dd>' + r.valid + (daysUntil(r.valid) < 0 ? ' <span style="color:var(--warn)">' + t('(만료 지남)') + '</span>' : '') + '</dd>'
        + '<dt>' + t('사유') + '</dt><dd><span class="cat">' + schema.catLabel(r.cat) + '</span></dd>'
        + '<dt>' + t('세부 목적') + '</dt><dd>' + esc(r.purpose) + '</dd><dt>' + t('요청자') + '</dt><dd>' + esc(r.req || '—') + (r.reqEmail ? ' <span style="color:var(--ink-3)">· ' + esc(r.reqEmail) + '</span>' : '') + '</dd>'
        + '<dt>' + t('Mate 승인') + '</dt><dd class="mate-no">' + esc(r.mate || '—') + '</dd>'
        + (r.usedDate ? '<dt>' + t('사용일') + '</dt><dd>' + r.usedDate + '</dd>' : '')
        + (schema.pickupState(r) ? '<dt>' + t('픽업') + '</dt><dd><span class="pkbadge ' + schema.PICKUP_CLASS[schema.pickupState(r)] + '">' + schema.pickupLabel(schema.pickupState(r)) + '</span>'
          + (r.printedAt ? ' · ' + t('인쇄 ') + r.printedAt : '')
          + (r.notifiedAt ? t(' · 알림 ') + r.notifiedAt + (r.notifiedTo ? ' (' + esc(r.notifiedTo) + ')' : '') : '')
          + (r.pickedUpAt ? t(' · 수령 ') + r.pickedUpAt + (r.pickedUpBy ? ' (' + esc(r.pickedUpBy) + ')' : '') : '') + '</dd>' : '')
        + (r.voidReason ? '<dt>' + t('취소 사유') + '</dt><dd>' + esc(r.voidReason) + '</dd>' : '')
        + (r.rejectReason ? '<dt>' + t('반려 사유') + '</dt><dd>' + esc(r.rejectReason) + '</dd>' : '')
        + (schema.blackoutSummary(r) ? '<dt>Black-out</dt><dd>' + esc(schema.blackoutSummary(r)) + '</dd>' : '')
        + (schema.displayRemark(r.remark) ? '<dt>' + t('비고') + '</dt><dd>' + esc(schema.displayRemark(r.remark)) + '</dd>' : '')
        + '</dl><div class="hist"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);margin-bottom:6px">' + t('변경 이력') + '</div>' + hist + '</div>',
      buttons: [{ label: t('닫기') }, { label: t('인쇄'), onClick: function () { setTimeout(function () { printRecord(r); }, 60); } }, { label: t('수정'), cls: 'btn-primary', onClick: function () { setTimeout(function () { editModal(r); }, 60); } }]
    });
  }

  // E: 바우처 발행 확인서 인쇄/PDF — populate the print-only slip and trigger the browser print dialog.
  function printRecord(r) {
    var slip = $('print-slip'); if (!slip) return;
    var es = effStatus(r);
    slip.innerHTML = '<div class="ps-head"><div class="ps-brand">Conrad Seoul</div><div class="ps-title">' + t('COMP Voucher 발행 확인서') + '</div></div>'
      + '<dl class="ps-kv">'
      + '<dt>' + t('증서번호') + '</dt><dd>' + esc(r.serial) + '</dd>'
      + '<dt>' + t('바우처 종류') + '</dt><dd>' + esc(schema.recordProductLabel(r)) + '</dd>'
      + '<dt>' + t('발행일') + '</dt><dd>' + esc(r.issued) + '</dd>'
      + '<dt>' + t('만료일') + '</dt><dd>' + esc(r.valid) + '</dd>'
      + '<dt>' + t('사유') + '</dt><dd>' + esc(schema.catLabel(r.cat)) + '</dd>'
      + '<dt>' + t('세부 목적') + '</dt><dd>' + esc(r.purpose || '') + '</dd>'
      + '<dt>' + t('요청자') + '</dt><dd>' + esc(r.req || '') + '</dd>'
      + '<dt>' + t('Mate 승인') + '</dt><dd>' + esc(r.mate || '—') + '</dd>'
      + '<dt>' + t('상태') + '</dt><dd>' + esc(schema.statusLabel(es)) + '</dd>'
      + '</dl>';
    setTimeout(function () { window.print(); }, 50);
  }

  // 자동 만료 처리: 상태가 ACTIVE인데 만료일이 오늘보다 지난 건을 자동으로 EXPIRED로 전환.
  // 앱 로드 시(app.js boot) 매번 한 번 실행되어, 정합성 점검의 "만료 미처리" 항목이 쌓이지 않게 한다.
  function autoExpireStale() {
    var today = todayStr();
    var stale = records().filter(function (r) { return r.status === 'ACTIVE' && r.valid && r.valid < today; });
    if (!stale.length) return 0;
    var batchId = schema.uid();
    stale.forEach(function (r) { r.status = 'EXPIRED'; logHist(r, '자동 만료', '만료일(' + r.valid + ') 경과로 자동 상태 변경', batchId); });
    persist(stale);
    return stale.length;
  }

  return {
    issue: issue, rowAction: rowAction, bulkAction: bulkAction, logHist: logHist,
    approveModal: approveModal, rejectModal: rejectModal, useModal: useModal, extendModal: extendModal, voidModal: voidModal,
    fieldSetModal: fieldSetModal, editModal: editModal, showDetail: showDetail, printRecord: printRecord,
    markPrintedModal: markPrintedModal, notifyPickupModal: notifyPickupModal, markPickedUpModal: markPickedUpModal,
    recById: recById, selIds: selIds, autoExpireStale: autoExpireStale
  };
})();
