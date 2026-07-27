-- Connections Layer Migration (Safe version with IF NOT EXISTS)
-- Supports Salesforce (org-level, JWT Bearer), Jira (user-level, OAuth 3LO), n8n (org-level)

-- ============================================================================
-- TABLE: connection_secrets
-- ============================================================================

CREATE TABLE IF NOT EXISTS connection_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('salesforce_jwt', 'jira_oauth', 'n8n_api_key')),
  enc_payload BYTEA NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connection_secrets_org ON connection_secrets(org_id);
CREATE INDEX IF NOT EXISTS idx_connection_secrets_user ON connection_secrets(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_connection_secrets_kind ON connection_secrets(org_id, kind);

ALTER TABLE connection_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connection_secrets_service_role ON connection_secrets;
CREATE POLICY connection_secrets_service_role ON connection_secrets
  FOR ALL
  USING (is_service_role());

DROP POLICY IF EXISTS connection_secrets_no_user_access ON connection_secrets;
CREATE POLICY connection_secrets_no_user_access ON connection_secrets
  FOR SELECT
  USING (false);

-- ============================================================================
-- TABLE: sf_connections
-- ============================================================================

CREATE TABLE IF NOT EXISTS sf_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  env TEXT NOT NULL CHECK (env IN ('sandbox', 'production')),
  instance_url TEXT NOT NULL,
  consumer_key TEXT NOT NULL,
  sf_username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  CONSTRAINT sf_connections_label_unique UNIQUE (org_id, label)
);

CREATE INDEX IF NOT EXISTS idx_sf_connections_org ON sf_connections(org_id);
CREATE INDEX IF NOT EXISTS idx_sf_connections_status ON sf_connections(org_id, status);

ALTER TABLE sf_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sf_connections_select ON sf_connections;
CREATE POLICY sf_connections_select ON sf_connections
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

DROP POLICY IF EXISTS sf_connections_insert ON sf_connections;
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

DROP POLICY IF EXISTS sf_connections_update ON sf_connections;
CREATE POLICY sf_connections_update ON sf_connections
  FOR UPDATE
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS sf_connections_delete ON sf_connections;
CREATE POLICY sf_connections_delete ON sf_connections
  FOR DELETE
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- TABLE: jira_connections
-- ============================================================================

CREATE TABLE IF NOT EXISTS jira_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cloud_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  jira_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT jira_connections_user_org_unique UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_jira_connections_org ON jira_connections(org_id);
CREATE INDEX IF NOT EXISTS idx_jira_connections_user ON jira_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_jira_connections_org_user ON jira_connections(org_id, user_id);

ALTER TABLE jira_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jira_connections_select ON jira_connections;
CREATE POLICY jira_connections_select ON jira_connections
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

DROP POLICY IF EXISTS jira_connections_insert ON jira_connections;
CREATE POLICY jira_connections_insert ON jira_connections
  FOR INSERT
  WITH CHECK (
    is_service_role()
    OR (
      org_id IN (SELECT user_orgs(auth.uid()))
      AND user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS jira_connections_update ON jira_connections;
CREATE POLICY jira_connections_update ON jira_connections
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND org_id IN (SELECT user_orgs(auth.uid()))
  );

DROP POLICY IF EXISTS jira_connections_delete ON jira_connections;
CREATE POLICY jira_connections_delete ON jira_connections
  FOR DELETE
  USING (
    user_id = auth.uid()
    AND org_id IN (SELECT user_orgs(auth.uid()))
  );

-- ============================================================================
-- TABLE: n8n_connections
-- ============================================================================

CREATE TABLE IF NOT EXISTS n8n_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('byo', 'hosted')),
  base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'revoked')),
  last_verified_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  CONSTRAINT n8n_connections_org_unique UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS idx_n8n_connections_org ON n8n_connections(org_id);

ALTER TABLE n8n_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS n8n_connections_select ON n8n_connections;
CREATE POLICY n8n_connections_select ON n8n_connections
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

DROP POLICY IF EXISTS n8n_connections_insert ON n8n_connections;
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

DROP POLICY IF EXISTS n8n_connections_update ON n8n_connections;
CREATE POLICY n8n_connections_update ON n8n_connections
  FOR UPDATE
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS n8n_connections_delete ON n8n_connections;
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

DROP TRIGGER IF EXISTS sf_connections_updated_at ON sf_connections;
CREATE TRIGGER sf_connections_updated_at
  BEFORE UPDATE ON sf_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS jira_connections_updated_at ON jira_connections;
CREATE TRIGGER jira_connections_updated_at
  BEFORE UPDATE ON jira_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS n8n_connections_updated_at ON n8n_connections;
CREATE TRIGGER n8n_connections_updated_at
  BEFORE UPDATE ON n8n_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS connection_secrets_updated_at ON connection_secrets;
CREATE TRIGGER connection_secrets_updated_at
  BEFORE UPDATE ON connection_secrets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
