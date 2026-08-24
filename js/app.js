/* CompApp boot. Local-array demo data is the default (Phase 1 behavior, unchanged) — if
   CompApp.cloudEnabled() (js/config.js has a real Supabase url+anonKey), the demo seed is replaced
   by the live `vouchers` table content, shared config (approver/admin lists, catalog, presets) is
   loaded from the `meta` table, and a realtime subscription keeps every open browser in sync. */
window.CompApp = window.CompApp || {};
(function () {
  "use strict";

  // Wire the language toggle immediately (not inside boot()) so it's responsive even while cloud
  // data is still loading — it only needs the static DOM, not the record set.
  if (CompApp.i18n) CompApp.i18n.init();

  function boot() {
    CompApp.schema.applyCloudCatalog();
    CompApp.ui.wireDateBoxes(document);
    CompApp.router.wireNav();
    CompApp.operator.init();
    CompApp.router.setScope('ALL');
    CompApp.router.go('overview');

    if (CompApp.cloudEnabled && CompApp.cloudEnabled()) {
      var onRemoteChange = function () { CompApp.router.renderCounts(); CompApp.router.refresh(); };
      CompApp.dbCloud.subscribe(onRemoteChange);
      // 공유 설정(승인자·관리자 명단 등)이 다른 브라우저에서 바뀌면 내 모드도 자동 판정을 다시 돌린다.
      CompApp.metaStore.subscribe(function () { CompApp.operator.refreshRole(); onRemoteChange(); });
    }
  }

  CompApp.schema.loadCatalog();

  if (CompApp.cloudEnabled && CompApp.cloudEnabled()) {
    CompApp.metaStore.init()
      .then(function () { return CompApp.dbCloud.getAllVouchers(); })
      .then(function (rows) {
        var arr = CompApp.db.cache.records;
        arr.length = 0;
        Array.prototype.push.apply(arr, rows);
        return CompApp.dbCloud.getAuditLog();
      })
      .then(function (auditRows) {
        CompApp.state.auditLog = auditRows;
        CompApp.workflow.autoExpireStale();
        boot();
      })
      .catch(function (e) {
        console.error('Cloud load failed — falling back to local demo data.', e);
        boot();
      });
  } else {
    boot();
  }
})();
