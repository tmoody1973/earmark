// What the Maybe? row's live region says after a tap (decision 025). `result` null: the save failed.
export type MaybeChoice = "keep" | "drop";

export function verdictMessage(choice: MaybeChoice, name: string, result: { changed: boolean } | null): string {
  if (!result) return `Couldn't save that. ${name} is back in Maybe; try again.`;
  if (!result.changed) return `Already handled: ${name}`;
  return `${choice === "keep" ? "Kept" : "Removed"}: ${name}`;
}
