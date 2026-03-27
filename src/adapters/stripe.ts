import Stripe from "stripe";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let _stripe: Stripe | null = null;

function getStripe(): Stripe | null {
  if (!config.STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    _stripe = new Stripe(config.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

export async function createPaymentLink(input: {
  taskId: string;
  quoteId: string;
  amountCents: number;
  description: string;
}): Promise<{ url: string; id: string }> {
  const stripe = getStripe();
  if (!stripe) {
    logger.info("[stripe] STUB payment link");
    return {
      url: `https://buy.stripe.com/stub?task=${input.taskId}`,
      id: `stub_link_${input.taskId}`,
    };
  }

  const product = await stripe.products.create({
    name: `Service: ${input.description}`,
    metadata: { task_id: input.taskId, quote_id: input.quoteId },
  });

  const price = await stripe.prices.create({
    unit_amount: input.amountCents,
    currency: "usd",
    product: product.id,
  });

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { taskId: input.taskId, quoteId: input.quoteId },
    after_completion: {
      type: "redirect",
      redirect: { url: config.STRIPE_SUCCESS_URL },
    },
  });

  logger.info(`[stripe] Payment link created: ${link.url}`);
  return { url: link.url, id: link.id };
}

export function verifyWebhookSignature(rawBody: string, signature: string): Stripe.Event | null {
  const stripe = getStripe();
  if (!stripe || !config.STRIPE_WEBHOOK_SECRET) {
    logger.warn("[stripe] No Stripe config — cannot verify webhook");
    return null;
  }

  try {
    return stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error("[stripe] Webhook verification failed:", err);
    return null;
  }
}
