export type ContactKind = "user" | "provider";

export type TaskStatus =
  | "intake"
  | "needs_user_clarification"
  | "ready_to_source"
  | "sourcing_providers"
  | "waiting_for_provider_quotes"
  | "quotes_ready"
  | "waiting_for_user_selection"
  | "waiting_for_payment"
  | "provider_confirmed"
  | "completed"
  | "failed";

export type ServiceType =
  | "plumber"
  | "electrician"
  | "handyman"
  | "cleaner"
  | "junk_removal"
  | "unknown";

export interface Contact {
  id: string;
  phone: string;
  kind: ContactKind;
  name: string | null;
  createdAt: Date;
}

export interface Task {
  id: string;
  userContactId: string;
  status: TaskStatus;
  serviceType: ServiceType | null;
  locationText: string | null;
  structuredData: Record<string, unknown>;
  selectedQuoteId: string | null;
  paymentStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockedAt: Date | null;
  lockToken: string | null;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  contactId: string;
  direction: "inbound" | "outbound";
  channel: string;
  body: string | null;
  media: Array<{ url: string; contentType: string }>;
  externalId: string | null;
  createdAt: Date;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface Quote {
  id: string;
  taskId: string;
  providerContactId: string;
  priceText: string | null;
  availabilityText: string | null;
  rawMessage: string | null;
  normalized: Record<string, unknown>;
  createdAt: Date;
}

export interface ProviderOutreach {
  id: string;
  taskId: string;
  providerContactId: string;
  status: string;
  lastMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Payment {
  id: string;
  taskId: string;
  stripePaymentLinkId: string | null;
  stripeSessionId: string | null;
  amountCents: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntakeExtraction {
  serviceType: ServiceType;
  description: string | null;
  locationText: string | null;
  needsClarification: boolean;
  clarificationQuestion: string | null;
}

export interface QuoteExtraction {
  priceText: string | null;
  availabilityText: string | null;
}
