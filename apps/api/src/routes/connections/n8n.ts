/**
 * n8n Connection Routes
 * Org-level n8n workflow automation connections
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseAdmin, verifyToken } from '../../lib/supabase.js';
import { storeSecret, deleteSecret, loadSecret } from '@forgesf/agent-core';
import { env } from '../../config/env.js';

const CreateN8nConnectionSchema = z.object({
  mode: z.enum(['byo', 'hosted']),
  base_url: z.string().url(),
  api_key: z.string().min(1)
});

/**
 * Verify n8n connection by calling GET /api/v1/workflows
 */
async function verifyN8nConnection(
  baseUrl: string,
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/v1/workflows`;

    const response = await fetch(url, {
      headers: {
        'X-N8N-API-KEY': apiKey,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return {
        success: false,
        error: `n8n API returned ${response.status}: ${response.statusText}`
      };
    }

    // Basic validation that we got JSON back
    const data: any = await response.json();
    if (!data || !data.data) {
      return {
        success: false,
        error: 'Invalid response format from n8n API'
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during verification'
    };
  }
}

export async function n8nConnectionRoutes(fastify: FastifyInstance) {
  // Create n8n connection
  fastify.post('/connections/n8n', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const user = await verifyToken(token);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    const body = CreateN8nConnectionSchema.parse(request.body);

    // Hosted mode not yet implemented
    if (body.mode === 'hosted') {
      return reply.status(501).send({
        error: 'NotImplemented',
        message: 'Hosted n8n mode is not yet available. Please use BYO (Bring Your Own) mode.'
      });
    }

    // Get user's org and verify they're an admin or owner
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
      return reply.status(403).send({ error: 'Only owners and admins can manage n8n connections' });
    }

    const orgId = membership.org_id;

    // Check if connection already exists
    const existingResult: any = await supabaseAdmin
      .from('n8n_connections')
      .select('id')
      .eq('org_id', orgId)
      .maybeSingle();

    if (existingResult.data) {
      return reply.status(400).send({
        error: 'ConnectionExists',
        message: 'An n8n connection already exists for this organization'
      });
    }

    // Verify n8n connection
    const verification = await verifyN8nConnection(body.base_url, body.api_key);

    if (!verification.success) {
      return reply.status(400).send({
        error: 'VerificationFailed',
        message: verification.error
      });
    }

    // Store API key in vault
    try {
      await storeSecret(supabaseAdmin, {
        orgId,
        userId: null,
        kind: 'n8n_api_key',
        payload: {
          api_key: body.api_key
        },
        masterKey: env.MASTER_ENC_KEY
      });
    } catch (error) {
      return reply.status(500).send({
        error: 'VaultError',
        message: 'Failed to store n8n API key'
      });
    }

    // Create connection record
    const connectionResult: any = await supabaseAdmin
      .from('n8n_connections')
      .insert({
        org_id: orgId,
        mode: body.mode,
        base_url: body.base_url,
        status: 'verified' as const,
        last_verified_at: new Date().toISOString(),
        created_by: user.id
      })
      .select()
      .single();

    const connection = connectionResult.data;
    if (!connection) {
      return reply.status(500).send({
        error: 'DatabaseError',
        message: 'Failed to create n8n connection'
      });
    }

    // Audit log
    await supabaseAdmin.from('audit_events').insert({
      org_id: orgId,
      actor_user_id: user.id,
      action: 'n8n_connection.created',
      target_type: 'n8n_connection',
      target_id: connection.id,
      payload_hash: 'redacted',
      metadata: {
        mode: body.mode,
        base_url: body.base_url
      }
    } as any);

    return reply.status(201).send({
      connection: {
        id: connection.id,
        mode: connection.mode,
        base_url: connection.base_url,
        status: connection.status,
        last_verified_at: connection.last_verified_at,
        created_at: connection.created_at
      }
    });
  });

  // List n8n connections
  fastify.get('/connections/n8n', async (request, reply) => {
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

    // Get connections
    const connectionsResult: any = await supabaseAdmin
      .from('n8n_connections')
      .select('*')
      .in('org_id', orgIds)
      .order('created_at', { ascending: false });

    const connections = connectionsResult.data || [];

    // Never return API keys
    return reply.send({
      connections: connections.map((c: any) => ({
        id: c.id,
        mode: c.mode,
        base_url: c.base_url,
        status: c.status,
        last_verified_at: c.last_verified_at,
        failure_reason: c.failure_reason,
        created_at: c.created_at,
        updated_at: c.updated_at
      }))
    });
  });

  // Delete n8n connection
  fastify.delete('/connections/n8n/:id', async (request, reply) => {
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
      .from('n8n_connections')
      .select('org_id')
      .eq('id', id)
      .single();

    const connection = connectionResult.data;
    if (!connection) {
      return reply.status(404).send({ error: 'Connection not found' });
    }

    // Verify user is admin/owner
    const membershipResult: any = await supabaseAdmin
      .from('org_members')
      .select('role')
      .eq('org_id', connection.org_id)
      .eq('user_id', user.id)
      .single();

    const membership = membershipResult.data;
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return reply.status(403).send({ error: 'Only owners and admins can delete n8n connections' });
    }

    // Delete secret from vault
    await deleteSecret(supabaseAdmin, {
      orgId: connection.org_id,
      userId: null,
      kind: 'n8n_api_key'
    });

    // Delete connection
    await supabaseAdmin
      .from('n8n_connections')
      .delete()
      .eq('id', id);

    // Audit log
    await supabaseAdmin.from('audit_events').insert({
      org_id: connection.org_id,
      actor_user_id: user.id,
      action: 'n8n_connection.deleted',
      target_type: 'n8n_connection',
      target_id: id,
      payload_hash: 'redacted',
      metadata: {}
    } as any);

    return reply.status(204).send();
  });

  // Re-verify n8n connection
  fastify.post('/connections/n8n/:id/verify', async (request, reply) => {
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
      .from('n8n_connections')
      .select('*')
      .eq('id', id)
      .single();

    const connection = connectionResult.data;
    if (!connection) {
      return reply.status(404).send({ error: 'Connection not found' });
    }

    // Verify user has access
    const membershipResult: any = await supabaseAdmin
      .from('org_members')
      .select('role')
      .eq('org_id', connection.org_id)
      .eq('user_id', user.id)
      .single();

    const membership = membershipResult.data;
    if (!membership) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    // Load API key from vault
    const secret = await loadSecret<{ api_key: string }>(supabaseAdmin, {
      orgId: connection.org_id,
      userId: null,
      kind: 'n8n_api_key',
      masterKey: env.MASTER_ENC_KEY
    });

    if (!secret) {
      return reply.status(500).send({ error: 'API key not found in vault' });
    }

    // Re-verify connection
    const verification = await verifyN8nConnection(connection.base_url, secret.api_key);

    // Update connection status
    await supabaseAdmin
      .from('n8n_connections')
      .update({
        status: verification.success ? 'verified' : 'failed',
        last_verified_at: new Date().toISOString(),
        failure_reason: verification.success ? null : verification.error
      })
      .eq('id', id);

    // Audit log
    await supabaseAdmin.from('audit_events').insert({
      org_id: connection.org_id,
      actor_user_id: user.id,
      action: 'n8n_connection.verified',
      target_type: 'n8n_connection',
      target_id: id,
      payload_hash: 'redacted',
      metadata: {
        success: verification.success,
        error: verification.error
      }
    } as any);

    return reply.send({
      success: verification.success,
      status: verification.success ? 'verified' : 'failed',
      error: verification.error
    });
  });
}
