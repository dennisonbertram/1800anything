import type { Task } from "../../domain/types.js";
import { listMessagesForTask, createMessage } from "../../repo/messages-repo.js";
import { updateTaskExtraction, updateTaskStatus } from "../../repo/tasks-repo.js";
import { findContactById } from "../../repo/contacts-repo.js";
import { extractIntake } from "../../adapters/openai.js";
import { sendSms } from "../../adapters/twilio.js";
import { logger } from "../../utils/logger.js";

export async function handleIntake(task: Task): Promise<void> {
  logger.info(`[handle-intake] Processing task ${task.id}`);

  const messages = await listMessagesForTask(task.id);
  if (messages.length === 0) {
    logger.info(`[handle-intake] No messages yet, skipping`);
    return;
  }

  const extracted = await extractIntake(messages);
  logger.info(`[handle-intake] Extraction result:`, extracted);

  await updateTaskExtraction(task.id, {
    serviceType: extracted.serviceType,
    locationText: extracted.locationText,
    structuredData: {
      ...task.structuredData,
      description: extracted.description,
    },
  });

  if (extracted.needsClarification && extracted.clarificationQuestion) {
    // FIX #1: Look up user phone from contacts, not structuredData
    const user = await findContactById(task.userContactId);
    if (!user) {
      logger.error(`[handle-intake] User contact not found: ${task.userContactId}`);
      return;
    }

    const result = await sendSms(user.phone, extracted.clarificationQuestion);
    await createMessage({
      taskId: task.id,
      contactId: task.userContactId,
      direction: "outbound",
      body: extracted.clarificationQuestion,
      media: [],
      externalId: result.sid,
    });

    await updateTaskStatus(task.id, "needs_user_clarification");
    return;
  }

  await updateTaskStatus(task.id, "ready_to_source");
}
