import type { Task } from "../../domain/types.js";
import { listQuotesForTask } from "../../repo/quotes-repo.js";
import { findContactById } from "../../repo/contacts-repo.js";
import { createMessage } from "../../repo/messages-repo.js";
import { sendSms } from "../../adapters/twilio.js";
import { updateTaskStatus } from "../../repo/tasks-repo.js";
import { logger } from "../../utils/logger.js";

export async function handleQuotesReady(task: Task): Promise<void> {
  logger.info(`[handle-quotes-ready] Presenting quotes for task ${task.id}`);

  const user = await findContactById(task.userContactId);
  if (!user) {
    logger.error(`[handle-quotes-ready] User contact not found`);
    return;
  }

  const quotes = await listQuotesForTask(task.id);
  const topQuotes = quotes.slice(0, 3);

  if (topQuotes.length === 0) return;

  // Build provider name lookup
  const lines = ["Here are your options:", ""];

  for (let i = 0; i < topQuotes.length; i++) {
    const q = topQuotes[i]!;
    const provider = await findContactById(q.providerContactId);
    const name = provider?.name ?? "Provider";
    const price = q.priceText ?? "Quote pending";
    const avail = q.availabilityText ?? "";
    lines.push(`${i + 1}. ${name} — ${price}${avail ? ` — ${avail}` : ""}`);
  }

  lines.push("", `Reply with a number (1-${topQuotes.length}) to choose.`);

  const body = lines.join("\n");
  const result = await sendSms(user.phone, body);

  await createMessage({
    taskId: task.id,
    contactId: user.id,
    direction: "outbound",
    body,
    media: [],
    externalId: result.sid,
  });

  // FIX #5: Transition immediately so this handler won't run again
  await updateTaskStatus(task.id, "waiting_for_user_selection");
}
