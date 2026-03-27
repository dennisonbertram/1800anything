import { Hono } from "hono";
import { parseInboundTwilioPayload, validateWebhookSignature } from "../adapters/twilio.js";
import { parseQuote } from "../adapters/openai.js";
import { normalizePhoneNumber } from "../utils/phone.js";
import { findContactByPhone, findOrCreateContact } from "../repo/contacts-repo.js";
import { createTask, findOpenTaskForUser, addTaskEvent } from "../repo/tasks-repo.js";
import { createMessage } from "../repo/messages-repo.js";
import { findRecentOutreachByProvider } from "../repo/provider-outreach-repo.js";
import { createQuote } from "../repo/quotes-repo.js";
import { enqueueTask } from "../services/task-dispatcher.js";
import { logger } from "../utils/logger.js";

export const twilioWebhook = new Hono();

twilioWebhook.post("/", async (c) => {
  try {
    // Parse form body
    const rawBody = await c.req.text();
    const formData: Record<string, string> = {};
    for (const pair of rawBody.split("&")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) continue;
      const key = decodeURIComponent(pair.slice(0, eqIdx));
      const value = decodeURIComponent(pair.slice(eqIdx + 1));
      formData[key] = value;
    }

    // Validate signature
    const signature = c.req.header("X-Twilio-Signature") ?? "";
    const webhookUrl = process.env["PUBLIC_URL"]
      ? `${process.env["PUBLIC_URL"]}/webhooks/twilio`
      : c.req.url;
    const valid = await validateWebhookSignature(signature, webhookUrl, formData);
    if (!valid) {
      logger.warn("[twilio-webhook] Invalid signature");
      return c.text("Forbidden", 403);
    }

    const parsed = parseInboundTwilioPayload(formData);
    const from = normalizePhoneNumber(parsed.from);

    logger.info(`[twilio-webhook] Message from ${from}: ${parsed.body ?? "(media only)"}`);

    // FIX #2: Check if sender is a known provider with active outreach
    const existingContact = await findContactByPhone(from);

    if (existingContact?.kind === "provider") {
      await handleProviderReply(existingContact.id, parsed);
    } else {
      await handleUserMessage(from, parsed);
    }

    return c.text("<Response></Response>", 200, { "Content-Type": "text/xml" });
  } catch (err) {
    logger.error("[twilio-webhook] Error:", err);
    // Return 500 so Twilio retries
    return c.text("<Response></Response>", 500, { "Content-Type": "text/xml" });
  }
});

async function handleUserMessage(
  phone: string,
  parsed: ReturnType<typeof parseInboundTwilioPayload>
): Promise<void> {
  const contact = await findOrCreateContact(phone, "user");

  let task = await findOpenTaskForUser(contact.id);
  if (!task) {
    task = await createTask(contact.id);
    logger.info(`[twilio-webhook] Created new task ${task.id}`);
  }

  await createMessage({
    taskId: task.id,
    contactId: contact.id,
    direction: "inbound",
    body: parsed.body,
    media: parsed.media,
    externalId: parsed.externalId,
  });

  await addTaskEvent(task.id, "user_message_received", {
    body: parsed.body,
    mediaCount: parsed.media.length,
  });

  enqueueTask(task.id);
}

// FIX #2 + FIX #3: Match provider replies to tasks via outreach records, create quotes
async function handleProviderReply(
  providerContactId: string,
  parsed: ReturnType<typeof parseInboundTwilioPayload>
): Promise<void> {
  // Find which task this provider was contacted for
  const outreach = await findRecentOutreachByProvider(providerContactId);
  if (!outreach) {
    logger.warn(`[twilio-webhook] No outreach found for provider ${providerContactId}`);
    return;
  }

  // Store inbound message
  await createMessage({
    taskId: outreach.taskId,
    contactId: providerContactId,
    direction: "inbound",
    body: parsed.body,
    media: parsed.media,
    externalId: parsed.externalId,
  });

  // FIX #3: Parse and create quote record
  const quoteExtraction = await parseQuote(parsed.body ?? "");

  await createQuote({
    taskId: outreach.taskId,
    providerContactId,
    priceText: quoteExtraction.priceText,
    availabilityText: quoteExtraction.availabilityText,
    rawMessage: parsed.body,
    normalized: quoteExtraction as unknown as Record<string, unknown>,
  });

  await addTaskEvent(outreach.taskId, "provider_quote_received", {
    providerContactId,
    price: quoteExtraction.priceText,
    availability: quoteExtraction.availabilityText,
  });

  // Enqueue the task so runner can check if we have enough quotes now
  enqueueTask(outreach.taskId);

  logger.info(`[twilio-webhook] Quote stored for task ${outreach.taskId}`);
}
