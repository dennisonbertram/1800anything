import type { Task } from "../../domain/types.js";
import {
  listMessagesForTask,
  getLatestInboundMessage,
  getLatestOutboundMessage,
} from "../../repo/messages-repo.js";
import { updateTaskStatus } from "../../repo/tasks-repo.js";
import { extractIntake } from "../../adapters/openai.js";
import { updateTaskExtraction } from "../../repo/tasks-repo.js";
import { logger } from "../../utils/logger.js";

export async function handleNeedsUserClarification(task: Task): Promise<void> {
  logger.info(`[handle-clarification] Checking task ${task.id}`);

  // FIX #4: Check if new inbound message arrived since our last outbound
  const latestInbound = await getLatestInboundMessage(task.id);
  const latestOutbound = await getLatestOutboundMessage(task.id);

  if (!latestInbound) {
    logger.info(`[handle-clarification] No inbound messages, waiting`);
    return;
  }

  if (latestOutbound && latestInbound.createdAt <= latestOutbound.createdAt) {
    logger.info(`[handle-clarification] No new reply since last question, waiting`);
    return;
  }

  // New user reply exists — re-run extraction
  const messages = await listMessagesForTask(task.id);
  const extracted = await extractIntake(messages);

  await updateTaskExtraction(task.id, {
    serviceType: extracted.serviceType,
    locationText: extracted.locationText,
    structuredData: {
      ...task.structuredData,
      description: extracted.description,
    },
  });

  if (!extracted.needsClarification) {
    await updateTaskStatus(task.id, "ready_to_source");
  } else {
    // Transition back to intake so it can ask another question
    await updateTaskStatus(task.id, "intake");
  }
}
