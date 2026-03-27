create extension if not exists pgcrypto;

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  kind text not null check (kind in ('user', 'provider')),
  name text,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_contact_id uuid not null references contacts(id),
  status text not null default 'intake',
  service_type text,
  location_text text,
  structured_data jsonb not null default '{}'::jsonb,
  selected_quote_id uuid,
  payment_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token text
);

create table if not exists task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  contact_id uuid not null references contacts(id),
  direction text not null check (direction in ('inbound', 'outbound')),
  channel text not null default 'sms',
  body text,
  media jsonb not null default '[]'::jsonb,
  external_id text,
  created_at timestamptz not null default now()
);

create table if not exists provider_outreach (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  provider_contact_id uuid not null references contacts(id),
  status text not null default 'sent',
  last_message_id uuid references messages(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  provider_contact_id uuid not null references contacts(id),
  price_text text,
  availability_text text,
  raw_message text,
  normalized jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  stripe_payment_link_id text,
  stripe_session_id text,
  amount_cents integer,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_tasks_user_contact on tasks(user_contact_id);
create index if not exists idx_messages_task_id on messages(task_id);
create index if not exists idx_messages_contact_id on messages(contact_id);
create index if not exists idx_quotes_task_id on quotes(task_id);
create index if not exists idx_provider_outreach_task_id on provider_outreach(task_id);
create index if not exists idx_provider_outreach_provider on provider_outreach(provider_contact_id);
create index if not exists idx_payments_task_id on payments(task_id);
