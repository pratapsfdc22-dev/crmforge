import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { salesforceConnectionRoutes } from "./routes/connections/salesforce.js";
import { jiraConnectionRoutes } from "./routes/connections/jira.js";
import { n8nConnectionRoutes } from "./routes/connections/n8n.js";
import { taskRoutes } from "./routes/tasks.js";
import { initQueue } from "./lib/queue.js";

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      env.NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              ignore: "pid,hostname",
              translateTime: "HH:MM:ss",
            },
          }
        : undefined,
    redact: {
      paths: [
        "*.secret",
        "*.token",
        "*.key",
        "*.password",
        "req.headers.authorization",
        "req.headers.cookie",
      ],
      censor: "[REDACTED]",
    },
  },
});

await fastify.register(cors, {
  origin: env.NODE_ENV === "production" ? false : true,
});

await fastify.register(healthRoutes);
await fastify.register(authRoutes);
await fastify.register(salesforceConnectionRoutes);
await fastify.register(jiraConnectionRoutes);
await fastify.register(n8nConnectionRoutes);
await fastify.register(taskRoutes);

const start = async () => {
  try {
    console.log('[Main] Starting API server...');

    // Security: Warn if test auth header is enabled
    if (process.env.ALLOW_TEST_AUTH_HEADER === 'true') {
      console.warn('⚠️  TEST_AUTH_HEADER ENABLED - local development only, NEVER for production');
    }

    console.log('[Main] Initializing queue...');
    await initQueue();
    console.log('[Main] Queue initialized successfully');

    const port = parseInt(env.PORT, 10);
    console.log(`[Main] Starting Fastify on port ${port}...`);
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`[Main] ✓ Server listening on port ${port}`);
  } catch (err) {
    console.error('[Main] ✗ Startup failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error) {
      console.error('[Main] Stack:', err.stack);
    }
    process.exit(1);
  }
};

start();
