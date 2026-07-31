/* CompApp.metaStore — shared config (approver list, admin list, product catalog, purpose/blackout
   presets) so every operator sees the same values, backed by a Supabase `meta` table (key/data
   jsonb) when cloud is enabled, or localStorage when it isn't. Callers get a SYNCHRONOUS API
   (get/set) regardless of backend: everything reads from an in-memory cache that is populated
   once at boot via init() (a no-op promise in local mode), and set() updates the cache immediately
   (optimistic) before persisting underneath. This avoids having to make every localStorage-era
   caller (operator.js approver/admin lists, viewIssue.js purpose/blackout presets) async. */
window.CompApp = window.CompApp || {};
CompApp.metaStore = (function () {
  "use strict";
  var cache = {};

  function client() { return CompApp.supabaseClient(); }
  function cloudOn() { return !!(CompApp.cloudEnabled && CompApp.cloudEnabled()); }

  function localGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      var v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }
  function localSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

  // Synchronous read: cache first (populated by init()/subscribe() in cloud mode, or lazily filled
  // from localStorage the first time a key is read in local mode), else the caller's fallback.
  function get(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    if (!cloudOn()) { var v = localGet(key, fallback); cache[key] = v; return v; }
    return fallback;
  }

  function set(key, value) {
    cache[key] = value;
    if (cloudOn()) {
      client().from('meta').upsert({ key: key, data: value, updated_at: new Date().toISOString() })
        .then(function (res) { if (res && res.error) console.warn('metaStore.set cloud save failed for', key, res.error); });
    } else {
      localSet(key, value);
    }
  }

  // Bulk-load every shared config row into the cache once at boot. No-op (resolved immediately) in
  // local mode — local reads populate the cache lazily per-key via get() instead.
  function init() {
    if (!cloudOn()) return Promise.resolve();
    return client().from('meta').select('key,data').then(function (res) {
      if (res && res.error) { console.warn('metaStore.init load failed', res.error); return; }
      (res.data || []).forEach(function (row) { cache[row.key] = row.data; });
    }).catch(function (e) { console.warn('metaStore.init failed', e); });
  }

  // Realtime: when another operator changes shared config (approver list, catalog, etc.), mirror
  // it into the cache and let the caller re-render. No-op in local mode (nothing to subscribe to).
  function subscribe(onChanged) {
    if (!cloudOn()) return;
    client().channel('comp-voucher-meta')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meta' }, function (payload) {
        if (payload.eventType === 'DELETE') { if (payload.old) delete cache[payload.old.key]; }
        else if (payload.new) cache[payload.new.key] = payload.new.data;
        onChanged();
      })
      .subscribe();
  }

  return { get: get, set: set, init: init, subscribe: subscribe };
})();
