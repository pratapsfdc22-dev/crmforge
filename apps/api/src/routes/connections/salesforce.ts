/**
 * Salesforce Connection Routes
 * JWT Bearer flow for org-level Salesforce connections
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { supabaseAdmin, verifyToken } from '../../lib/supabase.js';
import { storeSecret, deleteSecret } from '@forgesf/agent-core';
import { env } from '../../config/env.js';

const CreateSalesforceConnectionSchema = z.object({
  label: z.string().min(1).max(100),
  env: z.enum(['sandbox', 'production']),
  instance_url: z.string().url(),
  consumer_key: z.string().min(1),
  sf_username: z.string().email(),
  private_key_pem: z.string().min(1)
});

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

async function verifySalesforceConnection(
  instanceUrl: string,
  consumerKey: string,
  username: string,
  privateKeyPem: string
): Promise<{ success: boolean; error?: string; accessToken?: string }> {
  try {
    const payload = {
      iss: consumerKey,
      sub: username,
      aud: instanceUrl,
      exp: Math.floor(Date.now() / 1000) + 300
    };

    const assertion = jwt.sign(payload, privateKeyPem, { algorithm: 'RS256' });
    const tokenUrl = `${instanceUrl}/services/oauth2/token`;
    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return { success: false, error: `Token exchange failed: ${errorText}` };
    }

    const tokenData = await tokenResponse.json() as SalesforceTokenResponse;
    const apiResponse = await fetch(`${tokenData.instance_url}/services/data`, {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });

    if (!apiResponse.ok) {
      return { success: false, error: 'Failed to verify Salesforce API access' };
    }

    return { success: true, accessToken: tokenData.access_token };
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

    const membershipResult: any = await supabaseAdmin
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .single();

    const membership = membershipResult.data;
    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of any organization' });
    }

    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return reply.status(403).send({ error: 'Only owners and admins can manage connections' });
    }

    const orgId = membership.org_id;
    const orgResult: any = await supabaseAdmin
      .from('organizations')
      .select('tier')
      .eq('id', orgId)
      .single();

    const tier = orgResult.data?.tier || 'trial';

    const existingResult: any = await supabaseAdmin
      .from('sf_connections')
      .select('id')
      .eq('org_id', orgId);

    const limit = TIER_LIMITS[tier] || 1;
    const existing = existingResult.data || [];
    if (existing.length >= limit) {
      return reply.status(403).send({
        error: 'ConnectionLimitReached',
        message: `Your ${tier} plan allows ${limit} Salesforce connection(s). Upgrade to add more.`,
        limit,
        current: existing.length
      });
    }

    const verification = await verifySalesforceConnection(
      body.instance_url,
      body.consumer_key,
      body.sf_username,
      body.private_key_pem
    );

    if (!verification.success) {
      return reply.status(400).send({ error: 'VerificationFailed', message: verification.error });
    }

    try {
      await storeSecret(supabaseAdmin, {
        orgId,
        userId: null,
        kind: 'salesforce_jwt',
        payload: { private_key_pem: body.private_key_pem },
        masterKey: env.MASTER_ENC_KEY
      });
    } catch (error) {
      return reply.status(500).send({ error: 'VaultError', message: 'Failed to store connection secret' });
    }

    const connectionResult: any = await supabaseAdmin
      .from('sf_connections')
      .insert({
        org_id: orgId,
        label: body.label,
        env: body.env as 'sandbox' | 'production',
        instance_url: body.instance_url,
        consumer_key: body.consumer_key,
        sf_username: body.sf_username,
        status: 'verified' as const,
        last_verified_at: new Date().toISOString(),
        created_by: user.id
      })
      .select()
      .single();

    const connection = connectionResult.data;
    if (!connection) {
      return reply.status(500).send({ error: 'DatabaseError', message: 'Failed to create connection' });
    }

    await supabaseAdmin.from('audit_events').insert({
      org_id: orgId,
      actor_user_id: user.id,
      action: 'salesforce_connection.created',
      target_type: 'sf_connection',
      target_id: connection.id,
      payload_hash: 'redacted',
      metadata: { label: body.label, env: body.env, sf_username: body.sf_username }
    } as any);

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

  // List connections
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

    const membershipsResult: any = await supabaseAdmin
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id);

    const memberships = membershipsResult.data || [];
    if (memberships.length === 0) {
      return reply.send({ connections: [] });
    }

    const orgIds = memberships.map((m: any) => m.org_id);
    const connectionsResult: any = await supabaseAdmin
      .from('sf_connections')
      .select('*')
      .in('org_id', orgIds)
      .order('created_at', { ascending: false });

    const connections = connectionsResult.data || [];
    return reply.send({
      connections: connections.map((c: any) => ({
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

  // Delete connection
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
    const connectionResult: any = await supabaseAdmin
      .from('sf_connections')
      .select('org_id')
      .eq('id', id)
      .single();

    const connection = connectionResult.data;
    if (!connection) {
      return reply.status(404).send({ error: 'Connection not found' });
    }

    const membershipResult: any = await supabaseAdmin
      .from('org_members')
      .select('role')
      .eq('org_id', connection.org_id)
      .eq('user_id', user.id)
      .single();

    const membership = membershipResult.data;
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return reply.status(403).send({ error: 'Only owners and admins can delete connections' });
    }

    await deleteSecret(supabaseAdmin, {
      orgId: connection.org_id,
      userId: null,
      kind: 'salesforce_jwt'
    });

    await supabaseAdmin.from('sf_connections').delete().eq('id', id);
    await supabaseAdmin.from('audit_events').insert({
      org_id: connection.org_id,
      actor_user_id: user.id,
      action: 'salesforce_connection.deleted',
      target_type: 'sf_connection',
      target_id: id,
      payload_hash: 'redacted',
      metadata: {}
    } as any);

    return reply.status(204).send();
  });
}
