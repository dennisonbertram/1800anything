import type { TaskStatus } from "./types.js";

export const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  intake: ["needs_user_clarification", "ready_to_source"],
  needs_user_clarification: ["intake", "ready_to_source"],
  ready_to_source: ["sourcing_providers"],
  sourcing_providers: ["waiting_for_provider_quotes"],
  waiting_for_provider_quotes: ["quotes_ready", "failed"],
  quotes_ready: ["waiting_for_user_selection"],
  waiting_for_user_selection: ["waiting_for_payment"],
  waiting_for_payment: ["provider_confirmed", "failed"],
  provider_confirmed: ["completed"],
  completed: [],
  failed: [],
};

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["completed", "failed"];

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
