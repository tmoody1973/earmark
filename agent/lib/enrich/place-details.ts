// Place details (decision 058): what OpenStreetMap's mappers recorded about a matched place (kind, hours, website,
// phone, menu, reservations, takeaway and the like). The rec lane fetches them ONCE (extras.ts) with one Nominatim
// /lookup?extratags=1 request and stores them on recommendations.extras.place; the page never fetches. OpenStreetMap
// data is ODbL: storing it is allowed, with "© OpenStreetMap contributors" wherever it shows (the page does).
import { TIMELINE_TZ } from "../ideas/timeline-format";
import { nominatimHeaders, nominatimSlot } from "./nominatim";
import { getJson } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */

export type Reservation = "yes" | "no" | "required" | "recommended";
export interface PlaceExtras {
  kind: string | null; // "Japanese · Restaurant"
  hours: string | null; // OSM opening_hours, kept only when parseHours understands and trusts it
  website: string | null;
  phone: string | null;
  menu: string | null;
  reservation: Reservation | null;
  reservationUrl: string | null;
  features: string[]; // "Takeaway", "Delivery", "Outdoor seating", "Wheelchair accessible"
  source?: { site: string; url: string }; // set when the details were read from a web page (decision 063); unset = OpenStreetMap
}

const RESERVATIONS: readonly string[] = ["yes", "no", "required", "recommended"];
const FEATURES: ReadonlyArray<[tag: string, label: string]> = [
  ["takeaway", "Takeaway"], ["delivery", "Delivery"], ["outdoor_seating", "Outdoor seating"], ["wheelchair", "Wheelchair accessible"],
];
const KIND_CATEGORIES = new Set(["amenity", "shop", "tourism", "leisure", "craft"]);
const PHONE = /^\+?[\d\s().-]{6,24}$/;
const OSM_LINK = /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/(\d+)$/;

const https = (v: unknown): string | null =>
  (typeof v === "string" && /^https?:\/\/\S+$/i.test(v) && URL.canParse(v) ? v.replace(/^http:/i, "https:") : null);
const words = (s: string) => s.replace(/_/g, " ").trim();
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// ---- Opening hours: the common OSM forms only ("Mo-Th 11:30-22:00; Fr,Sa 17:00-02:00", "24/7", "We off"). ----
// ponytail: no public holidays, months, sunrise or week numbers; such a value is not shown at all. Upgrade: the
// `opening_hours` npm package if mappers' fancier forms turn up on real tips.

/** Minutes since midnight [start, end); end > 1440 runs past midnight into the next day. */
export type Range = [number, number];
/** Index 0 = Sunday (Date.getDay()). */
export type Week = Range[][];

const DAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
const RULE = new RegExp(`^(?:(${DAYS}(?:-${DAYS})?(?:,${DAYS}(?:-${DAYS})?)*)\\s+)?(off|closed|\\d{2}:\\d{2}-\\d{2}:\\d{2}(?:,\\d{2}:\\d{2}-\\d{2}:\\d{2})*)$`);
const LONGEST_DAY_MIN = 16 * 60; // a span longer than this (and short of all day) is almost always a typo: "11:30-09:30"

function days(spec: string): number[] {
  return spec.split(",").flatMap((part) => {
    const [a, b] = part.split("-").map((d) => DAY.indexOf(d));
    if (b === undefined) return [a!];
    const out: number[] = [];
    for (let d = a!; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === b) return out;
    }
  });
}

function ranges(spec: string): Range[] | null {
  if (spec === "off" || spec === "closed") return [];
  const out: Range[] = [];
  for (const span of spec.split(",")) {
    const [s, e] = span.split("-").map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
    if (s! > 1440 || e! > 1440 || s === e) return null;
    const end = e! <= s! ? e! + 1440 : e!;
    if (end - s! > LONGEST_DAY_MIN && end - s! < 1440) return null;
    out.push([s!, end]);
  }
  return out;
}

/** OSM opening_hours → the week, or null for anything it doesn't understand or trust. Later rules override earlier ones. Pure. */
export function parseHours(raw: string): Week | null {
  const text = raw.trim();
  if (text === "24/7") return Array.from({ length: 7 }, () => [[0, 1440]]);
  if (!text) return null;
  const week: (Range[] | null)[] = Array(7).fill(null);
  // A comma starts a new rule only after a time ("Mo-Sa 10:00-20:00, Su 11:00-18:00"), not inside a day list ("Sa,Su").
  for (const rule of text.split(new RegExp(`;\\s*|(?<=\\d|off|closed),\\s*(?=${DAYS}\\b)`))) {
    const m = RULE.exec(rule.trim());
    const r = m ? ranges(m[2]!) : null;
    if (!m || !r) return null;
    for (const d of m[1] ? days(m[1]) : [0, 1, 2, 3, 4, 5, 6]) week[d] = r;
  }
  return week.map((r) => r ?? []);
}

const clock = (min: number) => {
  const h = Math.floor(min / 60) % 24, mm = min % 60;
  return { text: `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`, half: h < 12 ? "AM" : "PM" };
};
const at = (min: number) => `${clock(min).text} ${clock(min).half}`;
const span = ([s, e]: Range) => {
  if (e - s === 1440) return "Open 24 hours";
  const [a, b] = [clock(s), clock(e)];
  return a.half === b.half && e - s < 720 ? `${a.text}–${b.text} ${b.half}` : `${a.text} ${a.half}–${b.text} ${b.half}`;
};

/** Open right now in Milwaukee time, and until when. Pure (pass the clock). */
export function hoursNow(week: Week, now: Date, timeZone = TIMELINE_TZ): { open: boolean; until?: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const today = DAY_NAME.indexOf(get("weekday"));
  const m = Number(get("hour")) * 60 + Number(get("minute"));
  for (const [s, e] of week[today] ?? []) {
    if (e - s === 1440) return { open: true };
    if (s <= m && m < e) return { open: true, until: at(e % 1440) };
  }
  for (const [, e] of week[(today + 6) % 7] ?? []) if (e > 1440 && m < e - 1440) return { open: true, until: at(e - 1440) };
  return { open: false };
}

/** The week Monday first, consecutive days with the same hours on one line: "Mon–Thu 11:30 AM–10 PM". Pure. */
export function weekLines(week: Week): string[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const label = (d: number) => (week[d]!.length ? week[d]!.map(span).join(", ") : "Closed");
  const lines: { from: number; to: number; text: string }[] = [];
  for (const d of order) {
    const last = lines.at(-1);
    if (last && last.text === label(d)) last.to = d;
    else lines.push({ from: d, to: d, text: label(d) });
  }
  return lines.map((l) => `${DAY_NAME[l.from]}${l.to === l.from ? "" : `–${DAY_NAME[l.to]}`} ${l.text}`);
}

// ---- Reading and fetching ----

/** One Nominatim lookup result (jsonv2, extratags) → what the page shows, or null when there's nothing. Pure. */
export function placeFromNominatim(r: unknown): PlaceExtras | null {
  const x = r as any;
  if (!x || typeof x !== "object") return null;
  const t = x.extratags && typeof x.extratags === "object" ? x.extratags : {};
  const cuisine = str(t.cuisine)?.split(";").map(words).filter(Boolean).join(", ");
  const type = KIND_CATEGORIES.has(x.category) && str(x.type) && x.type !== "yes" ? capital(words(x.type)) : null;
  const hours = str(t.opening_hours);
  const phone = str(t.phone) ?? str(t["contact:phone"]);
  const place: PlaceExtras = {
    kind: [cuisine && capital(cuisine), type].filter(Boolean).join(" · ") || null,
    hours: hours && parseHours(hours) ? hours : null,
    website: https(t.website) ?? https(t["contact:website"]),
    phone: phone && PHONE.test(phone) ? phone : null,
    menu: https(t["website:menu"]),
    reservation: RESERVATIONS.includes(t.reservation) ? t.reservation : null,
    reservationUrl: https(t["reservation:website"]),
    features: FEATURES.filter(([tag]) => t[tag] === "yes").map(([, label]) => label),
  };
  const { features, ...rest } = place;
  return features.length || Object.values(rest).some((v) => v !== null) ? place : null;
}

/** links.openstreetmap → Nominatim's lookup id ("N1171650361"), or null. Pure. */
export function osmLookupId(links: unknown): string | null {
  const m = OSM_LINK.exec(String((links as Record<string, unknown> | null)?.openstreetmap ?? ""));
  return m ? `${m[1]![0]!.toUpperCase()}${m[2]}` : null;
}

/** A matched place's details: one rate-limited Nominatim lookup. A 429/5xx or a timeout throws, for the lane to handle. */
export async function fetchPlaceDetails(links: unknown, fetchImpl: typeof fetch = fetch): Promise<PlaceExtras | null> {
  const id = osmLookupId(links);
  if (!id) return null;
  await nominatimSlot();
  const json = await getJson(`https://nominatim.openstreetmap.org/lookup?osm_ids=${id}&format=jsonv2&extratags=1&addressdetails=0`,
    { headers: nominatimHeaders() }, fetchImpl);
  return Array.isArray(json) ? placeFromNominatim(json[0]) : null;
}

/** The stored jsonb, as far as the page may trust it. Pure. */
export function readPlace(raw: unknown): PlaceExtras | null {
  const x = raw as any;
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const hours = str(x.hours);
  const phone = str(x.phone);
  return {
    kind: str(x.kind),
    hours: hours && parseHours(hours) ? hours : null,
    website: https(x.website),
    phone: phone && PHONE.test(phone) ? phone : null,
    menu: https(x.menu),
    reservation: RESERVATIONS.includes(x.reservation) ? x.reservation : null,
    reservationUrl: https(x.reservationUrl),
    features: Array.isArray(x.features) ? x.features.filter((f: unknown): f is string => typeof f === "string" && !!f) : [],
    ...(str(x.source?.site) && https(x.source?.url) ? { source: { site: str(x.source.site)!, url: https(x.source.url)! } } : {}),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
