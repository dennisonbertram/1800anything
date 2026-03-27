# Hono Framework Review: 1800anything

**Date:** 2026-03-27
**Scope:** `src/server.ts`, `src/routes/twilio.ts`
**Hono version:** `^4.0.0` / `@hono/node-server ^1.0.0`

---

## 1. `serve()` call — Incorrect invocation

**File:** `src/server.ts:14`

**Current code:**
```ts
serve({ fetch: app.fetch, port });
```

**Issue:** In modern `@hono/node-server`, you pass the Hono app directly instead of manually extracting `app.fetch`. Passing `{ fetch: app.fetch }` detaches the fetch method from the Hono instance, which can cause subtle `this`-binding issues. The docs show passing the app directly.

**Fix:**
```ts
serve({ fetch: app.fetch, port });
// Replace with:
serve(app);
// Or if you need port config:
const server = serve({ fetch: app.fetch, port });
```

Both forms work, but the simpler `serve(app)` is the canonical pattern. If you need to set the port, the object form `{ fetch: app.fetch, port }` is correct — but you should also capture the return value for graceful shutdown:

```ts
const server = serve({ fetch: app.fetch, port });

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
```

**Severity:** Low (functional, but missing graceful shutdown)

---

## 2. Missing `app.onError()` global error handler

**File:** `src/server.ts`

**Issue:** There is no global error handler. If any route throws an unhandled error, Hono's default behavior returns a generic 500 response. The Twilio route has its own try/catch, but any future routes would be unprotected.

**Fix — add to `src/server.ts`:**
```ts
app.onError((err, c) => {
  console.error('[server] Unhandled error:', err);
  return c.text('Internal Server Error', 500);
});
```

If both the parent app and a sub-app have `onError`, the sub-app's handler takes priority, so this serves as a safety net.

**Severity:** Medium — webhook reliability depends on never returning unexpected responses.

---

## 3. `app.route('/', twilioRoutes)` — Base path should be meaningful

**File:** `src/server.ts:10`

**Current code:**
```ts
app.route('/', twilioRoutes);
```

**Issue:** Hono best practices recommend using `app.route()` with a meaningful prefix path for sub-applications, not `/`. From the docs:

```ts
// Recommended pattern
app.route('/authors', authors);
app.route('/books', books);
```

Mounting at `/` works, but it defeats the purpose of route grouping. Since the twilio routes define `/webhook/twilio`, the path already includes a prefix, so this is functional but unconventional.

**Better approach — pick one pattern:**

Option A — Keep prefix in sub-app (current, acceptable):
```ts
// server.ts
app.route('/', twilioRoutes);
// twilio.ts defines: app.post('/webhook/twilio', ...)
```

Option B — Move prefix to mount point (recommended):
```ts
// server.ts
app.route('/webhook', twilioRoutes);
// twilio.ts defines: app.post('/twilio', ...)
```

**Severity:** Low (style/organization)

---

## 4. `c.req.parseBody()` — Correct but consider `c.req.formData()`

**File:** `src/routes/twilio.ts:29`

**Current code:**
```ts
const body = await c.req.parseBody();
```

**Issue:** `parseBody()` is a Hono convenience method that returns a key-value object. This is fine for `application/x-www-form-urlencoded` payloads like Twilio webhooks. The alternative is the Web Standard `c.req.formData()` which returns a `FormData` object.

For Twilio webhooks specifically, `parseBody()` is actually the better choice because:
- It returns a plain object, making property access simpler (`body['Body']` vs `formData.get('Body')`)
- It handles URL-encoded data cleanly

**Verdict:** Current usage is correct. No change needed.

---

## 5. `c.req.url` for Twilio signature validation — Potential bug

**File:** `src/routes/twilio.ts:35`

**Current code:**
```ts
const url = c.req.url;
```

**Issue:** `c.req.url` returns the full URL as seen by Hono, which behind a reverse proxy (Railway, Render, etc.) will be `http://localhost:3000/webhook/twilio` rather than the public URL `https://yourdomain.com/webhook/twilio`. Twilio signs requests using the **public URL** it sent the request to. This means signature validation will **always fail in production** behind a proxy.

**Fix:**
```ts
// Option 1: Use an environment variable for the canonical public URL
const publicBaseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
const url = `${publicBaseUrl}/webhook/twilio`;

// Option 2: Reconstruct from X-Forwarded-* headers (less reliable)
const proto = c.req.header('X-Forwarded-Proto') || 'http';
const host = c.req.header('X-Forwarded-Host') || c.req.header('Host') || 'localhost';
const url = `${proto}://${host}${c.req.path}`;
```

**Severity:** HIGH — Twilio signature validation is silently broken in any proxied deployment. This is a security and correctness issue.

---

## 6. Swallowed errors in webhook handler

**File:** `src/routes/twilio.ts:129-131`

**Current code:**
```ts
} catch (error) {
  console.error('[twilio] Webhook error:', error);
}

return c.text('<Response></Response>', 200, { 'Content-Type': 'text/xml' });
```

**Issue:** All errors are caught and logged, but the handler still returns 200 with an empty TwiML response. This means:
- Twilio thinks the request succeeded
- Twilio will not retry
- Failures are invisible except in logs

Depending on your intent, this may be deliberate (Twilio retries can cause duplicate processing). But if retries are desired on transient failures, you should return a 5xx.

**Recommendation:** At minimum, differentiate between expected and unexpected errors:
```ts
} catch (error) {
  console.error('[twilio] Webhook error:', error);
  // Return 500 so Twilio retries on transient failures
  return c.text('<Response></Response>', 500, { 'Content-Type': 'text/xml' });
}
```

**Severity:** Medium — depends on whether you want Twilio retry behavior.

---

## 7. TwiML response not using proper content type

**File:** `src/routes/twilio.ts:133`

**Current code:**
```ts
return c.text('<Response></Response>', 200, { 'Content-Type': 'text/xml' });
```

**Issue:** Minor — this works but is slightly unusual in Hono. The third argument to `c.text()` sets headers. A cleaner equivalent:

```ts
return c.body('<Response></Response>', 200, { 'Content-Type': 'text/xml' });
```

Or using the header method:
```ts
c.header('Content-Type', 'text/xml');
return c.body('<Response></Response>', 200);
```

**Verdict:** Current code is functionally correct. `c.text()` with a manual Content-Type override works fine in Hono 4. No change required.

---

## 8. Missing `app.notFound()` handler

**File:** `src/server.ts`

**Issue:** No custom 404 handler. Hono returns a default plain-text 404, which is fine for APIs but worth being explicit about.

**Optional improvement:**
```ts
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});
```

**Severity:** Low

---

## 9. Console.log before server starts listening

**File:** `src/server.ts:13-14`

**Current code:**
```ts
console.log(`  1800anything listening on port ${port}`);
serve({ fetch: app.fetch, port });
```

**Issue:** The log message prints *before* the server is actually listening. The `serve()` function returns a `Server` instance, and you can use its `listening` event for accurate logging. Minor but can be misleading if the port is in use.

**Severity:** Very Low

---

## Summary

| # | Issue | Severity | Action |
|---|-------|----------|--------|
| 1 | `serve()` missing graceful shutdown | Low | Add `process.on('SIGINT', ...)` |
| 2 | No global `app.onError()` | Medium | Add error handler to server.ts |
| 3 | `app.route('/')` base path | Low | Consider moving prefix to mount point |
| 4 | `parseBody()` usage | None | Correct as-is |
| 5 | **`c.req.url` for Twilio sig validation** | **HIGH** | **Use public URL from env var** |
| 6 | Swallowed errors return 200 | Medium | Consider returning 500 on failure |
| 7 | TwiML content type | None | Correct as-is |
| 8 | No `app.notFound()` handler | Low | Optional improvement |
| 9 | Premature log message | Very Low | Optional improvement |

### Priority fixes:
1. **Fix #5 is critical** — Twilio signature validation uses `c.req.url` which will be wrong behind any reverse proxy, making the security check ineffective in production.
2. **Fix #2** — Add global error handler for resilience.
3. **Fix #6** — Decide on error-swallowing strategy explicitly.
