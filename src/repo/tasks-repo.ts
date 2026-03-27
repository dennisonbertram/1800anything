import { query, queryOne, execute } from "./db.js";
import type { ServiceType, Task, TaskStatus } from "../domain/types.js";
import { VALID_TRANSITIONS } from "../domain/task-state-machine.js";
import { logger } from "../utils/logger.js";

type TaskRow = {
  id: string;
  user_contact_id: string;
  status: TaskStatus;
  service_type: ServiceType | null;
  location_text: string | null;
  structured_data: Record<string, unknown>;
  selected_quote_id: string | null;
  payment_status: string | null;
  created_at: Date;
  updated_at: Date;
  locked_at: Date | null;
  lock_token: string | null;
};

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    userContactId: row.user_contact_id,
    status: row.status,
    serviceType: row.service_type,
    locationText: row.location_text,
    structuredData: row.structured_data,
    selectedQuoteId: row.selected_quote_id,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lockedAt: row.locked_at,
    lockToken: row.lock_token,
  };
}

export async function createTask(userContactId: string): Promise<Task> {
  const rows = await query<TaskRow>(
    `insert into tasks (user_contact_id, status)
     values ($1, 'intake')
     returning *`,
    [userContactId]
  );
  return mapRow(rows[0]!);
}

export async function findOpenTaskForUser(userContactId: string): Promise<Task | null> {
  const row = await queryOne<TaskRow>(
    `select * from tasks
     where user_contact_id = $1
       and status not in ('completed', 'failed')
     order by created_at desc
     limit 1`,
    [userContactId]
  );
  return row ? mapRow(row) : null;
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const row = await queryOne<TaskRow>(
    "select * from tasks where id = $1",
    [taskId]
  );
  return row ? mapRow(row) : null;
}

export async function updateTaskStatus(taskId: string, newStatus: TaskStatus): Promise<boolean> {
  // Compute which states can transition TO newStatus
  const validFromStates: string[] = [];
  for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
    if ((targets as readonly string[]).includes(newStatus)) {
      validFromStates.push(from);
    }
  }

  if (validFromStates.length === 0) {
    logger.warn(`[tasks-repo] No valid source states for target: ${newStatus}`);
    return false;
  }

  const result = await execute(
    `update tasks set status = $2, updated_at = now()
     where id = $1 and status = any($3::text[])`,
    [taskId, newStatus, validFromStates]
  );

  if (result.rowCount === 0) {
    logger.warn(`[tasks-repo] Transition to '${newStatus}' failed for task ${taskId} — current status not in valid sources`);
    return false;
  }

  return true;
}

export async function updateTaskExtraction(
  taskId: string,
  data: {
    serviceType: ServiceType;
    locationText: string | null;
    structuredData: Record<string, unknown>;
  }
): Promise<void> {
  await query(
    `update tasks
     set service_type = $2,
         location_text = $3,
         structured_data = $4::jsonb,
         updated_at = now()
     where id = $1`,
    [taskId, data.serviceType, data.locationText, JSON.stringify(data.structuredData)]
  );
}

export async function setSelectedQuote(taskId: string, quoteId: string): Promise<void> {
  await query(
    "update tasks set selected_quote_id = $2, updated_at = now() where id = $1",
    [taskId, quoteId]
  );
}

export async function claimRunnableTask(): Promise<Task | null> {
  const rows = await query<TaskRow>(`
    update tasks
    set locked_at = now(), lock_token = gen_random_uuid()::text
    where id = (
      select id
      from tasks
      where status not in ('completed', 'failed')
        and (locked_at is null or locked_at < now() - interval '30 seconds')
      order by updated_at asc
      limit 1
      for update skip locked
    )
    returning *
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function releaseTaskLock(taskId: string): Promise<void> {
  await query(
    "update tasks set locked_at = null, lock_token = null where id = $1",
    [taskId]
  );
}

export async function addTaskEvent(taskId: string, type: string, payload: Record<string, unknown> = {}): Promise<void> {
  await query(
    "insert into task_events (task_id, type, payload) values ($1, $2, $3::jsonb)",
    [taskId, type, JSON.stringify(payload)]
  );
}
