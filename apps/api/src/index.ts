import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { salesforceConnectionRoutes } from "./routes/connections/salesforce.js";
import { jiraConnectionRoutes } from "./routes/connections/jira.js";
import { n8nConnectionRoutes } from "./routes/connections/n8n.js";

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

const start = async () => {
  try {
    const port = parseInt(env.PORT, 10);
    await fastify.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
