import { query, queryOne } from "./db.js";
import type { ProviderOutreach } from "../domain/types.js";

type OutreachRow = {
  id: string;
  task_id: string;
  provider_contact_id: string;
  status: string;
  last_message_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: OutreachRow): ProviderOutreach {
  return {
    id: row.id,
    taskId: row.task_id,
    providerContactId: row.provider_contact_id,
    status: row.status,
    lastMessageId: row.last_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createProviderOutreach(
  taskId: string,
  providerContactId: string,
  lastMessageId?: string
): Promise<ProviderOutreach> {
  const rows = await query<OutreachRow>(
    `insert into provider_outreach (task_id, provider_contact_id, status, last_message_id)
     values ($1, $2, 'sent', $3)
     returning *`,
    [taskId, providerContactId, lastMessageId ?? null]
  );
  return mapRow(rows[0]!);
}

export async function findRecentOutreachByProvider(providerContactId: string): Promise<ProviderOutreach | null> {
  const row = await queryOne<OutreachRow>(
    `select * from provider_outreach
     where provider_contact_id = $1
     order by created_at desc
     limit 1`,
    [providerContactId]
  );
  return row ? mapRow(row) : null;
}

export async function listOutreachForTask(taskId: string): Promise<ProviderOutreach[]> {
  const rows = await query<OutreachRow>(
    "select * from provider_outreach where task_id = $1",
    [taskId]
  );
  return rows.map(mapRow);
}
