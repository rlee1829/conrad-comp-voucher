/* CompApp.importMapper — shared helpers used by every import pipeline (FB/RM/HR):
   status-string normalization, category keyword inference, tolerant date parsing,
   amount-from-free-text extraction, and the needsReview marker convention. */
window.CompApp = window.CompApp || {};
CompApp.importMapper = (function () {
  "use strict";
  var schema = CompApp.schema;

  // ---- status mapping (case-insensitive, tolerant of blanks/typos) ----
  var STATUS_MAP = {
    'active': 'ACTIVE', 'used': 'USED', 'expired': 'EXPIRED',
    'void': 'VOID', 'voided': 'VOID', 'cancelled': 'VOID', 'canceled': 'VOID', 'cancel': 'VOID',
    'pending': 'PENDING', 'rejected': 'REJECTED', 'reject': 'REJECTED'
  };
  // Returns {status, needsReview, rawStatus}. Blank -> PENDING (not a data problem, just unset).
  // Anything non-blank and unrecognized -> best-guess ACTIVE (most historical rows without a
  // recognizable status are still-valid records, not literally "awaiting approval") + needsReview.
  function mapStatus(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return { status: 'PENDING', needsReview: false, rawStatus: '' };
    var key = s.toLowerCase();
    if (STATUS_MAP[key]) return { status: STATUS_MAP[key], needsReview: false, rawStatus: s };
    return { status: 'ACTIVE', needsReview: true, rawStatus: s };
  }

  // ---- category keyword inference ----
  // Order matters — checked top to bottom, first match wins. STAFF must precede WEDDING so a
  // service-anniversary benefit that happens to mention the recipient's own wedding still lands
  // in STAFF (e.g. "1st Anniversary Benefit: Wedding of ..."), and PARTNER must precede WEDDING so
  // a barter/exchange deal that happens to mention "wedding spenders" still lands in PARTNER.
  var CAT_KEYWORDS = {
    STAFF: [/anniversary/i, /근속/, /birthday/i, /생일/, /service\s*anniversary/i, /tm\s*birthday/i],
    COMPLAINT: [/apology/i, /complain/i, /보상/, /sorry/i, /inconvenience/i, /불편/],
    PARTNER: [/exchange/i, /교환/, /partner/i, /협찬/, /sponsorship/i, /collaboration/i, /miles/i, /hyatt/i, /marriott/i, /sheraton/i, /shilla/i, /lotte/i, /westin/i, /intercontinental/i],
    WEDDING: [/wedding/i, /웨딩/, /결혼식/]
  };
  // Scans the given text fields; returns {cat, needsReview}. No match -> VIP (catch-all) + needsReview.
  function inferCategory() {
    var text = Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
    var cats = Object.keys(CAT_KEYWORDS);
    for (var i = 0; i < cats.length; i++) {
      var pats = CAT_KEYWORDS[cats[i]];
      for (var j = 0; j < pats.length; j++) if (pats[j].test(text)) return { cat: cats[i], needsReview: false };
    }
    return { cat: 'VIP', needsReview: true };
  }

  // ---- date parsing: real Date objects (SheetJS w/ cellDates:true) or 'YYYY.MM.DD'/'YYYY-MM-DD' text ----
  // SheetJS builds date-only cells as a Date at LOCAL midnight — read the calendar fields with the
  // local getters (getFullYear/getMonth/getDate), NOT toISOString() (which converts to UTC first and
  // shifts the date back a day in any timezone ahead of UTC, e.g. KST — confirmed via real import).
  function excelDateToStr(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      var y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
      return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
    return schema.normDate(String(v));
  }

  // ---- amount extraction from free-text descriptions (no dedicated amount column in source data) ----
  function extractAmount(text) {
    var m = /(?:KRW|₩)\s?([\d,]{4,})/i.exec(String(text || ''));
    if (!m) return 0;
    var n = parseInt(m[1].replace(/,/g, ''), 10);
    return isNaN(n) ? 0 : n;
  }

  // ---- needsReview marker: appended to remark so it's visible in list/detail without a dedicated UI ----
  function appendReviewNote(remark, reasons) {
    if (!reasons || !reasons.length) return remark;
    return (remark ? remark + ' · ' : '') + '[가져오기 검토 필요: ' + reasons.join('; ') + ']';
  }

  function joinNonEmpty(parts, sep) {
    return parts.filter(function (p) { return p != null && String(p).trim() !== ''; }).map(function (p) { return String(p).trim(); }).join(sep || ' · ');
  }

  // Collapse the long multi-line free-text black-out strings into a single readable line for the tag chip.
  function cleanBlackoutText(s) {
    return String(s || '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  return {
    mapStatus: mapStatus, inferCategory: inferCategory, excelDateToStr: excelDateToStr,
    extractAmount: extractAmount, appendReviewNote: appendReviewNote, joinNonEmpty: joinNonEmpty,
    cleanBlackoutText: cleanBlackoutText
  };
})();
