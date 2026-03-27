import type { Task } from "../../domain/types.js";
import { searchProviders } from "../../adapters/provider-search.js";
import { findOrCreateContact } from "../../repo/contacts-repo.js";
import { createProviderOutreach } from "../../repo/provider-outreach-repo.js";
import { sendSms } from "../../adapters/twilio.js";
import { createMessage } from "../../repo/messages-repo.js";
import { updateTaskStatus } from "../../repo/tasks-repo.js";
import { logger } from "../../utils/logger.js";

export async function handleSourcingProviders(task: Task): Promise<void> {
  logger.info(`[handle-sourcing] Sourcing for task ${task.id}`);

  const description = String(task.structuredData["description"] ?? "Service request");
  const serviceType = task.serviceType ?? "unknown";
  const locationText = task.locationText ?? "Unknown location";

  const candidates = await searchProviders({ serviceType, locationText });

  const outreachBody = [
    "New job request:",
    `Type: ${serviceType}`,
    `Issue: ${description}`,
    `Location: ${locationText}`,
    "",
    "Are you available? Rough quote?",
  ].join("\n");

  for (const candidate of candidates) {
    const contact = await findOrCreateContact(candidate.phone, "provider", candidate.name);

    const result = await sendSms(contact.phone, outreachBody);

    const msg = await createMessage({
      taskId: task.id,
      contactId: contact.id,
      direction: "outbound",
      body: outreachBody,
      media: [],
      externalId: result.sid,
    });

    await createProviderOutreach(task.id, contact.id, msg.id);
  }

  await updateTaskStatus(task.id, "waiting_for_provider_quotes");
}
