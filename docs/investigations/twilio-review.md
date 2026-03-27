# Twilio SDK Implementation Review

**Date:** 2026-03-27
**Files reviewed:**
- `src/services/messagingService.ts`
- `src/routes/twilio.ts`

**Reference:** Twilio Node.js SDK documentation via Context7 (`/twilio/twilio-node`, `/llmstxt/twilio_llms_txt`)

---

## 1. Twilio Client Creation

### Current Implementation (`messagingService.ts`)

```typescript
export async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  // ...
  const client = twilio(accountSid, authToken);
  await client.messages.create({ body, from: fromNumber, to });
}
```

### Issues

**MEDIUM -- Client is re-created on every call.** The Twilio client is instantiated inside `sendSms()`, meaning every SMS creates a new HTTP client, new connection pool, and re-parses credentials. This is wasteful and prevents connection reuse.

### Fix

Create the client once at module level (or lazily on first use):

```typescript
import twilio from 'twilio';

let _client: ReturnType<typeof twilio> | null = null;

function getTwilioClient() {
  if (!_client) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
    }
    _client = twilio(accountSid, authToken);
  }
  return _client;
}

export async function sendSms(to: string, body: string): Promise<void> {
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!fromNumber) throw new Error('TWILIO_PHONE_NUMBER must be set');

  const client = getTwilioClient();
  const message = await client.messages.create({ body, from: fromNumber, to });
  console.log(`[messagingService] SMS sent to ${to}, SID: ${message.sid}`);
}
```

---

## 2. Sending Messages

### Current Implementation

```typescript
await client.messages.create({ body, from: fromNumber, to });
```

### Issues

**LOW -- No message SID logging.** The `create()` call returns a `MessageInstance` with a `sid`, `status`, `dateCreated`, etc. The current code discards the return value, losing the message SID which is essential for debugging and tracking delivery.

**LOW -- No Twilio-specific error handling.** The SDK throws `twilio.RestException` with structured error codes (`error.code`, `error.status`, `error.moreInfo`). The current `catch` block treats it as a generic error.

**INFO -- No MMS sending support.** The service only sends plain SMS. If you ever need to send outbound MMS, add the `mediaUrl` parameter:

```typescript
await client.messages.create({
  body,
  from: fromNumber,
  to,
  mediaUrl: ['https://example.com/image.jpg'], // array of URLs
});
```

### Fix (error handling)

```typescript
import twilio from 'twilio';

try {
  const message = await client.messages.create({ body, from: fromNumber, to });
  console.log(`[messagingService] SMS sent to ${to}, SID: ${message.sid}, status: ${message.status}`);
} catch (error) {
  if (error instanceof twilio.RestException) {
    console.error(`[messagingService] Twilio error ${error.code}: ${error.message}`);
    console.error(`[messagingService] More info: ${error.moreInfo}`);
  } else {
    console.error(`[messagingService] Failed to send SMS to ${to}:`, error);
  }
  throw error;
}
```

---

## 3. Webhook Signature Validation

### Current Implementation (`twilio.ts`)

```typescript
function isTwilioSignatureValid(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}

// In handler:
const url = c.req.url;
```

### Issues

**CRITICAL -- `c.req.url` may not match the URL Twilio signed against.** Twilio signs against the **exact public URL** configured in your webhook settings. If your app is behind a reverse proxy, load balancer, or tunnel (e.g., ngrok, Cloudflare, Railway), `c.req.url` will often be:
- `http://` instead of `https://`
- `localhost:PORT/...` instead of `your-domain.com/...`
- Missing or different port numbers

The signature will **always fail** if the URL doesn't match exactly. This is the #1 cause of webhook validation failures.

**MEDIUM -- Validation is skipped when `TWILIO_AUTH_TOKEN` is not set.** In production this should be a hard failure, not a silent pass-through. An attacker can forge requests if the token is missing.

### Fix

```typescript
app.post('/webhook/twilio', async (c) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // NEVER skip validation in production
  if (!authToken) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[twilio] TWILIO_AUTH_TOKEN not set in production -- rejecting');
      return c.text('Server misconfigured', 500);
    }
    console.warn('[twilio] TWILIO_AUTH_TOKEN not set -- skipping validation (dev mode)');
  }

  const body = await c.req.parseBody();

  if (authToken) {
    const signature = c.req.header('X-Twilio-Signature') ?? '';

    // Use the PUBLIC webhook URL, not the internal request URL.
    // Option A: Construct from known base URL (recommended)
    const baseUrl = process.env.WEBHOOK_BASE_URL; // e.g., "https://your-app.railway.app"
    const url = baseUrl
      ? `${baseUrl}/webhook/twilio`
      : c.req.url; // fallback for local dev

    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string') params[k] = v;
    }

    if (!twilio.validateRequest(authToken, signature, url, params)) {
      console.warn('[twilio] Invalid Twilio signature -- rejecting request');
      return c.text('Forbidden', 403);
    }
  }
  // ... rest of handler
});
```

Alternatively, use `twilio.validateExpressRequest` if you switch to Express, which has built-in protocol/host override options:

```typescript
const isValid = twilio.validateExpressRequest(req, authToken, {
  protocol: 'https',
  host: 'your-app.railway.app',
});
```

---

## 4. Parsing Webhook Bodies (Inbound SMS/MMS)

### Current Implementation

```typescript
const body = await c.req.parseBody();
const messageBody = (body['Body'] as string) ?? '';
const from = (body['From'] as string) ?? '';
const numMedia = parseInt((body['NumMedia'] as string) ?? '0', 10);

const mediaUrls: string[] = [];
for (let i = 0; i < numMedia; i++) {
  const mediaUrl = body[`MediaUrl${i}`] as string | undefined;
  if (mediaUrl) mediaUrls.push(mediaUrl);
}
```

### Issues

**LOW -- Missing `MediaContentType` extraction.** Twilio sends `MediaContentType0`, `MediaContentType1`, etc. alongside the URLs. Without the content type, you can't determine the file type (image/jpeg, image/png, video/mp4, etc.) which matters for downstream processing and storage.

**INFO -- Media URLs require authentication to fetch.** Twilio's `MediaUrl` values point to `https://api.twilio.com/...` which requires HTTP Basic Auth (`accountSid:authToken`) to download. If you're storing or processing these, make sure to authenticate the fetch.

**INFO -- Consider deleting media after download.** Twilio stores MMS media on their servers and charges for storage. Best practice is to download, store locally, then delete from Twilio.

### Fix (media content types)

```typescript
interface InboundMedia {
  url: string;
  contentType: string;
}

const media: InboundMedia[] = [];
for (let i = 0; i < numMedia; i++) {
  const url = body[`MediaUrl${i}`] as string | undefined;
  const contentType = body[`MediaContentType${i}`] as string | undefined;
  if (url) {
    media.push({ url, contentType: contentType ?? 'application/octet-stream' });
  }
}
```

### Fix (authenticated media download)

```typescript
async function downloadTwilioMedia(mediaUrl: string): Promise<Buffer> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(mediaUrl, {
    headers: { Authorization: authHeader },
  });

  if (!response.ok) throw new Error(`Failed to download media: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
```

---

## 5. TwiML Responses

### Current Implementation

```typescript
return c.text('<Response></Response>', 200, { 'Content-Type': 'text/xml' });
```

### Issues

**MEDIUM -- Hand-written TwiML instead of using the SDK's `MessagingResponse` builder.** This works for an empty response, but is fragile and error-prone if you ever need to add reply messages. The SDK provides a proper builder that handles XML escaping, encoding declaration, and nested elements.

**LOW -- Missing XML declaration.** Twilio expects `<?xml version="1.0" encoding="UTF-8"?>` before the `<Response>` tag. The SDK's `toString()` method includes this automatically.

**MEDIUM -- No TwiML response on error.** When the catch block fires, the handler still returns the empty `<Response>` TwiML. This is actually fine (Twilio won't retry), but the 200 status code masks errors in monitoring. Consider logging structured errors.

### Fix

```typescript
import twilio from 'twilio';
const { MessagingResponse } = twilio.twiml;

// Empty response (acknowledge receipt, no reply SMS)
const twiml = new MessagingResponse();
return c.text(twiml.toString(), 200, { 'Content-Type': 'text/xml' });

// Response with a reply message
const twiml = new MessagingResponse();
twiml.message('Thanks, we received your message!');
return c.text(twiml.toString(), 200, { 'Content-Type': 'text/xml' });

// Response with media
const twiml = new MessagingResponse();
const msg = twiml.message();
msg.body('Here is your receipt');
msg.media('https://example.com/receipt.pdf');
return c.text(twiml.toString(), 200, { 'Content-Type': 'text/xml' });
```

---

## 6. MMS / Media URL Handling

### Current Implementation

Media URLs are collected and passed to `storeMessage()`:

```typescript
await storeMessage(task.id, 'inbound', messageBody, mediaUrls);
```

### Issues

**MEDIUM -- No media downloading or persistence.** The raw Twilio media URLs (`https://api.twilio.com/2010-04-01/Accounts/.../Messages/.../Media/...`) are transient. If you delete the message from Twilio (or Twilio rotates storage), these URLs break. You should download and store media in your own storage (S3, R2, local disk).

**LOW -- No content type tracking.** As noted in section 4, `MediaContentType` is not captured.

**INFO -- No media cleanup from Twilio.** After downloading, delete media from Twilio to avoid storage charges:

```typescript
const client = getTwilioClient();
const messageSid = body['MessageSid'] as string;
for (let i = 0; i < numMedia; i++) {
  const mediaUrl = body[`MediaUrl${i}`] as string;
  const mediaSid = mediaUrl.split('/').pop()!;
  await client.messages(messageSid).media(mediaSid).remove();
}
```

---

## Summary Table

| Area | Severity | Issue |
|------|----------|-------|
| Client creation | MEDIUM | Client re-created on every `sendSms()` call |
| Sending messages | LOW | Return value (SID) discarded; no Twilio-specific error handling |
| Signature validation | **CRITICAL** | `c.req.url` likely mismatches Twilio's signed URL behind proxy/LB |
| Signature validation | MEDIUM | Validation silently skipped when auth token missing |
| Body parsing | LOW | `MediaContentType` not extracted |
| Body parsing | INFO | Media URLs require auth to fetch |
| TwiML response | MEDIUM | Hand-written XML instead of SDK `MessagingResponse` builder |
| TwiML response | LOW | Missing XML declaration |
| Media handling | MEDIUM | Raw Twilio URLs stored without downloading; will break over time |
| Media handling | INFO | No cleanup of media from Twilio servers |

---

## Recommended Priority

1. **Fix signature validation URL** (CRITICAL) -- add `WEBHOOK_BASE_URL` env var and use it for validation
2. **Use `MessagingResponse` builder** for TwiML (MEDIUM) -- small change, eliminates a class of bugs
3. **Singleton Twilio client** (MEDIUM) -- simple refactor, improves performance
4. **Enforce auth token presence in production** (MEDIUM) -- prevent silent security bypass
5. **Download and persist media** (MEDIUM) -- URLs are not permanent
6. **Capture `MediaContentType`** (LOW) -- needed for proper media handling
7. **Log message SIDs and use Twilio error types** (LOW) -- improves debugging
