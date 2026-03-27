import type { Task } from "../../domain/types.js";
import { updateTaskStatus } from "../../repo/tasks-repo.js";
import { logger } from "../../utils/logger.js";

export async function handleWaitingForPayment(task: Task): Promise<void> {
  // Timeout: if waiting more than 24 hours, fail the task
  const waitingHours = (Date.now() - task.updatedAt.getTime()) / 3600000;
  if (waitingHours > 24) {
    logger.info(`[handle-payment] Task ${task.id} payment timeout after 24h`);
    await updateTaskStatus(task.id, "failed");
  }
}
