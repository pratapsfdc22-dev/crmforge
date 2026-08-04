/**
 * Supabase Client for API
 * Uses service role key for admin operations
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@forgesf/db/types';
import { env } from '../config/env.js';

// Admin client with service role key (bypasses RLS)
export const supabaseAdmin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Create a client for a specific user (respects RLS)
export function createUserClient(accessToken: string) {
  return createClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

// Get service role client
export function getSupabaseClient() {
  return supabaseAdmin;
}

// Verify JWT and extract user
export async function verifyToken(token: string) {
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}
