import type { TranscriptWindow, Utterance } from "../types";

// Short windows keep Jev accurate (jev-1.13 jaggedness: irrelevant context lowers accuracy).
export function toWindows(
  utterances: Utterance[],
  ctx: { conversationId: number | null; conversationUuid: string | null },
  opts: { size?: number; stride?: number } = {},
): TranscriptWindow[] {
  const size = opts.size ?? 4;
  const stride = opts.stride ?? 2;
  if (!Number.isInteger(size) || !Number.isInteger(stride) || size < 1 || stride < 1 || stride > size) {
    throw new RangeError("toWindows: size and stride must be integers with 1 <= stride <= size");
  }
  const clean = utterances.filter((x) => x.text.trim());
  const windows: TranscriptWindow[] = [];
  for (let start = 0; start < clean.length; start += stride) {
    const slice = clean.slice(start, start + size);
    windows.push({
      ...ctx,
      utterances: slice,
      text: slice.map((x) => `${x.speaker?.trim() || "Unknown"}: ${x.text.trim().replace(/\s+/g, " ")}`).join("\n"),
      startedAt: slice.find((x) => x.spokenAt)?.spokenAt ?? null,
    });
    if (start + size >= clean.length) break;
  }
  return windows;
}
