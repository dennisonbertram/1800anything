import { query, queryOne } from "./db.js";
import type { Contact, ContactKind } from "../domain/types.js";

type ContactRow = {
  id: string;
  phone: string;
  kind: ContactKind;
  name: string | null;
  created_at: Date;
};

function mapRow(row: ContactRow): Contact {
  return {
    id: row.id,
    phone: row.phone,
    kind: row.kind,
    name: row.name,
    createdAt: row.created_at,
  };
}

export async function findContactByPhone(phone: string): Promise<Contact | null> {
  const row = await queryOne<ContactRow>(
    "select * from contacts where phone = $1 limit 1",
    [phone]
  );
  return row ? mapRow(row) : null;
}

export async function findContactById(id: string): Promise<Contact | null> {
  const row = await queryOne<ContactRow>(
    "select * from contacts where id = $1",
    [id]
  );
  return row ? mapRow(row) : null;
}

export async function findOrCreateContact(phone: string, kind: ContactKind, name?: string): Promise<Contact> {
  const rows = await query<ContactRow>(
    `insert into contacts (phone, kind, name)
     values ($1, $2, $3)
     on conflict (phone) do update set phone = excluded.phone
     returning *`,
    [phone, kind, name ?? null]
  );
  return mapRow(rows[0]!);
}
