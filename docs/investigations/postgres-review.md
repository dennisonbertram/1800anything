# node-postgres (pg) Implementation Review

**Date:** 2026-03-27
**Files reviewed:**
- `src/db/client.ts`
- `src/services/taskService.ts`
- `src/types.ts`

**Reference:** node-postgres official documentation via Context7 (`/brianc/node-postgres`)

---

## Summary

The current implementation is functional and gets several things right (parameterized queries, TypeScript generics on `query()`), but has **5 issues** ranging from a potential crash in production to missing cleanup and suboptimal Pool configuration.

---

## Issue 1: Missing `pool.on('error')` handler -- CRITICAL

**Problem:** The Pool has no error listener. When an idle client receives an error (e.g., Postgres restarts, network partition), node emits an `'error'` event. With no listener attached, this becomes an **uncaught exception that crashes the process**.

From the docs:
> "It is supplied the error as well as the idle client which received the error. Handle this in the same way you would treat `process.on('uncaughtException')`."

**Current code:**
```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// No error handler
```

**Fix:**
```ts
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  // Optionally: process.exit(-1) if you want fail-fast,
  // or let your process manager restart the service
});
```

---

## Issue 2: No Pool configuration beyond `connectionString` -- HIGH

**Problem:** The Pool is created with zero tuning. The defaults (`max: 10`, no timeouts) are often inadequate for production. Missing settings:

| Setting | Default | Recommendation |
|---|---|---|
| `max` | 10 | Set based on expected concurrency and Postgres `max_connections` |
| `idleTimeoutMillis` | 10000 | 30000 is common; prevents stale connections |
| `connectionTimeoutMillis` | 0 (infinite) | Set to 2000-5000ms to fail fast on connection issues |
| `maxLifetimeSeconds` | 0 (disabled) | Set to 60-300 to rotate connections and avoid issues with PgBouncer / cloud proxies |
| `allowExitOnIdle` | false | Set to `true` if this is a short-lived script/worker |

**Fix:**
```ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  maxLifetimeSeconds: 300,
});
```

---

## Issue 3: No graceful shutdown -- HIGH

**Problem:** There is no call to `pool.end()` on process termination. Open connections will be abandoned, which can exhaust Postgres connection slots over repeated deploys or restarts.

**Fix -- add to `client.ts`:**
```ts
async function shutdown() {
  console.log('Draining Postgres pool...');
  await pool.end();
  console.log('Pool drained.');
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { pool, shutdown };
```

---

## Issue 4: `updateTask` has a read-then-write race condition -- MEDIUM

**Problem:** `updateTask` reads the current state with one `pool.query()` call, then writes with another. Because `pool.query()` checks out a *different* client for each call, there is no transactional isolation. Two concurrent updates could both read the same state and both proceed.

The pg docs are explicit:
> "Do not use `pool.query` if you are using a transaction."

**Current code (simplified):**
```ts
// Two separate pool.query calls -- no shared transaction
const currentResult = await query('SELECT state FROM tasks WHERE id = $1', [taskId]);
// ... validation ...
const result = await query('UPDATE tasks SET ... WHERE id = $2 RETURNING *', params);
```

**Fix -- use an explicit client with a transaction:**
```ts
export async function updateTask(
  taskId: string,
  updates: Partial<Pick<Task, 'state' | 'location' | 'description' | 'selected_quote_id'>>
): Promise<Task> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (updates.state !== undefined) {
      const currentResult = await client.query<Task>(
        'SELECT state FROM tasks WHERE id = $1 FOR UPDATE',  // row-level lock
        [taskId]
      );
      const currentState = currentResult.rows[0]?.state;
      if (currentState !== undefined) {
        const allowed = VALID_TRANSITIONS[currentState] ?? [];
        if (!allowed.includes(updates.state)) {
          console.warn(
            `[taskService] WARN: Invalid state transition ${currentState} -> ${updates.state} for task ${taskId}`
          );
        }
      }
    }

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.state !== undefined) {
      setClauses.push(`state = $${paramIndex}`);
      params.push(updates.state);
      paramIndex++;
    }
    if (updates.location !== undefined) {
      setClauses.push(`location = $${paramIndex}`);
      params.push(updates.location);
      paramIndex++;
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex}`);
      params.push(updates.description);
      paramIndex++;
    }
    if (updates.selected_quote_id !== undefined) {
      setClauses.push(`selected_quote_id = $${paramIndex}`);
      params.push(updates.selected_quote_id);
      paramIndex++;
    }

    params.push(taskId);
    const result = await client.query<Task>(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
```

Note: this requires exporting `pool` from `client.ts` (already done) and importing it in `taskService.ts`.

---

## Issue 5: TypeScript interfaces don't extend `QueryResultRow` -- LOW

**Problem:** The generic constraint on `query<T>` is `T extends pg.QueryResultRow`, which is correct. However, the interfaces in `types.ts` (`User`, `Task`, `Message`) don't explicitly extend `pg.QueryResultRow`. This works today because `QueryResultRow` is `{ [column: string]: any }` and TypeScript structurally matches it, but it's fragile -- if an interface ever has an index signature conflict, the compiler won't catch it until call sites break.

**Recommendation:** Either leave as-is (acceptable since structural typing handles it) or explicitly mark your DB row types:

```ts
import type pg from 'pg';

export interface User extends pg.QueryResultRow {
  id: string;
  phone_number: string;
  created_at: Date;
}
```

This is optional but makes intent explicit.

---

## What the implementation gets RIGHT

- **Parameterized queries everywhere** -- all user input goes through `$1`, `$2`, etc. No string interpolation. This prevents SQL injection.
- **TypeScript generics on the query wrapper** -- `query<T extends pg.QueryResultRow>` gives typed `result.rows[0]` at every call site.
- **`pool.query()` for simple single-statement operations** -- this is the recommended pattern per the docs. Client checkout/release is handled automatically.
- **Nullish coalescing (`?? null`)** on `findActiveTask` -- correctly handles empty result sets.
- **Dynamic SET clause builder** in `updateTask` -- properly uses parameterized indices (`$1`, `$2`, ...) instead of string interpolation.

---

## Recommended final `src/db/client.ts`

```ts
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  maxLifetimeSeconds: 300,
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

async function shutdown() {
  console.log('Draining Postgres pool...');
  await pool.end();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { pool, shutdown };
```

---

## Priority summary

| # | Issue | Severity | Effort |
|---|---|---|---|
| 1 | Missing `pool.on('error')` | CRITICAL | 2 min |
| 2 | No Pool config tuning | HIGH | 5 min |
| 3 | No graceful shutdown | HIGH | 5 min |
| 4 | Race condition in `updateTask` | MEDIUM | 15 min |
| 5 | Types don't extend `QueryResultRow` | LOW | Optional |
