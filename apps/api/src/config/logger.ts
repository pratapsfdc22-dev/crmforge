import pino from "pino";
import { env } from "./env.js";

const redactPaths = [
  "*.secret",
  "*.token",
  "*.key",
  "*.password",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
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
});
