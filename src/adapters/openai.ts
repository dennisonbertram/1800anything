import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { extractIntakePrompt } from "../prompts/extract-intake.js";
import { parseQuotePrompt } from "../prompts/parse-quote.js";
import { logger } from "../utils/logger.js";
import type { IntakeExtraction, QuoteExtraction, TaskMessage } from "../domain/types.js";

let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!config.OPENAI_API_KEY) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: 30000 });
  }
  return _client;
}

const intakeSchema = z.object({
  serviceType: z.enum(["plumber", "electrician", "handyman", "cleaner", "junk_removal", "unknown"]),
  description: z.string().nullable(),
  locationText: z.string().nullable(),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().nullable(),
});

const quoteSchema = z.object({
  priceText: z.string().nullable(),
  availabilityText: z.string().nullable(),
});

export async function extractIntake(messages: TaskMessage[]): Promise<IntakeExtraction> {
  const client = getClient();
  if (!client) {
    logger.info("[openai] STUB extraction");
    const firstBody = messages.find((m) => m.direction === "inbound")?.body;
    return {
      serviceType: "unknown",
      description: firstBody ?? "Service request",
      locationText: null,
      needsClarification: true,
      clarificationQuestion: "What's your zip code or city?",
    };
  }

  // Build conversation context
  const conversationLines = messages.map((m) => {
    const prefix = m.direction === "inbound" ? "User" : "Agent";
    let line = `${prefix}: ${m.body ?? "(no text)"}`;
    if (m.media.length > 0) {
      line += ` [${m.media.length} media attached]`;
    }
    return line;
  });

  // Build content parts with vision support
  const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "text", text: `Conversation:\n${conversationLines.join("\n")}` },
  ];

  // Add images from latest message with media
  const latestWithMedia = [...messages].reverse().find((m) => m.media.length > 0);
  if (latestWithMedia) {
    for (const item of latestWithMedia.media) {
      if (item.contentType.startsWith("image/")) {
        contentParts.push({
          type: "image_url",
          image_url: { url: item.url },
        });
      }
    }
  }

  try {
    const response = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: extractIntakePrompt },
        { role: "user", content: contentParts },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) throw new Error("Empty OpenAI response");
    return intakeSchema.parse(JSON.parse(text));
  } catch (err) {
    logger.error("[openai] Extraction failed:", err);
    throw err;
  }
}

export async function parseQuote(message: string): Promise<QuoteExtraction> {
  const client = getClient();
  if (!client) {
    logger.info("[openai] STUB quote parsing");
    return { priceText: null, availabilityText: null };
  }

  try {
    const response = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: parseQuotePrompt },
        { role: "user", content: message },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) return { priceText: null, availabilityText: null };
    return quoteSchema.parse(JSON.parse(text));
  } catch (err) {
    logger.error("[openai] Quote parsing failed:", err);
    return { priceText: null, availabilityText: null };
  }
}
