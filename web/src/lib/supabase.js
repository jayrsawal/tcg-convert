import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || '';
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or Anon Key not found in environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

/**
 * Get the current Supabase session access token for API authentication
 * Uses Supabase's built-in session management
 * @returns {Promise<string|null>} The access token or null if not authenticated
 */
export const getAuthToken = async () => {
  try {
    // Use Supabase's built-in session getter
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('[getAuthToken] Error getting session:', error);
      return null;
    }
    
    if (!session) {
      console.log('[getAuthToken] No active session');
      return null;
    }
    
    if (!session.access_token) {
      console.warn('[getAuthToken] Session exists but no access_token');
      return null;
    }
    
    // Check if token is expired
    if (session.expires_at && session.expires_at * 1000 < Date.now()) {
      console.warn('[getAuthToken] Token expired, attempting refresh...');
      const { data: { session: newSession }, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !newSession) {
        console.error('[getAuthToken] Failed to refresh session:', refreshError);
        return null;
      }
      return newSession.access_token || null;
    }
    
    return session.access_token;
  } catch (error) {
    console.error('[getAuthToken] Exception getting auth token:', error);
    return null;
  }
};

/**
 * Get authenticated headers using Supabase session
 * @returns {Promise<Object>} Headers object with Authorization if authenticated
 */
export const getAuthHeaders = async () => {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
};

