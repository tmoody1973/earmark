// Bee todo/fact changes arrive here from /v1/changes. M3 (todo two-way sync) and M5 (fact proposals)
// replace these bodies; keep the signatures. Handlers must be idempotent: a failed batch is replayed.
export async function handleTodoChange(id: number): Promise<void> {
  void id;
}

export async function handleFactChange(id: number): Promise<void> {
  void id;
}
