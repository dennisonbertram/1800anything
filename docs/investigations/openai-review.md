# OpenAI SDK Usage Review -- 1800anything

**Date:** 2026-03-27
**Files reviewed:**
- `src/services/agentService.ts`
- `src/services/quoteService.ts`

**SDK version in package.json:** `openai ^4.0.0` (should upgrade to latest v4.x or consider v5+)

---

## 1. Client Initialization

### Current Code (both files duplicate this)

```ts
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}
```

### Issues

1. **Duplicated client factory.** Both `agentService.ts` and `quoteService.ts` have identical `getOpenAI()` implementations. This should be a shared singleton.

2. **No timeout or retry configuration.** The SDK defaults to a 10-minute timeout and 2 retries. For an SMS-driven service where users are waiting, you want a tighter timeout and explicit retry config.

3. **`apiKey` is redundant when using the env var `OPENAI_API_KEY`.** The SDK reads `process.env.OPENAI_API_KEY` automatically. Passing it explicitly is fine but unnecessary.

### Recommended Fix

Create a shared client module:

```ts
// src/lib/openai.ts
import OpenAI from 'openai';

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({
      // apiKey is auto-read from OPENAI_API_KEY env var
      timeout: 30_000,   // 30s -- reasonable for SMS latency
      maxRetries: 2,     // default, but explicit is better
    });
  }
  return client;
}
```

---

## 2. JSON Mode vs Structured Outputs

### Current Code

```ts
const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  response_format: { type: 'json_object' },
  messages: [ /* ... */ ],
});

const content = completion.choices[0]?.message?.content;
const parsed = JSON.parse(content) as ExtractedData;
```

### Issues

1. **`response_format: { type: 'json_object' }` works but is the older approach.** It guarantees valid JSON but does NOT enforce a schema -- the model can return any valid JSON. You are relying on prompt instructions alone to get the right shape, then casting with `as ExtractedData` which provides zero runtime validation.

2. **The modern best practice is Structured Outputs with `client.chat.completions.parse()` and `zodResponseFormat()`.** This:
   - Sends a JSON Schema to the API so the model is *constrained* to your exact shape
   - Auto-parses the response into a typed object (`message.parsed`)
   - Eliminates `JSON.parse()` + unsafe type assertion
   - Gives you Zod runtime validation for free

3. **Manual `JSON.parse()` with no try/catch.** If the model returns malformed content (rare with json_object mode, but possible on refusal), this throws an unhandled error.

### Recommended Fix for `agentService.ts`

```ts
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

const ExtractedDataSchema = z.object({
  description: z.string(),
  location: z.string().nullable(),
  has_enough_info: z.boolean(),
  missing_fields: z.array(z.string()),
});

export async function extractTaskData(messages: Message[]): Promise<ExtractedData> {
  const openai = getOpenAI();
  if (!openai) { /* stub fallback */ }

  const conversationText = messages.map(m => {
    const role = m.direction === 'inbound' ? 'User' : 'Assistant';
    const mediaNote = Array.isArray(m.media_urls) && m.media_urls.length > 0
      ? ` [Media: ${m.media_urls.join(', ')}]`
      : '';
    return `${role}: ${m.content}${mediaNote}`;
  }).join('\n');

  const completion = await openai.chat.completions.parse({
    model: 'gpt-4o-mini',
    response_format: zodResponseFormat(ExtractedDataSchema, 'extracted_data'),
    messages: [
      {
        role: 'system',
        content: `You are extracting structured data for a home service request.
Analyze the conversation and extract the description, location, whether there is enough info, and what fields are missing.
Rules:
- has_enough_info = true ONLY if we have BOTH: description of the problem AND location (zip, city, or address)
- If image/video URLs are present, assume the description can be inferred from the media
- Be generous - partial info is fine for v1`,
      },
      { role: 'user', content: conversationText },
    ],
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    throw new Error('[agentService] OpenAI returned no parsed content (possible refusal)');
  }
  return parsed;
}
```

### Recommended Fix for `quoteService.ts`

```ts
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

const ParsedQuoteSchema = z.object({
  price: z.string().nullable(),
  availability: z.string().nullable(),
});

export async function parseQuoteMessage(message: string): Promise<ParsedQuote> {
  const openai = getOpenAI();
  if (!openai) { /* stub fallback */ }

  const completion = await openai.chat.completions.parse({
    model: 'gpt-4o-mini',
    response_format: zodResponseFormat(ParsedQuoteSchema, 'parsed_quote'),
    messages: [
      {
        role: 'system',
        content: 'Extract quote information from this provider response. Extract any price mentioned and any availability/timing info.',
      },
      { role: 'user', content: message },
    ],
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    throw new Error('[quoteService] OpenAI returned no parsed content');
  }
  return parsed;
}
```

**Dependency needed:** Add `zod` to your dependencies:
```
npm install zod
```

---

## 3. Vision API for MMS Images

### Current Code

```ts
const mediaNote =
  Array.isArray(m.media_urls) && m.media_urls.length > 0
    ? ` [Media: ${m.media_urls.join(', ')}]`
    : '';
return `${role}: ${m.content}${mediaNote}`;
```

### Issue

**Images are passed as text URLs, not processed visually.** The model sees `[Media: https://...jpg]` as a string -- it cannot actually look at the image. The system prompt says "assume the description can be inferred from the media" but the model is literally guessing based on the URL filename.

### Recommended Fix

Use the Vision API by passing images as `image_url` content parts in the messages array. `gpt-4o-mini` supports vision.

```ts
function buildMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  const systemMessage: OpenAI.ChatCompletionMessageParam = {
    role: 'system',
    content: `You are extracting structured data for a home service request. ...`,
  };

  const userParts: OpenAI.ChatCompletionContentPart[] = [];

  for (const m of messages) {
    const role = m.direction === 'inbound' ? 'User' : 'Assistant';
    userParts.push({ type: 'text', text: `${role}: ${m.content}` });

    if (Array.isArray(m.media_urls)) {
      for (const url of m.media_urls) {
        userParts.push({
          type: 'image_url',
          image_url: { url, detail: 'low' }, // 'low' = cheaper, 'high' for detail
        });
      }
    }
  }

  return [
    systemMessage,
    { role: 'user', content: userParts },
  ];
}
```

**Key considerations:**
- Use `detail: 'low'` to keep costs down for initial triage; switch to `'high'` if you need the model to read fine text in photos
- Twilio MMS media URLs are temporary -- you may need to download and re-host or base64-encode them before sending to OpenAI
- Vision works with `parse()` + `zodResponseFormat` -- they are compatible

---

## 4. Error Handling

### Current Code

**`agentService.ts` -- `extractTaskData`:** No try/catch around the OpenAI call or JSON.parse. Errors propagate up to `processTask` which has a catch-all.

**`quoteService.ts` -- `parseQuoteMessage`:** No try/catch at all. A failure here crashes `storeQuote`.

### Issues

1. **No distinction between transient and permanent errors.** Rate limits (429) should be retried; auth errors (401) should not.
2. **No handling of refusals.** When the model refuses (e.g., content policy), `finish_reason` will be `'content_filter'` and content may be null. The code throws a generic error.
3. **`JSON.parse` can throw** if the model returns non-JSON despite json_object mode (edge case but possible on refusal).

### Recommended Fix

```ts
import OpenAI from 'openai';

async function safeExtract<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      console.error(`[${context}] OpenAI API error: status=${err.status} type=${err.type} message=${err.message}`);

      if (err.status === 429) {
        // Rate limited -- the SDK auto-retries (maxRetries), but if we still get here:
        throw new Error(`[${context}] Rate limited after retries`);
      }
      if (err.status === 401) {
        throw new Error(`[${context}] Invalid API key`);
      }
    }
    throw err;
  }
}

// Usage:
const completion = await safeExtract(
  () => openai.chat.completions.parse({ /* ... */ }),
  'agentService.extractTaskData'
);
```

Also check for refusals when using `.parse()`:

```ts
const message = completion.choices[0]?.message;
if (message?.refusal) {
  console.error(`[agentService] Model refused: ${message.refusal}`);
  throw new Error('Model refused to process this content');
}
if (!message?.parsed) {
  throw new Error('No parsed content returned');
}
```

---

## 5. Model Choice

### Current: `gpt-4o-mini`

This is fine for cost-sensitive extraction tasks. No issue here. If extraction quality becomes a problem, consider upgrading to `gpt-4o` for the extraction step only.

---

## 6. Summary of Action Items

| Priority | Issue | Fix |
|----------|-------|-----|
| **HIGH** | Duplicated OpenAI client in two files | Extract to shared `src/lib/openai.ts` |
| **HIGH** | Using `response_format: { type: 'json_object' }` + manual `JSON.parse` + type cast | Switch to `zodResponseFormat()` + `.parse()` for schema-enforced structured outputs |
| **HIGH** | MMS images passed as URL strings, not processed visually | Use Vision API with `image_url` content parts |
| **HIGH** | No error handling on OpenAI calls in `quoteService.ts` | Add try/catch with `OpenAI.APIError` handling |
| **MEDIUM** | No timeout configured on client | Set `timeout: 30_000` on client |
| **MEDIUM** | No refusal handling | Check `message.refusal` before accessing parsed content |
| **MEDIUM** | `JSON.parse` without try/catch | Eliminated by switching to `.parse()` |
| **LOW** | No `zod` dependency | `npm install zod` |
| **LOW** | `system` role vs `developer` role | OpenAI docs now show `developer` role in newer examples; `system` still works but `developer` is the new convention for gpt-4o+ models |

---

## 7. Minimal Migration Checklist

1. `npm install zod`
2. Create `src/lib/openai.ts` with shared client (timeout + retries configured)
3. Define Zod schemas for `ExtractedData` and `ParsedQuote`
4. Replace `openai.chat.completions.create()` with `openai.chat.completions.parse()` + `zodResponseFormat()`
5. Add Vision API support for MMS image URLs in `extractTaskData`
6. Add proper error handling with `OpenAI.APIError` checks and refusal handling
7. Remove duplicated `getOpenAI()` from both service files
