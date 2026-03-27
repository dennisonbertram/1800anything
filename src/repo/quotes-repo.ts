import { query, queryOne } from "./db.js";
import type { Quote } from "../domain/types.js";

type QuoteRow = {
  id: string;
  task_id: string;
  provider_contact_id: string;
  price_text: string | null;
  availability_text: string | null;
  raw_message: string | null;
  normalized: Record<string, unknown>;
  created_at: Date;
};

function mapRow(row: QuoteRow): Quote {
  return {
    id: row.id,
    taskId: row.task_id,
    providerContactId: row.provider_contact_id,
    priceText: row.price_text,
    availabilityText: row.availability_text,
    rawMessage: row.raw_message,
    normalized: row.normalized,
    createdAt: row.created_at,
  };
}

export async function createQuote(input: {
  taskId: string;
  providerContactId: string;
  priceText: string | null;
  availabilityText: string | null;
  rawMessage: string | null;
  normalized: Record<string, unknown>;
}): Promise<Quote> {
  const rows = await query<QuoteRow>(
    `insert into quotes (task_id, provider_contact_id, price_text, availability_text, raw_message, normalized)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning *`,
    [
      input.taskId,
      input.providerContactId,
      input.priceText,
      input.availabilityText,
      input.rawMessage,
      JSON.stringify(input.normalized),
    ]
  );
  return mapRow(rows[0]!);
}

export async function listQuotesForTask(taskId: string): Promise<Quote[]> {
  const rows = await query<QuoteRow>(
    "select * from quotes where task_id = $1 order by created_at asc",
    [taskId]
  );
  return rows.map(mapRow);
}

export async function countQuotesForTask(taskId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    "select count(*) as count from quotes where task_id = $1",
    [taskId]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

export async function getQuoteById(id: string): Promise<Quote | null> {
  const row = await queryOne<QuoteRow>(
    "select * from quotes where id = $1",
    [id]
  );
  return row ? mapRow(row) : null;
}
