import PgBoss from 'pg-boss';
import { env } from '../config/env.js';

let queue: InstanceType<typeof PgBoss> | null = null;

export async function initQueue(): Promise<InstanceType<typeof PgBoss>> {
  if (queue) {
    return queue;
  }

  queue = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'pgboss'
  });

  queue.on('error', err => console.error('[PgBoss] Error:', err));

  await queue.start();
  console.log('[Queue] PgBoss started');

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
