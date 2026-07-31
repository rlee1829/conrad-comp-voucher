/* ============================================================================
   Cloud sharing config
   ----------------------------------------------------------------------------
   To share data across PCs in real time, paste your Supabase project's URL and
   "anon public" key below (Supabase → Project Settings → API), then run
   supabase-schema.sql once in that project's SQL Editor.

   Leave `url`/`anonKey` blank to keep using local per-browser demo data — the
   app works exactly as before, just not shared.

   NOTE: The anon key is designed to be public (safe to ship in the client); row
   access is controlled by the database policies in supabase-schema.sql.
   ============================================================================ */
window.CompApp = window.CompApp || {};
CompApp.config = {
  supabase: {
    url: '',
    anonKey: ''
  }
};

CompApp.cloudEnabled = function () {
  var s = CompApp.config && CompApp.config.supabase;
  return !!(s && s.url && s.anonKey);
};

CompApp.supabaseClient = function () {
  if (CompApp._sb) return CompApp._sb;
  if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase client not loaded.');
  var s = CompApp.config.supabase;
  CompApp._sb = window.supabase.createClient(s.url, s.anonKey);
  return CompApp._sb;
};
