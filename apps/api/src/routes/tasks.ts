import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getQueue, getQueueConnectionDetails, TaskJob } from '../lib/queue.js';
import { TaskStateManager } from '../lib/task-state.js';
import { authenticateRequest } from '../lib/auth.js';
import { getSupabaseClient } from '../lib/supabase.js';

const createTaskSchema = z.object({
  intent: z.string().min(1),
});

function getTestAuthIfAllowed(request: FastifyRequest): { userId: string; orgId: string; tier: string } | null {
  // SECURITY: Test auth header only allowed in development with explicit opt-in flag
  // This check FAILS SAFE: missing/undefined env var means bypass is OFF
  const isDev = process.env.NODE_ENV === 'development';
  const testAuthEnabled = process.env.ALLOW_TEST_AUTH_HEADER === 'true';

  if (!isDev || !testAuthEnabled) {
    return null;
  }

  const testOrg = request.headers['x-test-org'] as string | undefined;
  if (!testOrg) {
    return null;
  }

  return {
    userId: 'test-user',
    orgId: testOrg,
    tier: 'professional'
  };
}

export async function taskRoutes(fastify: FastifyInstance) {
  // GET /tasks - List tasks for org
  fastify.get(
    '/tasks',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        let auth = getTestAuthIfAllowed(request);
        if (!auth) {
          auth = await authenticateRequest(request);
        }

        const query = request.query as { limit?: string; offset?: string };
        const limit = Math.min(parseInt(query.limit || '20') || 20, 100);
        const offset = parseInt(query.offset || '0') || 0;

        const supabase = getSupabaseClient();

        // TODO: regenerate packages/db/src/types.ts to include tasks table schema
        // Currently using 'as any' workaround due to stale Supabase types
        const { data: tasks, error } = await (supabase
          .from('tasks' as any)
          .select('*')
          .eq('org_id', auth.orgId)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1) as any);

        if (error) throw error;

        return reply.send({
          tasks: tasks.map((t: any) => ({
            id: t.id,
            org_id: t.org_id,
            user_id: t.user_id,
            intent: t.intent,
            state: t.state,
            plan: t.plan,
            steps: t.steps || [],
            error: t.error,
            created_at: t.created_at,
            started_at: t.started_at,
            completed_at: t.completed_at
          })),
          offset,
          limit
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(401).send({
          error: 'Unauthorized'
        });
      }
    }
  );

  // POST /tasks - Enqueue a new task
  fastify.post<{ Body: z.infer<typeof createTaskSchema> }>(
    '/tasks',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        let auth = getTestAuthIfAllowed(request);
        if (!auth) {
          auth = await authenticateRequest(request);
        }

        const body = createTaskSchema.parse(request.body);

        const supabase = getSupabaseClient();
        const stateManager = new TaskStateManager(supabase);

        // Create task in DB
        const task = await stateManager.createTask(
          auth.orgId,
          auth.userId,
          body.intent
        );

        // Enqueue to job queue
        const queue = await getQueue();
        const job: TaskJob = {
          taskId: task.id,
          orgId: auth.orgId,
          userId: auth.userId,
          intent: body.intent,
          tier: auth.tier,
        };

        const queueConnDetails = getQueueConnectionDetails();
        console.log('[Tasks Route] Queue.send() about to use: host=' + queueConnDetails.host + ' port=' + queueConnDetails.port + ' db=' + queueConnDetails.database);
        console.log('[Tasks Route] Sending job to queue name: "orchestrate-task"', { taskId: job.taskId });
        let sendResult;
        try {
          sendResult = await queue.send('orchestrate-task', job, {
            retryLimit: 2,
            retryDelay: 5,
            expireInSeconds: 3600,
          });
          console.log('[Tasks Route] ✓ Job persisted to queue table. pg-boss result:', sendResult);
        } catch (sendErr) {
          console.error('[Tasks Route] ✗ queue.send() threw error:', sendErr);
          throw sendErr;
        }

        return reply.code(202).send({
          taskId: task.id,
          status: 'queued',
          message: 'Task enqueued and will be processed by worker',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(400).send({
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  // GET /tasks/:id/events - SSE stream for task progress
  fastify.get<{ Params: { id: string } }>(
    '/tasks/:id/events',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        let auth = getTestAuthIfAllowed(request);
        if (!auth) {
          auth = await authenticateRequest(request);
        }

        const taskId = (request.params as { id: string }).id;

        const supabase = getSupabaseClient();
        const stateManager = new TaskStateManager(supabase);

        // Verify task ownership
        const task = await stateManager.getTask(taskId);
        if (!task || task.org_id !== auth.orgId) {
          return reply.code(404).send({ error: 'Task not found' });
        }

        // Set SSE headers
        reply.header('Content-Type', 'text/event-stream');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Connection', 'keep-alive');

        // Send initial connection message with current state
        reply.send(
          `data: ${JSON.stringify({
            type: 'connected',
            taskId,
            currentState: task.state,
            timestamp: new Date().toISOString(),
          })}\n\n`
        );

        // Poll for state changes every 500ms until task completes or 60s timeout
        let lastState = task.state;
        let pollCount = 0;
        const maxPolls = 120; // 60 seconds

        const pollInterval = setInterval(async () => {
          pollCount++;

          try {
            const updated = await stateManager.getTask(taskId);
            if (!updated) {
              clearInterval(pollInterval);
              reply.send(
                `data: ${JSON.stringify({
                  type: 'error',
                  message: 'Task not found',
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
              return;
            }

            // Send state change event
            if (updated.state !== lastState) {
              lastState = updated.state;
              reply.send(
                `data: ${JSON.stringify({
                  type: 'state_change',
                  state: updated.state,
                  plan: updated.plan,
                  steps: updated.steps,
                  error: updated.error,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
            }

            // Send step update events
            if (updated.steps && updated.steps.length > 0) {
              const latestStep = updated.steps[updated.steps.length - 1];
              if (latestStep && latestStep.completed_at) {
                reply.send(
                  `data: ${JSON.stringify({
                    type: 'step_update',
                    step: latestStep,
                    timestamp: new Date().toISOString(),
                  })}\n\n`
                );
              }
            }

            // Close connection when task completes
            if (
              updated.state === 'succeeded' ||
              updated.state === 'failed'
            ) {
              clearInterval(pollInterval);
              reply.send(
                `data: ${JSON.stringify({
                  type: 'completed',
                  finalState: updated.state,
                  error: updated.error,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
              return;
            }

            // Timeout after 60 seconds
            if (pollCount >= maxPolls) {
              clearInterval(pollInterval);
              reply.send(
                `data: ${JSON.stringify({
                  type: 'timeout',
                  message: 'Task monitoring timeout (60s)',
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
              return;
            }
          } catch (pollErr) {
            const errMsg = pollErr instanceof Error ? pollErr.message : 'Unknown error';
            fastify.log.error(errMsg);
            clearInterval(pollInterval);
            reply.send(
              `data: ${JSON.stringify({
                type: 'error',
                message: errMsg,
                timestamp: new Date().toISOString(),
              })}\n\n`
            );
          }
        }, 500);

        // Clean up interval if client disconnects
        request.socket.on('close', () => {
          clearInterval(pollInterval);
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(401).send({
          error: 'Unauthorized',
        });
      }
    }
  );
}
