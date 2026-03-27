import { query } from "./db.js";

export async function createPayment(input: {
  taskId: string;
  stripePaymentLinkId: string;
  amountCents: number;
}): Promise<void> {
  await query(
    `insert into payments (task_id, stripe_payment_link_id, amount_cents, status)
     values ($1, $2, $3, 'pending')`,
    [input.taskId, input.stripePaymentLinkId, input.amountCents]
  );
}

export async function markTaskPaid(taskId: string, stripeSessionId: string): Promise<void> {
  await query(
    `update payments
     set stripe_session_id = $2,
         status = 'paid',
         updated_at = now()
     where task_id = $1 and status = 'pending'`,
    [taskId, stripeSessionId]
  );
}
