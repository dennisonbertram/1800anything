import { query, queryOne } from "./db.js";
import type { TaskMessage } from "../domain/types.js";

type MessageRow = {
  id: string;
  task_id: string;
  contact_id: string;
  direction: "inbound" | "outbound";
  channel: string;
  body: string | null;
  media: Array<{ url: string; contentType: string }>;
  external_id: string | null;
  created_at: Date;
};

function mapRow(row: MessageRow): TaskMessage {
  return {
    id: row.id,
    taskId: row.task_id,
    contactId: row.contact_id,
    direction: row.direction,
    channel: row.channel,
    body: row.body,
    media: row.media,
    externalId: row.external_id,
    createdAt: row.created_at,
  };
}

export async function createMessage(input: {
  taskId: string;
  contactId: string;
  direction: "inbound" | "outbound";
  body: string | null;
  media: Array<{ url: string; contentType: string }>;
  externalId?: string | null;
}): Promise<TaskMessage> {
  const rows = await query<MessageRow>(
    `insert into messages (task_id, contact_id, direction, body, media, external_id)
     values ($1, $2, $3, $4, $5::jsonb, $6)
     returning *`,
    [
      input.taskId,
      input.contactId,
      input.direction,
      input.body,
      JSON.stringify(input.media),
      input.externalId ?? null,
    ]
  );
  return mapRow(rows[0]!);
}

export async function listMessagesForTask(taskId: string): Promise<TaskMessage[]> {
  const rows = await query<MessageRow>(
    "select * from messages where task_id = $1 order by created_at asc",
    [taskId]
  );
  return rows.map(mapRow);
}

export async function getLatestInboundMessage(taskId: string, contactId?: string): Promise<TaskMessage | null> {
  const sql = contactId
    ? "select * from messages where task_id = $1 and contact_id = $2 and direction = 'inbound' order by created_at desc limit 1"
    : "select * from messages where task_id = $1 and direction = 'inbound' order by created_at desc limit 1";
  const params = contactId ? [taskId, contactId] : [taskId];
  const row = await queryOne<MessageRow>(sql, params);
  return row ? mapRow(row) : null;
}

export async function getLatestOutboundMessage(taskId: string): Promise<TaskMessage | null> {
  const row = await queryOne<MessageRow>(
    "select * from messages where task_id = $1 and direction = 'outbound' order by created_at desc limit 1",
    [taskId]
  );
  return row ? mapRow(row) : null;
}
