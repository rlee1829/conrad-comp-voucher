/* CompApp.viewOverview — 개요: period-filtered summary chips + category/dept/product/usage
   breakdowns, each row clickable to drill through into the filtered list. */
window.CompApp = window.CompApp || {};
CompApp.viewOverview = (function () {
  "use strict";
  var $ = CompApp.ui.$, setDate = CompApp.ui.setDate;
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };
  var schema = CompApp.schema;
  var esc = schema.esc, money = schema.money, normDate = schema.normDate, todayStr = schema.todayStr, effStatus = schema.effStatus;
  var CAT_LABEL = schema.CAT_LABEL;
  var state = CompApp.state;

  function records() { return CompApp.db.cache.records; }
  function famMatch(r) { return CompApp.router.famMatch(r); }

  function ovDefault() { var now = new Date(); var mm = ('0' + (now.getMonth() + 1)).slice(-2); return { start: now.getFullYear() + '-' + mm + '-01', end: todayStr() }; }
  function render() {
    if (!state.ovState.start) { var def = ovDefault(); state.ovState = def; setDate('ov-start', def.start); setDate('ov-end', def.end); }
    var rs = records().filter(function (r) { return famMatch(r) && r.issued >= state.ovState.start && r.issued <= state.ovState.end; });
    var by = { PENDING: 0, ACTIVE: 0, USED: 0, EXPIRED: 0, VOID: 0, REJECTED: 0 }; var amt = 0;
    rs.forEach(function (r) { by[r.status]++; amt += (r.amount || 0); });
    var expp = rs.filter(function (r) { return effStatus(r) === 'EXPIRED_PENDING'; }).length;
    var chips = [{ k: t('총 발행'), v: rs.length + t('건'), s: '' }, { k: t('금액권 합계'), v: money(amt), s: '' }, { k: t('ACTIVE'), v: (by.ACTIVE - expp) + t('건'), s: 'ACTIVE' }, { k: t('USED'), v: by.USED + t('건'), s: 'USED' }, { k: t('반려'), v: by.REJECTED + t('건'), s: '' }, { k: t('만료·미처리/취소'), v: (by.EXPIRED + by.VOID + expp) + t('건'), s: '' }];
    $('ov-chips').innerHTML = chips.map(function (d) { return '<div class="chip"><div class="k">' + d.k + '</div><div class="v" style="font-size:19px">' + d.v + '</div></div>'; }).join('');
    var cats = {}; Object.keys(CAT_LABEL).forEach(function (c) { cats[c] = { n: 0, amt: 0 }; });
    rs.forEach(function (r) { if (!cats[r.cat]) cats[r.cat] = { n: 0, amt: 0 }; cats[r.cat].n++; cats[r.cat].amt += (r.amount || 0); });
    $('ov-cat').innerHTML = '<table class="minitable"><thead><tr><th>' + t('카테고리') + '</th><th class="num">' + t('건수') + '</th><th class="num">' + t('금액') + '</th></tr></thead><tbody>'
      + Object.keys(CAT_LABEL).map(function (c) { return '<tr class="clickable" data-drill="cat" data-val="' + c + '"><td><span class="link-btn">' + schema.catLabel(c) + '</span></td><td class="num">' + cats[c].n + '</td><td class="num">' + money(cats[c].amt) + '</td></tr>'; }).join('') + '</tbody></table>';
    var depts = {}; rs.forEach(function (r) { var m = /\(([^)]+)\)\s*$/.exec(r.req || ''); var d = m ? m[1].trim() : (r.req || t('미상')); depts[d] = (depts[d] || 0) + 1; });
    var arr = Object.keys(depts).map(function (d) { return { d: d, n: depts[d] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
    $('ov-dept').innerHTML = arr.length ? '<table class="minitable"><thead><tr><th>' + t('부서/요청자') + '</th><th class="num">' + t('건수') + '</th></tr></thead><tbody>'
      + arr.map(function (x) { return '<tr class="clickable" data-drill="text" data-val="' + esc(x.d) + '"><td><span class="link-btn">' + esc(x.d) + '</span></td><td class="num">' + x.n + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">' + t('데이터 없음') + '</div>';
    // 바우처 종류별 집계 — 가져온 레코드는 카탈로그 id(product)가 비어 있고 원문 텍스트(productText)만
    // 있을 수 있으므로, id가 아니라 화면에 실제 표시되는 라벨(recordProductLabel)로 묶는다. 그래야
    // Room 바우처처럼 원문 설명만 있는 항목이 빈 칸으로 뭉치지 않고 종류별로 정확히 집계된다.
    var prods = {}; rs.forEach(function (r) { var key = schema.recordProductLabel(r); if (!prods[key]) prods[key] = { iss: 0, used: 0 }; prods[key].iss++; if (r.status === 'USED') prods[key].used++; });
    var pkeys = Object.keys(prods);
    var parr = pkeys.map(function (p) { return { p: p, n: prods[p].iss }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
    $('ov-prod').innerHTML = parr.length ? '<table class="minitable"><thead><tr><th>' + t('바우처 종류') + '</th><th class="num">' + t('발행') + '</th></tr></thead><tbody>'
      + parr.map(function (x) { return '<tr class="clickable" data-drill="text" data-val="' + esc(x.p) + '"><td><span class="link-btn">' + esc(x.p) + '</span></td><td class="num">' + x.n + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">' + t('데이터 없음') + '</div>';
    var uarr = pkeys.map(function (p) { return { p: p, used: prods[p].used, iss: prods[p].iss }; }).filter(function (x) { return x.used > 0; }).sort(function (a, b) { return b.used - a.used; }).slice(0, 4);
    $('ov-usage').innerHTML = uarr.length ? '<table class="minitable"><thead><tr><th>' + t('바우처 종류') + '</th><th class="num">' + t('USED') + '</th></tr></thead><tbody>'
      + uarr.map(function (x) { return '<tr class="clickable" data-drill="used" data-val="' + esc(x.p) + '"><td><span class="link-btn">' + esc(x.p) + '</span></td><td class="num">' + x.used + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">' + t('사용 내역 없음') + '</div>';
  }
  $('ov-apply').addEventListener('click', function () {
    state.ovState = { start: normDate($('ov-start').value) || state.ovState.start, end: normDate($('ov-end').value) || state.ovState.end };
    setDate('ov-start', state.ovState.start); setDate('ov-end', state.ovState.end); render();
  });
  $('view-overview').addEventListener('click', function (e) {
    var tr = e.target.closest('tr.clickable'); if (!tr) return;
    var kind = tr.dataset.drill, val = tr.dataset.val;
    if (kind === 'cat') CompApp.router.goListFiltered({ cat: val });
    else if (kind === 'used') CompApp.router.goListFiltered({ text: val, status: 'USED' });
    else if (kind === 'text') CompApp.router.goListFiltered({ text: val });
  });

  return { render: render };
})();
