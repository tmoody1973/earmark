import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../agent/lib/db";
import { runEpisode } from "../../agent/lib/episode/publish";
import { weekOfSunday } from "../../agent/lib/time";

// M5-T11 (MOO-921), real Neon `test` branch (TEST_DATABASE_URL, never production): the real episode insert,
// idempotency check and feed query. The script writer, Polly and Blob are fakes: no model, voice or upload calls.
process.env.EARMARK_FEED_TOKEN = "t".repeat(40); // before any getEnv() call: the env is cached on first read
const NOW_A = new Date("2099-03-04T17:00:00Z");
const NOW_B = new Date("2099-03-11T17:00:00Z");
const WEEK_A = weekOfSunday(NOW_A);
const WEEK_B = weekOfSunday(NOW_B);

const fakes = () => ({
  gather: vi.fn(async () => ({ growing: [], ready: [], newInCrate: [], dontForget: [], thanksOwed: [] })),
  write: vi.fn(async () => ({ title: "Inttest week", script: "Hello from the test." })),
  voice: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
  upload: vi.fn(async (week: string) => `https://blob.test/episodes/earmark-${week}-x.mp3`),
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("weekly episode (real Neon)", () => {
  const clean = () => db()`delete from episodes where week_of in (${WEEK_A}, ${WEEK_B})`;
  beforeAll(clean);
  afterAll(clean);

  it("inserts one unpublished episode for the week, and a second run does not spend again", async () => {
    const first = fakes();
    const a = await runEpisode(NOW_A, first as never);
    expect(first.write).toHaveBeenCalledTimes(1);
    expect(first.voice).toHaveBeenCalledTimes(1);

    const rows = (await db()`select week_of::text as week_of, script_md, audio_url, audio_bytes, published_at from episodes where week_of = ${WEEK_A}`) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ week_of: WEEK_A, audio_bytes: 4, published_at: null, script_md: "Inttest week\n\nHello from the test." });

    const second = fakes();
    const b = await runEpisode(NOW_A, second as never);
    expect(b).toEqual(a);
    expect(second.write).not.toHaveBeenCalled();
    expect(second.voice).not.toHaveBeenCalled();
    expect(second.upload).not.toHaveBeenCalled();
  });

  it("the feed lists only approved episodes", async () => {
    await runEpisode(NOW_B, fakes() as never);
    await db()`update episodes set published_at = now() where week_of = ${WEEK_B}`;
    const { GET } = await import("../../app/feed/[token]/route");
    const xml = await (await GET(new Request("https://earmark.test/feed/x"), { params: Promise.resolve({ token: "t".repeat(40) }) })).text();
    expect(xml).toContain(`earmark-${WEEK_B}`);
    expect(xml).not.toContain(`earmark-${WEEK_A}`); // WEEK_A was never approved
  });
});
