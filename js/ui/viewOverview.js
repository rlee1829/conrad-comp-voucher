/* CompApp.viewOverview — 개요: period-filtered summary chips + category/dept/product/usage
   breakdowns, each row clickable to drill through into the filtered list. */
window.CompApp = window.CompApp || {};
CompApp.viewOverview = (function () {
  "use strict";
  var $ = CompApp.ui.$, setDate = CompApp.ui.setDate;
  var schema = CompApp.schema;
  var esc = schema.esc, money = schema.money, normDate = schema.normDate, todayStr = schema.todayStr, effStatus = schema.effStatus;
  var CAT_LABEL = schema.CAT_LABEL, prodName = schema.prodName;
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
    var chips = [{ k: '총 발행', v: rs.length + '건', s: '' }, { k: '금액권 합계', v: money(amt), s: '' }, { k: '활성', v: (by.ACTIVE - expp) + '건', s: 'ACTIVE' }, { k: '사용', v: by.USED + '건', s: 'USED' }, { k: '반려', v: by.REJECTED + '건', s: '' }, { k: '만료·미처리/취소', v: (by.EXPIRED + by.VOID + expp) + '건', s: '' }];
    $('ov-chips').innerHTML = chips.map(function (d) { return '<div class="chip"><div class="k">' + d.k + '</div><div class="v" style="font-size:19px">' + d.v + '</div></div>'; }).join('');
    var cats = {}; Object.keys(CAT_LABEL).forEach(function (c) { cats[c] = { n: 0, amt: 0 }; });
    rs.forEach(function (r) { if (!cats[r.cat]) cats[r.cat] = { n: 0, amt: 0 }; cats[r.cat].n++; cats[r.cat].amt += (r.amount || 0); });
    var maxN = Math.max(1, Math.max.apply(null, Object.keys(cats).map(function (c) { return cats[c].n; })));
    $('ov-cat').innerHTML = '<table class="minitable"><thead><tr><th>카테고리</th><th class="num">건수</th><th class="num">금액</th><th style="width:100px"></th></tr></thead><tbody>'
      + Object.keys(CAT_LABEL).map(function (c) { return '<tr class="clickable" data-drill="cat" data-val="' + c + '"><td><span class="link-btn">' + CAT_LABEL[c] + '</span></td><td class="num">' + cats[c].n + '</td><td class="num">' + money(cats[c].amt) + '</td><td><div class="bar" style="width:' + Math.round(cats[c].n / maxN * 100) + '%"></div></td></tr>'; }).join('') + '</tbody></table>';
    var depts = {}; rs.forEach(function (r) { var m = /\(([^)]+)\)\s*$/.exec(r.req || ''); var d = m ? m[1].trim() : (r.req || '미상'); depts[d] = (depts[d] || 0) + 1; });
    var arr = Object.keys(depts).map(function (d) { return { d: d, n: depts[d] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4);
    var maxD = Math.max(1, arr.length ? arr[0].n : 1);
    $('ov-dept').innerHTML = arr.length ? '<table class="minitable"><thead><tr><th>부서/요청자</th><th class="num">건수</th><th style="width:100px"></th></tr></thead><tbody>'
      + arr.map(function (x) { return '<tr class="clickable" data-drill="text" data-val="' + esc(x.d) + '"><td><span class="link-btn">' + esc(x.d) + '</span></td><td class="num">' + x.n + '</td><td><div class="bar" style="width:' + Math.round(x.n / maxD * 100) + '%"></div></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">데이터 없음</div>';
    var prods = {}; rs.forEach(function (r) { if (!prods[r.product]) prods[r.product] = { iss: 0, used: 0 }; prods[r.product].iss++; if (r.status === 'USED') prods[r.product].used++; });
    var pkeys = Object.keys(prods);
    var parr = pkeys.map(function (p) { return { p: p, n: prods[p].iss }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
    var maxP = Math.max(1, parr.length ? parr[0].n : 1);
    $('ov-prod').innerHTML = parr.length ? '<table class="minitable"><thead><tr><th>바우처 종류</th><th class="num">발행</th><th style="width:100px"></th></tr></thead><tbody>'
      + parr.map(function (x) { return '<tr class="clickable" data-drill="text" data-val="' + esc(prodName(state.fam, x.p)) + '"><td><span class="link-btn">' + prodName(state.fam, x.p) + '</span></td><td class="num">' + x.n + '</td><td><div class="bar" style="width:' + Math.round(x.n / maxP * 100) + '%"></div></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">데이터 없음</div>';
    var uarr = pkeys.map(function (p) { return { p: p, used: prods[p].used, iss: prods[p].iss, rate: prods[p].iss ? Math.round(prods[p].used / prods[p].iss * 100) : 0 }; }).filter(function (x) { return x.used > 0; }).sort(function (a, b) { return b.used - a.used; }).slice(0, 8);
    var maxU = Math.max(1, uarr.length ? uarr[0].used : 1);
    $('ov-usage').innerHTML = uarr.length ? '<table class="minitable"><thead><tr><th>바우처 종류</th><th class="num">사용</th><th class="num">사용률</th><th style="width:64px"></th></tr></thead><tbody>'
      + uarr.map(function (x) { return '<tr class="clickable" data-drill="used" data-val="' + esc(prodName(state.fam, x.p)) + '"><td><span class="link-btn">' + prodName(state.fam, x.p) + '</span></td><td class="num">' + x.used + '</td><td class="num">' + x.rate + '%</td><td><div class="bar" style="width:' + Math.round(x.used / maxU * 100) + '%"></div></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">사용 내역 없음</div>';
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
