import PgBoss from 'pg-boss';
import { env } from '../config/env.js';

let queue: InstanceType<typeof PgBoss> | null = null;

function parseConnectionString(connStr: string): { host: string; port: string; database: string } {
  try {
    const url = new URL(connStr);
    const host = url.hostname;
    const port = url.port || '5432';
    const database = url.pathname.substring(1) || 'postgres';
    return { host, port, database };
  } catch {
    return { host: 'unknown', port: 'unknown', database: 'unknown' };
  }
}

export function getQueueConnectionDetails() {
  const pgbossUrl = env.PGBOSS_DATABASE_URL || env.DATABASE_URL;
  return parseConnectionString(pgbossUrl);
}

export async function initQueue(): Promise<InstanceType<typeof PgBoss>> {
  if (queue) {
    return queue;
  }

  console.log('[Queue] Creating PgBoss instance...');

  // pg-boss requires direct connection (not pooler) for LISTEN/NOTIFY
  const pgbossUrl = env.PGBOSS_DATABASE_URL || env.DATABASE_URL;
  const isPooler = pgbossUrl.includes('pooler');
  const connDetails = getQueueConnectionDetails();
  console.log('[Queue] Using connection:', pgbossUrl.substring(0, 50) + '...');
  console.log('[Queue] Connection type:', isPooler ? '⚠️  POOLER (may not support LISTEN/NOTIFY)' : '✓ Direct');
  console.log('[Queue] Parsed host:port:db at init:', connDetails.host + ':' + connDetails.port + ':' + connDetails.database);

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
  } catch (err) {
    console.error('[Queue] ✗ queue.start() failed:', err instanceof Error ? err.message : err);
    queue = null;
    throw err;
  }

  // Explicitly create the queue if it doesn't exist
  // pg-boss's send() requires a row in pgboss.queue matching the job name
  try {
    console.log('[Queue] Creating queue entry for "orchestrate-task"...');
    await queue.createQueue('orchestrate-task');
    console.log('[Queue] ✓ Queue "orchestrate-task" created/verified');
  } catch (err) {
    console.error('[Queue] ⚠️  Failed to create queue:', err instanceof Error ? err.message : err);
    // Don't throw here; the queue might already exist
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
