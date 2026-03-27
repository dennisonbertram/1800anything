import type { Task } from "../../domain/types.js";
import { updateTaskStatus } from "../../repo/tasks-repo.js";
import { logger } from "../../utils/logger.js";

export async function handleReadyToSource(task: Task): Promise<void> {
  logger.info(`[handle-ready-to-source] Task ${task.id} moving to sourcing`);
  await updateTaskStatus(task.id, "sourcing_providers");
}
