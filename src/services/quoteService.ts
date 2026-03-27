import OpenAI from 'openai';
import { query } from '../db/client.js';
import type { Quote, ParsedQuote, Task, User } from '../types.js';
import { sendSms } from './messagingService.js';
import { storeMessage, updateTask } from './taskService.js';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export async function parseQuoteMessage(message: string): Promise<ParsedQuote> {
  console.log(`[quoteService] parseQuoteMessage`);

  const openai = getOpenAI();
  if (!openai) {
    console.log('[quoteService] STUB mode: returning stub parsed quote');
    return { price: '$100', availability: 'Tomorrow' };
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Extract quote information from this provider response. Return JSON: { "price": "string|null", "availability": "string|null" }. Extract any price mentioned and any availability/timing info.',
      },
      {
        role: 'user',
        content: message,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('[quoteService] OpenAI returned empty content');
  }

  return JSON.parse(content) as ParsedQuote;
}

export async function storeQuote(
  taskId: string,
  providerId: string,
  rawMessage: string
): Promise<Quote> {
  console.log(`[quoteService] storeQuote: task=${taskId} provider=${providerId}`);

  const parsed = await parseQuoteMessage(rawMessage);

  const result = await query<Quote>(
    `INSERT INTO quotes (task_id, provider_id, price, availability, raw_message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [taskId, providerId, parsed.price, parsed.availability, rawMessage]
  );
  return result.rows[0];
}

export interface QuoteWithProvider extends Quote {
  provider_name: string;
}

export async function getQuotesForTask(taskId: string): Promise<QuoteWithProvider[]> {
  console.log(`[quoteService] getQuotesForTask: ${taskId}`);

  const result = await query<QuoteWithProvider>(
    `SELECT q.*, p.name as provider_name
     FROM quotes q
     JOIN providers p ON q.provider_id = p.id
     WHERE q.task_id = $1
     ORDER BY q.created_at ASC`,
    [taskId]
  );
  return result.rows;
}

export async function checkAndPresentQuotes(taskId: string): Promise<void> {
  console.log(`[quoteService] checkAndPresentQuotes: ${taskId}`);

  // FIX 5: Guard against re-presenting quotes if already done
  const taskResult = await query<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = taskResult.rows[0];
  if (!task) {
    console.error(`[quoteService] Task not found: ${taskId}`);
    return;
  }
  if (
    task.state === 'awaiting_selection' ||
    task.state === 'awaiting_payment' ||
    task.state === 'completed'
  ) {
    console.log(`[quoteService] Quotes already presented for task ${taskId} (state: ${task.state})`);
    return;
  }

  const quotes = await getQuotesForTask(taskId);

  if (quotes.length < 2) {
    console.log(`[quoteService] Not enough quotes yet (${quotes.length}), waiting`);
    return;
  }

  const userResult = await query<User>('SELECT * FROM users WHERE id = $1', [task.user_id]);
  const user = userResult.rows[0];
  if (!user) {
    console.error(`[quoteService] User not found for task: ${taskId}`);
    return;
  }

  const quoteLines = quotes
    .map((q, i) => {
      const price = q.price ?? 'Price TBD';
      const availability = q.availability ?? 'Availability TBD';
      return `${i + 1}. ${q.provider_name} — ${price} — ${availability}`;
    })
    .join('\n');

  const message = `Here are your options:\n\n${quoteLines}\n\nReply with the number to choose.`;

  await sendSms(user.phone_number, message);
  await storeMessage(taskId, 'outbound', message);
  await updateTask(taskId, { state: 'awaiting_selection' });

  console.log(`[quoteService] Presented ${quotes.length} quotes to ${user.phone_number}`);
}

export async function handleSelection(taskId: string, selectionNumber: number): Promise<void> {
  console.log(`[quoteService] handleSelection: task=${taskId} selection=${selectionNumber}`);

  const quotes = await getQuotesForTask(taskId);

  if (selectionNumber < 1 || selectionNumber > quotes.length) {
    console.error(
      `[quoteService] Invalid selection ${selectionNumber}, max is ${quotes.length}`
    );

    const taskResult = await query<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
    const task = taskResult.rows[0];
    if (task) {
      const userResult = await query<User>('SELECT * FROM users WHERE id = $1', [task.user_id]);
      const user = userResult.rows[0];
      if (user) {
        await sendSms(
          user.phone_number,
          `Please reply with a number between 1 and ${quotes.length}.`
        );
        await storeMessage(taskId, 'outbound', `Please reply with a number between 1 and ${quotes.length}.`);
      }
    }
    return;
  }

  const selectedQuote = quotes[selectionNumber - 1];
  if (!selectedQuote) {
    console.error(`[quoteService] Selected quote not found at index ${selectionNumber - 1}`);
    return;
  }

  let paymentLink = 'https://buy.stripe.com/stub-payment-link';

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeKey);

      // FIX 4: Parse decimal prices correctly
      const priceAmount = selectedQuote.price
        ? Math.round(parseFloat(selectedQuote.price.replace(/[^0-9.]/g, '')) * 100)
        : 500000;

      const stripePrice = await stripe.prices.create({
        currency: 'usd',
        unit_amount: priceAmount,
        product_data: {
          name: `Home Service Deposit`,
        },
      });

      const link = await stripe.paymentLinks.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
      });

      paymentLink = link.url;
      console.log(`[quoteService] Created Stripe payment link: ${paymentLink}`);
    } catch (error) {
      console.error('[quoteService] Failed to create Stripe payment link:', error);
    }
  }

  const taskResult = await query<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = taskResult.rows[0];
  if (!task) {
    console.error(`[quoteService] Task not found: ${taskId}`);
    return;
  }

  const userResult = await query<User>('SELECT * FROM users WHERE id = $1', [task.user_id]);
  const user = userResult.rows[0];
  if (!user) {
    console.error(`[quoteService] User not found for task: ${taskId}`);
    return;
  }

  const confirmMessage = `To confirm, pay deposit here:\n${paymentLink}`;
  await sendSms(user.phone_number, confirmMessage);
  await storeMessage(taskId, 'outbound', confirmMessage);

  // FIX 3: Do NOT confirm booking yet — wait for payment confirmation.
  // Store selected quote and move to awaiting_payment.
  // In production a Stripe webhook would call confirmBooking.
  // For v1 testing, user can text "paid" / "confirm" / "done" to trigger confirmation.
  await updateTask(taskId, {
    state: 'awaiting_payment',
    selected_quote_id: selectedQuote.id,
  });

  console.log(`[quoteService] Task ${taskId} awaiting payment for quote ${selectedQuote.id}`);
}

export async function confirmBooking(taskId: string, quoteId: string): Promise<void> {
  console.log(`[quoteService] confirmBooking: task=${taskId} quote=${quoteId}`);

  const quoteResult = await query<Quote & { provider_name: string; provider_phone: string }>(
    `SELECT q.*, p.name as provider_name, p.phone_number as provider_phone
     FROM quotes q
     JOIN providers p ON q.provider_id = p.id
     WHERE q.id = $1`,
    [quoteId]
  );
  const quote = quoteResult.rows[0];
  if (!quote) {
    console.error(`[quoteService] Quote not found: ${quoteId}`);
    return;
  }

  const taskResult = await query<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = taskResult.rows[0];
  if (!task) {
    console.error(`[quoteService] Task not found: ${taskId}`);
    return;
  }

  const userResult = await query<User>('SELECT * FROM users WHERE id = $1', [task.user_id]);
  const user = userResult.rows[0];
  if (!user) {
    console.error(`[quoteService] User not found for task: ${taskId}`);
    return;
  }

  const providerMessage = `Job confirmed for: ${task.description}\nLocation: ${task.location ?? 'Not specified'}\nContact: ${user.phone_number}`;
  await sendSms(quote.provider_phone, providerMessage);
  await storeMessage(taskId, 'outbound', providerMessage);

  const userMessage = `You're booked with ${quote.provider_name}! They'll reach out shortly.`;
  await sendSms(user.phone_number, userMessage);
  await storeMessage(taskId, 'outbound', userMessage);

  await updateTask(taskId, { state: 'completed' });

  console.log(`[quoteService] Booking confirmed for task ${taskId}`);
}
