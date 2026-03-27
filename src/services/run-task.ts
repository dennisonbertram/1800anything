import { getTaskById } from "../repo/tasks-repo.js";
import { logger } from "../utils/logger.js";
import { handleIntake } from "./handlers/handle-intake.js";
import { handleNeedsUserClarification } from "./handlers/handle-needs-user-clarification.js";
import { handleReadyToSource } from "./handlers/handle-ready-to-source.js";
import { handleSourcingProviders } from "./handlers/handle-sourcing-providers.js";
import { handleWaitingForProviderQuotes } from "./handlers/handle-waiting-for-provider-quotes.js";
import { handleQuotesReady } from "./handlers/handle-quotes-ready.js";
import { handleWaitingForUserSelection } from "./handlers/handle-waiting-for-user-selection.js";
import { handleWaitingForPayment } from "./handlers/handle-waiting-for-payment.js";
import { handleProviderConfirmed } from "./handlers/handle-provider-confirmed.js";

export async function runTask(taskId: string): Promise<void> {
  const task = await getTaskById(taskId);
  if (!task) {
    logger.warn(`[run-task] Task not found: ${taskId}`);
    return;
  }

  logger.info(`[run-task] Processing task ${taskId} (status: ${task.status})`);

  switch (task.status) {
    case "intake":
      await handleIntake(task);
      return;
    case "needs_user_clarification":
      await handleNeedsUserClarification(task);
      return;
    case "ready_to_source":
      await handleReadyToSource(task);
      return;
    case "sourcing_providers":
      await handleSourcingProviders(task);
      return;
    case "waiting_for_provider_quotes":
      await handleWaitingForProviderQuotes(task);
      return;
    case "quotes_ready":
      await handleQuotesReady(task);
      return;
    case "waiting_for_user_selection":
      await handleWaitingForUserSelection(task);
      return;
    case "waiting_for_payment":
      await handleWaitingForPayment(task);
      return;
    case "provider_confirmed":
      await handleProviderConfirmed(task);
      return;
    default:
      return;
  }
}
