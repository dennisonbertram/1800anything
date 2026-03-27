import type { Task } from "../../domain/types.js";
import { countQuotesForTask } from "../../repo/quotes-repo.js";
import { updateTaskStatus } from "../../repo/tasks-repo.js";
import { logger } from "../../utils/logger.js";

export async function handleWaitingForProviderQuotes(task: Task): Promise<void> {
  const count = await countQuotesForTask(task.id);
  logger.info(`[handle-waiting-quotes] Task ${task.id} has ${count} quotes`);

  if (count >= 2) {
    await updateTaskStatus(task.id, "quotes_ready");
    return;
  }

  // Timeout: if we've been waiting more than 30 minutes, proceed with whatever we have
  const waitingMinutes = (Date.now() - task.updatedAt.getTime()) / 60000;
  if (waitingMinutes > 30) {
    if (count >= 1) {
      logger.info(`[handle-waiting-quotes] Timeout with ${count} quote(s), proceeding`);
      await updateTaskStatus(task.id, "quotes_ready");
    } else {
      logger.info(`[handle-waiting-quotes] Timeout with no quotes, failing task`);
      await updateTaskStatus(task.id, "failed");
      // TODO: notify user that no providers responded
    }
  }
}
