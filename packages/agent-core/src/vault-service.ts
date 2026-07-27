/**
 * Vault Service - Database-integrated secret storage
 * This module provides high-level functions to store/load secrets
 * with database persistence via Supabase
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareSecret, unwrapSecret } from './vault';

export interface SecretPayload {
  [key: string]: unknown;
}

export interface StoreSecretParams {
  orgId: string;
  userId: string | null;
  kind: 'salesforce_jwt' | 'jira_oauth' | 'n8n_api_key';
  payload: SecretPayload;
  masterKey: string;
  keyVersion?: number;
}

export interface LoadSecretParams {
  orgId: string;
  userId: string | null;
  kind: 'salesforce_jwt' | 'jira_oauth' | 'n8n_api_key';
  masterKey: string;
}

/**
 * Store a secret in the vault (database + encryption)
 * Returns the created secret ID
 */
export async function storeSecret(
  client: SupabaseClient,
  params: StoreSecretParams
): Promise<string> {
  const { orgId, userId, kind, payload, masterKey, keyVersion = 1 } = params;

  // Encrypt the payload
  const { encPayload } = prepareSecret(payload, masterKey, keyVersion);

  // Store in database (service role client bypasses RLS)
  const { data, error } = await client
    .from('connection_secrets')
    .insert({
      org_id: orgId,
      user_id: userId,
      kind,
      enc_payload: encPayload,
      key_version: keyVersion
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to store secret: ${error.message}`);
  }

  if (!data) {
    throw new Error('Failed to store secret: no data returned');
  }

  return data.id;
}

/**
 * Load and decrypt a secret from the vault
 * Returns null if not found
 */
export async function loadSecret<T extends SecretPayload = SecretPayload>(
  client: SupabaseClient,
  params: LoadSecretParams
): Promise<T | null> {
  const { orgId, userId, kind, masterKey } = params;

  // Query for the secret (service role client bypasses RLS)
  const query = client
    .from('connection_secrets')
    .select('enc_payload, key_version')
    .eq('org_id', orgId)
    .eq('kind', kind);

  // Add user_id filter if provided
  if (userId !== null) {
    query.eq('user_id', userId);
  } else {
    query.is('user_id', null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Failed to load secret: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  // Decrypt the payload
  const decrypted = unwrapSecret<T>(
    Buffer.from(data.enc_payload),
    masterKey,
    data.key_version
  );

  return decrypted;
}

/**
 * Update an existing secret
 */
export async function updateSecret(
  client: SupabaseClient,
  params: StoreSecretParams
): Promise<void> {
  const { orgId, userId, kind, payload, masterKey, keyVersion = 1 } = params;

  // Encrypt the new payload
  const { encPayload } = prepareSecret(payload, masterKey, keyVersion);

  // Update in database
  const query = client
    .from('connection_secrets')
    .update({
      enc_payload: encPayload,
      key_version: keyVersion,
      updated_at: new Date().toISOString()
    })
    .eq('org_id', orgId)
    .eq('kind', kind);

  // Add user_id filter if provided
  if (userId !== null) {
    query.eq('user_id', userId);
  } else {
    query.is('user_id', null);
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to update secret: ${error.message}`);
  }
}

/**
 * Delete a secret from the vault
 */
export async function deleteSecret(
  client: SupabaseClient,
  params: Omit<LoadSecretParams, 'masterKey'>
): Promise<void> {
  const { orgId, userId, kind } = params;

  const query = client
    .from('connection_secrets')
    .delete()
    .eq('org_id', orgId)
    .eq('kind', kind);

  // Add user_id filter if provided
  if (userId !== null) {
    query.eq('user_id', userId);
  } else {
    query.is('user_id', null);
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete secret: ${error.message}`);
  }
}
