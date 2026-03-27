import { config } from "../config.js";
import { claimRunnableTask, releaseTaskLock } from "../repo/tasks-repo.js";
import { runTask } from "../services/run-task.js";
import { logger } from "../utils/logger.js";

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function startRunner(): void {
  running = true;
  logger.info(`[runner] Starting background runner (interval: ${config.RUNNER_INTERVAL_MS}ms)`);

  timer = setInterval(async () => {
    if (!running) return;

    try {
      const task = await claimRunnableTask();
      if (!task) return;

      logger.info(`[runner] Claimed task ${task.id} (status: ${task.status})`);

      try {
        await runTask(task.id);
      } catch (err) {
        logger.error(`[runner] Task ${task.id} failed:`, err);
      } finally {
        await releaseTaskLock(task.id);
      }
    } catch (err) {
      logger.error("[runner] Poll error:", err);
    }
  }, config.RUNNER_INTERVAL_MS);
}

export function stopRunner(): void {
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  logger.info("[runner] Runner stopped");
}
