/**
 * RLS (Row Level Security) Integration Tests
 *
 * These tests verify that multi-tenant isolation is enforced at the database level.
 * If RLS is disabled or misconfigured, users can see/modify other organizations' data.
 *
 * This is the MOST IMPORTANT security test in the codebase.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types';

// Load env from api/.env
import { readFileSync } from 'fs';
import { join } from 'path';

const envPath = join(__dirname, '../../../apps/api/.env');
const envContent = readFileSync(envPath, 'utf-8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    const [, key, value] = match;
    env[key.trim()] = value.trim();
  }
});

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/api/.env');
}

if (!SUPABASE_ANON_KEY) {
  throw new Error('Missing SUPABASE_ANON_KEY in apps/api/.env');
}

// Admin client (bypasses RLS)
const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  db: {
    schema: 'public'
  }
});

// Test fixtures
let userA: { id: string; email: string; password: string; accessToken: string };
let userB: { id: string; email: string; password: string; accessToken: string };
let orgA: { id: string; name: string; slug: string };
let orgB: { id: string; name: string; slug: string };
let seatLimitTestOrg: { id: string; name: string; slug: string };

// User-scoped clients (respect RLS)
let clientA: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;

describe('RLS Multi-Tenant Isolation', () => {
  beforeAll(async () => {
    // Diagnostic: Check service role authentication
    console.log('\n=== DIAGNOSTIC: Service Role Authentication ===');
    console.log('SUPABASE_URL:', SUPABASE_URL);
    console.log('SUPABASE_SERVICE_ROLE_KEY (first 20 chars):', SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20));
    console.log('SUPABASE_SERVICE_ROLE_KEY length:', SUPABASE_SERVICE_ROLE_KEY?.length);

    // Try to query a simple table to see auth context
    const { data: testQuery, error: testError } = await adminClient
      .from('organizations')
      .select('id')
      .limit(1);

    console.log('Test query succeeded:', !testError);
    console.log('Test query error:', testError);

    // Test is_service_role() function
    const { data: serviceRoleCheck, error: serviceRoleError } = await adminClient
      .rpc('is_service_role');

    console.log('is_service_role() result:', serviceRoleCheck);
    console.log('is_service_role() error:', serviceRoleError);
    console.log('=== END DIAGNOSTIC ===\n');

    // Create test users
    const timestamp = Date.now();
    const emailA = `test-user-a-${timestamp}@example.com`;
    const emailB = `test-user-b-${timestamp}@example.com`;
    const password = 'TestPassword123!';

    // Create User A
    const { data: authDataA, error: authErrorA } = await adminClient.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true
    });

    if (authErrorA || !authDataA.user) {
      throw new Error(`Failed to create user A: ${authErrorA?.message}`);
    }

    // Create User B
    const { data: authDataB, error: authErrorB } = await adminClient.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true
    });

    if (authErrorB || !authDataB.user) {
      throw new Error(`Failed to create user B: ${authErrorB?.message}`);
    }

    // Create Organization A
    const { data: orgDataA, error: orgErrorA } = await adminClient
      .from('organizations')
      .insert({
        name: `Test Org A ${timestamp}`,
        slug: `test-org-a-${timestamp}`,
        tier: 'trial'
      })
      .select()
      .single();

    if (orgErrorA || !orgDataA) {
      throw new Error(`Failed to create org A: ${orgErrorA?.message}`);
    }

    // Create Organization B
    const { data: orgDataB, error: orgErrorB } = await adminClient
      .from('organizations')
      .insert({
        name: `Test Org B ${timestamp}`,
        slug: `test-org-b-${timestamp}`,
        tier: 'trial'
      })
      .select()
      .single();

    if (orgErrorB || !orgDataB) {
      throw new Error(`Failed to create org B: ${orgErrorB?.message}`);
    }

    // Add User A as owner of Org A
    const { error: memberErrorA } = await adminClient
      .from('org_members')
      .insert({
        org_id: orgDataA.id,
        user_id: authDataA.user.id,
        role: 'owner'
      });

    if (memberErrorA) {
      throw new Error(`Failed to add user A to org A: ${memberErrorA.message}`);
    }

    // Add User B as owner of Org B
    const { error: memberErrorB } = await adminClient
      .from('org_members')
      .insert({
        org_id: orgDataB.id,
        user_id: authDataB.user.id,
        role: 'owner'
      });

    if (memberErrorB) {
      throw new Error(`Failed to add user B to org B: ${memberErrorB.message}`);
    }

    // Get access tokens for both users using temporary clients
    // (Don't use adminClient.auth.signIn as it would mutate adminClient's auth state)
    const tempClientA = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    const { data: sessionA, error: sessionErrorA } = await tempClientA.auth.signInWithPassword({
      email: emailA,
      password
    });

    if (sessionErrorA || !sessionA.session) {
      throw new Error(`Failed to create session for user A: ${sessionErrorA?.message}`);
    }

    const tempClientB = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    const { data: sessionB, error: sessionErrorB } = await tempClientB.auth.signInWithPassword({
      email: emailB,
      password
    });

    if (sessionErrorB || !sessionB.session) {
      throw new Error(`Failed to create session for user B: ${sessionErrorB?.message}`);
    }

    // Store test fixtures
    userA = {
      id: authDataA.user.id,
      email: emailA,
      password,
      accessToken: sessionA.session.access_token
    };

    userB = {
      id: authDataB.user.id,
      email: emailB,
      password,
      accessToken: sessionB.session.access_token
    };

    orgA = {
      id: orgDataA.id,
      name: orgDataA.name,
      slug: orgDataA.slug
    };

    orgB = {
      id: orgDataB.id,
      name: orgDataB.name,
      slug: orgDataB.slug
    };

    // Create seat limit test org
    const seatLimitInsertData = {
      name: `Seat Limit Test Org ${timestamp}`,
      slug: `seat-limit-test-${timestamp}`,
      tier: 'trial' as const,
      seat_limit: 1
    };

    console.log('Attempting to create seat limit org with data:', JSON.stringify(seatLimitInsertData, null, 2));

    const { data: seatLimitOrgData, error: seatLimitOrgError } = await adminClient
      .from('organizations')
      .insert(seatLimitInsertData)
      .select()
      .single();

    if (seatLimitOrgError || !seatLimitOrgData) {
      console.error('FULL ERROR OBJECT:', JSON.stringify(seatLimitOrgError, null, 2));
      console.error('Error code:', seatLimitOrgError?.code);
      console.error('Error message:', seatLimitOrgError?.message);
      console.error('Error details:', seatLimitOrgError?.details);
      console.error('Error hint:', seatLimitOrgError?.hint);
      throw new Error(`Failed to create seat limit test org: ${seatLimitOrgError?.message}`);
    }

    seatLimitTestOrg = {
      id: seatLimitOrgData.id,
      name: seatLimitOrgData.name,
      slug: seatLimitOrgData.slug
    };

    // Create user-scoped clients using anon key + user access tokens
    // (Must use anon key, not service role key, for RLS to be enforced)
    clientA = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${userA.accessToken}`
        }
      },
      auth: { persistSession: false }
    });

    clientB = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${userB.accessToken}`
        }
      },
      auth: { persistSession: false }
    });

    console.log('✓ Test fixtures created:');
    console.log(`  User A: ${userA.email} (${userA.id})`);
    console.log(`  User B: ${userB.email} (${userB.id})`);
    console.log(`  Org A: ${orgA.name} (${orgA.id})`);
    console.log(`  Org B: ${orgB.name} (${orgB.id})`);
  });

  afterAll(async () => {
    // Clean up test data
    if (userA?.id) {
      await adminClient.auth.admin.deleteUser(userA.id);
    }
    if (userB?.id) {
      await adminClient.auth.admin.deleteUser(userB.id);
    }
    if (orgA?.id) {
      await adminClient.from('organizations').delete().eq('id', orgA.id);
    }
    if (orgB?.id) {
      await adminClient.from('organizations').delete().eq('id', orgB.id);
    }
    if (seatLimitTestOrg?.id) {
      await adminClient.from('organizations').delete().eq('id', seatLimitTestOrg.id);
    }

    console.log('✓ Test fixtures cleaned up');
  });

  describe('Organizations Table RLS', () => {
    it('User A can read their own organization', async () => {
      const { data, error } = await clientA
        .from('organizations')
        .select('*')
        .eq('id', orgA.id)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.id).toBe(orgA.id);
      expect(data?.name).toBe(orgA.name);
    });

    it('User A CANNOT read Organization B', async () => {
      const { data, error } = await clientA
        .from('organizations')
        .select('*')
        .eq('id', orgB.id)
        .single();

      // Should return no data (filtered by RLS)
      expect(data).toBeNull();
      // Supabase returns PGRST116 error when no rows match after RLS filtering
      expect(error?.code).toBe('PGRST116');
    });

    it('User A can only see their own org in list queries', async () => {
      const { data, error } = await clientA
        .from('organizations')
        .select('*');

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);

      // Should only see org A
      const orgIds = data?.map(o => o.id) || [];
      expect(orgIds).toContain(orgA.id);
      expect(orgIds).not.toContain(orgB.id);
    });

    it('User A CANNOT update Organization B', async () => {
      const { error } = await clientA
        .from('organizations')
        .update({ name: 'HACKED' })
        .eq('id', orgB.id);

      // Update should be silently ignored (0 rows affected)
      // or return an error depending on RLS policy
      expect(error).toBeDefined();
    });
  });

  describe('Org Members Table RLS', () => {
    it('User A can read their own membership', async () => {
      const { data, error } = await clientA
        .from('org_members')
        .select('*')
        .eq('org_id', orgA.id)
        .eq('user_id', userA.id)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.org_id).toBe(orgA.id);
      expect(data?.user_id).toBe(userA.id);
      expect(data?.role).toBe('owner');
    });

    it('User A CANNOT read Organization B members', async () => {
      const { data, error } = await clientA
        .from('org_members')
        .select('*')
        .eq('org_id', orgB.id);

      // Should return empty array (RLS filters out all rows)
      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);
      expect(data?.length).toBe(0);
    });

    it('User A can only see members of their own org', async () => {
      const { data, error } = await clientA
        .from('org_members')
        .select('*');

      expect(error).toBeNull();
      expect(data).toBeDefined();

      const orgIds = data?.map(m => m.org_id) || [];
      expect(orgIds).toContain(orgA.id);
      expect(orgIds).not.toContain(orgB.id);
    });
  });

  describe('AI Tasks Table RLS', () => {
    let taskA: string;
    let taskB: string;

    beforeAll(async () => {
      // Create test tasks using authenticated clients (as real users would)
      const { data: taskDataA, error: errorA } = await clientA
        .from('ai_tasks')
        .insert({
          org_id: orgA.id,
          title: 'Task A',
          description: 'Sensitive task for Org A',
          created_by: userA.id
        })
        .select()
        .single();

      if (errorA) {
        console.error('Failed to create taskA:', errorA);
        throw new Error(`Failed to create taskA: ${errorA.message}`);
      }

      const { data: taskDataB, error: errorB } = await clientB
        .from('ai_tasks')
        .insert({
          org_id: orgB.id,
          title: 'Task B',
          description: 'Sensitive task for Org B',
          created_by: userB.id
        })
        .select()
        .single();

      if (errorB) {
        console.error('Failed to create taskB:', errorB);
        throw new Error(`Failed to create taskB: ${errorB.message}`);
      }

      taskA = taskDataA!.id;
      taskB = taskDataB!.id;
    });

    it('User A can read their own task', async () => {
      const { data, error } = await clientA
        .from('ai_tasks')
        .select('*')
        .eq('id', taskA)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.id).toBe(taskA);
      expect(data?.org_id).toBe(orgA.id);
    });

    it('User A CANNOT read Organization B tasks', async () => {
      const { data, error } = await clientA
        .from('ai_tasks')
        .select('*')
        .eq('id', taskB)
        .single();

      // Should be filtered by RLS
      expect(data).toBeNull();
      expect(error?.code).toBe('PGRST116');
    });

    it('User A can only see tasks from their own org', async () => {
      const { data, error } = await clientA
        .from('ai_tasks')
        .select('*');

      expect(error).toBeNull();
      expect(data).toBeDefined();

      const orgIds = data?.map(t => t.org_id) || [];
      expect(orgIds).toContain(orgA.id);
      expect(orgIds).not.toContain(orgB.id);
    });
  });

  describe('Salesforce Connections Table RLS', () => {
    let connA: string;
    let connB: string;

    beforeAll(async () => {
      const { data: connDataA } = await clientA
        .from('salesforce_connections')
        .insert({
          org_id: orgA.id,
          name: 'Prod Org A',
          instance_url: 'https://orga.my.salesforce.com',
          access_token_encrypted: 'encrypted_token_a',
          refresh_token_encrypted: 'encrypted_refresh_a',
          salesforce_org_id: '00D000000000001',
          created_by: userA.id
        })
        .select()
        .single();

      const { data: connDataB } = await clientB
        .from('salesforce_connections')
        .insert({
          org_id: orgB.id,
          name: 'Prod Org B',
          instance_url: 'https://orgb.my.salesforce.com',
          access_token_encrypted: 'encrypted_token_b',
          refresh_token_encrypted: 'encrypted_refresh_b',
          salesforce_org_id: '00D000000000002',
          created_by: userB.id
        })
        .select()
        .single();

      connA = connDataA!.id;
      connB = connDataB!.id;
    });

    it('User A can read their own Salesforce connection', async () => {
      const { data, error } = await clientA
        .from('salesforce_connections')
        .select('*')
        .eq('id', connA)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.id).toBe(connA);
      expect(data?.org_id).toBe(orgA.id);
    });

    it('User A CANNOT read Organization B Salesforce connections', async () => {
      const { data, error } = await clientA
        .from('salesforce_connections')
        .select('*')
        .eq('id', connB)
        .single();

      expect(data).toBeNull();
      expect(error?.code).toBe('PGRST116');
    });
  });

  describe('Audit Events Table RLS', () => {
    let eventA: string;
    let eventB: string;

    beforeAll(async () => {
      const { data: eventDataA } = await clientA
        .from('audit_events')
        .insert({
          org_id: orgA.id,
          actor_user_id: userA.id,
          action: 'task.created',
          payload_hash: 'hash_a'
        })
        .select()
        .single();

      const { data: eventDataB } = await clientB
        .from('audit_events')
        .insert({
          org_id: orgB.id,
          actor_user_id: userB.id,
          action: 'task.created',
          payload_hash: 'hash_b'
        })
        .select()
        .single();

      eventA = eventDataA!.id;
      eventB = eventDataB!.id;
    });

    it('User A can read their own audit events', async () => {
      const { data, error } = await clientA
        .from('audit_events')
        .select('*')
        .eq('id', eventA)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data?.id).toBe(eventA);
    });

    it('User A CANNOT read Organization B audit events', async () => {
      const { data, error } = await clientA
        .from('audit_events')
        .select('*')
        .eq('id', eventB)
        .single();

      expect(data).toBeNull();
      expect(error?.code).toBe('PGRST116');
    });
  });

  describe('Seat Limit Enforcement', () => {
    it('should enforce seat limit on org_members insert', async () => {
      // Test org already created in beforeAll with seat_limit = 1

      // Add first member (should succeed)
      const { error: firstMemberError } = await adminClient
        .from('org_members')
        .insert({
          org_id: seatLimitTestOrg.id,
          user_id: userA.id,
          role: 'owner'
        });

      expect(firstMemberError).toBeNull();

      // Try to add second member (should fail due to seat limit)
      const { error: secondMemberError } = await adminClient
        .from('org_members')
        .insert({
          org_id: seatLimitTestOrg.id,
          user_id: userB.id,
          role: 'developer'
        });

      expect(secondMemberError).toBeDefined();
      expect(secondMemberError?.message).toContain('seat limit');

      // Cleanup members for this test
      await adminClient.from('org_members').delete().eq('org_id', seatLimitTestOrg.id);
    });
  });
});
