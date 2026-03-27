import type { Task } from "../../domain/types.js";
import { getLatestInboundMessage, getLatestOutboundMessage, createMessage } from "../../repo/messages-repo.js";
import { listQuotesForTask } from "../../repo/quotes-repo.js";
import { setSelectedQuote, updateTaskStatus } from "../../repo/tasks-repo.js";
import { findContactById } from "../../repo/contacts-repo.js";
import { createPaymentLink } from "../../adapters/stripe.js";
import { createPayment } from "../../repo/payments-repo.js";
import { sendSms } from "../../adapters/twilio.js";
import { logger } from "../../utils/logger.js";

export async function handleWaitingForUserSelection(task: Task): Promise<void> {
  logger.info(`[handle-selection] Checking for selection on task ${task.id}`);

  // FIX #5: If we already have a selected quote, don't re-process
  if (task.selectedQuoteId) {
    logger.info(`[handle-selection] Quote already selected, skipping`);
    return;
  }

  const user = await findContactById(task.userContactId);
  if (!user) {
    logger.error(`[handle-selection] User not found`);
    return;
  }

  // Check for new inbound since our last outbound
  const latestInbound = await getLatestInboundMessage(task.id, user.id);
  const latestOutbound = await getLatestOutboundMessage(task.id);

  if (!latestInbound || (latestOutbound && latestInbound.createdAt <= latestOutbound.createdAt)) {
    return; // No new response
  }

  const body = latestInbound.body?.trim() ?? "";
  const num = parseInt(body, 10);
  const quotes = await listQuotesForTask(task.id);

  if (isNaN(num) || num < 1 || num > quotes.length) {
    // Invalid selection — ask again
    const retryMsg = `Please reply with a number between 1 and ${quotes.length}.`;
    const result = await sendSms(user.phone, retryMsg);
    await createMessage({
      taskId: task.id,
      contactId: user.id,
      direction: "outbound",
      body: retryMsg,
      media: [],
      externalId: result.sid,
    });
    return;
  }

  const selectedQuote = quotes[num - 1]!;
  await setSelectedQuote(task.id, selectedQuote.id);

  // Parse price for payment
  let amountCents = 5000; // default $50 deposit
  if (selectedQuote.priceText) {
    const cleaned = selectedQuote.priceText.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(cleaned);
    if (!isNaN(dollars) && dollars > 0) {
      amountCents = Math.round(dollars * 100);
    }
  }

  // Sanity cap: $10,000 maximum
  const MAX_AMOUNT_CENTS = 1000000;
  if (amountCents > MAX_AMOUNT_CENTS) {
    logger.warn(`[handle-selection] Price ${amountCents} cents exceeds max, capping to ${MAX_AMOUNT_CENTS}`);
    amountCents = MAX_AMOUNT_CENTS;
  }

  const description = String(task.structuredData["description"] ?? "Home service");

  const paymentLink = await createPaymentLink({
    taskId: task.id,
    quoteId: selectedQuote.id,
    amountCents,
    description,
  });

  await createPayment({
    taskId: task.id,
    stripePaymentLinkId: paymentLink.id,
    amountCents,
  });

  const payMsg = `To confirm, pay here:\n${paymentLink.url}`;
  const payResult = await sendSms(user.phone, payMsg);
  await createMessage({
    taskId: task.id,
    contactId: user.id,
    direction: "outbound",
    body: payMsg,
    media: [],
    externalId: payResult.sid,
  });

  await updateTaskStatus(task.id, "waiting_for_payment");
}
