import { query } from '../db/client.js';
import type { User, Task, Message, MessageDirection, TaskState } from '../types.js';

// FIX 7: Valid state transitions — warns on invalid but does not throw for v1
const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  intake: ['clarifying', 'sourcing'],
  clarifying: ['sourcing', 'clarifying'],
  sourcing: ['quoting'],
  quoting: ['awaiting_selection'],
  awaiting_selection: ['awaiting_payment', 'completed'],
  awaiting_payment: ['completed'],
  completed: [],
};

export async function findOrCreateUser(phoneNumber: string): Promise<User> {
  console.log(`[taskService] findOrCreateUser: ${phoneNumber}`);
  const result = await query<User>(
    `INSERT INTO users (phone_number)
     VALUES ($1)
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING *`,
    [phoneNumber]
  );
  return result.rows[0];
}

export async function findActiveTask(userId: string): Promise<Task | null> {
  console.log(`[taskService] findActiveTask for user: ${userId}`);
  const result = await query<Task>(
    `SELECT * FROM tasks
     WHERE user_id = $1 AND state != 'completed'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function createTask(userId: string): Promise<Task> {
  console.log(`[taskService] createTask for user: ${userId}`);
  const result = await query<Task>(
    `INSERT INTO tasks (user_id, state)
     VALUES ($1, 'intake')
     RETURNING *`,
    [userId]
  );
  return result.rows[0];
}

export async function updateTask(
  taskId: string,
  updates: Partial<Pick<Task, 'state' | 'location' | 'description' | 'selected_quote_id'>>
): Promise<Task> {
  console.log(`[taskService] updateTask: ${taskId}`, updates);

  // FIX 7: Validate state transitions (warn only — do not throw for v1)
  if (updates.state !== undefined) {
    const currentResult = await query<Task>('SELECT state FROM tasks WHERE id = $1', [taskId]);
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

  const result = await query<Task>(
    `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params
  );
  return result.rows[0];
}

export async function storeMessage(
  taskId: string,
  direction: MessageDirection,
  content: string,
  mediaUrls: string[] = []
): Promise<Message> {
  console.log(`[taskService] storeMessage: task=${taskId} direction=${direction}`);
  const result = await query<Message>(
    `INSERT INTO messages (task_id, direction, content, media_urls)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [taskId, direction, content, JSON.stringify(mediaUrls)]
  );
  return result.rows[0];
}

export async function getMessages(taskId: string): Promise<Message[]> {
  console.log(`[taskService] getMessages: task=${taskId}`);
  const result = await query<Message>(
    `SELECT * FROM messages WHERE task_id = $1 ORDER BY created_at ASC`,
    [taskId]
  );
  return result.rows;
}
