const pendingTaskIds = new Set<string>();

export function enqueueTask(taskId: string): void {
  pendingTaskIds.add(taskId);
}

export function drainQueuedTaskIds(): string[] {
  const ids = [...pendingTaskIds];
  pendingTaskIds.clear();
  return ids;
}
