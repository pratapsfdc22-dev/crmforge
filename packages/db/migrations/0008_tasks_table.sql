-- Task execution state tracking for orchestration

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  -- queued | planning | awaiting_approval | executing | verifying | succeeded | failed

  plan JSONB,
  steps JSONB DEFAULT '[]'::jsonb,

  error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  CONSTRAINT valid_state CHECK (state IN ('queued', 'planning', 'awaiting_approval', 'executing', 'verifying', 'succeeded', 'failed'))
);

CREATE INDEX idx_tasks_org_id ON tasks(org_id);
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_state ON tasks(state);
CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);

-- Enable RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- RLS: Users can only see tasks from their org
CREATE POLICY tasks_org_isolation ON tasks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = tasks.org_id
      AND org_members.user_id = auth.jwt() ->> 'sub'
    )
  );

-- RLS: Service role can write (needed for worker and API)
CREATE POLICY tasks_write_admin ON tasks
  FOR ALL
  USING (current_setting('role') = 'authenticated' OR auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (current_setting('role') = 'authenticated' OR auth.jwt() ->> 'role' = 'service_role');
