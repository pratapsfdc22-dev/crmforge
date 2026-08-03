/**
 * TenantContext - Multi-tenant credential container for agent runtime
 * Loads and decrypts credentials on-demand, with cache until expiry
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSecret, type SecretPayload } from './vault-service';

export type Tier = 'trial' | 'starter' | 'professional' | 'enterprise';

export interface SalesforceJWT extends SecretPayload {
  client_id: string;
  client_secret: string;
  username: string;
  private_key: string;
  instance_url?: string;
}

export interface JiraOAuth extends SecretPayload {
  api_token: string;
  email: string;
  jira_url: string;
}

export interface N8nConnection extends SecretPayload {
  api_key: string;
  base_url: string;
}

export interface SalesforceConnection {
  instanceUrl: string;
  accessToken: string;
  expiresAt: number;
}

export interface TenantContext {
  readonly orgId: string;
  readonly userId: string;
  readonly tier: Tier;
  readonly sfConnection: SalesforceConnection;
  readonly jiraToken: JiraOAuth | null;
  readonly n8nConnection: N8nConnection | null;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/**
 * Acquire Salesforce JWT bearer token with in-memory cache
 * Token is cached until expiry - 30 second buffer
 */
async function getSalesforceToken(
  jwt: SalesforceJWT,
  orgId: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const cacheKey = `${orgId}:sf-token`;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 30000) {
    return { accessToken: cached.accessToken, expiresAt: cached.expiresAt };
  }

  const instanceUrl = jwt.instance_url || 'https://login.salesforce.com';

  const response = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: createJWT(jwt),
      client_id: jwt.client_id
    }).toString()
  });

  if (!response.ok) {
    throw new Error(`Salesforce token request failed: ${response.statusText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + data.expires_in * 1000;

  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt
  });

  return { accessToken: data.access_token, expiresAt };
}

/**
 * Create JWT assertion for Salesforce OAuth
 * Used internally for bearer token flow
 */
function createJWT(jwt: SalesforceJWT): string {
  const crypto = require('crypto');
  const algorithm = 'RS256';

  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: jwt.client_id,
      sub: jwt.username,
      aud: jwt.instance_url || 'https://login.salesforce.com',
      exp: now + 300
    })
  ).toString('base64url');

  const signature = crypto
    .createSign('SHA256')
    .update(`${header}.${payload}`)
    .sign(jwt.private_key, 'base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Factory function to load and decrypt credentials for a tenant
 * Returns a TenantContext with all decrypted secrets
 */
export async function loadTenantContext(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  tier: Tier,
  masterKey: string
): Promise<TenantContext> {
  const [sfJWT, jiraToken, n8nConn] = await Promise.all([
    loadSecret<SalesforceJWT>(supabaseClient, {
      orgId,
      userId: null,
      kind: 'salesforce_jwt',
      masterKey
    }),
    loadSecret<JiraOAuth>(supabaseClient, {
      orgId,
      userId,
      kind: 'jira_oauth',
      masterKey
    }).catch(() => null),
    loadSecret<N8nConnection>(supabaseClient, {
      orgId,
      userId: null,
      kind: 'n8n_api_key',
      masterKey
    }).catch(() => null)
  ]);

  if (!sfJWT) {
    throw new Error(`Missing Salesforce JWT for org ${orgId}`);
  }

  const { accessToken, expiresAt } = await getSalesforceToken(sfJWT, orgId);

  return {
    orgId,
    userId,
    tier,
    sfConnection: {
      instanceUrl: sfJWT.instance_url || 'https://login.salesforce.com',
      accessToken,
      expiresAt
    },
    jiraToken: jiraToken || null,
    n8nConnection: n8nConn || null
  };
}

/**
 * Clear token cache for testing/cleanup
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}
