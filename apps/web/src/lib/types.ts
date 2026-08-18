export type TaskState = 'queued' | 'planning' | 'awaiting_approval' | 'executing' | 'verifying' | 'succeeded' | 'failed';

export interface TaskStep {
  step_index: number;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export interface TaskPlan {
  summary: string;
  steps: Array<{
    title: string;
    description: string;
  }>;
  rationale: string;
}

export interface Task {
  id: string;
  org_id: string;
  user_id: string;
  intent: string;
  state: TaskState;
  plan?: TaskPlan;
  steps: TaskStep[];
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface SalesforceConnection {
  id: string;
  org_id: string;
  label: string;
  env: 'sandbox' | 'production';
  instance_url: string;
  consumer_key: string;
  sf_username: string;
  status: 'pending' | 'verified' | 'failed' | 'revoked';
  last_verified_at?: string;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export type SSEEventType = 'connected' | 'state_change' | 'step_update' | 'completed' | 'error' | 'timeout';

export interface SSEEvent {
  type: SSEEventType;
  taskId?: string;
  currentState?: TaskState;
  state?: TaskState;
  plan?: TaskPlan;
  steps?: TaskStep[];
  error?: string;
  message?: string;
  step?: TaskStep;
  finalState?: TaskState;
  timestamp: string;
}
