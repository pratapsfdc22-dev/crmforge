import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: './apps/api/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function test() {
  try {
    console.log('[DB Test] Connecting to Supabase...');
    console.log('[DB Test] URL:', process.env.SUPABASE_URL);
    
    const { error } = await supabase.rpc('now');
    if (error) {
      console.error('[DB Test] RPC error:', error);
      throw error;
    }
    
    console.log('[DB Test] ✓ Connection successful - Supabase is reachable');
    process.exit(0);
  } catch (err: any) {
    console.error('[DB Test] ✗ Connection failed:', err.message);
    process.exit(1);
  }
}

test();
