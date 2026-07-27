-- Phase 1: Security Fixes (v2 - Force recreation of user_orgs)
-- Fix 1: Add SECURITY DEFINER to user_orgs() to prevent RLS recursion
-- Fix 2: Add seat limit enforcement trigger
-- Fix 3: Test RLS isolation (see tests/rls.test.ts)

-- ============================================================================
-- FIX 1: user_orgs() SECURITY DEFINER - FORCED RECREATION
-- ============================================================================

-- Step 1: Temporarily disable RLS policies that depend on user_orgs
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE org_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE invitations DISABLE ROW LEVEL SECURITY;
ALTER TABLE salesforce_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE task_artifacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop the function (now safe since RLS is disabled)
DROP FUNCTION IF EXISTS user_orgs(UUID) CASCADE;

-- Step 3: Recreate with SECURITY DEFINER
CREATE OR REPLACE FUNCTION user_orgs(user_uuid UUID)
RETURNS SETOF UUID
LANGUAGE SQL STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM org_members WHERE user_id = user_uuid;
$$;

-- Step 4: Re-enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesforce_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Step 5: Recreate all RLS policies that depend on user_orgs
-- (CASCADE dropped them, so we must recreate)

-- Organizations policies
CREATE POLICY org_member_select ON organizations
  FOR SELECT
  USING (id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY org_owner_update ON organizations
  FOR UPDATE
  USING (id IN (
    SELECT org_id FROM org_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Org members policies
CREATE POLICY org_members_select ON org_members
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY org_admin_manage_members ON org_members
  FOR ALL
  USING (org_id IN (
    SELECT org_id FROM org_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Invitations policies
CREATE POLICY invitations_select ON invitations
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY invitations_insert ON invitations
  FOR INSERT
  WITH CHECK (org_id IN (
    SELECT org_id FROM org_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- Salesforce connections policies
CREATE POLICY sf_connections_select ON salesforce_connections
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY sf_connections_all ON salesforce_connections
  FOR ALL
  USING (org_id IN (SELECT user_orgs(auth.uid())));

-- AI tasks policies
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

-- Task artifacts policies
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

-- Usage records policies
CREATE POLICY usage_records_select ON usage_records
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

-- Audit events policies
CREATE POLICY audit_events_select ON audit_events
  FOR SELECT
  USING (org_id IN (SELECT user_orgs(auth.uid())));

CREATE POLICY audit_events_insert ON audit_events
  FOR INSERT
  WITH CHECK (org_id IN (SELECT user_orgs(auth.uid())));

-- ============================================================================
-- FIX 2: Seat Limit Enforcement
-- ============================================================================

-- Function to check seat limit before inserting org member
CREATE OR REPLACE FUNCTION check_seat_limit()
RETURNS TRIGGER AS $$
DECLARE
  current_count INTEGER;
  max_seats INTEGER;
BEGIN
  -- Get current member count
  SELECT COUNT(*) INTO current_count
  FROM org_members
  WHERE org_id = NEW.org_id;

  -- Get seat limit for the organization
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

-- Trigger to enforce seat limit on insert
DROP TRIGGER IF EXISTS org_members_seat_limit ON org_members;

CREATE TRIGGER org_members_seat_limit
  BEFORE INSERT ON org_members
  FOR EACH ROW
  EXECUTE FUNCTION check_seat_limit();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify user_orgs has SECURITY DEFINER enabled
DO $$
DECLARE
  is_secure BOOLEAN;
BEGIN
  SELECT prosecdef INTO is_secure
  FROM pg_proc
  WHERE proname = 'user_orgs';

  IF NOT is_secure THEN
    RAISE EXCEPTION 'SECURITY DEFINER not set on user_orgs function!';
  END IF;

  RAISE NOTICE '✓ user_orgs() has SECURITY DEFINER enabled';
END $$;
