import type { Task } from "../../domain/types.js";

export async function handleWaitingForPayment(_task: Task): Promise<void> {
  // No-op. Payment confirmation comes from Stripe webhook.
  // The webhook handler transitions the task to provider_confirmed.
}
