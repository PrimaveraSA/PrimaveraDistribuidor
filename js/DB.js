// DB.js
export const supabaseUrl = "https://pivuyofhmnbtomjizrfg.supabase.co";
export const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdnV5b2ZobW5idG9taml6cmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NDY5MTgsImV4cCI6MjA3NTQyMjkxOH0.n0zfHNiGY2-7g1K211ybIcEXRY3hc9i0S8HjSWzZauA";
// Supabase global (UMD)
export const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
window.SUPABASE_URL = supabaseUrl;
window.SUPABASE_KEY = supabaseKey;
window.SUPABASE_CLIENT = supabase;
