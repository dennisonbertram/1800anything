import type { Task } from "../../domain/types.js";
import { findContactById } from "../../repo/contacts-repo.js";
import { getQuoteById } from "../../repo/quotes-repo.js";
import { createMessage } from "../../repo/messages-repo.js";
import { updateTaskStatus } from "../../repo/tasks-repo.js";
import { sendSms } from "../../adapters/twilio.js";
import { logger } from "../../utils/logger.js";

export async function handleProviderConfirmed(task: Task): Promise<void> {
  logger.info(`[handle-confirmed] Confirming task ${task.id}`);

  if (!task.selectedQuoteId) {
    logger.error(`[handle-confirmed] No selected quote`);
    await updateTaskStatus(task.id, "failed");
    return;
  }

  const quote = await getQuoteById(task.selectedQuoteId);
  if (!quote) {
    logger.error(`[handle-confirmed] Quote not found: ${task.selectedQuoteId}`);
    await updateTaskStatus(task.id, "failed");
    return;
  }

  const provider = await findContactById(quote.providerContactId);
  const user = await findContactById(task.userContactId);
  if (!provider || !user) {
    logger.error(`[handle-confirmed] Missing contacts`);
    await updateTaskStatus(task.id, "failed");
    return;
  }

  const description = String(task.structuredData["description"] ?? "Home service");
  const location = task.locationText ?? "See details";

  // Notify provider
  const providerMsg = `Job confirmed!\n\n${description}\nLocation: ${location}\nCustomer contact: ${user.phone}`;
  const provResult = await sendSms(provider.phone, providerMsg);
  await createMessage({
    taskId: task.id,
    contactId: provider.id,
    direction: "outbound",
    body: providerMsg,
    media: [],
    externalId: provResult.sid,
  });

  // Notify user
  const userMsg = `You're booked with ${provider.name ?? "your provider"}! They'll reach out shortly.`;
  const userResult = await sendSms(user.phone, userMsg);
  await createMessage({
    taskId: task.id,
    contactId: user.id,
    direction: "outbound",
    body: userMsg,
    media: [],
    externalId: userResult.sid,
  });

  await updateTaskStatus(task.id, "completed");
}
