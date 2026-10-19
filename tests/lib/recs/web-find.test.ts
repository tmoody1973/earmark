import { describe, expect, it, vi } from "vitest";
import type { EnrichQuery } from "../../../agent/lib/enrich/types";
import type { StoredCandidate } from "../../../agent/lib/garden/which-one";
import { findOnWeb, readWebResults, searchWeb, webQuery, type WebResult, type WebTip } from "../../../agent/lib/recs/web-find";

// "Find it on the web" (decision 051), without the database: TinyFish, the model and the catalogs are fakes.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const EXCERPT = "SAID-VERBATIM you have to hear her new albums as a tribute to Sun Raw Records";
const tip: WebTip = { id: 7, type: "album", canonical_name: "Sun Ra-inspired album", creator: "Jimetta Rose",
  context_summary: "Ann says it is a tribute to Sun Ra and the best thing she heard all year." };
const ENV = { TINYFISH_API_KEY: "tf-test-key" };
const result = (title: string, url: string, site = new URL(url).host): WebResult => ({ title, snippet: `${title} snippet`, site_name: site, url });
const RESULTS = [
  result("Jimetta Rose: MettaSun", "https://jimettarose.bandcamp.com/album/mettasun"),
  result("Jimetta Rose on MettaSun, her Sun Ra tribute album", "https://magz.example.com/mettasun"),
];
const tinyfish = (results: WebResult[] = RESULTS, status = 200) =>
  vi.fn(async () => (status === 200 ? json({ query: "q", results, total_results: results.length, page: 0 }) : json({ error: { code: "X" } }, status)));
const answer = (options: { title: string; creator: string | null; result: number | null }[]) =>
  vi.fn(async () => ({ output: { options } })) as never;
const cand = (name: string, creator: string | null, over: Partial<StoredCandidate> = {}): StoredCandidate => ({
  provider: "apple", canonicalName: name, creator, yearOrAddress: "2026", imageUrl: "https://is1/600x600.jpg",
  links: { apple_music: `https://music.apple.com/us/album/${name.length}` }, appleMusicId: String(name.length), ...over,
});
const catalog = (byName: Record<string, StoredCandidate[]>) => vi.fn(async (q: EnrichQuery) => byName[q.name] ?? []);

describe("webQuery", () => {
  it("is built from Earmark's derived words only (name, creator, type word, why), never what Bee transcribed", () => {
    const q = webQuery({ ...tip, excerpt: EXCERPT, raw_text: EXCERPT } as WebTip);
    expect(q).toContain("Sun Ra-inspired album");
    expect(q).toContain("Jimetta Rose");
    expect(q).not.toContain("SAID-VERBATIM");
    expect(q).not.toContain("Sun Raw Records");
    expect(q.length).toBeLessThanOrEqual(120);
  });

  it("clips at a word boundary and leaves out a missing creator and why", () => {
    expect(webQuery({ ...tip, creator: null, context_summary: null, type: "book" })).toBe("Sun Ra-inspired album book");
    const long = webQuery({ ...tip, context_summary: "word ".repeat(60) });
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(" ")).toBe(false);
    expect(long).toMatch(/word$/);
  });
});

describe("searchWeb", () => {
  it("GETs TinyFish Search with the key header, the purpose, US/en, and keeps the top 5 results", async () => {
    const many = Array.from({ length: 8 }, (_, i) => result(`R${i}`, `https://r${i}.example.com/`));
    const fetchImpl = tinyfish(many);
    const found = await searchWeb("MettaSun Jimetta Rose album", "identify the exact title of a recommended album", "tf-test-key", fetchImpl as never);
    expect(found.map((r) => r.title)).toEqual(["R0", "R1", "R2", "R3", "R4"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin).toBe("https://api.search.tinyfish.ai");
    expect(Object.fromEntries(u.searchParams)).toEqual({ query: "MettaSun Jimetta Rose album",
      purpose: "identify the exact title of a recommended album", location: "US", language: "en" });
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("tf-test-key");
  });

  it.each([401, 402, 429, 503])("a %i throws ProviderHttpError (the lane retries later)", async (status) => {
    await expect(searchWeb("q", "p", "k", tinyfish([], status) as never)).rejects.toMatchObject({ name: "ProviderHttpError", status });
  });

  it("skips results without a title or an https URL", async () => {
    const found = await searchWeb("q", "p", "k", tinyfish([result("Ok", "https://ok.example.com/"), { title: "", snippet: "", site_name: "x", url: "https://x.example.com/" },
      { title: "Plain", snippet: "", site_name: "x", url: "http://plain.example.com/" }]) as never);
    expect(found.map((r) => r.title)).toEqual(["Ok"]);
  });
});

describe("readWebResults", () => {
  it("returns up to 3 distinct options, most likely first, each with the URL of the result about it", async () => {
    const generateImpl = answer([
      { title: "MettaSun", creator: "Jimetta Rose", result: 1 },
      { title: "mettasun", creator: "JIMETTA ROSE", result: 2 }, // the same item again
      { title: "Love Is", creator: "Jimetta Rose", result: 9 }, // no such result
      { title: "Sun Ra Tribute", creator: null, result: null },
      { title: "A fourth", creator: null, result: null },
    ]);
    const options = await readWebResults("q", RESULTS, { generateImpl, model: "test/model" });
    expect(options).toEqual([
      { title: "MettaSun", creator: "Jimetta Rose", url: "https://jimettarose.bandcamp.com/album/mettasun" },
      { title: "Love Is", creator: "Jimetta Rose", url: null },
      { title: "Sun Ra Tribute", creator: null, url: null },
    ]);
  });

  it("the model sees the query words and the results' title, snippet and site name, and nothing else", async () => {
    const generateImpl = answer([]);
    await readWebResults("Sun Ra-inspired album Jimetta Rose album", RESULTS, { generateImpl, model: "test/model" });
    const call = (generateImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { prompt: string; model: string };
    expect(call.model).toBe("test/model");
    expect(call.prompt).toContain("Sun Ra-inspired album Jimetta Rose album");
    expect(call.prompt).toContain("Jimetta Rose: MettaSun");
    expect(call.prompt).toContain("jimettarose.bandcamp.com");
    expect(call.prompt).not.toContain("https://"); // URLs stay out of the prompt; the answer names a result number
  });
});

describe("findOnWeb", () => {
  const deps = (o: { fetchImpl?: unknown; generateImpl?: unknown; search?: unknown; env?: Record<string, string> } = {}) =>
    ({ env: ENV, fetchImpl: tinyfish(), model: "test/model", ...o }) as never;

  it("one option and exactly one catalog item with its exact name and creator: the match", async () => {
    const hit = cand("MettaSun", "Jimetta Rose");
    const search = catalog({ MettaSun: [cand("Love Is", "Jimetta Rose"), hit] });
    const found = await findOnWeb(tip, deps({ generateImpl: answer([{ title: "MettaSun", creator: "Jimetta Rose", result: 1 }]), search }));
    expect(found).toEqual({ kind: "match", match: { ...hit, matchConfidence: 1 } });
    expect(search).toHaveBeenCalledWith({ type: "album", name: "MettaSun", creator: "Jimetta Rose", lat: null, lng: null });
  });

  it("a MusicBrainz-only match with no art yet is marked for the lane's art retry", async () => {
    const hit = cand("MettaSun", "Jimetta Rose", { provider: "musicbrainz", imageUrl: null, releaseGroupId: "rg-1", appleMusicId: undefined });
    const found = await findOnWeb(tip, deps({ generateImpl: answer([{ title: "MettaSun", creator: "Jimetta Rose", result: 1 }]),
      search: catalog({ MettaSun: [hit] }) }));
    expect(found).toMatchObject({ kind: "match", match: { artRetry: "rg-1", matchConfidence: 1 } });
  });

  it("two options: every exact catalog hit becomes a Which one? option, nothing is matched", async () => {
    const a = cand("MettaSun", "Jimetta Rose");
    const b = cand("Space Is the Place", "Sun Ra");
    const found = await findOnWeb(tip, deps({
      generateImpl: answer([{ title: "MettaSun", creator: "Jimetta Rose", result: 1 }, { title: "Space Is the Place", creator: "Sun Ra", result: null }]),
      search: catalog({ MettaSun: [a, cand("Metta", "Someone Else")], "Space Is the Place": [b] }) }));
    expect(found).toEqual({ kind: "options", candidates: [a, b] });
  });

  it("one option but two catalog items with that name and creator: options, not a match", async () => {
    const a = cand("MettaSun", "Jimetta Rose");
    const b = cand("MettaSun", "Jimetta Rose", { provider: "musicbrainz", yearOrAddress: "2025", mbid: "rg-2" });
    const found = await findOnWeb(tip, deps({ generateImpl: answer([{ title: "MettaSun", creator: "Jimetta Rose", result: 1 }]),
      search: catalog({ MettaSun: [a, b] }) }));
    expect(found).toEqual({ kind: "options", candidates: [a, b] });
  });

  it("an option with no creator never settles a tip on its own", async () => {
    const a = cand("MettaSun", "Jimetta Rose");
    const found = await findOnWeb(tip, deps({ generateImpl: answer([{ title: "MettaSun", creator: null, result: 1 }]),
      search: catalog({ MettaSun: [a] }) }));
    expect(found).toEqual({ kind: "options", candidates: [a] });
  });

  it("no catalog has it (Bandcamp only): one web option, the page about it, fetched only if the owner picks it", async () => {
    const fetchImpl = tinyfish();
    const found = await findOnWeb(tip, deps({ fetchImpl, generateImpl: answer([{ title: "MettaSun", creator: "Jimetta Rose", result: 1 }]),
      search: catalog({ MettaSun: [cand("Love Is", "Jimetta Rose")] }) }));
    expect(found).toEqual({ kind: "options", candidates: [{ provider: "web", canonicalName: "MettaSun", creator: "Jimetta Rose",
      yearOrAddress: null, detail: "jimettarose.bandcamp.com", imageUrl: null, links: { web: "https://jimettarose.bandcamp.com/album/mettasun" } }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // TinyFish only: the page itself is never fetched here
  });

  it("nothing in any catalog and no page about it: nothing", async () => {
    const found = await findOnWeb(tip, deps({ generateImpl: answer([{ title: "MettaSun", creator: "Jimetta Rose", result: null }]), search: catalog({}) }));
    expect(found).toEqual({ kind: "nothing" });
  });

  it("no web results: the model is never asked", async () => {
    const generateImpl = answer([]);
    expect(await findOnWeb(tip, deps({ fetchImpl: tinyfish([]), generateImpl, search: catalog({}) }))).toEqual({ kind: "nothing" });
    expect(generateImpl).not.toHaveBeenCalled();
  });

  it("TINYFISH_API_KEY unset: no call at all", async () => {
    const fetchImpl = tinyfish();
    const generateImpl = answer([]);
    expect(await findOnWeb(tip, deps({ env: {}, fetchImpl, generateImpl, search: catalog({}) }))).toEqual({ kind: "nothing" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(generateImpl).not.toHaveBeenCalled();
  });

  it("a 429 from TinyFish is thrown for the lane (retry later); the model and catalogs are never asked", async () => {
    const generateImpl = answer([]);
    const search = catalog({});
    await expect(findOnWeb(tip, deps({ fetchImpl: tinyfish([], 429), generateImpl, search }))).rejects.toMatchObject({ status: 429 });
    expect(generateImpl).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("the purpose names the tip's kind of item", async () => {
    const fetchImpl = tinyfish([]);
    await findOnWeb({ ...tip, type: "artist" }, deps({ fetchImpl, search: catalog({}) }));
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get("purpose")).toBe("identify the exact name of a recommended musician");
  });
});
