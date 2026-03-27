# Stripe SDK Implementation Review

**Date:** 2026-03-27
**File reviewed:** `src/services/quoteService.ts` (lines 168-198)
**Stripe SDK version:** `stripe@^17.0.0`
**Source:** Context7 documentation for `/stripe/stripe-node`

---

## 1. Stripe Client Instantiation

### Current Code (lines 173-174)
```typescript
const Stripe = (await import('stripe')).default;
const stripe = new Stripe(stripeKey);
```

### Issues

**ISSUE: Dynamic import on every payment link creation.** The Stripe client is re-imported and re-instantiated inside `handleSelection()` on every call. This is wasteful and prevents connection reuse.

**ISSUE: No API version pinned.** The constructor accepts an `apiVersion` option. Without pinning, your integration silently adopts breaking changes when Stripe rolls a new default version.

### Recommended Fix
```typescript
// At module top level (alongside the OpenAI client pattern already in this file)
import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(key, {
      apiVersion: '2025-12-18.acacia', // pin to a known-good version
    });
  }
  return stripeClient;
}
```

This follows the same lazy-singleton pattern the file already uses for OpenAI.

---

## 2. Product / Price / Payment Link Creation Flow

### Current Code (lines 177-193)
```typescript
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
```

### Issues

**ISSUE: Generic product name.** Every payment link creates a new "Home Service Deposit" product with no distinguishing info. The customer sees this on their receipt and in the Stripe dashboard. Use the provider name, task description, or quote details.

**ISSUE: No metadata on any Stripe object.** Without metadata you cannot correlate a Stripe payment back to your `taskId`, `quoteId`, or `providerId`. This is critical for webhook handling and reconciliation.

**ISSUE: Payment link has no `after_completion` redirect.** The customer completes payment and lands on Stripe's default "payment successful" page with no way back to your app.

**ISSUE: `product_data.name` is a generic string.** Stripe best practice is to include a description and, if possible, images so the checkout page is informative.

**ISSUE: Price parsing is fragile.** The regex `replace(/[^0-9.]/g, '')` will produce incorrect results for strings like `"$1,500.00"` (outputs `"1500.00"`, which is correct) but will break on `"$1.500,00"` (European format) or `"between $50-100"`. If `parseFloat` returns `NaN`, `Math.round(NaN * 100)` is `NaN`, and Stripe will reject it.

**ISSUE: Fallback amount of $5,000 (`500000` cents) is dangerously high.** If price parsing fails silently, you charge $5,000. Use a safer default or throw.

### Recommended Fix
```typescript
// Parse and validate the amount
function parsePriceCents(priceStr: string | null | undefined): number {
  if (!priceStr) throw new Error('No price available for payment link');
  const cleaned = priceStr.replace(/[^0-9.]/g, '');
  const dollars = parseFloat(cleaned);
  if (isNaN(dollars) || dollars <= 0) {
    throw new Error(`Cannot parse price: "${priceStr}"`);
  }
  return Math.round(dollars * 100);
}

// Create the price + payment link
const priceAmount = parsePriceCents(selectedQuote.price);

const stripePrice = await stripe.prices.create({
  currency: 'usd',
  unit_amount: priceAmount,
  product_data: {
    name: `${selectedQuote.provider_name} — Home Service Deposit`,
    description: task.description ?? undefined,
  },
});

const link = await stripe.paymentLinks.create({
  line_items: [{ price: stripePrice.id, quantity: 1 }],
  metadata: {
    taskId,
    quoteId: selectedQuote.id,
    providerId: selectedQuote.provider_id,
  },
  after_completion: {
    type: 'redirect',
    redirect: {
      url: `${process.env.APP_URL}/payment-success?task=${taskId}`,
    },
  },
});
```

---

## 3. Error Handling

### Current Code (lines 195-197)
```typescript
} catch (error) {
  console.error('[quoteService] Failed to create Stripe payment link:', error);
}
```

### Issues

**ISSUE: Errors are swallowed.** When Stripe fails, the code falls through and sends the **stub** payment link (`https://buy.stripe.com/stub-payment-link`) to the customer. This is wrong in production -- the user gets a broken link.

**ISSUE: No typed error handling.** Stripe provides typed error classes (`StripeCardError`, `StripeInvalidRequestError`, `StripeRateLimitError`, etc.) that allow granular recovery.

### Recommended Fix
```typescript
import Stripe from 'stripe';

try {
  // ... create price + link ...
} catch (error) {
  if (error instanceof Stripe.errors.StripeError) {
    console.error(`[quoteService] Stripe error (${error.type}):`, error.message);
    console.error(`[quoteService] Request ID: ${error.requestId}`);

    if (error.type === 'StripeRateLimitError') {
      // Could implement retry logic here
    }
  } else {
    console.error('[quoteService] Unexpected error creating payment link:', error);
  }

  // Inform the user that payment link creation failed
  // instead of sending a stub link
  const taskResult = await query<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = taskResult.rows[0];
  if (task) {
    const userResult = await query<User>('SELECT * FROM users WHERE id = $1', [task.user_id]);
    const user = userResult.rows[0];
    if (user) {
      await sendSms(user.phone_number,
        'Sorry, we had trouble generating your payment link. Please try again shortly.');
    }
  }
  return; // Do NOT proceed with a stub link
}
```

---

## 4. Missing Webhook for Payment Confirmation

### Current Behavior
The code at `src/routes/twilio.ts` lines 111-124 relies on the user texting "paid", "confirm", or "done" to trigger `confirmBooking()`. There is **no Stripe webhook endpoint** in the codebase.

### Why This Is a Problem

1. **No payment verification.** Anyone can text "paid" without actually paying.
2. **Payments can succeed without booking confirmation.** If the user pays but never texts back, the booking is never confirmed.
3. **No idempotency.** Nothing prevents double-confirmation.

### What You Need

A dedicated route that receives `checkout.session.completed` events from Stripe:

```typescript
// src/routes/stripe.ts
import { Hono } from 'hono';
import Stripe from 'stripe';
import { query } from '../db/client.js';
import type { Task } from '../types.js';
import { confirmBooking } from '../services/quoteService.js';

const app = new Hono();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

app.post('/webhook/stripe', async (c) => {
  // CRITICAL: Use raw body for signature verification.
  // With Hono, use c.req.raw.
  const rawBody = await c.req.text();
  const sig = c.req.header('stripe-signature');

  if (!sig) {
    return c.text('Missing stripe-signature header', 400);
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error(`[stripe] Webhook signature verification failed: ${err.message}`);
    return c.text(`Webhook Error: ${err.message}`, 400);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const taskId = session.metadata?.taskId;
      const quoteId = session.metadata?.quoteId;

      if (!taskId || !quoteId) {
        console.error('[stripe] Missing metadata on checkout session:', session.id);
        break;
      }

      console.log(`[stripe] Payment completed for task ${taskId}, quote ${quoteId}`);

      // Check task is still awaiting payment (idempotency)
      const taskResult = await query<Task>(
        'SELECT * FROM tasks WHERE id = $1',
        [taskId]
      );
      const task = taskResult.rows[0];
      if (task?.state === 'awaiting_payment') {
        await confirmBooking(taskId, quoteId);
      } else {
        console.log(`[stripe] Task ${taskId} not in awaiting_payment (${task?.state}), skipping`);
      }
      break;
    }

    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(`[stripe] Checkout session expired: ${session.id}`);
      // Optionally notify user that their payment link expired
      break;
    }

    default:
      console.log(`[stripe] Unhandled event type: ${event.type}`);
  }

  return c.json({ received: true });
});

export default app;
```

**Key requirements for this webhook:**
- `STRIPE_WEBHOOK_SECRET` env var (from Stripe Dashboard > Webhooks)
- Raw body parsing (not JSON-parsed) for signature verification
- Register this endpoint in Stripe Dashboard for `checkout.session.completed` and `checkout.session.expired` events
- The metadata (`taskId`, `quoteId`) must be set when creating the payment link (see Section 2)

**Important:** Payment Links create Checkout Sessions under the hood. The webhook event to listen for is `checkout.session.completed`, and the metadata you set on the payment link propagates to the checkout session.

---

## 5. Summary of All Issues

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| 1 | Medium | Stripe client re-created on every call | `quoteService.ts:173-174` |
| 2 | Medium | No API version pinned | `quoteService.ts:174` |
| 3 | Low | Generic product name, no description | `quoteService.ts:184-186` |
| 4 | **High** | No metadata on Stripe objects | `quoteService.ts:181-191` |
| 5 | Medium | No `after_completion` redirect on payment link | `quoteService.ts:189-191` |
| 6 | Medium | Fragile price parsing, NaN not handled | `quoteService.ts:177-179` |
| 7 | **High** | $5,000 fallback on parse failure | `quoteService.ts:179` |
| 8 | **High** | Stripe errors swallowed, stub link sent | `quoteService.ts:195-197` |
| 9 | **Critical** | No Stripe webhook -- payment not verified | entire codebase |
| 10 | **Critical** | User can text "paid" to skip actual payment | `twilio.ts:114` |
| 11 | Low | No typed Stripe error handling | `quoteService.ts:195` |

---

## 6. Recommended Action Items

1. **Create `/webhook/stripe` route** with signature verification and `checkout.session.completed` handling. This is the most important fix.
2. **Add metadata** (`taskId`, `quoteId`, `providerId`) to payment links so the webhook can route payments to the correct booking.
3. **Move Stripe client to a singleton** at module level with a pinned API version.
4. **Fix error handling** -- never send a stub link in production. Fail visibly.
5. **Remove or gate the "text paid to confirm" flow** -- keep it only behind a `NODE_ENV=development` check if needed for testing.
6. **Validate parsed price** -- throw on NaN, remove the $5,000 fallback.
7. **Store `stripe_payment_link_id`** and `stripe_checkout_session_id` in the tasks or quotes table for reconciliation.
