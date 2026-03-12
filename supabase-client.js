// ═══════════════════════════════════════════
//  POKO — Supabase Client
// ═══════════════════════════════════════════
const SUPABASE_URL     = 'https://agghgyidejzlxidrjswv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZ2hneWlkZWp6bHhpZHJqc3d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNzQ3MjcsImV4cCI6MjA4Nzg1MDcyN30.tS050ZrnbmwLWo4sWbt85fyy_em3g7_BjL7PF5acIhg';

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
