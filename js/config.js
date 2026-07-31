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
    url: 'https://foupxcgdopunvxecvwvn.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvdXB4Y2dkb3B1bnZ4ZWN2d3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MzM4MTYsImV4cCI6MjEwMTAwOTgxNn0.lXAI3yO92AKynI_rNCZBEGVlfDsyrzmNB7mtbftW7z4'
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
