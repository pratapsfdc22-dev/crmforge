/**
 * Task state management — tracks task progress in database
 * Allows SSE endpoint to poll for updates and stream to clients
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Plan, TaskStepRecord, TaskState } from '@forgesf/agent-core';

export interface Task {
  id: string;
  org_id: string;
  user_id: string;
  intent: string;
  state: TaskState;
  plan?: Plan;
  steps: TaskStepRecord[];
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export class TaskStateManager {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new task
   */
  async createTask(
    orgId: string,
    userId: string,
    intent: string
  ): Promise<Task> {
    const { data, error } = await this.supabase
      .from('tasks')
      .insert({
        org_id: orgId,
        user_id: userId,
        intent,
        state: 'queued'
      })
      .select()
      .single();

    if (error) throw error;
    return this.formatTask(data);
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? this.formatTask(data) : null;
  }

  /**
   * Update task state
   */
  async updateState(taskId: string, state: TaskState): Promise<void> {
    const { error } = await this.supabase
      .from('tasks')
      .update({
        state,
        started_at: state !== 'queued' ? new Date().toISOString() : undefined
      })
      .eq('id', taskId);

    if (error) throw error;
  }

  /**
   * Update plan after planning phase
   */
  async setPlan(taskId: string, plan: Plan): Promise<void> {
    const { error } = await this.supabase
      .from('tasks')
      .update({ plan })
      .eq('id', taskId);

    if (error) throw error;
  }

  /**
   * Add/update a step during execution
   */
  async addStep(taskId: string, step: TaskStepRecord): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const steps = task.steps || [];
    steps[step.step_index] = step;

    const { error } = await this.supabase
      .from('tasks')
      .update({ steps })
      .eq('id', taskId);

    if (error) throw error;
  }

  /**
   * Complete task with final state
   */
  async completeTask(
    taskId: string,
    state: 'succeeded' | 'failed',
    error?: string
  ): Promise<void> {
    const { error: err } = await this.supabase
      .from('tasks')
      .update({
        state,
        error,
        completed_at: new Date().toISOString()
      })
      .eq('id', taskId);

    if (err) throw err;
  }

  /**
   * Format raw DB row to Task interface
   */
  private formatTask(row: any): Task {
    return {
      id: row.id,
      org_id: row.org_id,
      user_id: row.user_id,
      intent: row.intent,
      state: row.state,
      plan: row.plan,
      steps: row.steps || [],
      error: row.error,
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at
    };
  }
}
