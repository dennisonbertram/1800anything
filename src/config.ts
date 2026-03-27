import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_PHONE_NUMBER: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_SUCCESS_URL: z.string().default("https://example.com/success"),
  STRIPE_CANCEL_URL: z.string().default("https://example.com/cancel"),
  RUNNER_INTERVAL_MS: z.coerce.number().default(3000),
});

export type Config = z.infer<typeof envSchema>;
export const config = envSchema.parse(process.env);
