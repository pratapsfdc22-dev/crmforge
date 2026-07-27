-- ForgeSF Phase 1: Initial Schema
-- Multi-tenant SaaS with Salesforce AI Agent integration

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ORGANIZATIONS & TENANCY
-- ============================================================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'trial' CHECK (tier IN ('trial', 'starter', 'professional', 'enterprise')),

  -- Stripe billing
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,

  -- Limits
  seat_limit INTEGER NOT NULL DEFAULT 5,
  task_quota INTEGER NOT NULL DEFAULT 100, -- monthly AI task quota

  -- Trial management
  trial_ends_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_stripe_customer ON organizations(stripe_customer_id);

-- ============================================================================
-- ORGANIZATION MEMBERS
-- ============================================================================

CREATE TABLE org_members (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer')),

  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org ON org_members(org_id);

-- ============================================================================
-- INVITATIONS
-- ============================================================================

CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'developer', 'viewer')),

  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),

  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,

  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_org ON invitations(org_id);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_token ON invitations(token) WHERE accepted_at IS NULL;

-- ============================================================================
-- SALESFORCE CONNECTIONS
-- ============================================================================

CREATE TABLE salesforce_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Connection identity
  name TEXT NOT NULL, -- user-friendly name like "Production Org" or "Dev Sandbox"
  instance_url TEXT NOT NULL, -- https://mycompany.my.salesforce.com

  -- OAuth tokens (encrypted at app layer with MASTER_ENC_KEY)
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,

  -- Salesforce org metadata
  salesforce_org_id TEXT NOT NULL, -- 00D... org ID
  salesforce_username TEXT,

  -- Connection health
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(org_id, salesforce_org_id)
);

CREATE INDEX idx_sf_connections_org ON salesforce_connections(org_id);
CREATE INDEX idx_sf_connections_active ON salesforce_connections(org_id, is_active);

-- ============================================================================
-- AI TASKS
-- ============================================================================

CREATE TABLE ai_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Task identity
  title TEXT NOT NULL,
  description TEXT,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),

  -- Connection context
  salesforce_connection_id UUID REFERENCES salesforce_connections(id) ON DELETE SET NULL,

  -- Agent execution
  agent_run_id TEXT, -- Langfuse trace ID
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_cost_usd DECIMAL(10, 6) DEFAULT 0,

  -- Results
  result_summary TEXT,
  error_message TEXT,

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_tasks_org ON ai_tasks(org_id);
CREATE INDEX idx_ai_tasks_status ON ai_tasks(org_id, status);
CREATE INDEX idx_ai_tasks_created_by ON ai_tasks(created_by);
CREATE INDEX idx_ai_tasks_created_at ON ai_tasks(org_id, created_at DESC);

-- ============================================================================
-- TASK ARTIFACTS (code, logs, screenshots)
-- ============================================================================

CREATE TABLE task_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,

  type TEXT NOT NULL CHECK (type IN ('code', 'log', 'screenshot', 'file', 'other')),
  name TEXT NOT NULL,

  -- Storage
  content_url TEXT, -- S3/Supabase Storage URL
  content_text TEXT, -- For small text artifacts
  mime_type TEXT,
  size_bytes INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_artifacts_task ON task_artifacts(task_id);

-- ============================================================================
-- USAGE TRACKING
-- ============================================================================

CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Billing period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Metrics
  tasks_executed INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd DECIMAL(10, 2) NOT NULL DEFAULT 0,

  -- Stripe billing
  stripe_invoice_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(org_id, period_start)
);

CREATE INDEX idx_usage_records_org_period ON usage_records(org_id, period_start DESC);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Event details
  action TEXT NOT NULL, -- 'task.created', 'connection.added', 'member.invited', etc.
  target_type TEXT, -- 'task', 'connection', 'member'
  target_id UUID,

  -- Security: hash of payload for tamper detection
  payload_hash TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_org_created ON audit_events(org_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_events(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_events(action);

-- Prevent updates/deletes on audit log (append-only)
CREATE RULE audit_no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesforce_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Helper function: get user's orgs
-- SECURITY DEFINER prevents infinite recursion when called from RLS policies on org_members
-- SET search_path ensures the function uses the public schema for security
CREATE OR REPLACE FUNCTION user_orgs(user_uuid UUID)
RETURNS SETOF UUID
LANGUAGE SQL STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM org_members WHERE user_id = user_uuid;
$$;

-- Organizations: users can see orgs they're members of
CREATE POLICY org_member_select ON organizations
  FOR SELECT
  USING (id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY org_owner_update ON organizations
  FOR UPDATE
  USING (id IN (
    SELECT org_id FROM org_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Org members: see members of own orgs
CREATE POLICY org_members_select ON org_members
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY org_admin_manage_members ON org_members
  FOR ALL
  USING (org_id IN (
    SELECT org_id FROM org_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Invitations: see invitations for own orgs
CREATE POLICY invitations_select ON invitations
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY invitations_insert ON invitations
  FOR INSERT
  WITH CHECK (org_id IN (
    SELECT org_id FROM org_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Salesforce connections: see connections in own orgs
CREATE POLICY sf_connections_select ON salesforce_connections
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY sf_connections_all ON salesforce_connections
  FOR ALL
  USING (org_id IN (SELECT user_orgs(auth.uid())));

-- AI tasks: see tasks in own orgs
CREATE POLICY ai_tasks_select ON ai_tasks
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY ai_tasks_insert ON ai_tasks
  FOR INSERT
  WITH CHECK (
    org_id IN (SELECT user_orgs(auth.uid()))
    AND created_by = auth.uid()
  );

CREATE POLICY ai_tasks_update ON ai_tasks
  FOR UPDATE
  USING (org_id IN (SELECT user_orgs(auth.uid())));

-- Task artifacts: see artifacts for tasks in own orgs
CREATE POLICY task_artifacts_select ON task_artifacts
  FOR SELECT
  USING (task_id IN (
    SELECT id FROM ai_tasks WHERE org_id IN (SELECT user_orgs(auth.uid()))
  ));

CREATE POLICY task_artifacts_insert ON task_artifacts
  FOR INSERT
  WITH CHECK (task_id IN (
    SELECT id FROM ai_tasks WHERE org_id IN (SELECT user_orgs(auth.uid()))
  ));

-- Usage records: see usage for own orgs
CREATE POLICY usage_records_select ON usage_records
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

-- Audit events: see audit log for own orgs
CREATE POLICY audit_events_select ON audit_events
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY audit_events_insert ON audit_events
  FOR INSERT
  WITH CHECK (org_id IN (SELECT user_orgs(auth.uid())));

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Enforce seat limit on org_members insert
CREATE OR REPLACE FUNCTION check_seat_limit()
RETURNS TRIGGER AS $$
DECLARE
  current_count INTEGER;
  max_seats INTEGER;
BEGIN
  -- Get current member count and seat limit
  SELECT COUNT(*) INTO current_count
  FROM org_members
  WHERE org_id = NEW.org_id;

  SELECT seat_limit INTO max_seats
  FROM organizations
  WHERE id = NEW.org_id;

  -- Raise exception if at capacity
  IF current_count >= max_seats THEN
    RAISE EXCEPTION 'Organization has reached its seat limit of %', max_seats
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_members_seat_limit
  BEFORE INSERT ON org_members
  FOR EACH ROW
  EXECUTE FUNCTION check_seat_limit();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER org_members_updated_at BEFORE UPDATE ON org_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sf_connections_updated_at BEFORE UPDATE ON salesforce_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER ai_tasks_updated_at BEFORE UPDATE ON ai_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER usage_records_updated_at BEFORE UPDATE ON usage_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- SEED DATA (Development only - remove for production)
-- ============================================================================

-- Note: In production, organizations are created via signup flow
-- This is just for local dev testing
