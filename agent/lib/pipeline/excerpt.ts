// Same rule as the SQL word_count() check in migration 001, so code and database agree.
export function wordCount(text: string): number {
  const s = text.trim();
  return s ? s.split(/\s+/).length : 0;
}

// No ellipsis: an added "…" would count as a 26th word in the database check.
export function clampExcerpt(text: string, maxWords = 25): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}
