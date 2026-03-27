import type { Task } from "../../domain/types.js";
import { countQuotesForTask } from "../../repo/quotes-repo.js";
import { updateTaskStatus } from "../../repo/tasks-repo.js";
import { logger } from "../../utils/logger.js";

export async function handleWaitingForProviderQuotes(task: Task): Promise<void> {
  const count = await countQuotesForTask(task.id);
  logger.info(`[handle-waiting-quotes] Task ${task.id} has ${count} quotes`);

  if (count >= 2) {
    await updateTaskStatus(task.id, "quotes_ready");
  }
  // Otherwise: do nothing, runner will check again next cycle
}
