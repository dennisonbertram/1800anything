import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { startRunner, stopRunner } from "./worker/runner.js";
import { shutdown as shutdownDb } from "./repo/db.js";
import { logger } from "./utils/logger.js";

const app = createApp();

const server = serve({ fetch: app.fetch, port: config.PORT }, () => {
  logger.info(`🚀 1800anything listening on port ${config.PORT}`);
});

startRunner();

// Graceful shutdown
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down...`);
  stopRunner();
  server.close();
  await shutdownDb();
  process.exit(0);
}

process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
