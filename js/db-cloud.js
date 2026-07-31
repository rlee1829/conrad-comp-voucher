/* CompApp.dbCloud — Supabase-backed persistence for the `vouchers` table. Unlike CompApp.db (a bare
   in-memory array that voucherWorkflow.js mutates directly), this is an async CRUD layer: the
   in-memory array (CompApp.db.cache.records) stays the single source every view/workflow function
   reads and mutates synchronously exactly as in Phase 1 — dbCloud just mirrors each mutation to
   Supabase in the background (see voucherWorkflow.js's persist() calls) and merges remote changes
   back in via realtime. Only active when CompApp.cloudEnabled() is true; otherwise unused. */
window.CompApp = window.CompApp || {};
CompApp.dbCloud = (function () {
  "use strict";
  var PAGE = 1000;   // Supabase caps a select at 1000 rows/request — page through
  var CHUNK = 500;   // rows per bulk upsert request

  function client() { return CompApp.supabaseClient(); }
  function chk(res) { if (res && res.error) throw new Error(res.error.message || 'Supabase error'); return res; }
  function toRow(record) { return { id: record.id, data: record }; }
  function fromRow(row) { var d = row.data; d.id = row.id; return d; }

  function getAllVouchers() {
    var out = [];
    function page(from) {
      // order by created_at + id (unique tiebreaker) — created_at alone isn't stable across paged
      // requests when many rows share the same timestamp (e.g. one bulk-insert batch), which let
      // ties land on both sides of a page boundary: some rows fetched twice, others skipped.
      return client().from('vouchers').select('id,data').order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, from + PAGE - 1).then(function (res) {
        chk(res);
        var rows = (res.data || []).map(fromRow);
        out = out.concat(rows);
        return rows.length === PAGE ? page(from + PAGE) : out;
      });
    }
    return page(0);
  }

  function put(record) {
    return client().from('vouchers').upsert(toRow(record)).then(chk).then(function () { return record; });
  }

  function putMany(records) {
    if (!records || !records.length) return Promise.resolve();
    var rows = records.map(toRow), chain = Promise.resolve();
    for (var i = 0; i < rows.length; i += CHUNK) {
      (function (batch) { chain = chain.then(function () { return client().from('vouchers').upsert(batch).then(chk); }); })(rows.slice(i, i + CHUNK));
    }
    return chain;
  }

  function remove(id) { return client().from('vouchers').delete().eq('id', id).then(chk); }

  // Realtime: mirror remote row changes into CompApp.db.cache.records, then call onChanged()
  // (the caller debounces this into a re-render — see app.js).
  function subscribe(onChanged) {
    var timer = null;
    function debounced() { clearTimeout(timer); timer = setTimeout(onChanged, 300); }
    function upsertInto(arr, rec) { var i = arr.findIndex(function (x) { return x.id === rec.id; }); if (i === -1) arr.unshift(rec); else arr[i] = rec; }
    function removeFrom(arr, id) { var i = arr.findIndex(function (x) { return x.id === id; }); if (i !== -1) arr.splice(i, 1); }
    client().channel('comp-voucher-vouchers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vouchers' }, function (payload) {
        var arr = CompApp.db.cache.records;
        if (payload.eventType === 'DELETE') { if (payload.old) removeFrom(arr, payload.old.id); }
        else if (payload.new && payload.new.data) upsertInto(arr, fromRow(payload.new));
        debounced();
      })
      .subscribe();
  }

  // Global audit log (F) — one row per workflow action.
  function logAudit(entry) {
    var row = { id: entry.id || CompApp.schema.uid(), data: entry };
    return client().from('audit_log').insert(row).then(chk);
  }
  // Boot-time hydrate for the 감사 로그 view — most recent first, capped (avoid pulling unbounded history).
  function getAuditLog(limit) {
    limit = limit || 2000;
    return client().from('audit_log').select('id,data,created_at').order('created_at', { ascending: false }).limit(limit).then(function (res) {
      chk(res);
      return (res.data || []).map(function (row) { var d = row.data; d.id = d.id || row.id; return d; });
    });
  }

  // Import batch summaries (E, used in a later phase).
  function logImportBatch(entry) {
    var row = { id: CompApp.schema.uid(), data: entry };
    return client().from('import_batches').insert(row).then(chk);
  }

  return {
    getAllVouchers: getAllVouchers, put: put, putMany: putMany, remove: remove, subscribe: subscribe,
    logAudit: logAudit, getAuditLog: getAuditLog, logImportBatch: logImportBatch
  };
})();
