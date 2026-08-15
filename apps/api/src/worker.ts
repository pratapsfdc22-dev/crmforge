/**
 * Task orchestration worker
 * Processes queued tasks using pg-boss
 * Runs Orchestrator through plan -> execute -> verify cycle
 * Writes state updates to database for SSE streaming
 */

import { initQueue, getQueue, TaskJob } from './lib/queue.js';
import { TaskStateManager } from './lib/task-state.js';
import { getSupabaseClient } from './lib/supabase.js';
import { env } from './config/env.js';
import {
  Orchestrator,
  BedrockClient,
  LangfuseClient,
  PineconeClient,
} from '@forgesf/agent-core';
import type { TenantContext } from '@forgesf/agent-core';

async function startWorker() {
  console.log('[Worker] Starting task orchestration worker...');

  const queue = await initQueue();
  const supabase = getSupabaseClient();
  const stateManager = new TaskStateManager(supabase);

  // Create shared service clients
  const bedrockClient = new BedrockClient('professional');

  const langfuseClient = new LangfuseClient(
    env.LANGFUSE_SECRET_KEY,
    env.LANGFUSE_PUBLIC_KEY
  );

  const pineconeClient = new PineconeClient(
    env.PINECONE_API_KEY,
    env.PINECONE_ENVIRONMENT,
    env.PINECONE_PROJECT_ID
  );

  // Register handler for orchestrate-task jobs
  console.log('[Worker] Registering work handler for orchestrate-task...');

  // Error handler - catch all errors
  queue.on('error', (err) => {
    console.error('[Worker Queue Error]:', err);
  });

  // Failed job handler
  queue.on('failed', (jobId, err) => {
    console.error(`[Worker Failed Job] ${jobId}:`, err);
  });

  // Work handler - receives array of jobs from pg-boss
  const workPromise = queue.work('orchestrate-task', async (jobs: any[]) => {
    console.log('[Worker Handler] *** HANDLER INVOKED ***');
    for (const job of jobs) {
      try {
        const taskData: TaskJob = job.data;
        console.log(`[Worker] ✓ JOB RECEIVED: Processing task ${taskData.taskId} for org ${taskData.orgId}`);

      // Update state: queued -> planning
      await stateManager.updateState(taskData.taskId, 'planning');

      // Build tenant context from task data
      const ctx: TenantContext = {
        orgId: taskData.orgId,
        userId: taskData.userId,
        tier: taskData.tier as any,
        sfConnection: taskData.sfConnection || {
          instanceUrl: 'https://login.salesforce.com',
          accessToken: '',
          expiresAt: Date.now()
        },
        jiraToken: taskData.jiraToken || null,
        n8nConnection: taskData.n8nConnection || null,
      };

      // Create orchestrator with all observability clients
      const orchestrator = new Orchestrator(
        ctx,
        bedrockClient,
        langfuseClient,
        pineconeClient
      );

      // Phase 1: Planning
      console.log(`[Worker] Planning task ${taskData.taskId}...`);
      const { plan, repaired } = await orchestrator.plan(taskData.intent);
      console.log(
        `[Worker] Plan generated: ${plan.steps.length} steps, risk=${plan.risk}, repaired=${repaired}`
      );

      // Save plan to database
      await stateManager.setPlan(taskData.taskId, plan);

      // Phase 2: Execution
      await stateManager.updateState(taskData.taskId, 'executing');
      console.log(`[Worker] Executing ${plan.steps.length} steps...`);

      const records = await Promise.all(
        plan.steps.map(async (step, idx) => {
          const record = await orchestrator.executeStep(step, idx);
          // Write step result to DB as it completes
          await stateManager.addStep(taskData.taskId, record);
          return record;
        })
      );

      console.log(
        `[Worker] Execution complete: ${records.filter(r => r.status === 'completed').length}/${records.length} successful`
      );

      // Phase 3: Verification
      await stateManager.updateState(taskData.taskId, 'verifying');
      console.log(`[Worker] Verifying task completion...`);
      const { verified, summary } = await orchestrator.verify(taskData.intent, records);
      console.log(`[Worker] Verification result: verified=${verified}, summary=${summary}`);

      // Phase 4: Record completion with real Pinecone integration
      console.log(`[Worker] Recording task completion...`);
      await orchestrator.recordCompletion(
        taskData.taskId,
        'Task Execution',
        taskData.intent,
        plan.summary,
        summary
      );

      // Final state: succeeded or failed based on verification
      const finalState = verified ? 'succeeded' : 'failed';
      await stateManager.completeTask(taskData.taskId, finalState as any);

      console.log(`[Worker] Task ${taskData.taskId} completed with state: ${finalState}`);
      } catch (error) {
        console.error(`[Worker] Task ${taskData.taskId} failed:`, error);
        // Mark task as failed
        await stateManager.completeTask(
          taskData.taskId,
          'failed',
          error instanceof Error ? error.message : 'Unknown error'
        ).catch(err => console.error('[Worker] Failed to mark task failed:', err));
        throw error; // pg-boss will handle retry
      }
    }
  });

  console.log('[Worker] Waiting for work handler to be ready...');
  // The work() promise doesn't resolve until the worker shuts down, so we don't await it
  console.log('[Worker] ✓ Listening for orchestrate-task jobs...');
}

startWorker().catch((err) => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received, shutting down...');
  const queue = await getQueue();
  await queue.stop();
  process.exit(0);
});
