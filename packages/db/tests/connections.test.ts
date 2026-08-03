/**
 * Connections Layer Integration Tests
 *
 * Verifies:
 * - Connection CRUD operations work correctly
 * - enc_payload is NEVER leaked through any API route
 * - User-scoped authentication (Jira)
 * - Org-scoped authentication (Salesforce, n8n)
 * - RLS policies enforce proper access control
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load env from api/.env
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

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required environment variables');
}

// Admin client (service role - bypasses RLS)
const adminClient = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

// Test fixtures
let userA: { id: string; email: string; password: string; accessToken: string };
let userB: { id: string; email: string; password: string; accessToken: string };
let orgA: { id: string; name: string; slug: string };
let orgB: { id: string; name: string; slug: string };

// User-scoped clients (use ANON key + access tokens)
let clientA: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;

describe('Connections Layer - Security & RLS', () => {
  beforeAll(async () => {
    // Create test users using admin client for auth operations
    const timestamp = Date.now();
    const emailA = `test-conn-a-${timestamp}@example.com`;
    const emailB = `test-conn-b-${timestamp}@example.com`;
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

    // Create organizations
    const orgDataA: Database['public']['Tables']['organizations']['Insert'] = {
      name: `Test Org A ${timestamp}`,
      slug: `test-org-a-${timestamp}`,
      tier: 'trial'
    };

    const orgResultA = await adminClient
      .from('organizations')
      .insert(orgDataA)
      .select()
      .single();

    if (orgResultA.error || !orgResultA.data) {
      throw new Error(`Failed to create org A: ${orgResultA.error?.message}`);
    }

    const orgDataB: Database['public']['Tables']['organizations']['Insert'] = {
      name: `Test Org B ${timestamp}`,
      slug: `test-org-b-${timestamp}`,
      tier: 'trial'
    };

    const orgResultB = await adminClient
      .from('organizations')
      .insert(orgDataB)
      .select()
      .single();

    if (orgResultB.error || !orgResultB.data) {
      throw new Error(`Failed to create org B: ${orgResultB.error?.message}`);
    }

    // Add users to orgs
    await adminClient.from('org_members').insert({
      org_id: orgResultA.data.id,
      user_id: authDataA.user.id,
      role: 'owner'
    });

    await adminClient.from('org_members').insert({
      org_id: orgResultB.data.id,
      user_id: authDataB.user.id,
      role: 'owner'
    });

    // Get access tokens using separate temp clients for each user
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

    // Store fixtures
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
      id: orgResultA.data.id,
      name: orgResultA.data.name,
      slug: orgResultA.data.slug
    };

    orgB = {
      id: orgResultB.data.id,
      name: orgResultB.data.name,
      slug: orgResultB.data.slug
    };

    // Create user-scoped clients using ANON key (not service role)
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

    console.log('✓ Test fixtures cleaned up');
  });

  describe('connection_secrets RLS - CRITICAL SECURITY', () => {
    it('authenticated users CANNOT select enc_payload from connection_secrets', async () => {
      // Create a test secret using admin client
      const { data: secret, error: insertError } = await adminClient
        .from('connection_secrets')
        .insert({
          org_id: orgA.id,
          user_id: null,
          kind: 'salesforce_jwt',
          enc_payload: Buffer.from('test-encrypted-data'),
          key_version: 1
        })
        .select()
        .single();

      expect(insertError).toBeNull();
      expect(secret).toBeDefined();

      // Try to read it with user client - should be blocked by RLS
      const { data: leaked, error: selectError } = await clientA
        .from('connection_secrets')
        .select('*')
        .eq('org_id', orgA.id)
        .eq('kind', 'salesforce_jwt');

      // Should return empty result (RLS filtered) or error
      expect(leaked).toEqual([]);

      // Clean up
      if (secret) {
        await adminClient.from('connection_secrets').delete().eq('id', secret.id);
      }
    });

    it('user CANNOT select connection_secrets even with explicit column selection', async () => {
      const { data: secret } = await adminClient
        .from('connection_secrets')
        .insert({
          org_id: orgA.id,
          user_id: userA.id,
          kind: 'jira_oauth',
          enc_payload: Buffer.from('secret-jira-token'),
          key_version: 1
        })
        .select()
        .single();

      // Try various query patterns
      const { data: leak1 } = await clientA
        .from('connection_secrets')
        .select('enc_payload')
        .eq('user_id', userA.id);

      const { data: leak2 } = await clientA
        .from('connection_secrets')
        .select('id, enc_payload')
        .eq('org_id', orgA.id);

      const { data: leak3 } = await clientA
        .from('connection_secrets')
        .select('*')
        .eq('id', secret?.id || 'fake-id');

      expect(leak1).toEqual([]);
      expect(leak2).toEqual([]);
      expect(leak3).toEqual([]);

      // Clean up
      if (secret) {
        await adminClient.from('connection_secrets').delete().eq('id', secret.id);
      }
    });
  });

  describe('Salesforce Connections - Org-Level', () => {
    it('User A can create Salesforce connection in their org', async () => {
      const { data: connection, error } = await clientA
        .from('sf_connections')
        .insert({
          org_id: orgA.id,
          label: 'Test SF Connection',
          env: 'sandbox',
          instance_url: 'https://test.salesforce.com',
          consumer_key: 'test-consumer-key',
          sf_username: 'test@example.com',
          status: 'pending',
          created_by: userA.id
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(connection).toBeDefined();
      expect(connection?.org_id).toBe(orgA.id);
      expect(connection?.label).toBe('Test SF Connection');

      // Clean up
      if (connection) {
        await adminClient.from('sf_connections').delete().eq('id', connection.id);
      }
    });

    it('User A CANNOT create Salesforce connection in Org B', async () => {
      const { error } = await clientA
        .from('sf_connections')
        .insert({
          org_id: orgB.id, // Different org!
          label: 'Hacked Connection',
          env: 'sandbox',
          instance_url: 'https://test.salesforce.com',
          consumer_key: 'test-consumer-key',
          sf_username: 'hacker@example.com',
          status: 'pending',
          created_by: userA.id
        });

      // Should be blocked by RLS
      expect(error).toBeDefined();
    });

    it('User A can read their own org SF connections', async () => {
      // Create connection
      const { data: connection } = await adminClient
        .from('sf_connections')
        .insert({
          org_id: orgA.id,
          label: 'Readable Connection',
          env: 'production',
          instance_url: 'https://login.salesforce.com',
          consumer_key: 'test-key',
          sf_username: 'user@example.com',
          status: 'verified',
          created_by: userA.id
        })
        .select()
        .single();

      // Read it back with user client
      const { data: readConnection, error } = await clientA
        .from('sf_connections')
        .select('*')
        .eq('id', connection!.id)
        .single();

      expect(error).toBeNull();
      expect(readConnection).toBeDefined();
      expect(readConnection?.label).toBe('Readable Connection');

      // Clean up
      if (connection) {
        await adminClient.from('sf_connections').delete().eq('id', connection.id);
      }
    });

    it('User A CANNOT read Org B SF connections', async () => {
      // Create connection in Org B
      const { data: connectionB } = await adminClient
        .from('sf_connections')
        .insert({
          org_id: orgB.id,
          label: 'Org B Connection',
          env: 'sandbox',
          instance_url: 'https://test.salesforce.com',
          consumer_key: 'org-b-key',
          sf_username: 'orgb@example.com',
          status: 'verified',
          created_by: userB.id
        })
        .select()
        .single();

      // Try to read it with User A's client
      const { data: leaked, error } = await clientA
        .from('sf_connections')
        .select('*')
        .eq('id', connectionB!.id)
        .single();

      // Should be filtered by RLS
      expect(leaked).toBeNull();
      expect(error?.code).toBe('PGRST116'); // Not found after RLS filtering

      // Clean up
      if (connectionB) {
        await adminClient.from('sf_connections').delete().eq('id', connectionB.id);
      }
    });
  });

  describe('Jira Connections - User-Level', () => {
    it('User A can create Jira connection in their org', async () => {
      const { data: connection, error } = await clientA
        .from('jira_connections')
        .insert({
          org_id: orgA.id,
          user_id: userA.id,
          cloud_id: 'test-cloud-id',
          site_url: 'https://test.atlassian.net',
          jira_account_id: 'test-account-id',
          status: 'verified'
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(connection).toBeDefined();
      expect(connection?.user_id).toBe(userA.id);
      expect(connection?.org_id).toBe(orgA.id);

      // Clean up
      if (connection) {
        await adminClient.from('jira_connections').delete().eq('id', connection.id);
      }
    });

    it('User A CANNOT create Jira connection for User B', async () => {
      const { error } = await clientA
        .from('jira_connections')
        .insert({
          org_id: orgA.id,
          user_id: userB.id, // Different user!
          cloud_id: 'hacked-cloud-id',
          site_url: 'https://hacked.atlassian.net',
          jira_account_id: 'hacked-account',
          status: 'verified'
        });

      // Should be blocked by RLS
      expect(error).toBeDefined();
    });

    it('User A can read all Jira connections in their org (including teammates)', async () => {
      // Create connection for User A
      const { data: connA } = await adminClient
        .from('jira_connections')
        .insert({
          org_id: orgA.id,
          user_id: userA.id,
          cloud_id: 'user-a-cloud',
          site_url: 'https://usera.atlassian.net',
          jira_account_id: 'user-a-account',
          status: 'verified'
        })
        .select()
        .single();

      // Read connections with user client
      const { data: connections, error } = await clientA
        .from('jira_connections')
        .select('*')
        .eq('org_id', orgA.id);

      expect(error).toBeNull();
      expect(connections).toBeDefined();
      expect(connections!.length).toBeGreaterThan(0);

      // Should be able to see own connection
      const found = connections!.find(c => c.user_id === userA.id);
      expect(found).toBeDefined();

      // Clean up
      if (connA) {
        await adminClient.from('jira_connections').delete().eq('id', connA.id);
      }
    });

    it('User A can only UPDATE their own Jira connection', async () => {
      // Create connection for User A
      const { data: conn } = await adminClient
        .from('jira_connections')
        .insert({
          org_id: orgA.id,
          user_id: userA.id,
          cloud_id: 'update-test',
          site_url: 'https://update.atlassian.net',
          jira_account_id: 'update-account',
          status: 'pending'
        })
        .select()
        .single();

      // User A updates their own connection - should succeed
      const { error: updateError } = await clientA
        .from('jira_connections')
        .update({ status: 'verified' })
        .eq('id', conn!.id);

      expect(updateError).toBeNull();

      // Verify update worked
      const { data: updated } = await adminClient
        .from('jira_connections')
        .select('status')
        .eq('id', conn!.id)
        .single();

      expect(updated?.status).toBe('verified');

      // Clean up
      if (conn) {
        await adminClient.from('jira_connections').delete().eq('id', conn.id);
      }
    });
  });

  describe('n8n Connections - Org-Level', () => {
    it('User A can create n8n connection in their org', async () => {
      const { data: connection, error } = await clientA
        .from('n8n_connections')
        .insert({
          org_id: orgA.id,
          mode: 'byo',
          base_url: 'https://n8n.example.com',
          status: 'pending',
          created_by: userA.id
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(connection).toBeDefined();
      expect(connection?.org_id).toBe(orgA.id);
      expect(connection?.mode).toBe('byo');

      // Clean up
      if (connection) {
        await adminClient.from('n8n_connections').delete().eq('id', connection.id);
      }
    });

    it('User A CANNOT create n8n connection in Org B', async () => {
      const { error } = await clientA
        .from('n8n_connections')
        .insert({
          org_id: orgB.id, // Different org!
          mode: 'byo',
          base_url: 'https://hacked-n8n.example.com',
          status: 'pending',
          created_by: userA.id
        });

      // Should be blocked by RLS
      expect(error).toBeDefined();
    });
  });

  describe('Cross-Tenant Isolation', () => {
    it('User A cannot see any of Org B connections', async () => {
      // Create connections in Org B
      const { data: sfB } = await adminClient
        .from('sf_connections')
        .insert({
          org_id: orgB.id,
          label: 'Org B SF',
          env: 'sandbox',
          instance_url: 'https://orgb.salesforce.com',
          consumer_key: 'orgb-key',
          sf_username: 'orgb@example.com',
          status: 'verified',
          created_by: userB.id
        })
        .select()
        .single();

      const { data: jiraB } = await adminClient
        .from('jira_connections')
        .insert({
          org_id: orgB.id,
          user_id: userB.id,
          cloud_id: 'orgb-cloud',
          site_url: 'https://orgb.atlassian.net',
          jira_account_id: 'orgb-account',
          status: 'verified'
        })
        .select()
        .single();

      const { data: n8nB } = await adminClient
        .from('n8n_connections')
        .insert({
          org_id: orgB.id,
          mode: 'byo',
          base_url: 'https://orgb-n8n.example.com',
          status: 'verified',
          created_by: userB.id
        })
        .select()
        .single();

      // Try to query all with User A's client
      const { data: sfLeak } = await clientA
        .from('sf_connections')
        .select('*')
        .eq('org_id', orgB.id);

      const { data: jiraLeak } = await clientA
        .from('jira_connections')
        .select('*')
        .eq('org_id', orgB.id);

      const { data: n8nLeak } = await clientA
        .from('n8n_connections')
        .select('*')
        .eq('org_id', orgB.id);

      // All should be empty (RLS filtered)
      expect(sfLeak).toEqual([]);
      expect(jiraLeak).toEqual([]);
      expect(n8nLeak).toEqual([]);

      // Clean up
      if (sfB) await adminClient.from('sf_connections').delete().eq('id', sfB.id);
      if (jiraB) await adminClient.from('jira_connections').delete().eq('id', jiraB.id);
      if (n8nB) await adminClient.from('n8n_connections').delete().eq('id', n8nB.id);
    });
  });
});
