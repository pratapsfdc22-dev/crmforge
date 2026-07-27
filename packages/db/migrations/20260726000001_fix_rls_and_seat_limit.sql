-- Phase 1: Security Fixes
-- Fix 1: Add SECURITY DEFINER to user_orgs() to prevent RLS recursion
-- Fix 2: Add seat limit enforcement trigger
-- Fix 3: Test RLS isolation (see tests/rls.test.ts)

-- ============================================================================
-- FIX 1: user_orgs() SECURITY DEFINER
-- ============================================================================

-- Drop and recreate with SECURITY DEFINER
DROP FUNCTION IF EXISTS user_orgs(UUID);

CREATE OR REPLACE FUNCTION user_orgs(user_uuid UUID)
RETURNS SETOF UUID
LANGUAGE SQL STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM org_members WHERE user_id = user_uuid;
$$;

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
