import { Hono } from 'hono';
import twilio from 'twilio';
import { query } from '../db/client.js';
import type { Provider, Task } from '../types.js';
import {
  findOrCreateUser,
  findActiveTask,
  createTask,
  storeMessage,
} from '../services/taskService.js';
import { processTask } from '../services/agentService.js';
import * as quoteService from '../services/quoteService.js';

const app = new Hono();

// FIX 2: Twilio signature validation helper
function isTwilioSignatureValid(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}

app.post('/webhook/twilio', async (c) => {
  try {
    // Parse body once — used for both signature validation and message handling
    const body = await c.req.parseBody();

    // FIX 2: Validate Twilio signature before processing
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = c.req.header('X-Twilio-Signature') ?? '';
      const url = c.req.url;
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === 'string') params[k] = v;
      }

      if (!isTwilioSignatureValid(authToken, url, params, signature)) {
        console.warn('[twilio] Invalid Twilio signature — rejecting request');
        return c.text('Forbidden', 403);
      }
    } else {
      console.warn('[twilio] TWILIO_AUTH_TOKEN not set — skipping signature validation (stub mode)');
    }

    const messageBody = (body['Body'] as string) ?? '';
    const from = (body['From'] as string) ?? '';
    const numMedia = parseInt((body['NumMedia'] as string) ?? '0', 10);

    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = body[`MediaUrl${i}`] as string | undefined;
      if (mediaUrl) {
        mediaUrls.push(mediaUrl);
      }
    }

    console.log(`[twilio] Incoming message from ${from}: "${messageBody}" (${numMedia} media)`);

    const providerResult = await query<Provider>(
      'SELECT * FROM providers WHERE phone_number = $1',
      [from]
    );
    const isProvider = providerResult.rows.length > 0;

    if (isProvider) {
      const provider = providerResult.rows[0];
      console.log(`[twilio] Message is from provider: ${provider.name}`);

      // FIX 1: Find the specific task that contacted this provider via task_providers table
      const taskResult = await query<Task>(
        `SELECT t.* FROM tasks t
         JOIN task_providers tp ON tp.task_id = t.id
         WHERE tp.provider_id = $1 AND t.state = 'quoting'
         ORDER BY t.updated_at DESC LIMIT 1`,
        [provider.id]
      );
      const task = taskResult.rows[0];

      if (task) {
        await quoteService.storeQuote(task.id, provider.id, messageBody);
        await quoteService.checkAndPresentQuotes(task.id);
      } else {
        console.log('[twilio] No quoting task found for provider message');
      }
    } else {
      const user = await findOrCreateUser(from);
      console.log(`[twilio] User found/created: ${user.id}`);

      let task = await findActiveTask(user.id);
      if (!task) {
        task = await createTask(user.id);
        console.log(`[twilio] Created new task: ${task.id}`);
      }

      await storeMessage(task.id, 'inbound', messageBody, mediaUrls);

      if (task.state === 'awaiting_selection') {
        const trimmed = messageBody.trim();
        const selectionMatch = /^[1-9]$/.exec(trimmed);
        if (selectionMatch) {
          const selectionNumber = parseInt(trimmed, 10);
          console.log(`[twilio] User selected option ${selectionNumber} for task ${task.id}`);
          await quoteService.handleSelection(task.id, selectionNumber);
        } else {
          await processTask(task.id);
        }
      } else if (task.state === 'awaiting_payment') {
        // FIX 3: Allow user to confirm payment by texting "paid", "confirm", or "done"
        const trimmed = messageBody.trim().toLowerCase();
        if (trimmed === 'paid' || trimmed === 'confirm' || trimmed === 'done') {
          const selectedQuoteId = task.selected_quote_id;
          if (selectedQuoteId) {
            console.log(`[twilio] User confirmed payment for task ${task.id}`);
            await quoteService.confirmBooking(task.id, selectedQuoteId);
          } else {
            console.error(`[twilio] No selected_quote_id on task ${task.id} in awaiting_payment state`);
          }
        } else {
          console.log(`[twilio] Task ${task.id} awaiting payment — ignoring message: "${messageBody}"`);
        }
      } else {
        await processTask(task.id);
      }
    }
  } catch (error) {
    console.error('[twilio] Webhook error:', error);
  }

  return c.text('<Response></Response>', 200, { 'Content-Type': 'text/xml' });
});

export default app;
