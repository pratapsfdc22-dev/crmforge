# RLS (Row Level Security) Testing Guide

## Overview

This document explains how to test the RLS policies that enforce multi-tenant isolation in ForgeSF.

**CRITICAL:** RLS is the PRIMARY security boundary preventing organizations from accessing each other's data. If RLS fails, all data is exposed across tenants.

## Running the RLS Tests

### 1. Apply the Migration Fixes

First, apply the security fixes:

```bash
# The SQL is in packages/db/migrations/20260726000001_fix_rls_and_seat_limit.sql
# Copy and run it in Supabase SQL Editor:
# https://supabase.com/dashboard/project/vhbynfsnwjfcfrznsmrx/sql/new
```

Or copy to clipboard:
```bash
cat packages/db/migrations/20260726000001_fix_rls_and_seat_limit.sql | pbcopy
```

### 2. Run the RLS Integration Tests

```bash
cd packages/db
pnpm test
```

This will:
1. Create two test organizations (Org A and Org B)
2. Create two test users (User A owns Org A, User B owns Org B)
3. Authenticate as User A
4. Attempt to read/write Org B's data
5. Assert that all cross-tenant operations are blocked

### 3. Verify the Test Actually Works

**IMPORTANT:** A passing test is meaningless if it doesn't fail when RLS is broken!

To verify the test catches RLS failures:

1. **Disable RLS temporarily** by commenting out these lines in the initial migration:
   ```sql
   -- ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
   -- ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
   -- ALTER TABLE ai_tasks ENABLE ROW LEVEL SECURITY;
   ```

2. Run the tests again:
   ```bash
   pnpm test
   ```

3. **The tests MUST fail** - if they pass, the test is broken

4. Re-enable RLS and confirm tests pass again

## What the Tests Cover

### Organizations Table
- ✅ User A can read their own organization
- ✅ User A CANNOT read Organization B
- ✅ User A only sees their org in list queries
- ✅ User A CANNOT update Organization B

### Org Members Table
- ✅ User A can read their own membership
- ✅ User A CANNOT read Organization B members
- ✅ User A only sees members of their own org

### AI Tasks Table
- ✅ User A can read their own tasks
- ✅ User A CANNOT read Organization B tasks
- ✅ User A only sees tasks from their own org

### Salesforce Connections Table
- ✅ User A can read their own connections
- ✅ User A CANNOT read Organization B connections

### Audit Events Table
- ✅ User A can read their own audit events
- ✅ User A CANNOT read Organization B audit events

### Seat Limit Enforcement
- ✅ Inserting beyond seat_limit raises an exception
- ✅ Seat limit is checked BEFORE insert completes

## Security Fixes Applied

### Fix 1: user_orgs() SECURITY DEFINER

**Problem:** The `user_orgs()` function is called from RLS policies on `org_members`. Without `SECURITY DEFINER`, this creates infinite recursion:
- Policy on `org_members` calls `user_orgs()`
- `user_orgs()` queries `org_members`
- That query triggers the policy again
- Infinite loop → query fails

**Solution:** Mark the function as `SECURITY DEFINER` with `SET search_path = public`:
```sql
CREATE OR REPLACE FUNCTION user_orgs(user_uuid UUID)
RETURNS SETOF UUID
LANGUAGE SQL STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM org_members WHERE user_id = user_uuid;
$$;
```

This allows the function to bypass RLS when querying `org_members`, breaking the recursion.

### Fix 2: Seat Limit Trigger

**Problem:** Without enforcement, organizations can add unlimited members regardless of their `seat_limit`.

**Solution:** Add a `BEFORE INSERT` trigger that:
1. Counts current members in the organization
2. Fetches the organization's `seat_limit`
3. Raises an exception if at capacity

```sql
CREATE OR REPLACE FUNCTION check_seat_limit()
RETURNS TRIGGER AS $$
DECLARE
  current_count INTEGER;
  max_seats INTEGER;
BEGIN
  SELECT COUNT(*) INTO current_count
  FROM org_members WHERE org_id = NEW.org_id;

  SELECT seat_limit INTO max_seats
  FROM organizations WHERE id = NEW.org_id;

  IF current_count >= max_seats THEN
    RAISE EXCEPTION 'Organization has reached its seat limit of %', max_seats
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Fix 3: Comprehensive RLS Tests

See `tests/rls.test.ts` for the full test suite.

## How Signup Bypasses RLS

**Question:** How does a brand-new user become the first member of a brand-new org given the current INSERT policies?

**Answer:** The signup flow in `apps/api/src/routes/auth.ts` uses `supabaseAdmin` (service role key), which **bypasses ALL RLS policies**.

```typescript
// Service role key bypasses RLS
const { data: org } = await supabaseAdmin
  .from('organizations')
  .insert({ name: orgName, slug: orgSlug, tier: 'trial' })
  .select()
  .single();

// Also bypasses RLS
await supabaseAdmin
  .from('org_members')
  .insert({
    org_id: org.id,
    user_id: authData.user.id,
    role: 'owner'
  });
```

This is correct and intentional:
- Service role key is only used server-side
- User never receives the service role key
- After signup, user's JWT respects RLS policies
- Users can only see/modify their own organizations

## Continuous Testing

Add this to your CI/CD pipeline:

```yaml
# .github/workflows/ci.yml
- name: Run RLS Tests
  run: pnpm --filter @forgesf/db test
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

## Troubleshooting

### Test fails with "infinite recursion detected"

The `user_orgs()` function is missing `SECURITY DEFINER`. Apply Fix 1.

### Test fails with "User A CAN read Organization B"

RLS policies are disabled or misconfigured. Check:
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';
```

All tables should have `rowsecurity = true`.

### Seat limit not enforced

The trigger is missing or not firing. Check:
```sql
SELECT tgname, tgenabled 
FROM pg_trigger 
WHERE tgrelid = 'org_members'::regclass;
```

You should see `org_members_seat_limit` with `tgenabled = 'O'` (enabled).

## Additional Resources

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [SECURITY DEFINER Functions](https://www.postgresql.org/docs/current/sql-createfunction.html)
