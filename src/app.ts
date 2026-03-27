import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { twilioWebhook } from "./routes/twilio-webhook.js";
import { stripeWebhook } from "./routes/stripe-webhook.js";

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", honoLogger());
  app.get("/health", (c) => c.json({ ok: true, timestamp: new Date().toISOString() }));

  app.route("/webhooks/twilio", twilioWebhook);
  app.route("/webhooks/stripe", stripeWebhook);

  app.onError((err, c) => {
    console.error("[app] Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
