/* CompApp.schema — catalog, status/category enums, and core format/date utils shared by every file */
window.CompApp = window.CompApp || {};
CompApp.schema = (function () {
  "use strict";

  var CATALOG = {
    FB: [
      { id: 'fb_buffet2', name: 'ZEST 뷔페 (평일/주말 런치·디너) 2인', amount: 0, defMonths: 12 },
      { id: 'fb_buffet_l2', name: 'ZEST 평일 런치 뷔페 2인', amount: 0, defMonths: 12 },
      { id: 'fb_buffet1', name: 'ZEST 뷔페 1인', amount: 0, defMonths: 12 },
      { id: 'fb_val_50', name: 'F&B 금액권 ₩50,000', amount: 50000, defMonths: 12 },
      { id: 'fb_val_100', name: 'F&B 금액권 ₩100,000', amount: 100000, defMonths: 12 },
      { id: 'fb_val_150', name: 'F&B 금액권 ₩150,000', amount: 150000, defMonths: 12 },
      { id: 'fb_10g_drinkbread', name: '10G 음료 1 + 베이커리 1', amount: 0, defMonths: 6 },
      { id: 'fb_10g_americano', name: '10G 아이스 아메리카노 1잔', amount: 0, defMonths: 6 },
      { id: 'fb_10g_beverage', name: '10G 음료 1잔', amount: 0, defMonths: 6 },
      { id: 'fb_10g_cake', name: '10G 홀케이크 (₩68,000)', amount: 68000, defMonths: 6 },
      { id: 'fb_atrio_pizza', name: 'ATRIO 피자 1판', amount: 0, defMonths: 6 },
      { id: 'fb_atrio_coppia', name: 'ATRIO Coppia Set 2인', amount: 0, defMonths: 6 },
      { id: 'fb_37_tea', name: '37 Bar & Lounge 애프터눈티 2인', amount: 0, defMonths: 6 },
      { id: 'fb_zest_dolsang', name: 'ZEST 돌상 패키지 (comp item 포함)', amount: 0, defMonths: 12 }
    ],
    RM: [
      { id: 'rm_deluxe_1n', name: 'Deluxe Room 1박 (조식 포함)', amount: 0, defMonths: 12 },
      { id: 'rm_deluxe_2n', name: 'Deluxe Room 2박 (조식 포함)', amount: 0, defMonths: 12 },
      { id: 'rm_exec_1n', name: 'Executive Corner Suite 1박 (조식 포함)', amount: 0, defMonths: 12 },
      { id: 'rm_king_1n', name: 'King Deluxe Corner Suite 1박 (조식 포함)', amount: 0, defMonths: 12 },
      { id: 'rm_val_10', name: 'Room & F&B 금액권 ₩10,000', amount: 10000, defMonths: 12 },
      { id: 'rm_val_50', name: 'Room & F&B 금액권 ₩50,000', amount: 50000, defMonths: 12 },
      { id: 'rm_val_100', name: 'Room & F&B 금액권 ₩100,000', amount: 100000, defMonths: 12 }
    ],
    HR: [
      { id: 'hr_fb100', name: 'F&B 금액권 ₩100,000', amount: 100000, defMonths: 6, prefix: 'HRF' },
      { id: 'hr_cake', name: '홀케이크 (₩68,000) · 10G', amount: 68000, defMonths: 6, prefix: 'HRC' },
      { id: 'hr_buffet', name: 'ZEST 뷔페 2인 (평일/주말)', amount: 0, defMonths: 6, prefix: 'HRZ' },
      { id: 'hr_drink', name: '10G 음료 1 + 베이커리 1', amount: 0, defMonths: 6, prefix: 'HRB' }
    ]
  };

  var CAT_LABEL = { VIP: 'VIP 예우', COMPLAINT: '컴플레인 보상', STAFF: '직원 복리후생', PARTNER: '제휴/마케팅', WEDDING: '웨딩' };
  var STATUS_LABEL = { PENDING: '승인대기', ACTIVE: '활성', USED: '사용', EXPIRED: '만료', VOID: '취소', EXPIRED_PENDING: '만료(미처리)', REJECTED: '반려' };
  var STATUS_CLASS = { PENDING: 'b-pending', ACTIVE: 'b-active', USED: 'b-used', EXPIRED: 'b-expired', VOID: 'b-void', EXPIRED_PENDING: 'b-expired', REJECTED: 'b-rejected' };
  var DEFAULT_DEPTS = ['FO', 'FB', 'Finance', 'RSVN', 'Sales', 'HR', 'MarComm', 'BD', 'HK', 'Event Sales', 'Concierge', 'GM'];
  // 픽업 흐름 — status(승인/사용/만료)와 별개의 축이다. 승인된 바우처를 실물로 인쇄해서 요청자에게
  // 건네주기까지의 단계만 다룬다. 인쇄는 별도 프린터·용지로 하므로 앱은 "인쇄했다"는 표시만 받는다.
  var PICKUP_LABEL = { TOPRINT: '인쇄대기', TOPICKUP: '픽업대기', PICKED: '픽업완료' };
  var PICKUP_CLASS = { TOPRINT: 'pk-toprint', TOPICKUP: 'pk-topickup', PICKED: 'pk-picked' };
  function catLabel(c) { var l = CAT_LABEL[c]; return l == null ? c : (CompApp.i18n ? CompApp.i18n.t(l) : l); }
  function statusLabel(s) { var l = STATUS_LABEL[s]; return l == null ? s : (CompApp.i18n ? CompApp.i18n.t(l) : l); }
  function pickupLabel(p) { var l = PICKUP_LABEL[p]; return l == null ? p : (CompApp.i18n ? CompApp.i18n.t(l) : l); }

  var retired = {}; // deleted products still referenced by past records — keep their names resolvable
  function saveRetired() { try { localStorage.setItem('compVoucherRetired', JSON.stringify(retired)); } catch (e) {} }
  function prodById(id) {
    var ks = Object.keys(CATALOG);
    for (var i = 0; i < ks.length; i++) {
      var p = CATALOG[ks[i]].find(function (x) { return x.id === id; });
      if (p) return p;
    }
    return retired[id] || null;
  }
  function prod(fam, id) { var p = CATALOG[fam] && CATALOG[fam].find(function (x) { return x.id === id; }); return p || prodById(id); }
  // Catalog names are fixed vocabulary for the built-in items — translatable via the i18n dict.
  // Custom/imported products (no dict entry) just fall through to their Korean name unchanged.
  function prodName(fam, id) { var p = prod(fam, id); return p ? (CompApp.i18n ? CompApp.i18n.t(p.name) : p.name) : id; }
  function productFam(id) { if (id.indexOf('rm_') === 0) return 'RM'; if (id.indexOf('fb_') === 0) return 'FB'; if (id.indexOf('hr_') === 0) return 'HR'; var p = prodById(id); return (p && p.fam) || 'FB'; }
  // E: imported FB/RM rows have no fixed catalog id (free-text source descriptions) — they carry
  // `productText` instead. Every place that displays a record's product name should use this
  // instead of prodName(r.fam, r.product) directly, so imported rows don't render blank.
  function recordProductLabel(r) {
    if (r.product) { var n = prodName(r.fam, r.product); if (n) return n; }
    return r.productText || (CompApp.i18n ? CompApp.i18n.t('(원본 미기재)') : '(원본 미기재)');
  }

  // E: appendReviewNote() (importMapper.js) writes just "[가져오기 검토 필요: ...]" into remark
  // when the source had no real remark to begin with (no leading "실제내용 · " prefix). That
  // internal housekeeping marker isn't meaningful to someone reading 비고, so hide it when it's
  // the only thing there — the underlying needsReview flag/정합성 tracking is unaffected.
  var REVIEW_MARKER_ONLY_RE = /^\[가져오기 검토 필요:[^\]]*\]$/;
  function displayRemark(remark) {
    if (!remark) return '';
    return REVIEW_MARKER_ONLY_RE.test(remark) ? '' : remark;
  }

  var CATALOG_KEY = 'compVoucherCatalog';
  function saveCatalog() {
    try { localStorage.setItem(CATALOG_KEY, JSON.stringify(CATALOG)); } catch (e) {}
    // Also push to the shared Supabase config so every operator sees catalog edits (no-op locally).
    if (CompApp.metaStore) CompApp.metaStore.set(CATALOG_KEY, CATALOG);
  }
  function loadCatalog() {
    // Local-only fallback (also the source of truth until a cloud value arrives — see applyCloudCatalog).
    try {
      var leg = JSON.parse(localStorage.getItem('compVoucherCustomProducts') || '[]');
      leg.forEach(function (p) { if (CATALOG[p.fam] && !CATALOG[p.fam].some(function (x) { return x.id === p.id; })) CATALOG[p.fam].push(p); });
    } catch (e) {}
    try {
      var s = JSON.parse(localStorage.getItem(CATALOG_KEY));
      if (s && s.FB && s.RM) { CATALOG.FB = s.FB; CATALOG.RM = s.RM; if (s.HR) CATALOG.HR = s.HR; }
    } catch (e) {}
    try {
      var rr = JSON.parse(localStorage.getItem('compVoucherRetired'));
      if (rr && typeof rr === 'object') retired = rr;
    } catch (e) {}
  }
  // Called once during boot after CompApp.metaStore.init() resolves — overlays the shared cloud
  // catalog (if one exists) on top of the local fallback CATALOG loaded above. No-op if cloud is off
  // or no shared catalog has been saved yet (schema.js's own CATALOG / the local one wins either way).
  function applyCloudCatalog() {
    if (!(CompApp.cloudEnabled && CompApp.cloudEnabled()) || !CompApp.metaStore) return;
    var s = CompApp.metaStore.get(CATALOG_KEY, null);
    if (s && s.FB && s.RM) { CATALOG.FB = s.FB; CATALOG.RM = s.RM; if (s.HR) CATALOG.HR = s.HR; }
  }

  // Real UUID (not a counter) — required once records may be upserted into Supabase's uuid pk column.
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  function money(n) { return n ? ('₩' + Number(n).toLocaleString()) : '—'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function normDate(s) {
    if (!s) return '';
    s = String(s).trim();
    var digits = s.replace(/[^\d]/g, '');
    if (digits.length === 8) return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
    var m = /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/.exec(s);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    return s;
  }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime()); }
  function addMonths(ds, m) { var d = new Date(ds + 'T00:00:00'); if (isNaN(d)) return ''; var day = d.getDate(); d.setMonth(d.getMonth() + m); if (d.getDate() < day) d.setDate(0); return d.toISOString().slice(0, 10); }
  function daysUntil(ds) { if (!ds) return 99999; return Math.round((new Date(ds + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000); }
  function effStatus(r) { if (r.status === 'ACTIVE' && r.valid && r.valid < todayStr()) return 'EXPIRED_PENDING'; return r.status; }
  function wasImported(r) { return (r.history || []).some(function (h) { return h.action === '가져오기'; }); }
  // 픽업 단계. 이관된 과거 이력은 인쇄·전달이 이미 끝난 건이므로 '인쇄대기'로 잡지 않는다 —
  // 그렇지 않으면 대기함에 수천 건이 쌓인다. 앱에서 발행/승인한 건만 흐름을 탄다.
  function pickupState(r) {
    if (r.pickedUpAt) return 'PICKED';
    if (r.printedAt) return 'TOPICKUP';
    if (r.status === 'ACTIVE' && !wasImported(r)) return 'TOPRINT';
    return '';
  }

  // ---- black-out tags (G: structured input) ----
  // A tag is {type:'preset'|'range'|'text', label?, from?, to?}. Records may still carry the old
  // single free-text `blackout` string (seed data, or anything imported in Phase 4) — normalize
  // treats that as a single {type:'text'} tag so every reader can just use these two helpers.
  function normalizeBlackoutTags(r) {
    if (Array.isArray(r)) return r.slice();
    if (r && Array.isArray(r.blackoutTags)) return r.blackoutTags.slice();
    if (r && r.blackout) return [{ type: 'text', label: r.blackout }];
    return [];
  }
  function blackoutTagLabel(t) { if (!t) return ''; if (t.type === 'range') return (t.from || '?') + ' ~ ' + (t.to || '?'); return t.label || ''; }
  function blackoutSummary(r) { return normalizeBlackoutTags(r).map(blackoutTagLabel).join('; '); }

  return {
    CATALOG: CATALOG, CAT_LABEL: CAT_LABEL, STATUS_LABEL: STATUS_LABEL, STATUS_CLASS: STATUS_CLASS, DEFAULT_DEPTS: DEFAULT_DEPTS,
    catLabel: catLabel, statusLabel: statusLabel, pickupLabel: pickupLabel,
    PICKUP_LABEL: PICKUP_LABEL, PICKUP_CLASS: PICKUP_CLASS, pickupState: pickupState, wasImported: wasImported,
    prodById: prodById, prod: prod, prodName: prodName, productFam: productFam, recordProductLabel: recordProductLabel, displayRemark: displayRemark,
    saveCatalog: saveCatalog, loadCatalog: loadCatalog, applyCloudCatalog: applyCloudCatalog, saveRetired: saveRetired,
    getRetired: function () { return retired; },
    uid: uid, money: money, esc: esc, todayStr: todayStr, normDate: normDate, validDate: validDate,
    addMonths: addMonths, daysUntil: daysUntil, effStatus: effStatus,
    normalizeBlackoutTags: normalizeBlackoutTags, blackoutTagLabel: blackoutTagLabel, blackoutSummary: blackoutSummary
  };
})();
