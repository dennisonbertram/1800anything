import twilio from "twilio";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

let _client: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> | null {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
    return null;
  }
  if (!_client) {
    _client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  }
  return _client;
}

export type ParsedInboundTwilioMessage = {
  from: string;
  to: string;
  body: string | null;
  media: Array<{ url: string; contentType: string }>;
  externalId: string | null;
};

export function parseInboundTwilioPayload(payload: Record<string, string>): ParsedInboundTwilioMessage {
  const numMedia = Number(payload["NumMedia"] ?? "0");
  const media = Array.from({ length: numMedia }, (_, index) => ({
    url: payload[`MediaUrl${index}`] ?? "",
    contentType: payload[`MediaContentType${index}`] ?? "application/octet-stream",
  })).filter((item) => item.url.length > 0);

  return {
    from: payload["From"] ?? "",
    to: payload["To"] ?? "",
    body: payload["Body"]?.trim() || null,
    media,
    externalId: payload["MessageSid"] ?? null,
  };
}

export async function sendSms(to: string, body: string): Promise<{ sid: string }> {
  const client = getClient();
  if (!client) {
    logger.info(`[twilio] STUB SMS -> ${to}: ${body}`);
    return { sid: `stub_${Date.now()}` };
  }

  const result = await client.messages.create({
    from: config.TWILIO_PHONE_NUMBER,
    to,
    body,
  });

  logger.info(`[twilio] SMS sent -> ${to} (sid: ${result.sid})`);
  return { sid: result.sid };
}

export async function validateWebhookSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  if (!config.TWILIO_AUTH_TOKEN) {
    logger.warn("[twilio] No auth token — skipping signature validation");
    return true;
  }
  return twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, url, params);
}
