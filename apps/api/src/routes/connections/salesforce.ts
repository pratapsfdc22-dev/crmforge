/**
 * Salesforce Connection Routes
 * JWT Bearer flow for org-level Salesforce connections
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from '@forgesf/db/types';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { supabaseAdmin, verifyToken } from '../../lib/supabase.js';
import { storeSecret, deleteSecret } from '@forgesf/agent-core';
import { env } from '../../config/env.js';

type SFConnection = Database['public']['Tables']['sf_connections']['Row'];
type OrgMember = Database['public']['Tables']['org_members']['Row'];
type Organization = Database['public']['Tables']['organizations']['Row'];

const CreateSalesforceConnectionSchema = z.object({
  label: z.string().min(1).max(100),
  env: z.enum(['sandbox', 'production']),
  instance_url: z.string().url(),
  consumer_key: z.string().min(1),
  sf_username: z.string().email(),
  private_key_pem: z.string().min(1)
});

// Tier limits for Salesforce connections
const TIER_LIMITS: Record<string, number> = {
  trial: 1,
  starter: 1,
  professional: 2,
  enterprise: 5
};

interface SalesforceTokenResponse {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
}

/**
 * Verify Salesforce connection by executing JWT Bearer token exchange
 */
async function verifySalesforceConnection(
  instanceUrl: string,
  consumerKey: string,
  username: string,
  privateKeyPem: string
): Promise<{ success: boolean; error?: string; accessToken?: string }> {
  try {
    // Create JWT assertion
    const payload = {
      iss: consumerKey,
      sub: username,
      aud: instanceUrl,
      exp: Math.floor(Date.now() / 1000) + 300 // 5 minutes
    };

    const assertion = jwt.sign(payload, privateKeyPem, { algorithm: 'RS256' });

    // Exchange JWT for access token
    const tokenUrl = `${instanceUrl}/services/oauth2/token`;
    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return {
        success: false,
        error: `Token exchange failed: ${errorText}`
      };
    }

    const tokenData = await tokenResponse.json() as SalesforceTokenResponse;

    // Verify connection by calling Salesforce API
    const apiResponse = await fetch(`${tokenData.instance_url}/services/data`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    if (!apiResponse.ok) {
      return {
        success: false,
        error: 'Failed to verify Salesforce API access'
      };
    }

    return {
      success: true,
      accessToken: tokenData.access_token
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during verification'
    };
  }
}

export async function salesforceConnectionRoutes(fastify: FastifyInstance) {
  // Create Salesforce connection
  fastify.post('/connections/salesforce', async (request, reply) => {
    // Authenticate user
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const user = await verifyToken(token);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    const body = CreateSalesforceConnectionSchema.parse(request.body);

    // Get user's org and verify they're an admin or owner
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .single() as any;

    if (membershipError || !membership) {
      return reply.status(403).send({ error: 'Not a member of any organization' });
    }

    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return reply.status(403).send({ error: 'Only owners and admins can manage connections' });
    }

    const orgId = membership.org_id;

    // Get org tier for limit checking
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('tier')
      .eq('id', orgId)
      .single() as any;

    const tier = org?.tier || 'trial';

    // Check tier limit
    const { data: existingConnections } = await supabaseAdmin
      .from('sf_connections')
      .select('id')
      .eq('org_id', orgId);

    const limit = TIER_LIMITS[tier] || 1;
    if (existingConnections && existingConnections.length >= limit) {
      return reply.status(403).send({
        error: 'ConnectionLimitReached',
        message: `Your ${tier} plan allows ${limit} Salesforce connection(s). Upgrade to add more.`,
        limit,
        current: existingConnections.length
      });
    }

    // Verify Salesforce connection
    const verification = await verifySalesforceConnection(
      body.instance_url,
      body.consumer_key,
      body.sf_username,
      body.private_key_pem
    );

    if (!verification.success) {
      return reply.status(400).send({
        error: 'VerificationFailed',
        message: verification.error
      });
    }

    // Store private key in vault
    try {
      await storeSecret(supabaseAdmin, {
        orgId,
        userId: null, // Org-level secret
        kind: 'salesforce_jwt',
        payload: {
          private_key_pem: body.private_key_pem
        },
        masterKey: env.MASTER_ENC_KEY
      });
    } catch (error) {
      return reply.status(500).send({
        error: 'VaultError',
        message: 'Failed to store connection secret'
      });
    }

    // Create connection record
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from('sf_connections')
      .insert({
        org_id: orgId,
        label: body.label,
        env: body.env,
        instance_url: body.instance_url,
        consumer_key: body.consumer_key,
        sf_username: body.sf_username,
        status: 'verified',
        last_verified_at: new Date().toISOString(),
        created_by: user.id
      } as any)
      .select()
      .single() as any;

    if (connectionError) {
      return reply.status(500).send({
        error: 'DatabaseError',
        message: connectionError.message
      });
    }

    // Audit log
    await supabaseAdmin.from('audit_events').insert({
      org_id: orgId,
      actor_user_id: user.id,
      action: 'salesforce_connection.created',
      target_type: 'sf_connection',
      target_id: connection.id,
      payload_hash: 'redacted',
      metadata: {
        label: body.label,
        env: body.env,
        sf_username: body.sf_username
      }
    });

    return reply.status(201).send({
      connection: {
        id: connection.id,
        label: connection.label,
        env: connection.env,
        instance_url: connection.instance_url,
        sf_username: connection.sf_username,
        status: connection.status,
        last_verified_at: connection.last_verified_at,
        created_at: connection.created_at
      }
    });
  });

  // List Salesforce connections
  fastify.get('/connections/salesforce', async (request, reply) => {
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
    const { data: memberships } = await supabaseAdmin
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id) as any;

    if (!memberships || memberships.length === 0) {
      return reply.send({ connections: [] });
    }

    const orgIds = memberships.map(m => m.org_id);

    // Get connections (RLS will filter to user's orgs, but we use admin client for consistency)
    const { data: connections, error } = await supabaseAdmin
      .from('sf_connections')
      .select('*')
      .in('org_id', orgIds)
      .order('created_at', { ascending: false });

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    // Never return private keys or consumer secrets
    return reply.send({
      connections: connections.map(c => ({
        id: c.id,
        label: c.label,
        env: c.env,
        instance_url: c.instance_url,
        sf_username: c.sf_username,
        status: c.status,
        last_verified_at: c.last_verified_at,
        failure_reason: c.failure_reason,
        created_at: c.created_at,
        updated_at: c.updated_at
      }))
    });
  });

  // Delete Salesforce connection
  fastify.delete('/connections/salesforce/:id', async (request, reply) => {
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

    // Get connection to verify ownership
    const { data: connection, error: fetchError } = await supabaseAdmin
      .from('sf_connections')
      .select('org_id')
      .eq('id', id)
      .single() as any;

    if (fetchError || !connection) {
      return reply.status(404).send({ error: 'Connection not found' });
    }

    // Verify user is admin/owner
    const { data: membership } = await supabaseAdmin
      .from('org_members')
      .select('role')
      .eq('org_id', connection.org_id)
      .eq('user_id', user.id)
      .single() as any;

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return reply.status(403).send({ error: 'Only owners and admins can delete connections' });
    }

    // Delete secret from vault
    await deleteSecret(supabaseAdmin, {
      orgId: connection.org_id,
      userId: null,
      kind: 'salesforce_jwt'
    });

    // Delete connection
    const { error: deleteError } = await supabaseAdmin
      .from('sf_connections')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return reply.status(500).send({ error: deleteError.message });
    }

    // Audit log
    await supabaseAdmin.from('audit_events').insert({
      org_id: connection.org_id,
      actor_user_id: user.id,
      action: 'salesforce_connection.deleted',
      target_type: 'sf_connection',
      target_id: id,
      payload_hash: 'redacted',
      metadata: {}
    });

    return reply.status(204).send();
  });

  // Re-verify Salesforce connection
  fastify.post('/connections/salesforce/:id/verify', async (request, reply) => {
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
    const { data: connection, error: fetchError } = await supabaseAdmin
      .from('sf_connections')
      .select('*')
      .eq('id', id)
      .single() as any;

    if (fetchError || !connection) {
      return reply.status(404).send({ error: 'Connection not found' });
    }

    // Verify user has access
    const { data: membership } = await supabaseAdmin
      .from('org_members')
      .select('role')
      .eq('org_id', connection.org_id)
      .eq('user_id', user.id)
      .single() as any;

    if (!membership) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    // Load private key from vault
    const { loadSecret } = await import('@forgesf/agent-core');
    const secret = await loadSecret<{ private_key_pem: string }>(supabaseAdmin, {
      orgId: connection.org_id,
      userId: null,
      kind: 'salesforce_jwt',
      masterKey: env.MASTER_ENC_KEY
    });

    if (!secret) {
      return reply.status(500).send({ error: 'Private key not found in vault' });
    }

    // Re-verify connection
    const verification = await verifySalesforceConnection(
      connection.instance_url,
      connection.consumer_key,
      connection.sf_username,
      secret.private_key_pem
    );

    // Update connection status
    const { error: updateError } = await supabaseAdmin
      .from('sf_connections')
      .update({
        status: verification.success ? 'verified' : 'failed',
        last_verified_at: new Date().toISOString(),
        failure_reason: verification.success ? null : verification.error
      } as any)
      .eq('id', id);

    if (updateError) {
      return reply.status(500).send({ error: updateError.message });
    }

    // Audit log
    await supabaseAdmin.from('audit_events').insert({
      org_id: connection.org_id,
      actor_user_id: user.id,
      action: 'salesforce_connection.verified',
      target_type: 'sf_connection',
      target_id: id,
      payload_hash: 'redacted',
      metadata: {
        success: verification.success,
        error: verification.error
      }
    });

    return reply.send({
      success: verification.success,
      status: verification.success ? 'verified' : 'failed',
      error: verification.error
    });
  });
}
