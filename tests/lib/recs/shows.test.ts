import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { readExtras } from "../../../agent/lib/enrich/extras";
import type { WebResult } from "../../../agent/lib/recs/web-find";
import {
  findShows, keepNearby, lookForShows, nextToTell, parseShows, readShows, showAlarm, showKey, showsQuery, showTodoDone, showTodoText, todayIn,
  type RawShow, type Show,
} from "../../../agent/lib/recs/shows";

// Shows nearby (decision 064), without the database: TinyFish, Nominatim and the model are fakes.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const TODAY = "2026-10-21";
const NOW = new Date("2026-10-21T17:00:00Z");
const HOME = { EARMARK_HOME_LAT: "43.04", EARMARK_HOME_LNG: "-87.91" };
const CITY = "Milwaukee, Wisconsin";
const results: WebResult[] = [
  { title: "Sault tour dates", snippet: "Nov 7 Cactus Club, Milwaukee", site_name: "songkick.com", url: "https://www.songkick.com/artists/sault" },
  { title: "Sault live", snippet: "Nov 9 Metro, Chicago", site_name: "bandsintown.com", url: "https://www.bandsintown.com/a/sault" },
];
const raw = (o: Partial<RawShow> = {}): RawShow => ({ date: "2026-11-07", venue: "Cactus Club", city: "Milwaukee, WI", result: 1, ...o });

describe("showsQuery", () => {
  it("is the artist's name, 'tour dates' and the home city only: never the excerpt or a person's name", () => {
    const tip = { type: "artist", canonical_name: "Sault", creator: null, excerpt: "SAID-VERBATIM Ann loves them", recommender_first_name: "Ann" };
    const q = showsQuery(tip as never, CITY);
    expect(q).toBe("Sault tour dates Milwaukee, Wisconsin");
    expect(q).not.toMatch(/SAID|Ann/);
  });
  it("uses an album's creator, and gives nothing for an album with no creator", () => {
    expect(showsQuery({ type: "album", canonical_name: "Untitled (Black Is)", creator: "Sault" }, CITY)).toBe("Sault tour dates Milwaukee, Wisconsin");
    expect(showsQuery({ type: "album", canonical_name: "Untitled", creator: null }, CITY)).toBeNull();
  });
});

describe("parseShows", () => {
  it("keeps a dated show with a venue and a source, in the next 30 days, each with its result's URL", () => {
    expect(parseShows([raw()], results, TODAY)).toEqual([
      { date: "2026-11-07", venue: "Cactus Club", city: "Milwaukee, WI", url: "https://www.songkick.com/artists/sault" },
    ]);
  });
  it("drops undated, venue-less, cityless, sourceless, past and >30-day shows, and bad dates", () => {
    const out = parseShows([
      raw({ date: null }), raw({ venue: null }), raw({ venue: "  " }), raw({ city: null }), raw({ result: null }), raw({ result: 9 }),
      raw({ date: "2026-10-20" }), raw({ date: "2026-11-21" }), raw({ date: "2026-02-30" }), raw({ date: "Nov 7" }),
    ], results, TODAY);
    expect(out).toEqual([]);
  });
  it("keeps today and day 30, sorted by date, without duplicates", () => {
    const out = parseShows([raw({ date: "2026-11-20", venue: "Metro", result: 2 }), raw({ date: TODAY }), raw({ date: TODAY, venue: "cactus club" })], results, TODAY);
    expect(out.map((s) => `${s.date} ${s.venue}`)).toEqual(["2026-10-21 Cactus Club", "2026-11-20 Metro"]);
  });
});

describe("keepNearby", () => {
  const show = (city: string): Show => ({ date: "2026-11-07", venue: "V", city, url: "https://x.example.com/" });
  it("keeps the home city without a lookup, and others only when they geocode within 150 km", async () => {
    const isNear = vi.fn(async (city: string) => city.startsWith("Chicago"));
    const out = await keepNearby([show("Milwaukee, WI"), show("Chicago, IL"), show("Portland, OR"), show("Chicago, IL")], CITY, isNear);
    expect(out.map((s) => s.city)).toEqual(["Milwaukee, WI", "Chicago, IL", "Chicago, IL"]);
    expect(isNear.mock.calls.map((c) => c[0])).toEqual(["Chicago, IL", "Portland, OR"]); // one lookup per city
  });
});

describe("the todo", () => {
  const show: Show = { date: "2026-11-07", venue: "Cactus Club", city: "Milwaukee, WI", url: "https://x.example.com/" };
  it("says '<artist> plays <venue> <Day Mon D>'", () => {
    expect(showTodoText("Sault", show)).toBe("Sault plays Cactus Club Sat Nov 7");
  });
  it("rings the day before, in the morning (Milwaukee time); a show tomorrow or today rings in a minute", () => {
    expect(showAlarm("2026-11-07", NOW)).toBe("2026-11-06T15:00:00.000Z");
    expect(showAlarm("2026-10-22", NOW)).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });
  it("tells each show once: the first one not told yet, by artist, date and venue", () => {
    const later = { ...show, date: "2026-11-09", venue: "Metro" };
    expect(nextToTell("Sault", [show, later], [])).toEqual(show);
    expect(nextToTell("Sault", [show, later], [showKey("Sault", show)])).toEqual(later);
    expect(nextToTell("Sault", [show, later], [showKey("SAULT", { ...show, venue: "cactus club" }), showKey("Sault", later)])).toBeUndefined();
  });
  it("today is Milwaukee's date", () => {
    expect(todayIn(new Date("2026-10-22T03:00:00Z"))).toBe("2026-10-21");
  });
});

describe("showTodoDone: a past show's todo is completed", () => {
  const show = (date: string, venue = "Cactus Club"): Show => ({ date, venue, city: "Milwaukee, WI", url: "https://x.example.com/" });
  const told = (...s: Show[]) => s.map((x) => showKey("Sault", x));
  it("is done the day after the show it names, not on the day itself", () => {
    const a = show("2026-10-20");
    expect(showTodoDone({ items: [a], told: told(a), todoDate: a.date }, "Sault", "2026-10-21")).toBe(true);
    expect(showTodoDone({ items: [a], told: told(a), todoDate: a.date }, "Sault", "2026-10-20")).toBe(false);
  });
  it("is not done while a newer show waits to be told (the next check refreshes it), and is once that show was told", () => {
    const a = show("2026-10-20");
    const b = show("2026-11-02", "Metro");
    expect(showTodoDone({ items: [a, b], told: told(a), todoDate: a.date }, "Sault", "2026-10-21")).toBe(false);
    expect(showTodoDone({ items: [a, b], told: told(a, b), todoDate: a.date }, "Sault", "2026-10-21")).toBe(true);
  });
  it("a cleared tip's todo is completed by a status effect", async () => {
    const { STATUS_EFFECTS } = await import("../../../agent/lib/recs/status-effects");
    expect(STATUS_EFFECTS.map((fx) => fx.name)).toContain("show-todo");
  });
  it("is never done without a known show date", () => {
    expect(showTodoDone(null, "Sault", TODAY)).toBe(false);
    expect(showTodoDone({ items: [], told: [] }, "Sault", TODAY)).toBe(false);
  });
});

describe("readShows", () => {
  it("one model call: artist, city, today and the results (no URLs), told the results are untrusted", async () => {
    const generateImpl = vi.fn(async () => ({ output: { shows: [raw()] } }));
    expect(await readShows("Sault", CITY, TODAY, results, { generateImpl: generateImpl as never, model: "test/model" })).toEqual([raw()]);
    const call = (generateImpl.mock.calls[0] as unknown as [{ instructions: string; prompt: string }])[0];
    expect(call.instructions).toMatch(/untrusted/);
    expect(call.prompt).toContain("Sault");
    expect(call.prompt).toContain(CITY);
    expect(call.prompt).toContain(TODAY);
    expect(call.prompt).not.toContain("https://");
  });
});

describe("findShows", () => {
  it("one TinyFish Search with the derived query, one model read, kept shows nearby only", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith("https://api.search.tinyfish.ai")) return json({ results });
      return json(url.includes("Chicago") ? [{ lat: "41.88", lon: "-87.63", display_name: "Chicago, Illinois", osm_type: "relation", osm_id: 1 }] : []);
    });
    const generateImpl = vi.fn(async () => ({ output: { shows: [raw(), raw({ date: "2026-11-09", venue: "Metro", city: "Chicago, IL", result: 2 }),
      raw({ date: "2026-11-10", venue: "Crystal Ballroom", city: "Portland, OR", result: 2 })] } }));
    const out = await findShows({ type: "artist", canonical_name: "Sault", creator: null }, { city: CITY, near: { lat: 43, lng: -87.9 } },
      { env: { TINYFISH_API_KEY: "k" }, fetchImpl: fetchImpl as never, generateImpl: generateImpl as never, model: "m", now: NOW });
    expect(out.map((s) => s.venue)).toEqual(["Cactus Club", "Metro"]);
    const search = new URL(fetchImpl.mock.calls[0]![0]);
    expect(search.searchParams.get("query")).toBe("Sault tour dates Milwaukee, Wisconsin");
  });
});

describe("lookForShows: off", () => {
  beforeEach(() => { h.mock = makeMockDb(); });
  it("does nothing, and reads nothing, while TINYFISH_API_KEY is unset", async () => {
    const fetchImpl = vi.fn();
    expect(await lookForShows({ env: { ...HOME }, fetchImpl: fetchImpl as never })).toEqual({ checked: 0, found: 0, told: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(h.mock.calls).toHaveLength(0);
  });
  it("does nothing without a home location", async () => {
    const fetchImpl = vi.fn();
    expect(await lookForShows({ env: { TINYFISH_API_KEY: "k" }, fetchImpl: fetchImpl as never })).toEqual({ checked: 0, found: 0, told: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(h.mock.calls).toHaveLength(0);
  });
  it("skips every tip when the home city can't be named: no search, no write", async () => {
    h.mock.queue.push([{ id: "5", type: "artist", canonical_name: "Sault", creator: null, enriched_key: "k", shows: null }]);
    const fetchImpl = vi.fn(async () => json({}, 500));
    expect(await lookForShows({ env: { TINYFISH_API_KEY: "k", ...HOME }, fetchImpl: fetchImpl as never }))
      .toEqual({ checked: 0, found: 0, told: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // the Nominatim reverse lookup only
    expect(String((fetchImpl.mock.calls[0] as unknown as [string])[0])).toContain("nominatim.openstreetmap.org/reverse");
    expect(h.mock.calls).toHaveLength(1); // the select; no write
  });
});

describe("readExtras: the page's shows", () => {
  it("reads extras.shows.items, https sources only, every field the right shape", () => {
    const good = { date: "2026-11-07", venue: "Cactus Club", city: "Milwaukee, WI", url: "https://www.songkick.com/a" };
    const items = [good, { ...good, url: "ftp://x.example.com/" }, { ...good, date: "soon" }, { ...good, venue: 3 }];
    expect(readExtras({ shows: { checkedAt: "x", told: [], items } })).toEqual({ shows: [good] });
    expect(readExtras({ shows: { checkedAt: "x", items: [], told: [] } })).toEqual({});
  });
});
