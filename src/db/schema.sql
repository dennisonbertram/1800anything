CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE task_state AS ENUM (
  'intake', 'clarifying', 'sourcing', 'quoting', 'awaiting_selection', 'awaiting_payment', 'completed'
);

CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  state task_state NOT NULL DEFAULT 'intake',
  location TEXT,
  description TEXT NOT NULL DEFAULT '',
  selected_quote_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id),
  direction message_direction NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  media_urls JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id),
  provider_id UUID NOT NULL REFERENCES providers(id),
  price TEXT,
  availability TEXT,
  raw_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE task_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id),
  provider_id UUID NOT NULL REFERENCES providers(id),
  contacted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, provider_id)
);

-- Add FK for selected_quote_id after quotes table exists
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_selected_quote
  FOREIGN KEY (selected_quote_id) REFERENCES quotes(id);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_state ON tasks(state);
CREATE INDEX idx_messages_task_id ON messages(task_id);
CREATE INDEX idx_quotes_task_id ON quotes(task_id);
CREATE INDEX idx_task_providers_provider ON task_providers(provider_id);
