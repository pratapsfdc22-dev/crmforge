/**
 * Jira OAuth 3LO Connection Routes
 * User-level OAuth connections to Atlassian/Jira
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin, verifyToken } from '../../lib/supabase.js';
import { storeSecret, updateSecret, deleteSecret, loadSecret } from '@forgesf/agent-core';
import { env } from '../../config/env.js';
import crypto from 'crypto';

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

interface AtlassianTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

interface AtlassianResource {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl: string;
}

/**
 * Sign state parameter for OAuth flow
 */
function signState(data: { orgId: string; userId: string }): string {
  const payload = JSON.stringify(data);
  const signature = crypto
    .createHmac('sha256', env.MASTER_ENC_KEY)
    .update(payload)
    .digest('hex');

  return Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');
}

/**
 * Verify and decode signed state
 */
function verifyState(state: string): { orgId: string; userId: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    const { payload, signature } = decoded;

    const expectedSignature = crypto
      .createHmac('sha256', env.MASTER_ENC_KEY)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSignature) {
      return null;
    }

    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Refresh Jira OAuth token
 */
export async function refreshJiraToken(
  userId: string,
  orgId: string,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: env.ATLASSIAN_CLIENT_ID || '',
      client_secret: env.ATLASSIAN_CLIENT_SECRET || ''
    });

    const response = await fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as AtlassianTokenResponse;

    // Update stored token
    await updateSecret(supabaseAdmin, {
      orgId,
      userId,
      kind: 'jira_oauth',
      payload: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString()
      },
      masterKey: env.MASTER_ENC_KEY
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token
    };
  } catch {
    return null;
  }
}

/**
 * Make authenticated request to Jira API with auto-retry on 401
 */
export async function jiraRequest(
  url: string,
  userId: string,
  orgId: string,
  options: RequestInit = {}
): Promise<Response> {
  const secret = await loadSecret<{
    access_token: string;
    refresh_token: string;
    expires_at: string;
  }>(supabaseAdmin, {
    orgId,
    userId,
    kind: 'jira_oauth',
    masterKey: env.MASTER_ENC_KEY
  });

  if (!secret) {
    throw new Error('No Jira credentials found');
  }

  // Try request with current token
  let response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${secret.access_token}`,
      'Accept': 'application/json'
    }
  });

  // If 401, refresh token and retry
  if (response.status === 401) {
    const refreshed = await refreshJiraToken(userId, orgId, secret.refresh_token);

    if (!refreshed) {
      throw new Error('Failed to refresh Jira token');
    }

    // Retry with new token
    response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${refreshed.accessToken}`,
        'Accept': 'application/json'
      }
    });
  }

  return response;
}

export async function jiraConnectionRoutes(fastify: FastifyInstance) {
  // Initiate Jira OAuth flow
  fastify.get('/connections/jira/authorize', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const user = await verifyToken(token);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    // Get user's org
    const membershipResult: any = await supabaseAdmin
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .single();

    const membership = membershipResult.data;
    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of any organization' });
    }

    // Generate signed state
    const state = signState({
      orgId: membership.org_id,
      userId: user.id
    });

    // Redirect to Atlassian OAuth
    const authUrl = new URL(ATLASSIAN_AUTH_URL);
    authUrl.searchParams.set('audience', 'api.atlassian.com');
    authUrl.searchParams.set('client_id', env.ATLASSIAN_CLIENT_ID || '');
    authUrl.searchParams.set('scope', 'read:jira-work write:jira-work offline_access');
    authUrl.searchParams.set('redirect_uri', `${env.API_URL}/connections/jira/callback`);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('prompt', 'consent');

    return reply.redirect(authUrl.toString());
  });

  // OAuth callback
  fastify.get('/connections/jira/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };

    if (!code || !state) {
      return reply.status(400).send({ error: 'Missing code or state' });
    }

    // Verify state
    const stateData = verifyState(state);
    if (!stateData) {
      return reply.status(400).send({ error: 'Invalid state parameter' });
    }

    try {
      // Exchange code for tokens
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.ATLASSIAN_CLIENT_ID || '',
        client_secret: env.ATLASSIAN_CLIENT_SECRET || '',
        code,
        redirect_uri: `${env.API_URL}/connections/jira/callback`
      });

      const tokenResponse = await fetch(ATLASSIAN_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${errorText}`);
      }

      const tokens = await tokenResponse.json() as AtlassianTokenResponse;

      // Get accessible resources
      const resourcesResponse = await fetch(ATLASSIAN_RESOURCES_URL, {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json'
        }
      });

      if (!resourcesResponse.ok) {
        throw new Error('Failed to fetch accessible resources');
      }

      const resources = await resourcesResponse.json() as AtlassianResource[];

      if (resources.length === 0) {
        throw new Error('No accessible Jira sites found');
      }

      // Use first resource (in production, might want to let user choose)
      const resource = resources[0];

      // Store tokens in vault
      await storeSecret(supabaseAdmin, {
        orgId: stateData.orgId,
        userId: stateData.userId,
        kind: 'jira_oauth',
        payload: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        },
        masterKey: env.MASTER_ENC_KEY
      });

      // Create/update connection record
      const connectionData = {
        org_id: stateData.orgId,
        user_id: stateData.userId,
        cloud_id: resource.id,
        site_url: resource.url,
        jira_account_id: stateData.userId,
        status: 'verified' as const,
        last_verified_at: new Date().toISOString()
      };

      const { error: upsertError } = await supabaseAdmin
        .from('jira_connections')
        .upsert(connectionData, {
          onConflict: 'org_id,user_id'
        });

      if (upsertError) {
        throw new Error(`Database error: ${upsertError.message}`);
      }

      // Audit log
      await supabaseAdmin.from('audit_events').insert({
        org_id: stateData.orgId,
        actor_user_id: stateData.userId,
        action: 'jira_connection.created',
        target_type: 'jira_connection',
        target_id: stateData.userId,
        payload_hash: 'redacted',
        metadata: {
          cloud_id: resource.id,
          site_url: resource.url
        }
      } as any);

      // Redirect to success page
      return reply.redirect(`${env.WEB_URL}/app/connections?jira=success`);
    } catch (error) {
      console.error('Jira OAuth callback error:', error);
      return reply.redirect(`${env.WEB_URL}/app/connections?jira=error`);
    }
  });

  // List Jira connections (all in org)
  fastify.get('/connections/jira', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const user = await verifyToken(token);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    // Get user's orgs
    const membershipsResult: any = await supabaseAdmin
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id);

    const memberships = membershipsResult.data || [];
    if (memberships.length === 0) {
      return reply.send({ connections: [] });
    }

    const orgIds = memberships.map((m: any) => m.org_id);

    // Get all connections in these orgs
    const connectionsResult: any = await supabaseAdmin
      .from('jira_connections')
      .select('*')
      .in('org_id', orgIds)
      .order('created_at', { ascending: false });

    const connections = connectionsResult.data || [];

    // Never return tokens
    return reply.send({
      connections: connections.map((c: any) => ({
        id: c.id,
        user_id: c.user_id,
        cloud_id: c.cloud_id,
        site_url: c.site_url,
        status: c.status,
        last_verified_at: c.last_verified_at,
        failure_reason: c.failure_reason,
        created_at: c.created_at,
        updated_at: c.updated_at
      }))
    });
  });

  // Delete Jira connection (own connection only)
  fastify.delete('/connections/jira/:id', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const user = await verifyToken(token);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    const { id } = request.params as { id: string };

    // Get connection
    const connectionResult: any = await supabaseAdmin
      .from('jira_connections')
      .select('org_id, user_id')
      .eq('id', id)
      .single();

    const connection = connectionResult.data;
    if (!connection) {
      return reply.status(404).send({ error: 'Connection not found' });
    }

    // Only the connection owner can delete it
    if (connection.user_id !== user.id) {
      return reply.status(403).send({ error: 'You can only delete your own Jira connection' });
    }

    // Delete secret from vault
    await deleteSecret(supabaseAdmin, {
      orgId: connection.org_id,
      userId: user.id,
      kind: 'jira_oauth'
    });

    // Delete connection
    await supabaseAdmin
      .from('jira_connections')
      .delete()
      .eq('id', id);

    // Audit log
    await supabaseAdmin.from('audit_events').insert({
      org_id: connection.org_id,
      actor_user_id: user.id,
      action: 'jira_connection.deleted',
      target_type: 'jira_connection',
      target_id: id,
      payload_hash: 'redacted',
      metadata: {}
    } as any);

    return reply.status(204).send();
  });

  // Re-verify Jira connection
  fastify.post('/connections/jira/:id/verify', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const user = await verifyToken(token);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    const { id } = request.params as { id: string };

    // Get connection
    const connectionResult: any = await supabaseAdmin
      .from('jira_connections')
      .select('*')
      .eq('id', id)
      .single();

    const connection = connectionResult.data;
    if (!connection) {
      return reply.status(404).send({ error: 'Connection not found' });
    }

    // Only connection owner can verify
    if (connection.user_id !== user.id) {
      return reply.status(403).send({ error: 'You can only verify your own connection' });
    }

    try {
      // Try making a test API call
      const response = await jiraRequest(
        `${connection.site_url}/rest/api/3/myself`,
        user.id,
        connection.org_id
      );

      const success = response.ok;

      // Update connection status
      await supabaseAdmin
        .from('jira_connections')
        .update({
          status: success ? 'verified' : 'failed',
          last_verified_at: new Date().toISOString(),
          failure_reason: success ? null : 'API request failed'
        })
        .eq('id', id);

      // Audit log
      await supabaseAdmin.from('audit_events').insert({
        org_id: connection.org_id,
        actor_user_id: user.id,
        action: 'jira_connection.verified',
        target_type: 'jira_connection',
        target_id: id,
        payload_hash: 'redacted',
        metadata: { success }
      } as any);

      return reply.send({
        success,
        status: success ? 'verified' : 'failed'
      });
    } catch (error) {
      await supabaseAdmin
        .from('jira_connections')
        .update({
          status: 'failed',
          last_verified_at: new Date().toISOString(),
          failure_reason: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', id);

      return reply.send({
        success: false,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
