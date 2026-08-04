import PgBoss from 'pg-boss';
import { env } from '../config/env.js';

let queue: InstanceType<typeof PgBoss> | null = null;

export async function initQueue(): Promise<InstanceType<typeof PgBoss>> {
  if (queue) {
    return queue;
  }

  console.log('[Queue] Creating PgBoss instance...');

  // pg-boss requires direct connection (not pooler) for LISTEN/NOTIFY
  const pgbossUrl = env.PGBOSS_DATABASE_URL || env.DATABASE_URL;
  const isPooler = pgbossUrl.includes('pooler');
  console.log('[Queue] Using connection:', pgbossUrl.substring(0, 50) + '...');
  console.log('[Queue] Connection type:', isPooler ? '⚠️  POOLER (may not support LISTEN/NOTIFY)' : '✓ Direct');

  queue = new PgBoss({
    connectionString: pgbossUrl,
    schema: 'pgboss'
  });

  queue.on('error', err => console.error('[PgBoss Error Event]:', err));

  console.log('[Queue] Calling queue.start()...');

  // Start with a timeout to catch hangs
  const startPromise = queue.start();
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('queue.start() timeout after 10 seconds')), 10000)
  );

  try {
    await Promise.race([startPromise, timeoutPromise]);
    console.log('[Queue] ✓ queue.start() completed successfully');
    console.log('[Queue] Now listening for jobs on queue name: "orchestrate-task"');
  } catch (err) {
    console.error('[Queue] ✗ queue.start() failed:', err instanceof Error ? err.message : err);
    queue = null;
    throw err;
  }

  console.log('[Queue] ✓ PgBoss started and ready');
  return queue;
}

export async function getQueue(): Promise<InstanceType<typeof PgBoss>> {
  if (!queue) {
    return initQueue();
  }
  return queue;
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.stop();
    queue = null;
  }
}

export interface TaskJob {
  taskId: string;
  orgId: string;
  userId: string;
  intent: string;
  tier: string;
  sfConnection?: {
    instanceUrl: string;
    accessToken: string;
    expiresAt: number;
  };
  jiraToken?: {
    api_token: string;
    email: string;
    jira_url: string;
  };
  n8nConnection?: {
    api_key: string;
    base_url: string;
  };
}
