-- Connections Layer Migration
-- Supports Salesforce (org-level, JWT Bearer), Jira (user-level, OAuth 3LO), n8n (org-level)

-- ============================================================================
-- TABLE: connection_secrets
-- ============================================================================
-- Stores encrypted secrets for all connection types
-- RLS: NO authenticated role can select enc_payload; only service role

CREATE TABLE connection_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for org-level secrets
  kind TEXT NOT NULL, -- 'salesforce_jwt', 'jira_oauth', 'n8n_api_key'
  enc_payload BYTEA NOT NULL, -- AES-256-GCM encrypted payload
  key_version INTEGER NOT NULL DEFAULT 1, -- For key rotation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT connection_secrets_kind_check
    CHECK (kind IN ('salesforce_jwt', 'jira_oauth', 'n8n_api_key'))
);

CREATE INDEX idx_connection_secrets_org ON connection_secrets(org_id);
CREATE INDEX idx_connection_secrets_user ON connection_secrets(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_connection_secrets_kind ON connection_secrets(org_id, kind);

-- RLS: Prevent ANY authenticated user from reading enc_payload
ALTER TABLE connection_secrets ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (bypasses RLS anyway, but explicit policy documents intent)
CREATE POLICY connection_secrets_service_role ON connection_secrets
  FOR ALL
  USING (is_service_role());

-- Authenticated users can NEVER select enc_payload directly
-- They can only see metadata through explicit views if needed
CREATE POLICY connection_secrets_no_user_access ON connection_secrets
  FOR SELECT
  USING (false); -- Explicitly block all user access

-- ============================================================================
-- TABLE: sf_connections (Salesforce connections - org-level)
-- ============================================================================

CREATE TABLE sf_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- User-facing metadata
  label TEXT NOT NULL, -- e.g., "Production Org", "Sandbox"
  env TEXT NOT NULL CHECK (env IN ('sandbox', 'production')),

  -- Salesforce metadata
  instance_url TEXT NOT NULL, -- e.g., https://login.salesforce.com or https://test.salesforce.com
  consumer_key TEXT NOT NULL, -- Connected App consumer key
  sf_username TEXT NOT NULL, -- Salesforce username for JWT Bearer flow

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  failure_reason TEXT, -- Error message if status = 'failed'

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id),

  CONSTRAINT sf_connections_label_unique UNIQUE (org_id, label)
);

CREATE INDEX idx_sf_connections_org ON sf_connections(org_id);
CREATE INDEX idx_sf_connections_status ON sf_connections(org_id, status);

-- RLS: Org members can read, admins/owners can write
ALTER TABLE sf_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY sf_connections_select ON sf_connections
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY sf_connections_insert ON sf_connections
  FOR INSERT
  WITH CHECK (
    is_service_role()
    OR (
      org_id IN (
        SELECT om.org_id FROM org_members om
        WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
      )
      AND created_by = auth.uid()
    )
  );

CREATE POLICY sf_connections_update ON sf_connections
  FOR UPDATE
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY sf_connections_delete ON sf_connections
  FOR DELETE
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- TABLE: jira_connections (Jira connections - USER-level)
-- ============================================================================

CREATE TABLE jira_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- Per-user connection

  -- Atlassian metadata
  cloud_id TEXT NOT NULL, -- Atlassian cloud ID from accessible-resources
  site_url TEXT NOT NULL, -- e.g., https://yoursite.atlassian.net
  jira_account_id TEXT NOT NULL, -- Jira account ID from userinfo

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  failure_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One Jira connection per user per org
  CONSTRAINT jira_connections_user_org_unique UNIQUE (org_id, user_id)
);

CREATE INDEX idx_jira_connections_org ON jira_connections(org_id);
CREATE INDEX idx_jira_connections_user ON jira_connections(user_id);
CREATE INDEX idx_jira_connections_org_user ON jira_connections(org_id, user_id);

-- RLS: Users can only read/write their own Jira connections
ALTER TABLE jira_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY jira_connections_select ON jira_connections
  FOR SELECT
  USING (
    org_id IN (SELECT user_orgs(auth.uid()))
  );

CREATE POLICY jira_connections_insert ON jira_connections
  FOR INSERT
  WITH CHECK (
    is_service_role()
    OR (
      org_id IN (SELECT user_orgs(auth.uid()))
      AND user_id = auth.uid()
    )
  );

CREATE POLICY jira_connections_update ON jira_connections
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND org_id IN (SELECT user_orgs(auth.uid()))
  );

CREATE POLICY jira_connections_delete ON jira_connections
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND org_id IN (SELECT user_orgs(auth.uid()))
  );

-- ============================================================================
-- TABLE: n8n_connections (n8n connections - org-level)
-- ============================================================================

CREATE TABLE n8n_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- n8n configuration
  mode TEXT NOT NULL CHECK (mode IN ('byo', 'hosted')), -- 'byo' = bring your own, 'hosted' = ForgeSF-hosted
  base_url TEXT NOT NULL, -- e.g., https://n8n.yourcompany.com

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  failure_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id),

  -- One n8n connection per org
  CONSTRAINT n8n_connections_org_unique UNIQUE (org_id)
);

CREATE INDEX idx_n8n_connections_org ON n8n_connections(org_id);

-- RLS: Org members can read, admins/owners can write
ALTER TABLE n8n_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY n8n_connections_select ON n8n_connections
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY n8n_connections_insert ON n8n_connections
  FOR INSERT
  WITH CHECK (
    is_service_role()
    OR (
      org_id IN (
        SELECT om.org_id FROM org_members om
        WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
      )
      AND created_by = auth.uid()
    )
  );

CREATE POLICY n8n_connections_update ON n8n_connections
  FOR UPDATE
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY n8n_connections_delete ON n8n_connections
  FOR DELETE
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- TRIGGER: Update updated_at timestamps
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sf_connections_updated_at
  BEFORE UPDATE ON sf_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER jira_connections_updated_at
  BEFORE UPDATE ON jira_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER n8n_connections_updated_at
  BEFORE UPDATE ON n8n_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER connection_secrets_updated_at
  BEFORE UPDATE ON connection_secrets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
