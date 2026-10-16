import type { RecType } from "@/agent/lib/types";

// One authored line set: 24-unit grid, 1.6 stroke, round caps, currentColor. Decorative: labels carry the meaning.
const PATHS: Record<RecType | "heart" | "check", string> = {
  album: "M9 18V6l11-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  song: "M9 18V6l11-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  artist: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4.5 20a7.5 7.5 0 0 1 15 0",
  book: "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z",
  place: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  podcast: "M12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M11 21l.6-6h.8l.6 6 M7.8 15.2a6 6 0 1 1 8.4 0 M5 18a10 10 0 1 1 14 0",
  film_tv: "M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z M4 9l1.2-4.4 15 4 M8.5 5.8 10 9.6 M13.5 7.1 15 10.6",
  other: "M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M14 3v4h4 M9 12h6 M9 16h4",
  heart: "M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z",
  check: "M5 12.5l4.5 4.5L19 7.5",
};

export function Icon({ name, size = 16, className }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
