export type TaskState =
  | 'intake'
  | 'clarifying'
  | 'sourcing'
  | 'quoting'
  | 'awaiting_selection'
  | 'awaiting_payment'
  | 'completed';

export type MessageDirection = 'inbound' | 'outbound';

export interface User {
  id: string;
  phone_number: string;
  created_at: Date;
}

export interface Task {
  id: string;
  user_id: string;
  state: TaskState;
  location: string | null;
  description: string;
  selected_quote_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  task_id: string;
  direction: MessageDirection;
  content: string;
  media_urls: string[];
  created_at: Date;
}

export interface Provider {
  id: string;
  name: string;
  phone_number: string;
  source: string;
  created_at: Date;
}

export interface Quote {
  id: string;
  task_id: string;
  provider_id: string;
  price: string | null;
  availability: string | null;
  raw_message: string | null;
  created_at: Date;
}

export interface ExtractedData {
  description: string;
  location: string | null;
  has_enough_info: boolean;
  missing_fields: string[];
}

export interface ParsedQuote {
  price: string | null;
  availability: string | null;
}
