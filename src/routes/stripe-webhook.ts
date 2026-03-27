import { Hono } from "hono";
import { verifyWebhookSignature } from "../adapters/stripe.js";
import { markTaskPaid } from "../repo/payments-repo.js";
import { updateTaskStatus, addTaskEvent } from "../repo/tasks-repo.js";
import { logger } from "../utils/logger.js";

export const stripeWebhook = new Hono();

stripeWebhook.post("/", async (c) => {
  try {
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? "";

    const event = verifyWebhookSignature(rawBody, signature);
    if (!event) {
      return c.json({ error: "Invalid signature" }, 400);
    }

    logger.info(`[stripe-webhook] Event: ${event.type}`);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as unknown as Record<string, unknown>;
      const metadata = (session["metadata"] ?? {}) as Record<string, string>;
      const taskId = metadata["taskId"];

      if (taskId) {
        const sessionId = session["id"] as string;
        await markTaskPaid(taskId, sessionId);

        const transitioned = await updateTaskStatus(taskId, "provider_confirmed");
        if (transitioned) {
          logger.info(`[stripe-webhook] Task ${taskId} payment confirmed`);
          await addTaskEvent(taskId, "payment_confirmed", {
            sessionId,
            amount: session["amount_total"],
          });
        } else {
          logger.info(`[stripe-webhook] Task ${taskId} already transitioned (duplicate webhook?)`);
        }
      }
    }

    return c.json({ received: true });
  } catch (err) {
    logger.error("[stripe-webhook] Error:", err);
    return c.json({ error: "Webhook error" }, 500);
  }
});
