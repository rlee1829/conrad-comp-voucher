/* CompApp.voucherPrint — 실물 바우처 인쇄. 로고·증서번호가 이미 찍힌 170×80mm 전용 용지에 문구
   (상품 설명 / 유효기간 / Black-out)만 겹쳐 찍는다. 슬라이드 시안(11.1 Certification/COMP VOUCHER 시안)의
   글자 위치를 PowerPoint PDF에서 잰 기준선(baseline, mm) 그대로 옮겼다. 유효기간·Black-out은 시안의
   고정 문구가 아니라 해당 레코드의 값으로 찍는다 — 건마다 다르기 때문이다. */
window.CompApp = window.CompApp || {};
CompApp.voucherPrint = (function () {
  "use strict";
  var $ = CompApp.ui.$, modal = CompApp.ui.modal, toast = CompApp.ui.toast;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };
  var t2 = function (ko, en) { return CompApp.i18n ? CompApp.i18n.t2(ko, en) : ko; };
  var schema = CompApp.schema, esc = schema.esc;

  var MAP_KEY = 'compVoucherPrintMap';       // { productId: { tpl, title } } — 시안 없는 상품의 문구를 공유 저장
  var OFFSET_KEY = 'compVoucherPrintOffset'; // { x, y } mm — 프린터 급지 오차 보정
  var MM_PER_PT = 25.4 / 72;
  var FONT_K = 0.365;      // (ascent-descent)/2 — 줄 상자 중앙에서 기준선까지의 거리(글자크기 대비)
  var MIN_PT = 6.5;        // 이보다 줄여야 들어가는 문구는 인쇄를 막는다
  var MAX_LINES = 2;
  var TEXT_W = 150;        // 문구 영역 폭(mm)
  var BO_PREFIX = '(**Black-out dates; ';

  var BO_ROOM = 'Every Saturday 2026-2027, Seoul Fireworks Festival, Sept. 24-26, Oct. 3, 10, Dec. 24, 25, 31, 2026 & Feb. 6-9, 2027';
  var BO_WEDDING = 'Every Saturday 2026-2027, Seoul Fireworks Festival, Sept. 24-26, Oct. 3, 10, Dec. 24, 25, 31, 2026 & Feb. 6-9, Sept. 14-16, 2027';
  // tb/vb/bb = 문구/유효기간/Black-out 첫 줄 기준선, tc/bc = 가로 중심, ts/vs/bs = 글자크기(pt), tlh/blh = 줄간격(mm)
  var LAYOUT_DELUXE = { tc: 85.25, tb: 43.22, ts: 10, tlh: 4.3, bc: 85.25, vb: 47.84, vs: 9, bb: 52.39, bs: 9, blh: 4.58 };
  var LAYOUT_LOUNGE = { tc: 89.3, tb: 41.17, ts: 10.5, tlh: 4.44, bc: 85, vb: 49.81, vs: 9, bb: 53.97, bs: 8, blh: 4.06 };
  var LAYOUT_GENERIC = { tc: 85.25, tb: 41.17, ts: 10.5, tlh: 4.44, bc: 85.25, vb: 49.81, vs: 9, bb: 53.97, bs: 8, blh: 4.06 };
  var TEMPLATES = [
    { id: 'deluxe_bf', name: '디럭스 1박 + 조식 2인', products: ['rm_deluxe_1n', 'rm_c1788768575599'], bo: BO_ROOM, layout: LAYOUT_DELUXE,
      title: ['Complimentary 1-night stay in a Deluxe Room including breakfast for 2 persons at Zest'] },
    { id: 'deluxe_corner', name: '디럭스 코너 스위트 1박', products: ['rm_c1791964788170'], bo: BO_ROOM, layout: LAYOUT_DELUXE,
      title: ['Complimentary 1-night stay in a Deluxe Corner Suite for 2 persons'] },
    { id: 'premium_river', name: '프리미엄 리버뷰 1박 + 조식 2인', products: ['rm_premium_river_1n'],
      bo: 'Every Saturday 2026-2027, Sept. 24-26, Oct. 3, 10, Fireworks Festival, Dec. 24, 25, 31, 2026 & Feb. 6-9, 2027',
      layout: { tc: 85, tb: 41.8, ts: 10, tlh: 4.24, bc: 85, vb: 49.81, vs: 9, bb: 54.19, bs: 8.5, blh: 4.34 },
      title: ['Complimentary 1-night stay in a Premium River View Room', 'including breakfast for 2 persons at ZEST'] },
    { id: 'exec_corner', name: '웨딩-이그제큐티브 코너 스위트 1박 2인 라운지', products: ['rm_c1785919610130'], bo: BO_WEDDING, layout: LAYOUT_LOUNGE,
      title: ['Complimentary 1-night stay in an Executive Corner Suite', 'including Executive Floor Privileges for two (2) persons.'] },
    { id: 'exec_river', name: '이그제큐티브 리버뷰 1박 + 라운지', products: ['rm_exec_river_1n'], bo: BO_WEDDING, layout: LAYOUT_LOUNGE,
      title: ['Complimentary 1-night stay in an Executive River View Room', 'including Executive Floor Privileges for two (2) persons.'] },
    { id: 'premium_corner', name: '프리미엄 코너 스위트 1박 2인 + 라운지', products: ['rm_premium_corner_1n'], bo: BO_WEDDING, layout: LAYOUT_LOUNGE,
      title: ['Complimentary 1-night stay in a Premium Corner Suite', 'including Executive Floor Privileges for two (2) persons.'] },
    { id: 'conrad_suite', name: '콘래드 스위트 1박 + 라운지', products: ['rm_conrad_suite_1n'], bo: BO_ROOM,
      layout: { tc: 85.25, tb: 39.69, ts: 11, tlh: 4.69, bc: 85.25, vb: 49.81, vs: 9, bb: 54.4, bs: 9, blh: 4.58 },
      title: ['Complimentary 1-night stay in a Conrad Suite including', 'Executive Lounge access for 2 persons'] },
    { id: 'zest_full', name: '제스트 평일·주말 점심·저녁 2인', products: ['fb_buffet2', 'hr_buffet'],
      bo: 'Seoul Fireworks Festival, Sep. 24-26, Dec. 19-31, 2026 & Jan. 1, Feb. 7-9, May 5-8, 2027',
      layout: { tc: 85.25, tb: 42.69, ts: 11, tlh: 4.69, bc: 85.25, vb: 48.22, vs: 9, bb: 52.03, bs: 9, blh: 3.81 },
      title: ['Complimentary weekday or weekend lunch or dinner buffet for 2 persons at ZEST'] },
    { id: 'zest_lunch', name: '제스트 Lucky Draw 평일 점심 2인', products: ['fb_buffet_l2'],
      bo: 'Sept. 24-26, Seoul Fireworks Festival, Dec. 18-31, 2026',
      layout: { tc: 85.25, tb: 42.37, ts: 11, tlh: 4.69, bc: 85.25, vb: 49.07, vs: 9, bb: 52.53, bs: 8, blh: 3.46 },
      title: ['Complimentary weekdays lunch buffet for two (2) persons at ZEST'] }
  ];
  function tplById(id) { return TEMPLATES.find(function (x) { return x.id === id; }) || null; }
  function tplForProduct(id) { return TEMPLATES.find(function (x) { return x.products.indexOf(id) !== -1; }) || null; }

  var MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  function dateParts(ds) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ds || ''); return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null; }
  function validLine(ds) { var p = dateParts(ds); return p ? 'This certificate is valid until ' + MONTH_LONG[p.m] + ' ' + p.d + ', ' + p.y : ''; }
  function rangeText(from, to) {
    var a = dateParts(from), b = dateParts(to);
    if (!a || !b) return (from || '') + (to ? ' - ' + to : '');
    if (a.y === b.y && a.m === b.m) return MONTH_ABBR[a.m] + ' ' + (a.d === b.d ? a.d : a.d + '-' + b.d) + ', ' + a.y;
    return MONTH_ABBR[a.m] + ' ' + a.d + ', ' + a.y + ' - ' + MONTH_ABBR[b.m] + ' ' + b.d + ', ' + b.y;
  }
  // 앱의 Black-out 태그를 바우처에 찍을 영문 문구로. 프리셋 앞의 (RM)/(FB) 구분표시는 내부용이라 뺀다.
  function blackoutText(r) {
    return schema.normalizeBlackoutTags(r).map(function (tag) {
      if (tag.type === 'range') return rangeText(tag.from, tag.to);
      return String(tag.label || '').replace(/^\s*\((RM|FB|HR)\)\s*/i, '').replace(/\s+/g, ' ').trim();
    }).filter(function (s) { return s && s !== '블랙아웃 없음'; }).join(' & ');
  }
  function hasKorean(s) { return /[ㄱ-ㅎ가-힣]/.test(s || ''); }

  // ---- 조판 ----
  var measureEl = null;
  function lineCount(text, pt, lh) {
    if (!measureEl) { measureEl = document.createElement('div'); measureEl.className = 'pv-card pv-measure'; document.body.appendChild(measureEl); }
    measureEl.innerHTML = '<div class="pv-line" style="position:static;width:' + TEXT_W + 'mm;font-size:' + pt + 'pt;line-height:' + lh + 'mm">' + esc(text) + '</div>';
    var box = measureEl.firstChild.getBoundingClientRect(), lhPx = lh * 96 / 25.4;
    return Math.round(box.height / lhPx);
  }
  // 문구가 두 줄을 넘으면 글자를 줄여 맞춘다. 끝까지 안 들어가면 fits=false.
  function fit(text, pt, lh) {
    for (var size = pt; size >= MIN_PT; size -= 0.25) {
      var n = lineCount(text, size, lh);
      if (n <= MAX_LINES) return { pt: size, lines: n, fits: true };
    }
    return { pt: MIN_PT, lines: lineCount(text, MIN_PT, lh), fits: false };
  }
  function block(text, baseline, pt, lh, cx) {
    var top = baseline - lh / 2 - FONT_K * pt * MM_PER_PT;
    return '<div class="pv-line" style="left:' + (cx - TEXT_W / 2).toFixed(2) + 'mm;width:' + TEXT_W + 'mm;top:' + top.toFixed(3) + 'mm;font-size:' + pt + 'pt;line-height:' + lh + 'mm">' + esc(text) + '</div>';
  }
  function compose(v) {
    var L = v.layout, title = fit(v.title, L.ts, L.tlh), bo = v.blackout ? fit(BO_PREFIX + v.blackout + ')', L.bs, L.blh) : null;
    var tplLines = v.tplLines || 1;
    // 문구 줄 수가 시안과 달라져도 마지막 줄 기준선은 그대로 둬서 유효기간과 겹치지 않게 한다.
    var titleTop = L.tb + (tplLines - title.lines) * L.tlh;
    var html = block(v.title, titleTop, title.pt, L.tlh, L.tc) + block(validLine(v.valid), L.vb, L.vs, L.blh, L.bc);
    if (bo) html += block(BO_PREFIX + v.blackout + ')', L.bb, bo.pt, L.blh, L.bc);
    return { html: html, fits: title.fits && (!bo || bo.fits) };
  }
  function cardHTML(v, offset, guide) {
    var style = offset && (offset.x || offset.y) ? ' style="transform:translate(' + (offset.x || 0) + 'mm,' + (offset.y || 0) + 'mm)"' : '';
    return '<div class="pv-card">' + (guide ? '<div class="pv-guide"></div>' : '') + '<div class="pv-inner"' + style + '>' + compose(v).html + '</div></div>';
  }

  // ---- 인쇄 실행 ----
  // @page는 문서 전체에 걸리므로 바우처를 찍는 동안에만 넣는다(발행 확인서 인쇄는 A4 그대로).
  function runPrint(html, after) {
    var host = $('print-vouchers'), st = document.createElement('style');
    host.innerHTML = html;
    st.textContent = '@page{size:170mm 80mm;margin:0}';
    document.head.appendChild(st);
    document.body.classList.add('pv-mode');
    function done() {
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('pv-mode');
      st.remove(); host.innerHTML = '';
      if (after) setTimeout(after, 0);
    }
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 80);
  }

  // ---- 인쇄 미리보기 ----
  function serialSort(a, b) { return String(a.serial).localeCompare(String(b.serial), 'en', { numeric: true }); }
  function resolve(r) {
    var map = CompApp.metaStore.get(MAP_KEY, {}) || {}, saved = r.product ? map[r.product] : null;
    var builtin = tplForProduct(r.product), tpl = (saved && tplById(saved.tpl)) || builtin;
    var title = (saved && saved.title) || (tpl ? tpl.title.join('\n') : '');
    return { tpl: tpl, title: title, builtin: !!builtin };
  }
  function groupsOf(list) {
    var groups = [];
    list.slice().sort(serialSort).forEach(function (r) {
      var bo = blackoutText(r), key = [r.product || r.productText, r.valid, bo].join('|');
      var g = groups.find(function (x) { return x.key === key; });
      if (!g) { var res = resolve(r); g = { key: key, recs: [], valid: r.valid, blackout: bo, tpl: res.tpl, title: res.title, builtin: res.builtin, label: schema.recordProductLabel(r), product: r.product }; groups.push(g); }
      g.recs.push(r);
    });
    return groups;
  }
  function viewOf(g) {
    var L = g.tpl ? g.tpl.layout : LAYOUT_GENERIC;
    return { title: g.title, valid: g.valid, blackout: g.blackout, layout: L, tplLines: g.tpl ? g.tpl.title.length : 2 };
  }
  function groupHTML(g, i) {
    var opts = '<option value="">' + t('시안 없음 (문구 직접 입력)') + '</option>' + TEMPLATES.map(function (x) {
      return '<option value="' + x.id + '"' + (g.tpl && g.tpl.id === x.id ? ' selected' : '') + '>' + esc(t(x.name)) + '</option>';
    }).join('');
    return '<div class="pv-group" data-i="' + i + '">'
      + '<div class="pv-ghead"><b>' + esc(g.label) + '</b><span>' + g.recs.length + t('건') + ' · ' + esc(g.recs.map(function (r) { return r.serial; }).join(', ')) + '</span></div>'
      + '<div class="pv-prev"><div class="pv-prev-card"></div></div>'
      + '<div class="pv-warn"></div>'
      + '<div class="field"><label>' + t('시안') + '</label><select class="pv-tpl">' + opts + '</select></div>'
      + '<div class="field"><label>' + t('바우처 문구 (영문)') + '<span class="req">*</span></label><textarea class="pv-title" rows="2">' + esc(g.title) + '</textarea></div>'
      + '<div class="field"><label>' + t('Black-out 문구 (영문)') + ' <span class="opt">' + t('(없으면 인쇄 안 함)') + '</span></label><textarea class="pv-bo" rows="2">' + esc(g.blackout) + '</textarea></div>'
      + '<div class="pv-tools"><button type="button" class="btn btn-ghost btn-sm pv-use-bo">' + t('시안의 Black-out 문구 넣기') + '</button>'
      + (g.product ? '<label class="pv-remember"><input type="checkbox" class="pv-rem"' + (g.builtin ? '' : ' checked') + '> ' + t('이 상품의 기본 문구로 저장') + '</label>' : '') + '</div>'
      + '</div>';
  }
  function refreshGroup(root, g) {
    var c = compose(viewOf(g)), warn = [];
    root.querySelector('.pv-prev-card').innerHTML = cardHTML(viewOf(g));
    if (!g.title.trim()) warn.push(t('바우처 문구를 입력하세요. 이 상품은 시안이 없습니다.'));
    if (hasKorean(g.title) || hasKorean(g.blackout)) warn.push(t('바우처에는 영문만 인쇄됩니다. 한글 문구를 영문으로 바꿔주세요.'));
    if (!c.fits) warn.push(t('문구가 너무 길어 두 줄에 들어가지 않습니다. 줄여주세요.'));
    if (!g.blackout.trim()) warn.push(t('이 건은 Black-out이 없습니다. 맞는지 확인하세요.'));
    var box = root.querySelector('.pv-warn');
    box.innerHTML = warn.map(function (w) { return '<div>※ ' + esc(w) + '</div>'; }).join('');
    box.style.display = warn.length ? 'block' : 'none';
    root.querySelector('.pv-use-bo').style.display = g.tpl ? '' : 'none';
    g.problem = !g.title.trim() ? warn[0] : (hasKorean(g.title) || hasKorean(g.blackout) ? t('바우처에는 영문만 인쇄됩니다. 한글 문구를 영문으로 바꿔주세요.') : (!c.fits ? t('문구가 너무 길어 두 줄에 들어가지 않습니다. 줄여주세요.') : ''));
  }
  function pagesHTML(groups, offset) {
    var pages = [];
    groups.forEach(function (g) { g.recs.forEach(function (r) { pages.push({ r: r, v: viewOf(g) }); }); });
    pages.sort(function (a, b) { return serialSort(a.r, b.r); });
    return pages.map(function (p) { return cardHTML(p.v, offset); }).join('');
  }
  // 테스트 인쇄 뒤 다시 열 때는 입력해 둔 문구를 잃지 않도록 groups를 그대로 넘겨받는다.
  function open(list, keepGroups) {
    var groups = keepGroups || groupsOf(list);
    var off = CompApp.metaStore.get(OFFSET_KEY, null) || { x: 0, y: 0 };
    var order = list.slice().sort(serialSort).map(function (r) { return r.serial; }).join(' → ');
    function readOffset(b) { return { x: parseFloat(b.querySelector('#pv-off-x').value) || 0, y: parseFloat(b.querySelector('#pv-off-y').value) || 0 }; }
    modal({
      wide: true,
      title: t('바우처 인쇄'), sub: list.length + t('건 · 문구를 확인한 뒤 인쇄하세요. 증서번호는 용지에 이미 찍혀 있어 인쇄하지 않습니다.'),
      bodyHtml: '<div class="modal-hint">' + t('용지 투입 순서: ') + '<b>' + esc(order) + '</b></div>'
        + groups.map(groupHTML).join('')
        + '<div class="pv-offset"><span>' + t('인쇄 위치 보정 (mm)') + '</span>'
        + '<label>' + t('가로') + ' <input type="number" step="0.5" id="pv-off-x" value="' + off.x + '"></label>'
        + '<label>' + t('세로') + ' <input type="number" step="0.5" id="pv-off-y" value="' + off.y + '"></label>'
        + '<small>' + t('+는 오른쪽·아래로 이동. 인쇄 창에서 여백 없음, 배율 100%로 설정하세요.') + '</small></div>',
      wire: function (b) {
        b.querySelectorAll('.pv-group').forEach(function (el) {
          var g = groups[+el.dataset.i];
          refreshGroup(el, g);
          el.querySelector('.pv-tpl').addEventListener('change', function () {
            g.tpl = tplById(this.value);
            if (g.tpl) { g.title = g.tpl.title.join('\n'); el.querySelector('.pv-title').value = g.title; }
            refreshGroup(el, g);
          });
          el.querySelector('.pv-title').addEventListener('input', function () { g.title = this.value; refreshGroup(el, g); });
          el.querySelector('.pv-bo').addEventListener('input', function () { g.blackout = this.value.trim(); refreshGroup(el, g); });
          el.querySelector('.pv-use-bo').addEventListener('click', function () {
            if (!g.tpl) return;
            g.blackout = g.tpl.bo; el.querySelector('.pv-bo').value = g.blackout; refreshGroup(el, g);
          });
        });
      },
      buttons: [{ label: t2('취소', 'Cancel') }, {
        label: t('테스트 인쇄 (일반 용지)'), onClick: function (b) {
          var offset = readOffset(b);
          CompApp.metaStore.set(OFFSET_KEY, offset);
          var html = cardHTML(viewOf(groups[0]), offset, true);
          setTimeout(function () { runPrint(html, function () { open(list, groups); }); }, 60);
        }
      }, {
        label: t('인쇄'), cls: 'btn-primary', onClick: function (b, setErr) {
          var bad = groups.filter(function (g) { return g.problem; })[0];
          if (bad) { setErr(bad.label + ' — ' + bad.problem); return false; }
          var offset = readOffset(b);
          CompApp.metaStore.set(OFFSET_KEY, offset);
          var map = Object.assign({}, CompApp.metaStore.get(MAP_KEY, {}) || {}), mapChanged = false;
          var snaps = {};
          b.querySelectorAll('.pv-group').forEach(function (el) {
            var g = groups[+el.dataset.i], rem = el.querySelector('.pv-rem');
            if (rem && rem.checked) { map[g.product] = { tpl: g.tpl ? g.tpl.id : '', title: g.title }; mapChanged = true; }
            g.recs.forEach(function (r) { snaps[r.id] = { tpl: g.tpl ? g.tpl.id : '', title: g.title, valid: validLine(g.valid), blackout: g.blackout }; });
          });
          if (mapChanged) CompApp.metaStore.set(MAP_KEY, map);
          var html = pagesHTML(groups, offset);
          setTimeout(function () { runPrint(html, function () { CompApp.workflow.markPrintedModal(list, snaps); }); }, 60);
        }
      }]
    });
  }

  return { open: open, TEMPLATES: TEMPLATES, blackoutText: blackoutText, validLine: validLine, cardHTML: cardHTML, tplForProduct: tplForProduct, LAYOUT_GENERIC: LAYOUT_GENERIC };
})();
